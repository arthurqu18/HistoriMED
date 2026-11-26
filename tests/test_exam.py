from datetime import datetime

from backend.database.models import Exam, ExamResult, ExamSummary, ProcessingStatus


def test_dashboard_returns_only_selected_user_data(
    client, db_session, create_user, create_exam_result
):
    maria = create_user("Maria")
    joao = create_user("João")
    maria_exam = create_exam_result(maria, "glicemia")
    create_exam_result(joao, "colesterol")
    db_session.add(
        ExamSummary(
            user_id=maria.id,
            summary_text="Resumo da Maria",
            generated_at=datetime(2026, 4, 6),
        )
    )
    db_session.commit()

    response = client.get(f"/users/{maria.id}/dashboard")

    assert response.status_code == 200
    data = response.json()
    assert data["user_name"] == "Maria"
    assert data["summary"] == "Resumo da Maria"
    assert [result["parameter_name"] for result in data["results_history"]] == [
        "glicemia", "ferro"
    ]
    assert maria_exam.user_id == maria.id


def test_dashboard_for_new_user_has_empty_history(client, create_user):
    user = create_user("Maria")

    response = client.get(f"/users/{user.id}/dashboard")

    assert response.status_code == 200
    assert response.json()["summary"] == "Nenhum resumo disponível ainda."
    assert response.json()["results_history"] == []


def test_consultation_report_contains_summary_and_latest_results(
    client, db_session, create_user, create_exam_result
):
    user = create_user("Maria", idade=34, sexo="feminino")
    create_exam_result(user, "glicemia")
    db_session.add(
        ExamSummary(
            user_id=user.id,
            summary_text="Resumo e histórico clinico.",
            generated_at=datetime(2026, 4, 6),
        )
    )
    db_session.commit()

    response = client.get(f"/users/{user.id}/report")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    html = response.text
    assert "Resumo para Consulta" in html
    assert "Resumo e histórico clinico." in html
    assert "Maria" in html
    assert "34 anos" in html
    assert "Feminino" in html
    assert "glicemia" in html
    assert "Últimos resultados laboratoriais" in html
    assert "window.print()" in html


def test_consultation_report_renders_markdown_summary(client, db_session, create_user):
    user = create_user("Maria")
    db_session.add(
        ExamSummary(
            user_id=user.id,
            summary_text=(
                "- **Hemácias**: 5.52 (fora da faixa de normalidade)\n"
                "- **Vitamina B12**: 2000.0 (fora da faixa de normalidade)\n\n"
                "**Recomendação:** Realizar exames complementares."
            ),
            generated_at=datetime(2026, 4, 6),
        )
    )
    db_session.commit()

    response = client.get(f"/users/{user.id}/report")

    assert response.status_code == 200
    assert "<li><strong>Hemácias</strong>: 5.52 (fora da faixa de normalidade)</li>" in response.text
    assert "<li><strong>Vitamina B12</strong>: 2000.0 (fora da faixa de normalidade)</li>" in response.text
    assert "<p><strong>Recomendação:</strong> Realizar exames complementares.</p>" in response.text
    assert "**" not in response.text


def test_consultation_report_is_isolated_by_user(
    client, create_user, create_exam_result
):
    maria = create_user("Maria")
    joao = create_user("João")
    create_exam_result(maria, "glicemia")
    create_exam_result(joao, "colesterol")

    response = client.get(f"/users/{maria.id}/report")

    assert response.status_code == 200
    assert "glicemia" in response.text
    assert "ferro" in response.text
    assert "colesterol" not in response.text


def test_consultation_report_rejects_unknown_user(client):
    response = client.get("/users/999/report")

    assert response.status_code == 404
    assert response.json()["detail"] == "User não encontrado"

def test_dashboard_with_only_abnormal_results(client, create_user, create_exam_result):
    user = create_user("João")
    create_exam_result(user, "glicemia")

    response = client.get(f"/users/{user.id}/dashboard/is_abnormal")

    assert response.status_code == 200
    data = response.json()
    assert [result['is_abnormal'] for result in data] == [1]
    assert [result['parameter_name'] for result in data] == ["ferro"]


