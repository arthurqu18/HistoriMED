import os
import socket
import subprocess
import sys
import time
import urllib.request
from datetime import datetime

import pytest
from playwright.sync_api import expect, sync_playwright
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database.connection import Base
from backend.database.models import Exam, ExamResult, ExamSummary, User


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_server(url: str, timeout: float = 15.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as resp:
                if resp.status == 200:
                    return
        except Exception:
            time.sleep(0.2)
    raise RuntimeError(f"Servidor não respondeu em {url} dentro de {timeout}s")


@pytest.fixture(scope="module")
def e2e_env(tmp_path_factory):
    """Inicia uma instância real do FastAPI + Frontend com banco SQLite isolado."""
    work_dir = tmp_path_factory.mktemp("historimed_e2e")
    db_path = work_dir / "e2e_test.db"
    db_url = f"sqlite:///{db_path}"

    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionTesting = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    port = _find_free_port()
    base_url = f"http://127.0.0.1:{port}"

    env = os.environ.copy()
    env["DATABASE_URL"] = db_url
    env["GEMINI_API_KEY"] = ""
    env["PYTHONPATH"] = "."

    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "backend.api:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
        ],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    try:
        _wait_for_server(f"{base_url}/users/show_users")
        yield {
            "base_url": base_url,
            "session_factory": SessionTesting,
            "work_dir": work_dir,
        }
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        engine.dispose()


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        browser_instance = p.chromium.launch(headless=True)
        yield browser_instance
        browser_instance.close()


@pytest.fixture
def page(browser):
    context = browser.new_context(viewport={"width": 1280, "height": 860})
    page_instance = context.new_page()
    yield page_instance
    context.close()


def test_e2e_register_patient_and_open_workspace(e2e_env, page):
    """1. Cadastra um novo paciente na tela inicial e abre seu dossiê clínico."""
    page.goto(e2e_env["base_url"])

    expect(page.locator("#auth-view")).to_be_visible()
    expect(page.locator(".brand-pill")).to_contain_text("HistoriMED")

    page.fill("#reg-name", "Clara Mendes")
    page.fill("#reg-age", "29")
    page.select_option("#reg-sex", "feminino")
    page.click("#register-form button[type='submit']")

    expect(page.locator("#workspace-view")).to_be_visible()
    expect(page.locator("#header-patient-name")).to_have_text("Clara Mendes")
    expect(page.locator("#header-patient-meta")).to_have_text("29 anos · Feminino")


def test_e2e_switch_patient_via_sticky_topbar(e2e_env, page):
    """2. Alterna entre perfis de pacientes pela barra superior fixa."""
    db = e2e_env["session_factory"]()
    try:
        db.add(User(name="Paciente Alfa", idade=41, sexo="masculino"))
        db.add(User(name="Paciente Beta", idade=36, sexo="feminino"))
        db.commit()
    finally:
        db.close()

    page.goto(e2e_env["base_url"])

    page.locator(".profile-row-btn", has_text="Paciente Alfa").click()
    expect(page.locator("#header-patient-name")).to_have_text("Paciente Alfa")

    page.click("#switch-user-btn")
    expect(page.locator("#auth-view")).to_be_visible()

    page.locator(".profile-row-btn", has_text="Paciente Beta").click()
    expect(page.locator("#header-patient-name")).to_have_text("Paciente Beta")


def test_e2e_pre_consultation_anamnesis_persists_across_reload(e2e_env, page):
    """3. Preenche a anamnese prévia, gera a ficha estruturada e valida persistência."""
    db = e2e_env["session_factory"]()
    try:
        db.add(User(name="Rafael Costa", idade=33, sexo="masculino"))
        db.commit()
    finally:
        db.close()

    page.goto(e2e_env["base_url"])
    page.locator(".profile-row-btn", has_text="Rafael Costa").click()

    page.click(".nav-item[data-tab='anamnesis']")
    expect(page.locator("#tab-anamnesis")).to_be_visible()

    page.fill("#anam-complaint", "Cansaço persistente e check-up anual")
    page.fill("#anam-duration", "4 semanas")
    page.fill("#anam-meds", "Vitamina D 2000 UI")
    page.fill("#anam-allergies", "Dipirona")
    page.click("#anamnesis-form button[type='submit']")

    preview = page.locator("#anamnesis-preview")
    expect(preview).to_contain_text("FICHA DE ANAMNESE PRÉVIA - HISTORIMED")
    expect(preview).to_contain_text("Cansaço persistente e check-up anual")
    expect(preview).to_contain_text("Vitamina D 2000 UI")
    expect(page.locator("#download-anamnesis-btn")).to_be_enabled()

    page.reload()
    page.locator(".profile-row-btn", has_text="Rafael Costa").click()
    page.click(".nav-item[data-tab='anamnesis']")
    expect(page.locator("#anamnesis-preview")).to_contain_text("Dipirona")


