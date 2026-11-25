import os
import re
import shutil
from html import escape
from datetime import datetime
from pathlib import Path
from uuid import uuid4
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from .database.connection import get_db, engine, Base
from .database.models import Exam, ExamResult, ExamSummary, ProcessingStatus, User
from .schemas.schemas import (
    ExamResponse,
    DashboardResponse,
    UserCreate,
    UserResponse,
    ExamResultResponse,
    ExamListResponse,
)
from .services.ai_service import process_exam_with_ai

# Inicializa as tabelas no SQLite
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="HistoriMED API",
    description="API simplificada para upload de exames e ver histórico de evolução",
    version="1.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "./uploaded_exams"
os.makedirs(UPLOAD_DIR, exist_ok=True)

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR), check_dir=False), name="static")


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def serve_frontend():
    """Serve a interface web principal do HistoriMED."""
    index_path = FRONTEND_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend não encontrado")
    return FileResponse(index_path)

# --- USUÁRIOS

@app.post("/users/register", response_model=UserResponse, status_code=201)
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    """Cria conta de usuário."""
    db_user = db.query(User).filter(User.name == user.name).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Usuário já cadastrado")

    new_user = User(
        name=user.name,
        idade=user.idade,
        sexo=user.sexo,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.get("/users/show_users", response_model=list[UserResponse])
def show_users(db: Session = Depends(get_db)):
    """Mostra usuários na tela inicial."""
    all_users = db.query(User).all()

    return all_users

@app.delete("/users/{user_id}/delete-account", status_code=204)
def delete_account(user_id: int, db: Session = Depends(get_db)):
    """Remove a conta, exames, resultados, resumos e arquivos do usuário."""

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User não encontrado")

    exams = db.query(Exam).filter(Exam.user_id == user_id).all()
    exam_ids = [exam.id for exam in exams]
    file_paths = [exam.file_url for exam in exams if exam.file_url]

    if exam_ids:
        db.query(ExamResult).filter(
            ExamResult.exam_id.in_(exam_ids)
        ).delete(synchronize_session=False)

    db.query(Exam).filter(Exam.user_id == user_id).delete(
        synchronize_session=False
    )
    db.query(ExamSummary).filter(
        ExamSummary.user_id == user_id
    ).delete(synchronize_session=False)

    for file_path in file_paths:
        if not file_path:
            continue
        try:
            os.remove(file_path)
        except FileNotFoundError:
            pass
        except OSError:
            db.rollback()
            raise HTTPException(
                status_code=500,
                detail=(
                    "Não foi possível excluir todos os arquivos da conta"
                ),
            )

    db.delete(user)
    db.commit()

    return None

# --- EXAMES

@app.post("/users/{user_id}/upload-exam/", response_model=ExamResponse)
def upload_exam(
    user_id: int,
    laboratory_name: Optional[str] = Form(None),
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db)
):
    """User logado envia os exames."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User não encontrado")

    original_filename = file.filename or ""
    safe_filename = re.sub(r"[^A-Za-z0-9._-]", "_", Path(original_filename).name)
    safe_filename = safe_filename.strip(" .")
    if not safe_filename:
        raise HTTPException(status_code=400, detail="Nome de arquivo inválido")

    stored_filename = f"{user_id}_{uuid4().hex}_{safe_filename}"
    file_path = os.path.join(UPLOAD_DIR, stored_filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    new_exam = Exam(
        user_id=user_id,
        file_name=safe_filename,
        file_url=file_path,
        laboratory_name=laboratory_name,
        status=ProcessingStatus.PENDING
    )
    db.add(new_exam)
    db.commit()
    db.refresh(new_exam)

    # Dispara a extração OCR + IA em segundo plano
    if background_tasks:
        background_tasks.add_task(
            process_exam_with_ai,
            new_exam.id,
            db,
            user.idade,
            user.sexo,
        )

    return new_exam


@app.get("/users/{user_id}/dashboard", response_model=DashboardResponse)
def get_dashboard(user_id: int, db: Session = Depends(get_db)):
    """Retorna o resumo clínico e o histórico de exames."""

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User não encontrado")

    # 1. Busca o Resumo da IA
    summary_obj = db.query(ExamSummary).filter(ExamSummary.user_id == user_id).first()
    summary_text = summary_obj.summary_text if summary_obj else "Nenhum resumo disponível ainda."

    # 2. Busca todos os resultados para os gráficos
    results = db.query(ExamResult).join(Exam).filter(Exam.user_id == user_id).order_by(ExamResult.measured_at.asc()).all()

    return DashboardResponse(
        user_id = user.id,
        user_name = user.name,
        summary=summary_text,
        results_history=results
    )

@app.get("/users/{user_id}/show_exams_for_user", response_model=list[ExamListResponse])
def show_exams_for_user(user_id: int, db: Session = Depends(get_db)):
    """Retorna todos os exames listados no user_id especificado"""

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User não encontrado!")

    exames = (
        db.query(Exam)
        .filter(Exam.user_id == user_id)
        .order_by(Exam.created_at.desc())
        .all()
    )

    return exames

@app.delete("/users/{user_id}/{exam_id}/delete_exam_for_user", status_code=204)
def delete_exam_for_a_user(user_id: int, exam_id: int, db: Session = Depends(get_db)):
    """Deleta um exame especifico de um usuário."""

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User não encontrado!")

    exam = (
        db.query(Exam)
        .filter(
            Exam.user_id == user_id,
            Exam.id == exam_id,
        )
        .first())
    
    if not exam:
        raise HTTPException(status_code=404, detail="Exame não encontrado!")

    file_path = exam.file_url
    db.delete(exam)
    db.commit()

    if file_path:
        try:
            os.remove(file_path)
        except FileNotFoundError:
            pass

    return None


# --- USABILIDADE

@app.get("/users/{user_id}/dashboard/is_abnormal", response_model=list[ExamResultResponse])
def get_abnormal_results(user_id: int, db: Session = Depends(get_db)):
    """Retorno parametros do usuario que estão fora do valor padrão."""

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User não encontrado")

    results_alterados = (
        db.query(ExamResult)
        .join(Exam)
        .filter(
            Exam.user_id == user_id,
            ExamResult.is_abnormal == 1,
        )
        .order_by(ExamResult.measured_at.asc())
        .all()
    )

    return results_alterados


def _render_summary_markdown(summary_text: str) -> str:
    """Render the summary's bullet lists and bold text as safe HTML."""
    rendered_lines = []
    list_open = False

    for raw_line in summary_text.splitlines():
        line = escape(raw_line.strip())
        bullet = re.match(r"^[-*]\s+(.+)$", line)

        if bullet:
            if not list_open:
                rendered_lines.append("<ul>")
                list_open = True
            content = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", bullet.group(1))
            rendered_lines.append(f"<li>{content}</li>")
            continue

        if list_open:
            rendered_lines.append("</ul>")
            list_open = False

        if line:
            line = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", line)
            rendered_lines.append(f"<p>{line}</p>")

    if list_open:
        rendered_lines.append("</ul>")

    return "\n".join(rendered_lines)


