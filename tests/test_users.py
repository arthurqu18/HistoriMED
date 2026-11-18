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
