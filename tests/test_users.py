from backend.database.models import Exam, ExamResult, ExamSummary, User

def test_register_user_returns_created_user(client):
    response = client.post(
        "/users/register",
        json={"name": "Maria", "idade": 34, "sexo": "feminino"},
    )

    assert response.status_code == 201
    assert response.json()["name"] == "Maria"
    assert response.json()["id"] > 0
    assert response.json()["idade"] == 34
    assert response.json()["sexo"] == "feminino"


def test_register_user_allows_optional_profile_fields(client):
    response = client.post("/users/register", json={"name": "Maria"})

    assert response.status_code == 201
    assert response.json()["idade"] is None
    assert response.json()["sexo"] is None


def test_register_user_rejects_out_of_range_age(client):
    for idade in (-1, 131):
        response = client.post(
            "/users/register",
            json={"name": f"Maria {idade}", "idade": idade},
        )

        assert response.status_code == 422


def test_register_user_rejects_duplicate_name(client):
    client.post("/users/register", json={"name": "Maria"})

    response = client.post("/users/register", json={"name": "Maria"})

    assert response.status_code == 400
    assert response.json()["detail"] == "Usuário já cadastrado"


def test_show_users_returns_available_users(client):
    client.post("/users/register", json={"name": "Maria"})
    client.post("/users/register", json={"name": "João"})

    response = client.get("/users/show_users")

    assert response.status_code == 200
    assert [user["name"] for user in response.json()] == ["Maria", "João"]

def test_delete_known_user(client, create_user, create_exam_result, db_session):
    user = create_user("João")
    exam = create_exam_result(user, "glicemia")
    user_id = user.id
    exam_id = exam.id

    response = client.delete(f"/users/{user_id}/delete-account")

    user_test = db_session.query(User).filter(User.id == user_id).first()
    exam_test = db_session.query(Exam).filter(Exam.id == exam_id).first()
    results_test = db_session.query(ExamResult).filter(
        ExamResult.exam_id == exam_id
    ).all()
    exam_summary_test = db_session.query(ExamSummary).filter(
        ExamSummary.user_id == user_id
    ).first()

    assert response.status_code == 204
    assert user_test is None
    assert exam_test is None
    assert results_test == []
    assert exam_summary_test is None


def test_delete_unknown_user(client):
    response = client.delete("/users/999/delete-account")

    assert response.status_code == 404
    assert response.json()["detail"] == "User não encontrado"


def test_delete_account_removes_uploaded_files(
    client, create_user, create_exam_result, db_session, tmp_path
):
    user = create_user("Maria")
    exam = create_exam_result(user, "glicemia")
    user_id = user.id
    exam_id = exam.id
    uploaded_file = tmp_path / "glicemia.pdf"
    uploaded_file.write_bytes(b"%PDF")
    exam.file_url = str(uploaded_file)
    db_session.commit()

    response = client.delete(f"/users/{user_id}/delete-account")

    assert response.status_code == 204
    assert not uploaded_file.exists()
    assert db_session.query(Exam).filter(Exam.id == exam_id).first() is None


def test_delete_account_does_not_remove_another_users_data(
    client, create_user, create_exam_result, db_session
):
    maria = create_user("Maria")
    joao = create_user("João")
    maria_exam = create_exam_result(maria, "glicemia")
    joao_exam = create_exam_result(joao, "colesterol")
    maria_id = maria.id
    maria_exam_id = maria_exam.id
    joao_exam_id = joao_exam.id

    response = client.delete(f"/users/{maria_id}/delete-account")

    assert response.status_code == 204
    assert db_session.query(Exam).filter(Exam.id == maria_exam_id).first() is None
    assert db_session.query(Exam).filter(Exam.id == joao_exam_id).first() is not None