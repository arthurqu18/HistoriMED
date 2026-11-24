import os
from datetime import datetime

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


def format_profile(user):
    parts = []
    if user.get("idade") is not None:
        parts.append(f"{user['idade']} anos")
    if user.get("sexo"):
        parts.append(user["sexo"].capitalize())
    return " · ".join(parts) if parts else "Perfil clínico não informado"


def show_user_selection():
    st.markdown("#### HistoriMED")
    st.title("Histórico Clínico Unificado")
    st.write(
        "Selecione um perfil cadastrado para visualizar exames, acompanhar "
        "tendências laboratoriais e preparar o resumo para sua consulta."
    )
    st.divider()

    st.subheader("Perfis disponíveis")
    users = load_users()
    if users:
        columns = st.columns(3)
        for index, user in enumerate(users):
            with columns[index % 3]:
                with st.container(border=True):
                    st.markdown(f"**{user['name']}**")
                    st.caption(format_profile(user))
                    if st.button(
                        "Acessar histórico",
                        key=f"user-{user['id']}",
                        type="primary",
                        use_container_width=True,
                    ):
                        st.session_state.user = user
                        st.rerun()
    else:
        st.info("Nenhum perfil cadastrado ainda. Crie o primeiro perfil abaixo.")

    st.write("")
    with st.expander("Cadastrar novo paciente", expanded=not bool(users)):
        with st.form("register-user"):
            col_name, col_age, col_sex = st.columns([2, 1, 1])
            with col_name:
                name = st.text_input("Nome completo")
            with col_age:
                idade = st.number_input(
                    "Idade (opcional)",
                    min_value=0,
                    max_value=130,
                    value=None,
                    step=1,
                )
            with col_sex:
                sexo = st.selectbox(
                    "Sexo biológico (opcional)",
                    options=["Não informar", "Masculino", "Feminino"],
                    index=0,
                )

            submitted = st.form_submit_button("Criar perfil", type="primary")
            if submitted:
                if not name.strip():
                    st.warning("Informe o nome do paciente.")
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
                        st.success("Perfil criado com sucesso.")
                        st.session_state.user = response.json()
                        st.rerun()


