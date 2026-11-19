import os

import requests
import streamlit as st


API_URL = os.getenv("HISTORIMED_API_URL", "http://localhost:8001").rstrip("/")
REQUEST_TIMEOUT = 10


def api_request(method, path, **kwargs):
    try:
        response = requests.request(
            method,
            f"{API_URL}{path}",
            timeout=REQUEST_TIMEOUT,
            **kwargs,
        )
    except requests.RequestException as exc:
        st.error(f"Não foi possível conectar à API: {exc}")
        return None

    if not response.ok:
        try:
            detail = response.json().get("detail", response.text)
        except ValueError:
            detail = response.text
        st.error(f"Erro na API ({response.status_code}): {detail}")
        return None

    return response


def load_users():
    response = api_request("GET", "/users/show_users")
    return response.json() if response else []


def show_user_selection():
    st.title("HistoriMED")
    st.subheader("Selecione seu usuário")
    st.write("Clique no seu nome para acessar seu histórico de exames.")

    users = load_users()
    if users:
        columns = st.columns(min(len(users), 3))
        for index, user in enumerate(users):
            with columns[index % len(columns)]:
                if st.button(
                    user["name"],
                    key=f"user-{user['id']}",
                    use_container_width=True,
                ):
                    st.session_state.user = user
                    st.rerun()
    else:
        st.info("Nenhum usuário cadastrado.")

    with st.expander("Cadastrar usuário"):
        with st.form("register-user"):
            name = st.text_input("Nome")
            idade = st.number_input(
                "Idade (opcional)",
                min_value=0,
                max_value=130,
                value=None,
                step=1,
            )
            sexo = st.selectbox(
                "Sexo biológico (opcional)",
                options=["Não informar", "Masculino", "Feminino"],
                index=0,
            )
            submitted = st.form_submit_button("Cadastrar")
            if submitted:
                if not name.strip():
                    st.warning("Informe um nome.")
                else:
                    idade_value = int(idade) if idade is not None else None
                    sexo_value = None
                    if sexo == "Masculino":
                        sexo_value = "masculino"
                    elif sexo == "Feminino":
                        sexo_value = "feminino"

                    response = api_request(
                        "POST",
                        "/users/register",
                        json={
                            "name": name.strip(),
                            "idade": idade_value,
                            "sexo": sexo_value,
                        },
                    )
                    if response:
                        st.success("Usuário cadastrado.")
                        st.session_state.user = response.json()
                        st.rerun()


def show_dashboard(user):
    st.title(f"Olá, {user['name']}!")

    if st.sidebar.button("Trocar usuário"):
        st.session_state.pop("user", None)
        st.rerun()

    st.sidebar.divider()
    st.sidebar.subheader("Privacidade")
    st.sidebar.caption(
        "Esta ação remove permanentemente sua conta, exames, resultados "
        "e arquivos PDF."
    )
    confirm_delete = st.sidebar.checkbox(
        "Confirmo que quero apagar todos os meus dados",
        key=f"confirm-delete-{user['id']}",
    )
    if st.sidebar.button(
        "Apagar todos os meus dados",
        type="secondary",
        disabled=not confirm_delete,
        use_container_width=True,
    ):
        delete_response = api_request(
            "DELETE",
            f"/users/{user['id']}/delete-account",
        )
        if delete_response is not None:
            st.session_state.pop("user", None)
            st.success("Sua conta e todos os seus dados foram apagados.")
            st.rerun()

    response = api_request("GET", f"/users/{user['id']}/dashboard")
    if response is None:
        return

    dashboard = response.json()
    st.subheader("Resumo")
    st.info(dashboard["summary"] or "Nenhum resumo disponível ainda.")
    st.link_button(
        "Gerar resumo para consulta",
        f"{API_URL}/users/{user['id']}/report",
        use_container_width=True,
    )

    abnormal_response = api_request(
        "GET", f"/users/{user['id']}/dashboard/is_abnormal"
    )
    if abnormal_response:
        abnormal_results = abnormal_response.json()
        st.subheader("Resultados alterados")
        if abnormal_results:
            st.warning(
                f"{len(abnormal_results)} resultado(s) fora do valor de referência."
            )
            st.dataframe(
                [
                    {
                        "Parâmetro": result["parameter_name"],
                        "Valor": result["value"],
                        "Unidade": result["unit"] or "",
                        "Referência": result["reference_range"] or "",
                        "Data": result["measured_at"][:10],
                    }
                    for result in abnormal_results
                ],
                use_container_width=True,
                hide_index=True,
            )
        else:
            st.success("Nenhum resultado fora do valor de referência.")

    st.subheader("Exames enviados")
    exams_response = api_request(
        "GET", f"/users/{user['id']}/show_exams_for_user"
    )
    if exams_response:
        exams = exams_response.json()
        if exams:
            for exam in exams:
                details = (
                    f"**{exam['file_name']}** | "
                    f"Laboratório: {exam['laboratory_name'] or 'Não informado'} | "
                    f"Coleta: {(exam['exam_date'] or 'Não informada')[:10]} | "
                    f"Status: `{exam['status']}`"
                )
                col_details, col_delete = st.columns([5, 1])
                with col_details:
                    st.markdown(details)
                with col_delete:
                    if st.button("Excluir", key=f"delete-exam-{exam['id']}"):
                        delete_response = api_request(
                            "DELETE",
                            f"/users/{user['id']}/{exam['id']}/delete_exam_for_user",
                        )
                        if delete_response is not None:
                            st.success("Exame excluído.")
                            st.rerun()
        else:
            st.info("Nenhum exame enviado.")

    results = dashboard["results_history"]
    st.subheader("Histórico de resultados")
    if results:
        rows = [
            {
                "Parâmetro": result["parameter_name"],
                "Valor": result["value"],
                "Unidade": result["unit"] or "",
                "Referência": result["reference_range"] or "",
                "Data": result["measured_at"][:10],
            }
            for result in results
        ]
        st.dataframe(rows, use_container_width=True, hide_index=True)

        chart_rows = [
            {
                "Data": result["measured_at"][:10],
                result["parameter_name"]: result["value"],
            }
            for result in results
        ]
        st.line_chart(chart_rows, x="Data")
    else:
        st.info("Nenhum resultado disponível.")

    st.subheader("Enviar exame")
    with st.form("upload-exam"):
        laboratory_name = st.text_input("Laboratório (opcional)")
        uploaded_file = st.file_uploader("Arquivo PDF", type=["pdf"])
        submitted = st.form_submit_button("Enviar exame")
        if submitted:
            if uploaded_file is None:
                st.warning("Selecione um arquivo PDF.")
            else:
                response = api_request(
                    "POST",
                    f"/users/{user['id']}/upload-exam/",
                    data={"laboratory_name": laboratory_name or ""},
                    files={
                        "file": (
                            uploaded_file.name,
                            uploaded_file.getvalue(),
                            "application/pdf",
                        )
                    },
                )
                if response:
                    st.success(
                        "Exame enviado. O processamento pode levar alguns instantes."
                    )
                    st.rerun()


st.set_page_config(page_title="HistoriMED", page_icon="🩺", layout="wide")

if "user" not in st.session_state:
    show_user_selection()
else:
    show_dashboard(st.session_state.user)