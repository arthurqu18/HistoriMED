from datetime import datetime

from backend.database.models import Exam, ExamResult, ExamSummary


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

def test_show_all_exams_for_a_user(client, create_user, create_exam_result):

    user = create_user("Maria")
    create_exam_result(user, "glicemia")
    create_exam_result(user, "colesterol")

    response = client.get(f"/users/{user.id}/show_exams_for_user")

    assert response.status_code == 200
    assert len(response.json()) == 2
    assert [exam["file_name"] for exam in response.json()] == [
        "colesterol.pdf",
        "glicemia.pdf",
    ]

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