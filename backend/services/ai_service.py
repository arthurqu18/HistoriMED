from datetime import datetime
from sqlalchemy.orm import Session
from database.models import Exam, ExamResult, ExamSummary, ProcessingStatus


def is_abnormal(value: float, reference_min=None, reference_max=None) -> bool:
    """Retorna se o valor está fora dos limites de referência disponíveis."""
    if reference_min is not None and value < reference_min:
        return True
    if reference_max is not None and value > reference_max:
        return True
    return False


def ref_label(reference_range=None, reference_min=None, reference_max=None) -> str:
    """Formata a referência, usando os limites quando não há rótulo pronto."""
    if reference_range:
        return reference_range
    if reference_min is not None or reference_max is not None:
        minimum = reference_min if reference_min is not None else "—"
        maximum = reference_max if reference_max is not None else "—"
        return f"{minimum} – {maximum}"
    return "—"


def process_exam_with_ai(exam_id: int, db: Session):
    """
    Simula a extração de dados via OCR + LLM.
    Em produção, aqui entraria a chamada para Textract / Vision API e GPT-4o.
    """
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        return

    exam.status = ProcessingStatus.PROCESSING
    db.commit()

    # Histórico simulado convertido do mockDashboard do frontend.
    dates = [
        datetime.fromisoformat(date)
        for date in ("2025-10-12", "2026-01-18", "2026-04-09", "2026-07-22", "2026-09-30")
    ]
    series = {
        "Glicemia": {"unit": "mg/dL", "min": 70, "max": 99, "values": [92, 98, 104, 109, 101]},
        "Colesterol Total": {"unit": "mg/dL", "min": 0, "max": 190, "values": [212, 205, 196, 184, 178]},
        "HDL": {"unit": "mg/dL", "min": 40, "max": 90, "values": [44, 46, 49, 52, 55]},
        "Hemoglobina Glicada": {"unit": "%", "min": 4, "max": 5.7, "values": [5.4, 5.6, 5.8, 6.0, 5.8]},
    }

    # O schema do banco armazena a faixa de referência como texto.
    mock_results = []
    for parameter_name, data in series.items():
        for value, measured_at in zip(data["values"], dates):
            mock_results.append(
                ExamResult(
                    exam_id=exam.id,
                    category="Bioquímica",
                    parameter_name=parameter_name,
                    value=value,
                    unit=data["unit"],
                    reference_range=ref_label(
                        f"{data['min']} – {data['max']} {data['unit']}",
                        data["min"],
                        data["max"],
                    ),
                    is_abnormal=int(is_abnormal(value, data["min"], data["max"])),
                    measured_at=measured_at,
                )
            )

    db.add_all(mock_results)

    # 2. Simula a geração do resumo para o médico
    summary_text = (
        "- Glicemia de jejum em tendência de alta desde jan/2026, atingindo 109 mg/dL em jul/2026 (faixa de pré-diabetes).\n"
        "- Hemoglobina glicada acima de 5,7% nos dois últimos exames — sugere acompanhamento metabólico.\n"
        "- Colesterol total em queda consistente, voltando à faixa desejável (178 mg/dL).\n"
        "- HDL em melhora progressiva (44 → 55 mg/dL).\n"
        "- Recomendação: reavaliar dieta e atividade física; repetir glicemia e HbA1c em 90 dias."
    )

    # Atualiza ou cria o resumo do paciente
    summary = db.query(ExamSummary).filter(ExamSummary.patient_id == exam.patient_id).first()
    if summary:
        summary.summary_text = summary_text
        summary.generated_at = datetime.utcnow()
    else:
        summary = ExamSummary(
            patient_id=exam.patient_id,
            summary_text=summary_text
        )
        db.add(summary)

    exam.status = ProcessingStatus.COMPLETED
    db.commit()
