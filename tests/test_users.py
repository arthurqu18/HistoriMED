def test_register_user_returns_created_user(client):
    response = client.post("/users/register", json={"name": "Maria"})

    assert response.status_code == 201
    assert response.json()["name"] == "Maria"
    assert response.json()["id"] > 0


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