def test_abnormal_results_are_isolated_by_user(
    client, create_user, create_exam_result
):
    maria = create_user("Maria")
    joao = create_user("João")
    create_exam_result(maria, "glicemia")
    create_exam_result(joao, "colesterol")

    response = client.get(f"/users/{maria.id}/dashboard/is_abnormal")

    assert response.status_code == 200
    assert [result["parameter_name"] for result in response.json()] == ["ferro"]


def test_abnormal_results_reject_unknown_user(client):
    response = client.get("/users/999/dashboard/is_abnormal")

    assert response.status_code == 404
    assert response.json()["detail"] == "User não encontrado"


def test_abnormal_results_are_empty_when_user_has_no_abnormal_values(
    client, create_user, db_session
):
    user = create_user("Maria")
    exam = Exam(
        user_id=user.id,
        file_name="normal.pdf",
        file_url="/tmp/normal.pdf",
        status=ProcessingStatus.COMPLETED,
    )
    db_session.add(exam)
    db_session.flush()
    db_session.add(
        ExamResult(
            exam_id=exam.id,
            parameter_name="Glicemia",
            value=90.0,
            unit="mg/dL",
            reference_range="70-99",
            is_abnormal=0,
            measured_at=datetime(2026, 4, 6),
        )
    )
    db_session.commit()

    response = client.get(f"/users/{user.id}/dashboard/is_abnormal")

    assert response.status_code == 200
    assert response.json() == []


def test_consultation_report_handles_user_without_exam_data(client, create_user):
    user = create_user("Maria")

    response = client.get(f"/users/{user.id}/report")

    assert response.status_code == 200
    assert "Maria" in response.text
    assert "Nenhum resumo disponível ainda." in response.text
    assert "Nenhum resultado disponível." in response.text


def test_show_all_exams_for_a_user(client, create_user, create_exam_result):

    user = create_user("Maria")
    create_exam_result(user, "glicemia")
    create_exam_result(user, "colesterol")

    response = client.get(f"/users/{user.id}/show_exams_for_user")

    assert response.status_code == 200
    assert len(response.json()) == 2
    assert {exam["file_name"] for exam in response.json()} == {
        "colesterol.pdf",
        "glicemia.pdf",
    }

def test_show_all_exams_for_a_unknow_user(client):
    response = client.get("/users/999/show_exams_for_user")

    assert response.status_code == 404
    assert response.json()['detail'] == "User não encontrado!"

def test_delete_exam_for_a_user(client, create_user,
    create_exam_result, db_session):

    user = create_user("João")
    exam = create_exam_result(user, "glicemia")

    response = client.delete(f"/users/{user.id}/{exam.id}/delete_exam_for_user")

    assert response.status_code == 204
    assert response.content == b""

    exam_db = db_session.query(Exam).filter(Exam.id == exam.id).first()
    assert exam_db is None

def test_delete_in_cascade_results_for_exam(client, create_user,
    create_exam_result, db_session):

    user = create_user("João")
    exam = create_exam_result(user, "glicemia")

    response = client.delete(f"/users/{user.id}/{exam.id}/delete_exam_for_user")

    assert response.status_code == 204

    results = db_session.query(ExamResult).filter(ExamResult.exam_id == exam.id).all()
    assert results == []


def test_delete_exam_removes_uploaded_file(
    client, create_user, create_exam_result, db_session, tmp_path
):
    user = create_user("Maria")
    exam = create_exam_result(user, "glicemia")
    uploaded_file = tmp_path / "glicemia.pdf"
    uploaded_file.write_bytes(b"pdf")
    exam.file_url = str(uploaded_file)
    db_session.commit()

    response = client.delete(f"/users/{user.id}/{exam.id}/delete_exam_for_user")

    assert response.status_code == 204
    assert not uploaded_file.exists()


def test_user_cannot_delete_another_users_exam(
    client, create_user, create_exam_result
):
    owner = create_user("Maria")
    other_user = create_user("João")
    exam = create_exam_result(owner, "glicemia")

    response = client.delete(
        f"/users/{other_user.id}/{exam.id}/delete_exam_for_user"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Exame não encontrado!"