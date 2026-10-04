from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, EmailStr
from database.models import UserRole, ProcessingStatus

# --- USER SCHEMAS ---
class UserBase(BaseModel):
    name: str
    email: EmailStr
    role: UserRole = UserRole.PATIENT

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

# --- EXAM RESULT SCHEMAS ---
class ExamResultResponse(BaseModel):
    id: int
    category: Optional[str] = None
    parameter_name: str
    value: float
    unit: Optional[str] = None
    reference_range: Optional[str] = None
    is_abnormal: int
    measured_at: datetime

    class Config:
        from_attributes = True

# --- EXAM SCHEMAS ---
class ExamResponse(BaseModel):
    id: int
    patient_id: int
    file_name: str
    file_url: str
    laboratory_name: Optional[str] = None
    exam_date: Optional[datetime] = None
    status: ProcessingStatus
    created_at: datetime
    results: List[ExamResultResponse] = []

    class Config:
        from_attributes = True

# --- SUMMARY SCHEMAS ---
class ExamSummaryResponse(BaseModel):
    id: int
    patient_id: int
    summary_text: str
    generated_at: datetime

    class Config:
        from_attributes = True

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class PatientSearchResponse(BaseModel):
    id: int
    name: str
    email: str

    class Config:
        from_attributes = True

class PatientDashboardResponse(BaseModel):
    patient_id: int
    patient_name: str
    summary: Optional[str] = None
    results_history: List[ExamResultResponse] = []