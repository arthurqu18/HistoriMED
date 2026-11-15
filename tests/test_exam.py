from datetime import datetime

from backend.database.models import ExamSummary


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