def render_sidebar(user):
    with st.sidebar:
        st.markdown("### HistoriMED")
        st.caption("Inteligência Clínica & Histórico Unificado")
        st.divider()

        st.markdown(f"**Paciente:** {user['name']}")
        st.caption(format_profile(user))
        if st.button("Trocar usuário", use_container_width=True):
            st.session_state.pop("user", None)
            st.rerun()

        st.divider()
        st.subheader("Privacidade (LGPD)")
        st.caption(
            "Exclui permanentemente sua conta, exames, resultados e arquivos PDF."
        )
        confirm_delete = st.checkbox(
            "Confirmo que quero apagar todos os meus dados",
            key=f"confirm-delete-{user['id']}",
        )
        if st.button(
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


def render_clinical_overview_tab(dashboard, abnormal_results):
    st.subheader("Pontos de atenção")
    if abnormal_results:
        st.warning(
            f"{len(abnormal_results)} resultado(s) fora da faixa de referência."
        )
        st.dataframe(
            [
                {
                    "Parâmetro": r["parameter_name"],
                    "Resultado": f"{r['value']} {r['unit'] or ''}".strip(),
                    "Referência": r["reference_range"] or "Não informada",
                    "Data": r["measured_at"][:10],
                }
                for r in abnormal_results
            ],
            use_container_width=True,
            hide_index=True,
        )
    else:
        st.success("Nenhum resultado fora da faixa de referência identificado.")

    st.subheader("Síntese clínica gerada pela IA")
    with st.container(border=True):
        st.markdown(dashboard["summary"] or "Nenhum resumo disponível ainda.")


def render_evolution_tab(results):
    st.subheader("Evolução por parâmetro")
    if not results:
        st.info(
            "Nenhum resultado laboratorial extraído ainda. Envie um laudo PDF "
            "na aba 'Gerenciar Exames'."
        )
        return

    parameter_names = sorted({r["parameter_name"] for r in results})
    selected_param = st.selectbox(
        "Selecione o exame ou biomarcador para analisar",
        options=parameter_names,
    )

    param_history = [
        r for r in results if r["parameter_name"] == selected_param
    ]
    latest = param_history[-1]
    unit = latest["unit"] or ""
    status_label = (
        "Fora da referência" if latest["is_abnormal"] == 1 else "Dentro da referência"
    )

    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("Último resultado", f"{latest['value']} {unit}".strip())
    with col2:
        st.metric("Faixa de referência", latest["reference_range"] or "Não informada")
    with col3:
        st.metric("Status clínico", status_label)

    if len(param_history) >= 2:
        chart_data = [
            {
                "Data": r["measured_at"][:10],
                f"{selected_param} ({unit})".strip(): r["value"],
            }
            for r in param_history
        ]
        st.line_chart(chart_data, x="Data")
    else:
        st.caption(
            "Apenas 1 medição registrada para este parâmetro até o momento. "
            "Envie novos laudos ao longo do tempo para visualizar a curva de evolução."
        )

    st.dataframe(
        [
            {
                "Data": r["measured_at"][:10],
                "Valor": r["value"],
                "Unidade": r["unit"] or "",
                "Referência": r["reference_range"] or "",
                "Leitura": "Alterado" if r["is_abnormal"] == 1 else "Normal",
            }
            for r in param_history
        ],
        use_container_width=True,
        hide_index=True,
    )

    with st.expander("Ver tabela completa de todos os parâmetros"):
        st.dataframe(
            [
                {
                    "Parâmetro": r["parameter_name"],
                    "Categoria": r["category"] or "",
                    "Valor": r["value"],
                    "Unidade": r["unit"] or "",
                    "Referência": r["reference_range"] or "",
                    "Data": r["measured_at"][:10],
                }
                for r in results
            ],
            use_container_width=True,
            hide_index=True,
        )


def render_anamnesis_tab(user):
    st.subheader("Anamnese prévia para consulta")
    st.write(
        "Organize suas queixas, sintomas e medicamentos antes do atendimento "
        "para otimizar o tempo com o médico."
    )

    state_key = f"anamnesis_{user['id']}"
    saved_data = st.session_state.get(state_key, {})

    with st.form("pre-consultation-anamnesis"):
        complaint = st.text_area(
            "Motivo principal da consulta / sintomas atuais",
            value=saved_data.get("complaint", ""),
            placeholder="Ex.: Cansaço frequente nas últimas semanas e exames de rotina.",
        )
        col_dur, col_meds = st.columns(2)
        with col_dur:
            duration = st.text_input(
                "Há quanto tempo percebe os sintomas?",
                value=saved_data.get("duration", ""),
                placeholder="Ex.: Cerca de 3 semanas",
            )
        with col_meds:
            medications = st.text_input(
                "Medicamentos ou suplementos em uso",
                value=saved_data.get("medications", ""),
                placeholder="Ex.: Vitamina D 2000 UI, Losartana 50 mg",
            )
        allergies = st.text_input(
            "Alergias conhecidas (medicamentos ou alimentos)",
            value=saved_data.get("allergies", ""),
            placeholder="Ex.: Nenhuma conhecida / Dipirona",
        )
        notes = st.text_area(
            "Observações adicionais ou dúvidas para o médico",
            value=saved_data.get("notes", ""),
            placeholder="Ex.: Gostaria de revisar a necessidade de suplementação.",
        )

        if st.form_submit_button("Gerar ficha pré-consulta", type="primary"):
            if not complaint.strip():
                st.warning("Descreva ao menos o motivo principal da consulta.")
            else:
                st.session_state[state_key] = {
                    "complaint": complaint.strip(),
                    "duration": duration.strip() or "Não informado",
                    "medications": medications.strip() or "Nenhum informado",
                    "allergies": allergies.strip() or "Nenhuma informada",
                    "notes": notes.strip() or "Sem observações adicionais",
                    "updated_at": datetime.now().strftime("%d/%m/%Y %H:%M"),
                }
                st.success("Ficha pré-consulta atualizada.")

    current_anamnesis = st.session_state.get(state_key)
    if current_anamnesis:
        summary_card = (
            f"FICHA DE ANAMNESE PRÉVIA - HISTORIMED\n"
            f"Paciente: {user['name']} ({format_profile(user)})\n"
            f"Preenchido em: {current_anamnesis['updated_at']}\n"
            f"--------------------------------------------------\n"
            f"Motivo / Queixa principal: {current_anamnesis['complaint']}\n"
            f"Duração dos sintomas: {current_anamnesis['duration']}\n"
            f"Medicamentos em uso: {current_anamnesis['medications']}\n"
            f"Alergias: {current_anamnesis['allergies']}\n"
            f"Observações: {current_anamnesis['notes']}\n"
        )
        with st.container(border=True):
            st.markdown("#### Ficha estruturada pronta para consulta")
            st.text(summary_card)
            st.download_button(
                "Baixar ficha pré-consulta (.txt)",
                data=summary_card,
                file_name=f"anamnese_{user['name'].lower().replace(' ', '_')}.txt",
                mime="text/plain",
            )


def render_exams_tab(user, exams):
    col_upload, col_list = st.columns([1, 1.4])

    with col_upload:
        st.subheader("Enviar novo laudo")
        with st.container(border=True):
            with st.form("upload-exam"):
                laboratory_name = st.text_input(
                    "Laboratório (opcional)",
                    placeholder="Ex.: Hermes Pardini, Fleury, Sabin",
                )
                uploaded_file = st.file_uploader(
                    "Selecione o laudo em PDF", type=["pdf"]
                )
                submitted = st.form_submit_button(
                    "Enviar para análise",
                    type="primary",
                    use_container_width=True,
                )
                if submitted:
                    if uploaded_file is None:
                        st.warning("Selecione um arquivo PDF antes de enviar.")
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
                                "Laudo enviado. Clique em 'Atualizar status' "
                                "em alguns segundos para ver os dados extraídos."
                            )
                            st.rerun()

    with col_list:
        header_col, refresh_col = st.columns([3, 1])
        with header_col:
            st.subheader("Laudos enviados")
        with refresh_col:
            if st.button("Atualizar status", use_container_width=True):
                st.rerun()

        if not exams:
            st.info("Nenhum laudo PDF enviado até o momento.")
            return

        status_labels = {
            "completed": "Concluído",
            "processing": "Processando...",
            "pending": "Pendente",
            "failed": "Falha na leitura",
        }

        for exam in exams:
            with st.container(border=True):
                info_col, action_col = st.columns([4, 1])
                readable_status = status_labels.get(exam["status"], exam["status"])
                with info_col:
                    st.markdown(f"**{exam['file_name']}**")
                    st.caption(
                        f"Laboratório: {exam['laboratory_name'] or 'Não informado'} · "
                        f"Coleta: {(exam['exam_date'] or 'Não informada')[:10]} · "
                        f"Status: {readable_status}"
                    )
                with action_col:
                    if st.button(
                        "Excluir",
                        key=f"delete-exam-{exam['id']}",
                        use_container_width=True,
                    ):
                        delete_response = api_request(
                            "DELETE",
                            f"/users/{user['id']}/{exam['id']}/delete_exam_for_user",
                        )
                        if delete_response is not None:
                            st.success("Exame excluído.")
                            st.rerun()


