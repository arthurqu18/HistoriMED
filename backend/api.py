import os
import re
import shutil
from pathlib import Path
from uuid import uuid4
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
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
    ExtractResponse,
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

@app.get("users/{user_id}/dashboard/extract", response_model=ExtractResponse)