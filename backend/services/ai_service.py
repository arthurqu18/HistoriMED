import os
import json
from datetime import datetime
from typing import List, Optional
from pypdf import PdfReader
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from sqlalchemy.orm import Session

from ..database.models import Exam, ExamResult, ExamSummary, ProcessingStatus

# O cliente é criado apenas quando uma operação de IA é executada, para que
# importar a aplicação não exija uma chave Gemini.
client = None


def _get_client():
    global client
    if client is None:
        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    return client


# -------------------------------------------------------------------
# 1. PYDANTIC SCHEMAS PARA A RESPOSTA ESTRUTURADA DA IA
# -------------------------------------------------------------------
class ExtractedExamResult(BaseModel):
    category: Optional[str] = Field(
        default=None, 
        description="Categoria do exame (ex: Hemograma, Bioquímica, Perfil Lipídico)"
    )
    parameter_name: str = Field(
        description="Nome exato do parâmetro (ex: Hemácias, Glicemia, Ferritina Sérica)"
    )
    value: float = Field(
        description="Valor numérico obtido. Se no laudo estiver '117,1' ou '5.720.000', converta para float (117.1 ou 5720000.0)"
    )
    unit: Optional[str] = Field(
        default=None, 
        description="Unidade de medida (ex: mg/dL, ng/mL, %, /mm3)"
    )
    reference_range: Optional[str] = Field(
        default=None, 
        description="Texto descritivo do intervalo de referência aplicável"
    )
    is_abnormal: int = Field(
        description="0 se o resultado estiver dentro do valor de referência normal, 1 se estiver alterado/fora da faixa"
    )


class ExtractedExamData(BaseModel):
    laboratory_name: Optional[str] = Field(
        default=None, 
        description="Nome do laboratório identificado no laudo"
    )
    exam_date: Optional[str] = Field(
        default=None, 
        description="Data de realização/coleta no formato YYYY-MM-DD ou YYYY-MM-DDTHH:MM:SS, se disponível"
    )
    results: List[ExtractedExamResult] = Field(
        default_factory=list, 
        description="Lista de parâmetros extraídos"
    )


# -------------------------------------------------------------------
# 2. FUNÇÕES AUXILIARES DE EXTRAÇÃO E IA
# -------------------------------------------------------------------
def extract_text_from_pdf(pdf_path: str) -> str:
    """Lê todas as páginas do PDF digital e extrai o texto bruto."""
    reader = PdfReader(pdf_path)
    extracted_text = ""
    for page in reader.pages:
        text = page.extract_text()
        if text:
            extracted_text += text + "\n"
    return extracted_text


def call_gemini_structured_extraction(raw_text: str) -> ExtractedExamData:
    """Envia o texto extraído para o Gemini retornar um JSON rigorosamente estruturado."""
    prompt = (
        "Você é um assistente médico especializado em estruturação de laudos laboratoriais.\n"
        "Analise o texto do exame de sangue/laudo a seguir e extraia os dados conforme o schema solicitado.\n"
        "Atenção especial para:\n"
        "1. Converter números com vírgula para ponto (ex: '117,1' vira 117.1).\n"
        "2. Identificar se o valor está alterado (is_abnormal = 1) ou normal (is_abnormal = 0) comparando o valor com a faixa de referência descrita.\n\n"
        f"TEXTO DO LAUDO:\n{raw_text}"
    )

    response = _get_client().models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ExtractedExamData,
            temperature=0.1,
        ),
    )

    # Retorna os dados convertidos no modelo Pydantic
    return ExtractedExamData.model_validate_json(response.text)


def generate_consolidated_summary(db: Session) -> str:
    """
    Busca o histórico completo de resultados no banco e gera uma síntese
    clínica em tópicos consolidados para o dashboard.
    """
    all_results = (
        db.query(ExamResult)
        .order_by(ExamResult.measured_at.asc())
        .all()
    )

    if not all_results:
        return "Nenhum resultado de exame disponível para resumo."

    # Prepara o histórico para o prompt da IA
    history_str = ""
    for r in all_results:
        dt_str = r.measured_at.strftime("%Y-%m-%d")
        abnormal_flag = " [ALTERADO]" if r.is_abnormal == 1 else ""
        history_str += f"- {dt_str} | {r.parameter_name}: {r.value} {r.unit or ''} (Ref: {r.reference_range or 'N/A'}){abnormal_flag}\n"

    prompt = (
        "Você é um assistente médico especialista. Com base no histórico de exames laboratoriais abaixo, "
        "gere um resumo executivo claro, conciso e em tópicos (bullet points) destacando tendências de evolução, "
        "melhorias, pontos de atenção ou alteração e recomendações gerais.\n\n"
        f"HISTÓRICO DO PACIENTE:\n{history_str}"
    )

    response = _get_client().models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.3,
        ),
    )

    return response.text


# -------------------------------------------------------------------
# 3. PIPELINE PRINCIPAL CHAMADO PELA API
# -------------------------------------------------------------------
def process_exam_with_ai(exam_id: int, db: Session):
    """
    Pipeline executado após o upload do PDF:
    1. Extrai texto do PDF local.
    2. Envia para a IA estruturar.
    3. Popula a tabela ExamResult.
    4. Atualiza/Gera a ExamSummary global.
    """
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        return

    try:
        exam.status = ProcessingStatus.PROCESSING
        db.commit()

        # 1. Extração do texto do PDF
        if not os.path.exists(exam.file_url):
            raise FileNotFoundError(f"Arquivo não encontrado: {exam.file_url}")
            
        raw_text = extract_text_from_pdf(exam.file_url)

        # 2. Extração via Gemini com Pydantic Structured Output
        extracted = call_gemini_structured_extraction(raw_text)

        # Atualiza metadata do exame
        if extracted.laboratory_name:
            exam.laboratory_name = extracted.laboratory_name

        exam_dt = datetime.utcnow()
        if extracted.exam_date:
            try:
                exam_dt = datetime.fromisoformat(extracted.exam_date)
            except ValueError:
                pass
        exam.exam_date = exam_dt

        # 3. Inserção dos ExamResults
        results_to_insert = []
        for res in extracted.results:
            results_to_insert.append(
                ExamResult(
                    exam_id=exam.id,
                    category=res.category,
                    parameter_name=res.parameter_name,
                    value=res.value,
                    unit=res.unit,
                    reference_range=res.reference_range,
                    is_abnormal=res.is_abnormal,
                    measured_at=exam_dt
                )
            )

        db.add_all(results_to_insert)

        # 4. Atualização/Geração do Resumo Consolidado
        summary_text = generate_consolidated_summary(db)
        
        summary = db.query(ExamSummary).first()
        if summary:
            summary.summary_text = summary_text
            summary.generated_at = datetime.utcnow()
        else:
            summary = ExamSummary(
                summary_text=summary_text,
                generated_at=datetime.utcnow()
            )
            db.add(summary)

        exam.status = ProcessingStatus.COMPLETED
        db.commit()

    except Exception as e:
        db.rollback()
        exam.status = ProcessingStatus.FAILED
        db.commit()
        print(f"[ERRO no processamento do exame {exam_id}]: {str(e)}")