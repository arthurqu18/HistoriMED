import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, Enum
from sqlalchemy.orm import relationship
from database.connection import Base

class UserRole(str, enum.Enum):
    PATIENT = "patient"
    DOCTOR = "doctor"

class ProcessingStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    email = Column(String(150), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.PATIENT, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relacionamentos
    exams = relationship("Exam", back_populates="patient")
    summaries = relationship("ExamSummary", back_populates="patient")


class Exam(Base):
    """Armazena o registro do arquivo de exame enviado pelo paciente."""
    __tablename__ = "exams"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_url = Column(String(500), nullable=False)  # S3 URL ou caminho local
    laboratory_name = Column(String(150), nullable=True) # Nome do laboratório[cite: 1, 2]
    exam_date = Column(DateTime, nullable=True)  # Data em que o exame foi realizado
    status = Column(Enum(ProcessingStatus), default=ProcessingStatus.PENDING, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relacionamentos
    patient = relationship("User", back_populates="exams")
    results = relationship("ExamResult", back_populates="exam", cascade="all, delete-orphan")


class ExamResult(Base):
    """Armazena cada indicador/métrica extraído via OCR + IA (ex: Glicemia: 95 mg/dL)."""
    __tablename__ = "exam_results"

    id = Column(Integer, primary_key=True, index=True)
    exam_id = Column(Integer, ForeignKey("exams.id"), nullable=False)
    category = Column(String(100), nullable=True) # Ex: Bioquímica, Hemograma
    parameter_name = Column(String(150), nullable=False, index=True) # Ex: Glicemia em jejum
    value = Column(Float, nullable=False) # Ex: 95.0
    unit = Column(String(50), nullable=True) # Ex: mg/dL
    reference_range = Column(String(100), nullable=True) # Ex: 70 - 99 mg/dL
    is_abnormal = Column(Integer, default=0) # 0 = Normal, 1 = Alterado
    measured_at = Column(DateTime, nullable=False) # Data para montagem dos gráficos de evolução[cite: 3]

    # Relacionamentos
    exam = relationship("Exam", back_populates="results")


class ExamSummary(Base):
    """Armazena a síntese inteligente em tópicos gerada pela LLM para o médico."""
    __tablename__ = "exam_summaries"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    summary_text = Column(Text, nullable=False) # Texto sumarizado da IA[cite: 1, 3]
    generated_at = Column(DateTime, default=datetime.utcnow)

    # Relacionamentos
    patient = relationship("User", back_populates="summaries")