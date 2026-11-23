import os
import json
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from datetime import datetime
from typing import List, Optional
from pypdf import PdfReader
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database.models import Exam, ExamResult, ExamSummary, ProcessingStatus, User

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:latest")


def _ollama_chat(prompt: str, *, json_schema: Optional[dict] = None,
                 temperature: float = 0.3) -> str:
    """Executa uma conversa com o Ollama local e retorna o conteúdo da resposta."""
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "options": {"temperature": temperature},
    }
    if json_schema is not None:
        payload["format"] = json_schema

    request = Request(
        f"{OLLAMA_BASE_URL}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=300) as response:
            data = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Ollama respondeu com HTTP {exc.code} para o modelo '{OLLAMA_MODEL}': {details}"
        ) from exc
    except (URLError, TimeoutError) as exc:
        raise RuntimeError(
            f"Não foi possível consultar o Ollama em {OLLAMA_BASE_URL}. "
            "Confirme que o serviço está ativo e acessível a partir do backend."
        ) from exc
    return data["message"]["content"]


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


def call_ollama_structured_extraction(
    raw_text: str,
    idade: Optional[int] = None,
    sexo: Optional[str] = None,
) -> ExtractedExamData:
    """Envia o texto extraído para o Ollama retornar dados estruturados em JSON."""
    profile_parts = []
    if idade is not None:
        profile_parts.append(f"idade: {idade} anos")
    if sexo:
        profile_parts.append(f"sexo biológico: {sexo}")
    patient_profile = (
        "Perfil do paciente: " + "; ".join(profile_parts) + ".\n"
        if profile_parts
        else "Perfil do paciente não informado.\n"
    )

    prompt = (
        "Você é um assistente médico especializado em estruturação de laudos laboratoriais.\n"
        "Analise o texto do exame de sangue/laudo a seguir e extraia os dados conforme o schema solicitado.\n"
        f"{patient_profile}"
        "Use o perfil informado para selecionar e aplicar a faixa de referência exata para cada parâmetro.\n"
        "Quando o sexo ou a faixa etária não forem informados, não invente faixas de referência:\n"
        "use apenas a faixa explícita no laudo ou mantenha o campo como não informado.\n"
        "Atenção especial para:\n"
        "1. Converter números com vírgula para ponto (ex: '117,1' vira 117.1).\n"
        "2. Identificar se o valor está alterado (is_abnormal = 1) ou normal (is_abnormal = 0) comparando o valor com a faixa de referência descrita.\n\n"
        f"TEXTO DO LAUDO:\n{raw_text}"
    )

    response = _ollama_chat(
        prompt, json_schema=ExtractedExamData.model_json_schema(), temperature=0.1
    )
    return ExtractedExamData.model_validate_json(response)


def generate_consolidated_summary(db: Session, user_id: int) -> str:
    """
    Busca o histórico completo de um usuário no banco e gera uma síntese
    clínica em tópicos consolidados para o dashboard.
    """
    all_results = (
        db.query(ExamResult)
        .join(Exam)
        .filter(Exam.user_id == user_id)
        .order_by(ExamResult.measured_at.asc())
        .all()
    )

    if not all_results:
        return "Nenhum resultado de exame disponível para resumo."

    user = db.query(User).filter(User.id == user_id).first()
    profile_parts = []
    if user and user.idade is not None:
        profile_parts.append(f"idade: {user.idade} anos")
    if user and user.sexo:
        profile_parts.append(f"sexo biológico: {user.sexo}")
    patient_profile = (
        "Perfil do paciente: " + "; ".join(profile_parts) + ".\n"
        if profile_parts
        else "Perfil do paciente não informado.\n"
    )

    # Prepara o histórico para o prompt da IA
    history_str = ""
    for r in all_results:
        dt_str = r.measured_at.strftime("%Y-%m-%d")
        abnormal_flag = " [ALTERADO]" if r.is_abnormal == 1 else ""
        history_str += f"- {dt_str} | {r.parameter_name}: {r.value} {r.unit or ''} (Ref: {r.reference_range or 'N/A'}){abnormal_flag}\n"

    prompt = (
            "Você é um assistente médico objetivo. Analise o histórico de exames abaixo e gere um resumo ULTRA-CONCISO em português, use as informações de usuário para embasar a sua resposta\n"
            f"perfil do usuário: {patient_profile}\n"
            "Regras estritas:\n"
            "1. Liste APENAS os pontos de atenção (parâmetros alterados ou tendências preocupantes). NÃO mencione exames normais.\n"
            "2. Se todos os exames estiverem normais, responda apenas: 'Todos os parâmetros avaliados estão dentro da faixa de normalidade.'\n"
            "3. Use no máximo 4 tópicos curtos (bullet points usando '- ') para os pontos de atenção.\n"
            "4. Adicione ao final uma única linha com '**Recomendação:**' seguida de uma orientação breve e direta (máximo 2 frases).\n"
            "5. Não inclua títulos, cabeçalhos, dados de identificação ou notas introdutórias.\n\n"
            f"HISTÓRICO DO PACIENTE:\n{history_str}"
        )

    return _ollama_chat(prompt, temperature=0.3)


# -------------------------------------------------------------------
# 3. PIPELINE PRINCIPAL CHAMADO PELA API
# -------------------------------------------------------------------
def process_exam_with_ai(
    exam_id: int,
    db: Session,
    idade: Optional[int] = None,
    sexo: Optional[str] = None,
):
    """
    Pipeline executado após o upload do PDF:
    1. Extrai texto do PDF local.
    2. Envia para a IA estruturar.
    3. Popula a tabela ExamResult.
    4. Atualiza/Gera a ExamSummary do usuário.
    """
    exam = db.query(Exam).filter(Exam.id == exam_id).first()
    if not exam:
        return

    if idade is None and sexo is None:
        user = db.query(User).filter(User.id == exam.user_id).first()
        if user:
            idade = user.idade
            sexo = user.sexo

    try:
        exam.status = ProcessingStatus.PROCESSING
        db.commit()

        # 1. Extração do texto do PDF
        if not os.path.exists(exam.file_url):
            raise FileNotFoundError(f"Arquivo não encontrado: {exam.file_url}")
            
        raw_text = extract_text_from_pdf(exam.file_url)

        # 2. Extração via Ollama com schema Pydantic
        extracted = call_ollama_structured_extraction(
            raw_text,
            idade=idade,
            sexo=sexo,
        )

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
        db.flush()

        # 4. Atualização/Geração do Resumo Consolidado
        summary_text = generate_consolidated_summary(db, user_id=exam.user_id)
        
        summary = db.query(ExamSummary).filter(ExamSummary.user_id == exam.user_id).first()
        if summary:
            summary.summary_text = summary_text
            summary.generated_at = datetime.utcnow()
        else:
            summary = ExamSummary(
                user_id=exam.user_id,
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