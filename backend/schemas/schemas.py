from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel
from ..database.models import ProcessingStatus

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
    summary_text: str
    generated_at: datetime

    class Config:
        from_attributes = True

class DashboardResponse(BaseModel):
    summary: Optional[str] = None
    results_history: List[ExamResultResponse] = []