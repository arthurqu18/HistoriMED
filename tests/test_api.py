import io
from pathlib import Path
from unittest.mock import patch


@patch("backend.api.process_exam_with_ai")
def test_upload_exam_associates_user_and_sanitizes_filename(
    mock_process_exam, client, db_session, tmp_path, monkeypatch, create_user
):
    user = create_user("Maria")
    monkeypatch.setattr("backend.api.UPLOAD_DIR", str(tmp_path))

    response = client.post(
        f"/users/{user.id}/upload-exam/",
        data={"laboratory_name": "Laboratório Central"},
        files={
            "file": (
                "../../laudo com espaços.pdf",
                io.BytesIO(b"%PDF-1.4 test"),
                "application/pdf",
            )
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["user_id"] == user.id
    assert data["file_name"] == "laudo_com_espa_os.pdf"
    assert data["laboratory_name"] == "Laboratório Central"

    stored_file = Path(data["file_url"])
    assert stored_file.parent == tmp_path
    assert stored_file.exists()
    assert stored_file.name.endswith("_laudo_com_espa_os.pdf")
    mock_process_exam.assert_called_once()


def test_upload_exam_rejects_unknown_user(client, tmp_path, monkeypatch):
    monkeypatch.setattr("backend.api.UPLOAD_DIR", str(tmp_path))

    response = client.post(
        "/users/999/upload-exam/",
        files={"file": ("exam.pdf", io.BytesIO(b"%PDF-1.4 test"), "application/pdf")},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "User não encontrado"
