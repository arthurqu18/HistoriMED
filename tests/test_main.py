import os
import io
import json
from datetime import datetime
import pytest
from unittest.mock import MagicMock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from database.connection import Base, get_db
from database.models import Exam, ExamResult, ExamSummary, ProcessingStatus
from api import app
from services.ai_services import (
    extract_text_from_pdf,
    call_gemini_structured_extraction,
    generate_consolidated_summary,
    process_exam_with_ai,
    ExtractedExamData,
    ExtractedExamResult
)

# -------------------------------------------------------------------
# CONFIGURAÇÃO DE AMBIENTE DE TESTE (BANCO DE DADOS EM MEMÓRIA)
# -------------------------------------------------------------------
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function")
def db_session():
    """Cria tabelas limpas no banco de dados SQLite em memória para cada teste."""
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def client(db_session):
    """Substitui a dependência de banco de dados do FastAPI pela sessão de testes."""
    def _override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def dummy_pdf_file(tmp_path):
    """Gera um arquivo PDF válido temporário em disco para simular o upload."""
    pdf_path = tmp_path / "exame_teste.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    
    with open(pdf_path, "wb") as f:
        writer.write(f)
        
    return str(pdf_path)


# -------------------------------------------------------------------
# 1. TESTES DO SERVIÇO DE IA (ai_services.py)
# -------------------------------------------------------------------

def test_extract_text_from_pdf(dummy_pdf_file):
    """Garante que a função de leitura de PDF executa sem falhar."""
    text = extract_text_from_pdf(dummy_pdf_file)
    assert isinstance(text, str)


@patch("services.ai_services.client")
def test_call_gemini_structured_extraction(mock_gemini_client):
    """Testa a conversão da resposta da API do Gemini para os modelos Pydantic."""
    mock_json_response = json.dumps({
        "laboratory_name": "Laboratório Central",
        "exam_date": "2026-04-06T11:00:00",
        "results": [
            {
                "category": "Bioquímica",
                "parameter_name": "Glicemia",
                "value": 105.0,
                "unit": "mg/dL",
                "reference_range": "70 - 99 mg/dL",
                "is_abnormal": 1
            }
        ]
    })
    
    # Mock do objeto de resposta do Gemini
    mock_response = MagicMock()
    mock_response.text = mock_json_response
    mock_gemini_client.models.generate_content.return_value = mock_response

    extracted = call_gemini_structured_extraction("Texto do laudo simulado")

    assert extracted.laboratory_name == "Laboratório Central"
    assert len(extracted.results) == 1
    assert extracted.results[0].parameter_name == "Glicemia"
    assert extracted.results[0].value == 105.0
    assert extracted.results[0].is_abnormal == 1


@patch("services.ai_services.client")
def test_generate_consolidated_summary(mock_gemini_client, db_session):
    """Testa a geração do resumo consolidado em tópicos a partir do banco de dados."""
    exam = Exam(
        file_name="teste.pdf",
        file_url="/tmp/teste.pdf",
        status=ProcessingStatus.COMPLETED
    )
    db_session.add(exam)
    db_session.commit()

    result = ExamResult(
        exam_id=exam.id,
        category="Bioquímica",
        parameter_name="Hemoglobina Glicada",
        value=6.2,
        unit="%",
        reference_range="Até 5.7%",
        is_abnormal=1,
        measured_at=datetime(2026, 4, 6)
    )
    db_session.add(result)
    db_session.commit()

    mock_response = MagicMock()
    mock_response.text = "- Hemoglobina glicada alterada em 6,2%. Sugere atenção metabólica."
    mock_gemini_client.models.generate_content.return_value = mock_response

    summary_text = generate_consolidated_summary(db_session)

    assert "Hemoglobina glicada alterada" in summary_text
    mock_gemini_client.models.generate_content.assert_called_once()


