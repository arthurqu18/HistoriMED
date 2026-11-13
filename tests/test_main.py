import io
import json
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api import app
from backend.database.connection import Base, get_db
from backend.database.models import (
    Exam,
    ExamResult,
    ExamSummary,
    ProcessingStatus,
    User,
)
from backend.services.ai_service import (
    ExtractedExamData,
    ExtractedExamResult,
    call_gemini_structured_extraction,
    extract_text_from_pdf,
    generate_consolidated_summary,
    process_exam_with_ai,
)


TEST_DATABASE_URL = "sqlite:///:memory:"
test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=test_engine)


@pytest.fixture
def db_session():
    Base.metadata.create_all(bind=test_engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def dummy_pdf_file(tmp_path):
    pdf_path = tmp_path / "exam.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    with pdf_path.open("wb") as file:
        writer.write(file)
    return pdf_path


def create_user(db_session, name):
    user = User(name=name)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def create_exam_result(db_session, user, parameter_name):
    exam = Exam(
        user_id=user.id,
        file_name=f"{parameter_name}.pdf",
        file_url=f"/tmp/{parameter_name}.pdf",
        status=ProcessingStatus.COMPLETED,
    )
    db_session.add(exam)
    db_session.flush()
    result = ExamResult(
        exam_id=exam.id,
        parameter_name=parameter_name,
        value=10.0,
        unit="mg/dL",
        reference_range="0-20",
        is_abnormal=0,
        measured_at=datetime(2026, 4, 6),
    )
    db_session.add(result)
    db_session.commit()
    return exam


def test_register_user_returns_created_user(client):
    response = client.post("/users/register", json={"name": "Maria"})

    assert response.status_code == 201
    assert response.json()["name"] == "Maria"
    assert response.json()["id"] > 0


def test_register_user_rejects_duplicate_name(client):
    client.post("/users/register", json={"name": "Maria"})

    response = client.post("/users/register", json={"name": "Maria"})

    assert response.status_code == 400
    assert response.json()["detail"] == "Usuário já cadastrado"


def test_show_users_returns_available_users(client):
    client.post("/users/register", json={"name": "Maria"})
    client.post("/users/register", json={"name": "João"})

    response = client.get("/users/show_users")

    assert response.status_code == 200
    assert [user["name"] for user in response.json()] == ["Maria", "João"]


@patch("backend.api.process_exam_with_ai")
def test_upload_exam_associates_user_and_sanitizes_filename(
    mock_process_exam, client, db_session, tmp_path, monkeypatch
):
    user = create_user(db_session, "Maria")
    monkeypatch.setattr("backend.api.UPLOAD_DIR", str(tmp_path))

    response = client.post(
        f"/users/{user.id}/upload-exam/",
        data={"laboratory_name": "Laboratório Central"},
        files={
            "file": (
                "../../laudo com espaços.pdf",
                io.BytesIO(b"%PDF-1.4 test"),
                "application/pdf",
            )
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["user_id"] == user.id
    assert data["file_name"] == "laudo_com_espa_os.pdf"
    assert data["laboratory_name"] == "Laboratório Central"

    stored_file = Path(data["file_url"])
    assert stored_file.parent == tmp_path
    assert stored_file.exists()
    assert stored_file.name.endswith("_laudo_com_espa_os.pdf")
    mock_process_exam.assert_called_once()


def test_upload_exam_rejects_unknown_user(client, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.api.UPLOAD_DIR", str(tmp_path))

    response = client.post(
        "/users/999/upload-exam/",
        files={"file": ("exam.pdf", io.BytesIO(b"%PDF-1.4 test"), "application/pdf")},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "User não encontrado"


def test_dashboard_returns_only_selected_user_data(client, db_session):
    maria = create_user(db_session, "Maria")
    joao = create_user(db_session, "João")
    maria_exam = create_exam_result(db_session, maria, "glicemia")
    create_exam_result(db_session, joao, "colesterol")
    db_session.add(
        ExamSummary(
            user_id=maria.id,
            summary_text="Resumo da Maria",
            generated_at=datetime(2026, 4, 6),
        )
    )
    db_session.commit()

    response = client.get(f"/users/{maria.id}/dashboard")

    assert response.status_code == 200
    data = response.json()
    assert data["user_name"] == "Maria"
    assert data["summary"] == "Resumo da Maria"
    assert [result["parameter_name"] for result in data["results_history"]] == [
        "glicemia"
    ]
    assert maria_exam.user_id == maria.id


def test_dashboard_for_new_user_has_empty_history(client, db_session):
    user = create_user(db_session, "Maria")

    response = client.get(f"/users/{user.id}/dashboard")

    assert response.status_code == 200
    assert response.json()["summary"] == "Nenhum resumo disponível ainda."
    assert response.json()["results_history"] == []


def test_extract_text_from_pdf_reads_pdf_content(dummy_pdf_file):
    extracted_text = extract_text_from_pdf(str(dummy_pdf_file))

    assert isinstance(extracted_text, str)


@patch("backend.services.ai_service.client")
def test_call_gemini_structured_extraction_returns_exam_data(mock_client):
    mock_response = MagicMock()
    mock_response.text = json.dumps(
        {
            "laboratory_name": "Laboratório Central",
            "exam_date": "2026-04-06T11:00:00",
            "results": [
                {
                    "category": "Bioquímica",
                    "parameter_name": "Glicemia",
                    "value": 105.0,
                    "unit": "mg/dL",
                    "reference_range": "70 - 99 mg/dL",
                    "is_abnormal": 1,
                }
            ],
        }
    )
    mock_client.models.generate_content.return_value = mock_response

    extracted = call_gemini_structured_extraction("Texto do exame")

    assert extracted.laboratory_name == "Laboratório Central"
    assert extracted.results[0].parameter_name == "Glicemia"
    assert extracted.results[0].value == 105.0


@patch("backend.services.ai_service.client")
def test_generate_summary_uses_only_selected_user_results(mock_client, db_session):
    maria = create_user(db_session, "Maria")
    joao = create_user(db_session, "João")
    create_exam_result(db_session, maria, "glicemia")
    create_exam_result(db_session, joao, "colesterol")

    mock_response = MagicMock()
    mock_response.text = "Resumo da Maria"
    mock_client.models.generate_content.return_value = mock_response

    summary = generate_consolidated_summary(db_session, user_id=maria.id)

    assert summary == "Resumo da Maria"
    prompt = mock_client.models.generate_content.call_args.kwargs["contents"]
    assert "glicemia" in prompt
    assert "colesterol" not in prompt


@patch("backend.services.ai_service.generate_consolidated_summary")
@patch("backend.services.ai_service.call_gemini_structured_extraction")
@patch("backend.services.ai_service.extract_text_from_pdf")
def test_process_exam_with_ai_completes_exam_and_creates_user_summary(
    mock_extract_text,
    mock_extract_data,
    mock_generate_summary,
    db_session,
    dummy_pdf_file,
):
    user = create_user(db_session, "Maria")
    exam = Exam(
        user_id=user.id,
        file_name="exam.pdf",
        file_url=str(dummy_pdf_file),
        status=ProcessingStatus.PENDING,
    )
    db_session.add(exam)
    db_session.commit()

    mock_extract_text.return_value = "Texto do exame"
    mock_extract_data.return_value = ExtractedExamData(
        laboratory_name="Laboratório Central",
        exam_date="2026-04-06T11:00:00",
        results=[
            ExtractedExamResult(
                parameter_name="Ferritina",
                value=117.1,
                unit="ng/mL",
                reference_range="22 a 299 ng/mL",
                is_abnormal=0,
            )
        ],
    )
    mock_generate_summary.return_value = "Resumo da Maria"

    process_exam_with_ai(exam.id, db_session)

    db_session.refresh(exam)
    summary = db_session.query(ExamSummary).one()
    result = db_session.query(ExamResult).one()
    assert exam.status == ProcessingStatus.COMPLETED
    assert exam.user_id == user.id
    assert result.parameter_name == "Ferritina"
    assert summary.user_id == user.id
    assert summary.summary_text == "Resumo da Maria"
