import os
import shutil
from typing import List, Optional
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from database.connection import get_db, engine, Base
from database.models import User, Exam, ExamResult, ExamSummary, UserRole, ProcessingStatus
from schemas.schemas import UserCreate, UserResponse, ExamResponse, ExamSummaryResponse, ExamResultResponse, LoginRequest, PatientSearchResponse, PatientDashboardResponse
from services.ai_service import process_exam_with_ai

# Inicializa as tabelas no SQLite
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="HistoriMED API - MVP",
    description="API simplificada para login, upload de paciente e busca médica",
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


# --- 1. MÓDULO DE AUTENTICAÇÃO / LOGIN ---

@app.post("/users/register", response_model=UserResponse, status_code=201)
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    """Cria conta de Paciente ou Médico."""
    db_user = db.query(User).filter(User.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="E-mail já registado.")
    
    new_user = User(
        name=user.name,
        email=user.email,
        hashed_password=user.password, # Para MVP simples (em produção usar bcrypt)
        role=user.role
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user


@app.post("/login")
def login(credentials: LoginRequest, db: Session = Depends(get_db)):
    """Efetua o login e retorna a role (patient/doctor) para o Frontend direcionar a tela."""
    user = db.query(User).filter(User.email == credentials.email).first()
    if not user or user.hashed_password != credentials.password:
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")
    
    return {
        "message": "Login efetuado com sucesso",
        "user_id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role.value  # Retorna 'patient' ou 'doctor'
    }


# --- 2. PAINEL DO PACIENTE (LAURA) ---

@app.post("/patient/{patient_id}/upload-exam/", response_model=ExamResponse)
def upload_exam_for_patient(
    patient_id: int,
    laboratory_name: Optional[str] = Form(None),
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db)
):
    """Paciente logado envia o arquivo de exame."""
    patient = db.query(User).filter(User.id == patient_id, User.role == UserRole.PATIENT).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente não encontrado.")

    file_path = os.path.join(UPLOAD_DIR, f"{patient_id}_{file.filename}")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    new_exam = Exam(
        patient_id=patient_id,
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


# --- 3. PAINEL DO MÉDICO (DR. ROBERTO) ---

@app.get("/doctor/search-patients", response_model=List[PatientSearchResponse])
def search_patients(name: str, db: Session = Depends(get_db)):
    """Médico pesquisa pacientes pelo nome para visualizar a ficha clínica."""
    if len(name.strip()) < 2:
        raise HTTPException(status_code=400, detail="Digite pelo menos 2 caracteres para pesquisar.")
    
    patients = db.query(User).filter(
        User.role == UserRole.PATIENT,
        User.name.ilike(f"%{name}%")
    ).all()
    
    return patients


@app.get("/doctor/patient/{patient_id}/dashboard", response_model=PatientDashboardResponse)
def get_patient_dashboard_for_doctor(patient_id: int, db: Session = Depends(get_db)):
    """
    Retorna numa única chamada o Resumo de IA e o Histórico de exames para construir o painel gráfico do médico.
    """
    patient = db.query(User).filter(User.id == patient_id, User.role == UserRole.PATIENT).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Paciente não encontrado.")

    # 1. Busca o Resumo da IA
    summary_obj = db.query(ExamSummary).filter(ExamSummary.patient_id == patient_id).first()
    summary_text = summary_obj.summary_text if summary_obj else "Nenhum resumo disponível ainda."

    # 2. Busca todos os resultados para os gráficos
    results = db.query(ExamResult).join(Exam).filter(Exam.patient_id == patient_id).order_by(ExamResult.measured_at.asc()).all()

    return PatientDashboardResponse(
        patient_id=patient.id,
        patient_name=patient.name,
        summary=summary_text,
        results_history=results
    )