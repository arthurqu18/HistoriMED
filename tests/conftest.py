from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.api import app
from backend.database.connection import Base, get_db
from backend.database.models import Exam, ExamResult, ProcessingStatus, User


test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=test_engine)


@pytest.fixture
def db_session():
    Base.metadata.create_all(bind=test_engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def dummy_pdf_file(tmp_path):
    pdf_path = tmp_path / "exam.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    with pdf_path.open("wb") as file:
        writer.write(file)
    return pdf_path


@pytest.fixture
def create_user(db_session):
    def factory(name):
        user = User(name=name)
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        return user

    return factory


@pytest.fixture
def create_exam_result(db_session):
    def factory(user, parameter_name):
        exam = Exam(
            user_id=user.id,
            file_name=f"{parameter_name}.pdf",
            file_url=f"/tmp/{parameter_name}.pdf",
            status=ProcessingStatus.COMPLETED,
        )
        db_session.add(exam)
        db_session.flush()
        db_session.add_all(
            [ExamResult(
                exam_id=exam.id,
                parameter_name=parameter_name,
                value=10.0,
                unit="mg/dL",
                reference_range="0-20",
                is_abnormal=0,
                measured_at=datetime(2026, 4, 6)
            ),
            ExamResult(
                exam_id=exam.id,
                parameter_name="ferro",
                value=10.0,
                unit="mg/dL",
                reference_range="0-20",
                is_abnormal=1,
                measured_at=datetime(2026, 4, 6)
            )
            ]
        )
        db_session.commit()
        return exam

    return factory
