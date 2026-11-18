import json
from unittest.mock import MagicMock, patch

from backend.database.models import ExamResult, ExamSummary, Exam, ProcessingStatus
from backend.services.ai_service import (
    ExtractedExamData,
    ExtractedExamResult,
    call_gemini_structured_extraction,
    extract_text_from_pdf,
    generate_consolidated_summary,
    process_exam_with_ai,
)


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

    extracted = call_gemini_structured_extraction(
        "Texto do exame",
        idade=34,
        sexo="feminino",
    )

    assert extracted.laboratory_name == "Laboratório Central"
    assert extracted.results[0].parameter_name == "Glicemia"
    assert extracted.results[0].value == 105.0
    prompt = mock_client.models.generate_content.call_args.kwargs["contents"]
    assert "idade: 34 anos" in prompt
    assert "sexo biológico: feminino" in prompt
    assert "faixa de referência exata" in prompt


@patch("backend.services.ai_service.client")
def test_generate_summary_uses_only_selected_user_results(
    mock_client, db_session, create_user, create_exam_result
):
    maria = create_user("Maria", idade=34, sexo="feminino")
    joao = create_user("João")
    create_exam_result(maria, "glicemia")
    create_exam_result(joao, "colesterol")

    mock_response = MagicMock()
    mock_response.text = "Resumo da Maria"
    mock_client.models.generate_content.return_value = mock_response

    summary = generate_consolidated_summary(db_session, user_id=maria.id)

    assert summary == "Resumo da Maria"
    prompt = mock_client.models.generate_content.call_args.kwargs["contents"]
    assert "glicemia" in prompt
    assert "colesterol" not in prompt
    assert "idade: 34 anos" in prompt
    assert "sexo biológico: feminino" in prompt


@patch("backend.services.ai_service.generate_consolidated_summary")
@patch("backend.services.ai_service.call_gemini_structured_extraction")
@patch("backend.services.ai_service.extract_text_from_pdf")
def test_process_exam_with_ai_completes_exam_and_creates_user_summary(
    mock_extract_text,
    mock_extract_data,
    mock_generate_summary,
    db_session,
    dummy_pdf_file,
    create_user,
):
    user = create_user("Maria", idade=34, sexo="feminino")
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

    mock_extract_data.assert_called_once_with(
        "Texto do exame",
        idade=34,
        sexo="feminino",
    )
    db_session.refresh(exam)
    summary = db_session.query(ExamSummary).one()
    result = db_session.query(ExamResult).one()
    assert exam.status == ProcessingStatus.COMPLETED
    assert exam.user_id == user.id
    assert result.parameter_name == "Ferritina"
    assert summary.user_id == user.id
    assert summary.summary_text == "Resumo da Maria"