def show_dashboard(user):
    render_sidebar(user)

    header_col, report_col = st.columns([3, 1.3])
    with header_col:
        st.title(f"Olá, {user['name']}")
        st.caption(format_profile(user))
    with report_col:
        st.write("")
        st.link_button(
            "Imprimir resumo médico",
            f"{API_URL}/users/{user['id']}/report",
            use_container_width=True,
        )

    dashboard_resp = api_request("GET", f"/users/{user['id']}/dashboard")
    if dashboard_resp is None:
        return
    dashboard = dashboard_resp.json()

    abnormal_resp = api_request(
        "GET", f"/users/{user['id']}/dashboard/is_abnormal"
    )
    abnormal_results = abnormal_resp.json() if abnormal_resp else []

    exams_resp = api_request("GET", f"/users/{user['id']}/show_exams_for_user")
    exams = exams_resp.json() if exams_resp else []

    results = dashboard["results_history"]
    unique_parameters = {r["parameter_name"] for r in results}

    m1, m2, m3 = st.columns(3)
    with m1:
        st.metric("Laudos enviados", len(exams))
    with m2:
        st.metric("Parâmetros monitorados", len(unique_parameters))
    with m3:
        st.metric("Resultados alterados", len(abnormal_results))

    st.write("")
    tab_overview, tab_evolution, tab_anamnesis, tab_exams = st.tabs(
        [
            "Resumo Clínico",
            "Evolução por Parâmetro",
            "Anamnese Prévia",
            "Gerenciar Exames",
        ]
    )

    with tab_overview:
        render_clinical_overview_tab(dashboard, abnormal_results)

    with tab_evolution:
        render_evolution_tab(results)

    with tab_anamnesis:
        render_anamnesis_tab(user)

    with tab_exams:
        render_exams_tab(user, exams)


st.set_page_config(
    page_title="HistoriMED | Histórico Clínico Unificado",
    layout="wide",
)

if "user" not in st.session_state:
    show_user_selection()
else:
    show_dashboard(st.session_state.user)