@app.get("/users/{user_id}/report", response_class=HTMLResponse)
def get_consultation_report(user_id: int, db: Session = Depends(get_db)):
    """Gera uma página HTML limpa para impressão ou salvar como PDF."""

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User não encontrado")

    summary_obj = (
        db.query(ExamSummary)
        .filter(ExamSummary.user_id == user_id)
        .first()
    )
    summary_text = (
        summary_obj.summary_text
        if summary_obj
        else "Nenhum resumo disponível ainda."
    )

    results = (
        db.query(ExamResult)
        .join(Exam)
        .filter(Exam.user_id == user_id)
        .order_by(ExamResult.measured_at.desc(), ExamResult.id.desc())
        .all()
    )

    latest_by_parameter = {}
    for result in results:
        if result.parameter_name not in latest_by_parameter:
            latest_by_parameter[result.parameter_name] = result

    rows = []
    for result in latest_by_parameter.values():
        measured_at = (
            result.measured_at.strftime("%d/%m/%Y")
            if result.measured_at
            else ""
        )
        status = "Alterado" if result.is_abnormal == 1 else "Dentro da referência"
        rows.append(
            "<tr>"
            f"<td>{escape(result.parameter_name)}</td>"
            f"<td>{escape(str(result.value))} {escape(result.unit or '')}</td>"
            f"<td>{escape(result.reference_range or '')}</td>"
            f"<td>{escape(measured_at)}</td>"
            f"<td>{escape(status)}</td>"
            "</tr>"
        )

    table_body = (
        "".join(rows)
        if rows
        else "<tr><td colspan=\"5\">Nenhum resultado disponível.</td></tr>"
    )
    profile = []
    if user.idade is not None:
        profile.append(f"{user.idade} anos")
    if user.sexo:
        profile.append(escape(user.sexo.capitalize()))
    profile_text = " | ".join(profile) if profile else "Não informado"
    generated_at = datetime.now().strftime("%d/%m/%Y %H:%M")
    summary_html = _render_summary_markdown(summary_text)

    html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Resumo para consulta - {escape(user.name)}</title>
  <style>
    body {{ font-family: Arial, sans-serif; color: #172b4d; margin: 32px; }}
    .actions {{ margin-bottom: 24px; }}
    button {{ background: #0b6bcb; color: white; border: 0; border-radius: 6px;
              padding: 10px 16px; cursor: pointer; }}
    h1 {{ margin-bottom: 4px; }}
    .meta {{ color: #52606d; margin-bottom: 24px; }}
    h2 {{ border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; }}
    .summary {{ border: 1px solid #cbd5e1; border-radius: 8px;
                padding: 16px; line-height: 1.5; }}
    .summary p {{ margin: 0 0 8px; }}
    .summary p:last-child {{ margin-bottom: 0; }}
    .summary ul {{ margin: 0 0 8px; padding-left: 24px; }}
    .summary li {{ margin: 4px 0; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 12px; }}
    th, td {{ border: 1px solid #cbd5e1; padding: 8px; text-align: left; }}
    th {{ background: #eef3f8; }}
    @media print {{
      .actions {{ display: none; }}
      body {{ margin: 12mm; }}
      tr {{ break-inside: avoid; }}
    }}
  </style>
</head>
<body>
  <div class="actions"><button onclick="window.print()">Imprimir / Salvar em PDF</button></div>
  <h1>Resumo para Consulta</h1>
  <div class="meta">
    <strong>Usuário:</strong> {escape(user.name)}<br>
    <strong>Perfil:</strong> {profile_text}<br>
    <strong>Gerado em:</strong> {generated_at}
  </div>
  <h2>Resumo gerado pela IA</h2>
  <div class="summary">{summary_html}</div>
  <h2>Últimos resultados laboratoriais</h2>
  <table>
    <thead>
      <tr>
        <th>Parâmetro</th><th>Resultado</th><th>Referência</th>
        <th>Data</th><th>Leitura</th>
      </tr>
    </thead>
    <tbody>{table_body}</tbody>
  </table>
</body>
</html>"""
    return HTMLResponse(content=html)