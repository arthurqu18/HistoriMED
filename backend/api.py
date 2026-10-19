import os
import shutil
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database.connection import get_db, engine, Base
from database.models import Exam, ExamResult, ExamSummary, ProcessingStatus
from schemas.schemas import ExamResponse, DashboardResponse
from services.ai_service import process_exam_with_ai

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


@app.post("/patient/upload-exam/", response_model=ExamResponse)
def upload_exam(
    laboratory_name: Optional[str] = Form(None),
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db)
):
    """Enviar arquivo ou tirar foto dos exames."""

    file_path = os.path.join(UPLOAD_DIR, f"{file.filename}")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    new_exam = Exam(
        file_name=file.filename,
        file_url=file_path,
        laboratory_name=laboratory_name,
        status=ProcessingStatus.PENDING
    )
    db.add(new_exam)
    db.commit()
    db.refresh(new_exam)

    # Dispara a extração OCR + IA em segundo plano
    if background_tasks:
        background_tasks.add_task(process_exam_with_ai, new_exam.id, db)

    return new_exam


@app.get("/patient/dashboard", response_model=DashboardResponse)
def get_dashboard(db: Session = Depends(get_db)):
    """Retorna o resumo clínico e o histórico de exames."""

    # 1. Busca o Resumo da IA
    summary_obj = db.query(ExamSummary).first()
    summary_text = summary_obj.summary_text if summary_obj else "Nenhum resumo disponível ainda."

    # 2. Busca todos os resultados para os gráficos
    results = db.query(ExamResult).join(Exam).order_by(ExamResult.measured_at.asc()).all()

    return DashboardResponse(
        summary=summary_text,
        results_history=results
    )