def test_e2e_biomarker_evolution_chart_and_table_filter(e2e_env, page):
    """4. Renderiza síntese clínica, gráfico SVG com faixa de referência e filtro de tabela."""
    db = e2e_env["session_factory"]()
    try:
        user = User(name="Helena Souza", idade=52, sexo="feminino")
        db.add(user)
        db.commit()
        db.refresh(user)

        exam = Exam(
            user_id=user.id,
            file_name="hemograma_glicemia.pdf",
            file_url="/tmp/hemograma_glicemia.pdf",
            laboratory_name="Sabin",
            exam_date=datetime(2026, 3, 15),
            status="completed",
        )
        db.add(exam)
        db.commit()
        db.refresh(exam)

        db.add_all(
            [
                ExamResult(
                    exam_id=exam.id,
                    category="Metabolismo",
                    parameter_name="Glicemia",
                    value=92.0,
                    unit="mg/dL",
                    reference_range="70 A 99",
                    is_abnormal=0,
                    measured_at=datetime(2025, 10, 10),
                ),
                ExamResult(
                    exam_id=exam.id,
                    category="Metabolismo",
                    parameter_name="Glicemia",
                    value=118.0,
                    unit="mg/dL",
                    reference_range="70 A 99",
                    is_abnormal=1,
                    measured_at=datetime(2026, 3, 15),
                ),
                ExamResult(
                    exam_id=exam.id,
                    category="Lipidograma",
                    parameter_name="Colesterol Total",
                    value=184.0,
                    unit="mg/dL",
                    reference_range="ATE 190",
                    is_abnormal=0,
                    measured_at=datetime(2026, 3, 15),
                ),
            ]
        )
        db.add(
            ExamSummary(
                user_id=user.id,
                summary_text="### Pontos de Atenção\n- **Glicemia** discretamente elevada em 118 mg/dL.",
                generated_at=datetime(2026, 3, 15),
            )
        )
        db.commit()
    finally:
        db.close()

    page.goto(e2e_env["base_url"])
    page.locator(".profile-row-btn", has_text="Helena Souza").click()

    expect(page.locator("#kpi-exams")).to_have_text("1")
    expect(page.locator("#kpi-parameters")).to_have_text("2")
    expect(page.locator("#kpi-abnormal")).to_have_text("1")
    expect(page.locator("#ai-summary-body")).to_contain_text("Pontos de Atenção")

    page.click(".nav-item[data-tab='evolution']")
    expect(page.locator("#tab-evolution")).to_be_visible()
    expect(page.locator("#parameter-focus svg")).to_be_visible()
    expect(page.locator("#parameter-focus svg polyline")).to_be_visible()

    page.fill("#results-search", "Colesterol")
    rows = page.locator("#all-results-tbody tr")
    expect(rows).to_have_count(1)
    expect(rows.first).to_contain_text("Colesterol Total")


def test_e2e_upload_pdf_exam_and_delete_account(e2e_env, page):
    """5. Envia um laudo PDF e executa a exclusão definitiva de conta e dados."""
    db = e2e_env["session_factory"]()
    try:
        db.add(User(name="Marcos Lima", idade=45, sexo="masculino"))
        db.commit()
    finally:
        db.close()

    sample_pdf = e2e_env["work_dir"] / "laudo_checkup.pdf"
    sample_pdf.write_bytes(b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")

    page.goto(e2e_env["base_url"])
    page.locator(".profile-row-btn", has_text="Marcos Lima").click()

    page.click(".nav-item[data-tab='exams']")
    page.fill("#exam-lab", "Laboratório Fleury")
    page.set_input_files("#exam-file", str(sample_pdf))
    page.click("#upload-exam-form button[type='submit']")

    expect(page.locator("#exams-list")).to_contain_text("laudo_checkup.pdf")
    expect(page.locator("#exams-list")).to_contain_text("Laboratório Fleury")
    expect(page.locator("#kpi-exams")).to_have_text("1")

    page.locator(".danger-disclosure summary").click()
    page.check("#confirm-delete-account")
    page.click("#delete-account-btn")

    expect(page.locator("#auth-view")).to_be_visible()
    expect(page.locator("#profiles-grid")).not_to_contain_text("Marcos Lima")