@patch("services.ai_services.generate_consolidated_summary")
@patch("services.ai_services.call_gemini_structured_extraction")
@patch("services.ai_services.extract_text_from_pdf")
def test_process_exam_with_ai_success(
    mock_extract_text, mock_call_gemini, mock_gen_summary, db_session, dummy_pdf_file
):
    """Testa o pipeline completo de processamento (PDF -> Gemini -> Banco de Dados)."""
    # 1. Cria o exame pendente
    exam = Exam(
        file_name="exame_teste.pdf",
        file_url=dummy_pdf_file,
        status=ProcessingStatus.PENDING
    )
    db_session.add(exam)
    db_session.commit()
    db_session.refresh(exam)

    # 2. Configura os mocks
    mock_extract_text.return_value = "Texto simulado do exame"
    mock_call_gemini.return_value = ExtractedExamData(
        laboratory_name="Laboratório HSPE",
        exam_date="2026-04-06T11:00:00",
        results=[
            ExtractedExamResult(
                category="Bioquímica",
                parameter_name="Ferritina Sérica",
                value=117.1,
                unit="ng/mL",
                reference_range="22 a 299 ng/mL",
                is_abnormal=0
            )
        ]
    )
    mock_gen_summary.return_value = "- Ferritina em nível adequado."

    # 3. Executa a função do serviço
    process_exam_with_ai(exam.id, db_session)

    # 4. Verificações no banco
    db_session.refresh(exam)
    assert exam.status == ProcessingStatus.COMPLETED
    assert exam.laboratory_name == "Laboratório HSPE"

    results = db_session.query(ExamResult).filter(ExamResult.exam_id == exam.id).all()
    assert len(results) == 1
    assert results[0].parameter_name == "Ferritina Sérica"
    assert results[0].value == 117.1

    summary = db_session.query(ExamSummary).first()
    assert summary is not None
    assert summary.summary_text == "- Ferritina em nível adequado."


# -------------------------------------------------------------------
# 2. TESTES DAS ROTAS DA API (api.py)
# -------------------------------------------------------------------

@patch("api.process_exam_with_ai")
def test_upload_exam_route(mock_bg_process, client, tmp_path):
    """Testa o upload de um arquivo PDF via endpoint HTTP."""
    fake_pdf_content = b"%PDF-1.4 Mock Content"
    
    response = client.post(
        "/upload-exam/",
        data={"laboratory_name": "Laboratório Fleury"},
        files={"file": ("exame.pdf", io.BytesIO(fake_pdf_content), "application/pdf")}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["file_name"] == "exame.pdf"
    assert data["status"] == "pending"
    assert data["laboratory_name"] == "Laboratório Fleury"


def test_get_dashboard_route_empty(client):
    """Testa a rota de dashboard quando ainda não existem dados gravados."""
    response = client.get("/dashboard")
    assert response.status_code == 200
    data = response.json()
    assert data["summary"] == "Nenhum resumo disponível ainda."
    assert data["results_history"] == []


def test_get_dashboard_route_with_data(client, db_session):
    """Testa a rota de dashboard populada com histórico de indicadores."""
    exam = Exam(file_name="teste.pdf", file_url="/tmp/teste.pdf", status=ProcessingStatus.COMPLETED)
    db_session.add(exam)
    db_session.commit()

    result = ExamResult(
        exam_id=exam.id,
        category="Hemograma",
        parameter_name="Hemácias",
        value=5.72,
        unit="10^6/mm3",
        reference_range="4.5 a 5.5",
        is_abnormal=1,
        measured_at=datetime(2026, 4, 6)
    )
    summary = ExamSummary(summary_text="- Hemácias levemente elevadas.")
    
    db_session.add_all([result, summary])
    db_session.commit()

    response = client.get("/dashboard")
    assert response.status_code == 200
    data = response.json()
    
    assert data["summary"] == "- Hemácias levemente elevadas."
    assert len(data["results_history"]) == 1
    assert data["results_history"][0]["parameter_name"] == "Hemácias"
    assert data["results_history"][0]["value"] == 5.72