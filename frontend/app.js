const state = {
  users: [],
  currentUser: null,
  dashboard: null,
  abnormalResults: [],
  exams: [],
  selectedParameter: null,
  searchQuery: "",
};

// --- UTILITÁRIOS DE SEGURANÇA E FORMATAÇÃO ---

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showToast(message, isError = false) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " toast-error" : ""}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4200);
}

function formatProfile(user) {
  const parts = [];
  if (user.idade !== null && user.idade !== undefined) {
    parts.push(`${user.idade} anos`);
  }
  if (user.sexo) {
    parts.push(user.sexo.charAt(0).toUpperCase() + user.sexo.slice(1));
  }
  return parts.length ? parts.join(" · ") : "Perfil clínico não informado";
}

function getInitials(name) {
  const words = (name || "HM").trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function formatDate(isoDate) {
  if (!isoDate) return "Não informada";
  return String(isoDate).slice(0, 10);
}

function renderSafeMarkdown(rawText) {
  if (!rawText) {
    return '<p class="muted-state">Nenhum resumo disponível ainda.</p>';
  }

  const lines = escapeHtml(rawText).split(/\r?\n/);
  const htmlParts = [];
  let inList = false;

  const formatInline = (text) =>
    text
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (inList) {
        htmlParts.push("</ul>");
        inList = false;
      }
      continue;
    }

    if (/^---+$/.test(line)) {
      if (inList) {
        htmlParts.push("</ul>");
        inList = false;
      }
      htmlParts.push("<hr />");
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      if (inList) {
        htmlParts.push("</ul>");
        inList = false;
      }
      const level = Math.min(headingMatch[1].length + 2, 5);
      htmlParts.push(`<h${level}>${formatInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      if (!inList) {
        htmlParts.push("<ul>");
        inList = true;
      }
      htmlParts.push(`<li>${formatInline(bulletMatch[1])}</li>`);
      continue;
    }

    if (inList) {
      htmlParts.push("</ul>");
      inList = false;
    }
    htmlParts.push(`<p>${formatInline(line)}</p>`);
  }

  if (inList) {
    htmlParts.push("</ul>");
  }

  return htmlParts.join("");
}

function parseLocaleNumber(token) {
  let cleaned = token.trim();
  if (!cleaned) return null;

  if (cleaned.includes(".") && cleaned.includes(",")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if ((cleaned.match(/\./g) || []).length > 1) {
    cleaned = cleaned.replace(/\./g, "");
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(",", ".");
  }

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseReferenceBounds(referenceText) {
  if (!referenceText) return null;
  const text = String(referenceText).toUpperCase();
  const matches = text.match(/\d[\d.,]*/g);
  if (!matches || matches.length === 0) return null;

  const numbers = matches
    .map(parseLocaleNumber)
    .filter((n) => n !== null);

  if (numbers.length >= 2) {
    const low = Math.min(numbers[0], numbers[1]);
    const high = Math.max(numbers[0], numbers[1]);
    if (high > low) {
      return { low, high, mode: "range" };
    }
  }

  if (numbers.length === 1) {
    if (text.includes("ATE") || text.includes("ATÉ") || text.includes("INFERIOR") || text.includes("<")) {
      return { low: 0, high: numbers[0], mode: "upper" };
    }
    if (text.includes("SUPERIOR") || text.includes("ACIMA") || text.includes(">")) {
      return { low: numbers[0], high: numbers[0] * 2 || 10, mode: "lower" };
    }
  }

  return null;
}

// --- COMUNICAÇÃO COM A API ---

async function apiRequest(path, options = {}) {
  try {
    const response = await fetch(path, options);
    if (!response.ok) {
      let detail = `Erro ${response.status}`;
      try {
        const errData = await response.json();
        detail = errData.detail || detail;
      } catch (_) {
        // mantém mensagem padrão
      }
      throw new Error(detail);
    }

    if (response.status === 204) {
      return null;
    }
    return await response.json();
  } catch (error) {
    showToast(error.message || "Falha na comunicação com o servidor.", true);
    return undefined;
  }
}

// --- TELA 1: PERFIS E CADASTRO ---

async function loadUsers() {
  const users = await apiRequest("/users/show_users");
  if (!users) return;
  state.users = users;
  renderProfilesGrid();
}

function renderProfilesGrid() {
  const grid = document.getElementById("profiles-grid");
  if (!state.users.length) {
    grid.innerHTML =
      '<p class="muted-state">Nenhum perfil cadastrado ainda. Crie o primeiro dossiê abaixo.</p>';
    return;
  }

  grid.innerHTML = state.users
    .map(
      (user) => `
      <button type="button" class="profile-tile" data-user-id="${user.id}">
        <strong>${escapeHtml(user.name)}</strong>
        <span>${escapeHtml(formatProfile(user))}</span>
      </button>
    `
    )
    .join("");

  grid.querySelectorAll(".profile-tile").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.userId);
      const selected = state.users.find((u) => u.id === id);
      if (selected) openWorkspace(selected);
    });
  });
}

async function handleRegisterUser(event) {
  event.preventDefault();
  const nameInput = document.getElementById("reg-name");
  const ageInput = document.getElementById("reg-age");
  const sexInput = document.getElementById("reg-sex");

  const name = nameInput.value.trim();
  if (!name) {
    showToast("Informe o nome completo do paciente.", true);
    return;
  }

  const idade = ageInput.value !== "" ? Number(ageInput.value) : null;
  const sexo = sexInput.value || null;

  const created = await apiRequest("/users/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, idade, sexo }),
  });

  if (created) {
    nameInput.value = "";
    ageInput.value = "";
    sexInput.value = "";
    showToast("Dossiê clínico criado com sucesso.");
    await loadUsers();
    openWorkspace(created);
  }
}

// --- TELA 2: WORKSPACE CLÍNICO ---

async function openWorkspace(user) {
  state.currentUser = user;
  state.selectedParameter = null;
  state.searchQuery = "";

  document.getElementById("auth-view").classList.add("hidden");
  document.getElementById("workspace-view").classList.remove("hidden");

  document.getElementById("sidebar-avatar").textContent = getInitials(user.name);
  document.getElementById("sidebar-name").textContent = user.name;
  document.getElementById("sidebar-profile").textContent = formatProfile(user);

  document.getElementById("header-patient-name").textContent = user.name;
  document.getElementById("header-patient-meta").textContent = formatProfile(user);
  document.getElementById("print-report-link").href = `/users/${user.id}/report`;

  const confirmCheckbox = document.getElementById("confirm-delete-account");
  const deleteAccountBtn = document.getElementById("delete-account-btn");
  confirmCheckbox.checked = false;
  deleteAccountBtn.disabled = true;

  loadSavedAnamnesis(user);
  await refreshWorkspaceData();
}

function exitWorkspace() {
  state.currentUser = null;
  state.dashboard = null;
  state.abnormalResults = [];
  state.exams = [];

  document.getElementById("workspace-view").classList.add("hidden");
  document.getElementById("auth-view").classList.remove("hidden");
  loadUsers();
}

async function refreshWorkspaceData() {
  if (!state.currentUser) return;
  const userId = state.currentUser.id;

  const [dashboard, abnormal, exams] = await Promise.all([
    apiRequest(`/users/${userId}/dashboard`),
    apiRequest(`/users/${userId}/dashboard/is_abnormal`),
    apiRequest(`/users/${userId}/show_exams_for_user`),
  ]);

  if (dashboard) state.dashboard = dashboard;
  if (abnormal) state.abnormalResults = abnormal;
  if (exams) state.exams = exams;

  renderKPIs();
  renderOverviewTab();
  renderEvolutionTab();
  renderExamsTab();
}

function renderKPIs() {
  const results = state.dashboard?.results_history || [];
  const uniqueParams = new Set(results.map((r) => r.parameter_name));

  document.getElementById("kpi-exams").textContent = state.exams.length;
  document.getElementById("kpi-parameters").textContent = uniqueParams.size;
  document.getElementById("kpi-abnormal").textContent = state.abnormalResults.length;
}

// --- ABA 01: SÍNTESE CLÍNICA ---

function renderOverviewTab() {
  const summaryEl = document.getElementById("ai-summary-body");
  summaryEl.innerHTML = renderSafeMarkdown(state.dashboard?.summary);

  const abnormalEl = document.getElementById("abnormal-list");
  if (!state.abnormalResults.length) {
    abnormalEl.innerHTML =
      '<p class="muted-state">Nenhum resultado fora da faixa de referência.</p>';
    return;
  }

  abnormalEl.innerHTML = state.abnormalResults
    .map(
      (item) => `
      <article class="abnormal-item">
        <div class="abnormal-top">
          <span>${escapeHtml(item.parameter_name)}</span>
          <span class="mono-num">${escapeHtml(item.value)} ${escapeHtml(item.unit || "")}</span>
        </div>
        <div class="abnormal-meta">
          Referência: ${escapeHtml(item.reference_range || "Não informada")} · Coleta: ${escapeHtml(formatDate(item.measured_at))}
        </div>
      </article>
    `
    )
    .join("");
}

// --- ABA 02: EVOLUÇÃO & BIOMARCADORES ---

function renderEvolutionTab() {
  const results = state.dashboard?.results_history || [];
  const select = document.getElementById("parameter-select");
  const focusContainer = document.getElementById("parameter-focus");

  const parameterNames = [...new Set(results.map((r) => r.parameter_name))].sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  );

  if (!parameterNames.length) {
    select.innerHTML = '<option value="">Sem parâmetros</option>';
    focusContainer.innerHTML =
      '<p class="muted-state">Envie um laudo em PDF na aba "Laudos & Upload" para visualizar a evolução dos biomarcadores.</p>';
    renderAllResultsTable();
    return;
  }

  if (!state.selectedParameter || !parameterNames.includes(state.selectedParameter)) {
    state.selectedParameter = parameterNames[0];
  }

  select.innerHTML = parameterNames
    .map(
      (param) =>
        `<option value="${escapeHtml(param)}" ${
          param === state.selectedParameter ? "selected" : ""
        }>${escapeHtml(param)}</option>`
    )
    .join("");

  const history = results.filter((r) => r.parameter_name === state.selectedParameter);
  const latest = history[history.length - 1];
  const unit = latest.unit || "";
  const isAbnormal = latest.is_abnormal === 1;

  const gaugeHtml = buildReferenceGauge(latest);
  const chartHtml = buildSvgTrendChart(history, state.selectedParameter, unit);

  focusContainer.innerHTML = `
    <div class="focus-metrics">
      <div class="focus-stat">
        <span>Último resultado (${escapeHtml(formatDate(latest.measured_at))})</span>
        <strong>${escapeHtml(latest.value)} ${escapeHtml(unit)}</strong>
      </div>
      <div class="focus-stat">
        <span>Faixa de referência</span>
        <strong>${escapeHtml(latest.reference_range || "Não informada")}</strong>
      </div>
      <div class="focus-stat">
        <span>Leitura clínica</span>
        <strong>${isAbnormal ? "Fora da referência" : "Dentro da referência"}</strong>
      </div>
    </div>
    ${gaugeHtml}
    ${chartHtml}
  `;

  renderAllResultsTable();
}

function buildReferenceGauge(latest) {
  const bounds = parseReferenceBounds(latest.reference_range);
  if (!bounds) return "";

  const span = bounds.high - bounds.low;
  if (span <= 0) return "";

  // 25% a 75% na barra representa o intervalo de referência normal
  const ratio = (latest.value - bounds.low) / span;
  const rawPct = 25 + ratio * 50;
  const clampedPct = Math.max(4, Math.min(96, rawPct));

  return `
    <div class="range-gauge-box">
      <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--ink-muted);">
        <span>Posicionamento relativo à referência</span>
        <span class="mono-num">${escapeHtml(latest.reference_range)}</span>
      </div>
      <div class="range-track" title="Valor: ${escapeHtml(latest.value)}">
        <div class="range-marker" style="left: ${clampedPct.toFixed(1)}%;"></div>
      </div>
      <div style="display:flex; justify-content:space-between; font-family:var(--font-mono); font-size:0.72rem; color:var(--ink-muted);">
        <span>Abaixo</span>
        <span>Faixa esperada</span>
        <span>Acima</span>
      </div>
    </div>
  `;
}

function buildSvgTrendChart(history, parameterName, unit) {
  if (history.length < 2) {
    return `
      <div class="svg-chart-wrap">
        <p class="muted-state" style="margin:0;">
          Apenas <strong>1 medição</strong> registrada para <strong>${escapeHtml(
            parameterName
          )}</strong> até o momento. Novos laudos enviados ao longo do tempo formarão automaticamente a curva evolutiva aqui.
        </p>
      </div>
    `;
  }

  const width = 760;
  const height = 220;
  const padLeft = 56;
  const padRight = 28;
  const padTop = 24;
  const padBottom = 38;

  const values = history.map((h) => Number(h.value));
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const spread = maxVal - minVal || Math.abs(maxVal) * 0.2 || 1;
  const yMin = minVal - spread * 0.15;
  const yMax = maxVal + spread * 0.15;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const points = history.map((item, idx) => {
    const x = padLeft + (idx / (history.length - 1)) * plotW;
    const y = padTop + ((yMax - Number(item.value)) / (yMax - yMin)) * plotH;
    return {
      x,
      y,
      value: item.value,
      date: formatDate(item.measured_at),
      abnormal: item.is_abnormal === 1,
    };
  });

  const polylinePoints = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const circlesSvg = points
    .map(
      (p) => `
      <circle
        cx="${p.x.toFixed(1)}"
        cy="${p.y.toFixed(1)}"
        r="5.5"
        fill="${p.abnormal ? "#C99A2E" : "#246464"}"
        stroke="#FFFFFF"
        stroke-width="2"
      >
        <title>${escapeHtml(p.date)}: ${escapeHtml(p.value)} ${escapeHtml(unit)}</title>
      </circle>
      <text
        x="${p.x.toFixed(1)}"
        y="${height - 12}"
        text-anchor="middle"
        font-family="IBM Plex Mono, monospace"
        font-size="11"
        fill="#526069"
      >${escapeHtml(p.date)}</text>
    `
    )
    .join("");

  return `
    <div class="svg-chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Gráfico de evolução de ${escapeHtml(
        parameterName
      )}">
        <line x1="${padLeft}" y1="${padTop}" x2="${width - padRight}" y2="${padTop}" stroke="#DCE1DA" stroke-dasharray="4 4" />
        <line x1="${padLeft}" y1="${padTop + plotH / 2}" x2="${width - padRight}" y2="${
    padTop + plotH / 2
  }" stroke="#DCE1DA" stroke-dasharray="4 4" />
        <line x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${
    padTop + plotH
  }" stroke="#DCE1DA" />

        <text x="${padLeft - 8}" y="${padTop + 4}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="11" fill="#526069">${yMax.toFixed(
    1
  )}</text>
        <text x="${padLeft - 8}" y="${
    padTop + plotH + 4
  }" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="11" fill="#526069">${yMin.toFixed(
    1
  )}</text>

        <polyline
          fill="none"
          stroke="#5AA7A7"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
          points="${polylinePoints}"
        />
        ${circlesSvg}
      </svg>
    </div>
  `;
}

function renderAllResultsTable() {
  const tbody = document.getElementById("all-results-tbody");
  const results = state.dashboard?.results_history || [];
  const query = state.searchQuery.trim().toLowerCase();

  const filtered = query
    ? results.filter(
        (r) =>
          (r.parameter_name || "").toLowerCase().includes(query) ||
          (r.category || "").toLowerCase().includes(query)
      )
    : results;

  if (!filtered.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="muted-state">Nenhum resultado encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .map((r) => {
      const abnormal = r.is_abnormal === 1;
      return `
        <tr>
          <td><strong>${escapeHtml(r.parameter_name)}</strong></td>
          <td>${escapeHtml(r.category || "—")}</td>
          <td class="mono-num">${escapeHtml(r.value)} ${escapeHtml(r.unit || "")}</td>
          <td class="mono-num">${escapeHtml(r.reference_range || "—")}</td>
          <td class="mono-num">${escapeHtml(formatDate(r.measured_at))}</td>
          <td>
            <span class="status-pill ${abnormal ? "pill-abnormal" : "pill-normal"}">
              ${abnormal ? "Alterado" : "Normal"}
            </span>
          </td>
        </tr>
      `;
    })
    .join("");
}

// --- ABA 03: ANAMNESE PRÉVIA ---

function getAnamnesisStorageKey(userId) {
  return `historimed_anamnesis_${userId}`;
}

function buildAnamnesisText(user, data) {
  return [
    "FICHA DE ANAMNESE PRÉVIA - HISTORIMED",
    `Paciente: ${user.name} (${formatProfile(user)})`,
    `Atualizado em: ${data.updatedAt}`,
    "--------------------------------------------------",
    `Motivo principal / sintomas: ${data.complaint}`,
    `Duração dos sintomas: ${data.duration || "Não informado"}`,
    `Medicamentos e suplementos: ${data.medications || "Nenhum informado"}`,
    `Alergias conhecidas: ${data.allergies || "Nenhuma informada"}`,
    `Observações para o médico: ${data.notes || "Sem observações adicionais"}`,
  ].join("\n");
}

function loadSavedAnamnesis(user) {
  const previewEl = document.getElementById("anamnesis-preview");
  const downloadBtn = document.getElementById("download-anamnesis-btn");
  const raw = localStorage.getItem(getAnamnesisStorageKey(user.id));

  if (!raw) {
    document.getElementById("anamnesis-form").reset();
    previewEl.textContent =
      "Preencha o formulário ao lado para gerar a ficha estruturada da consulta.";
    downloadBtn.disabled = true;
    return;
  }

  try {
    const data = JSON.parse(raw);
    document.getElementById("anam-complaint").value = data.complaint || "";
    document.getElementById("anam-duration").value = data.duration || "";
    document.getElementById("anam-meds").value = data.medications || "";
    document.getElementById("anam-allergies").value = data.allergies || "";
    document.getElementById("anam-notes").value = data.notes || "";

    previewEl.textContent = buildAnamnesisText(user, data);
    downloadBtn.disabled = false;
  } catch (_) {
    downloadBtn.disabled = true;
  }
}

function handleAnamnesisSubmit(event) {
  event.preventDefault();
  if (!state.currentUser) return;

  const complaint = document.getElementById("anam-complaint").value.trim();
  if (!complaint) {
    showToast("Descreva o motivo principal da consulta.", true);
    return;
  }

  const now = new Date();
  const updatedAt = `${now.toLocaleDateString("pt-BR")} ${now.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;

  const data = {
    complaint,
    duration: document.getElementById("anam-duration").value.trim(),
    medications: document.getElementById("anam-meds").value.trim(),
    allergies: document.getElementById("anam-allergies").value.trim(),
    notes: document.getElementById("anam-notes").value.trim(),
    updatedAt,
  };

  localStorage.setItem(
    getAnamnesisStorageKey(state.currentUser.id),
    JSON.stringify(data)
  );

  document.getElementById("anamnesis-preview").textContent = buildAnamnesisText(
    state.currentUser,
    data
  );
  document.getElementById("download-anamnesis-btn").disabled = false;
  showToast("Ficha pré-consulta atualizada.");
}

function handleDownloadAnamnesis() {
  if (!state.currentUser) return;
  const content = document.getElementById("anamnesis-preview").textContent;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `anamnese_${state.currentUser.name
    .toLowerCase()
    .replace(/\s+/g, "_")}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

// --- ABA 04: LAUDOS & UPLOAD ---

function renderExamsTab() {
  const container = document.getElementById("exams-list");
  if (!state.exams.length) {
    container.innerHTML =
      '<p class="muted-state">Nenhum laudo PDF enviado até o momento.</p>';
    return;
  }

  const statusMap = {
    completed: { label: "Concluído", cls: "pill-normal" },
    processing: { label: "Processando", cls: "pill-pending" },
    pending: { label: "Pendente", cls: "pill-pending" },
    failed: { label: "Falha na leitura", cls: "pill-failed" },
  };

  container.innerHTML = state.exams
    .map((exam) => {
      const st = statusMap[exam.status] || { label: exam.status, cls: "pill-pending" };
      return `
        <div class="exam-row-card">
          <div>
            <strong>${escapeHtml(exam.file_name)}</strong>
            <span>
              Laboratório: ${escapeHtml(exam.laboratory_name || "Não informado")} ·
              Coleta: ${escapeHtml(formatDate(exam.exam_date))}
            </span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="status-pill ${st.cls}">${escapeHtml(st.label)}</span>
            <button
              type="button"
              class="btn btn-outline btn-sm delete-exam-btn"
              data-exam-id="${exam.id}"
            >
              Excluir
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll(".delete-exam-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const examId = Number(btn.dataset.examId);
      const res = await apiRequest(
        `/users/${state.currentUser.id}/${examId}/delete_exam_for_user`,
        { method: "DELETE" }
      );
      if (res !== undefined) {
        showToast("Laudo excluído.");
        await refreshWorkspaceData();
      }
    });
  });
}

async function handleUploadExam(event) {
  event.preventDefault();
  if (!state.currentUser) return;

  const labInput = document.getElementById("exam-lab");
  const fileInput = document.getElementById("exam-file");
  const file = fileInput.files[0];

  if (!file) {
    showToast("Selecione um arquivo PDF antes de enviar.", true);
    return;
  }

  const formData = new FormData();
  formData.append("laboratory_name", labInput.value.trim());
  formData.append("file", file);

  const created = await apiRequest(
    `/users/${state.currentUser.id}/upload-exam/`,
    {
      method: "POST",
      body: formData,
    }
  );

  if (created) {
    labInput.value = "";
    fileInput.value = "";
    showToast("Laudo enviado! Clique em 'Atualizar status' em alguns segundos.");
    await refreshWorkspaceData();
  }
}

async function handleDeleteAccount() {
  if (!state.currentUser) return;
  const res = await apiRequest(
    `/users/${state.currentUser.id}/delete-account`,
    { method: "DELETE" }
  );
  if (res !== undefined) {
    localStorage.removeItem(getAnamnesisStorageKey(state.currentUser.id));
    showToast("Conta e todos os dados removidos.");
    exitWorkspace();
  }
}

// --- INICIALIZAÇÃO E NAVEGAÇÃO ---

document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("register-form")
    .addEventListener("submit", handleRegisterUser);

  document
    .getElementById("switch-user-btn")
    .addEventListener("click", exitWorkspace);

  document
    .getElementById("confirm-delete-account")
    .addEventListener("change", (e) => {
      document.getElementById("delete-account-btn").disabled = !e.target.checked;
    });

  document
    .getElementById("delete-account-btn")
    .addEventListener("click", handleDeleteAccount);

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetTab = btn.dataset.tab;
      document
        .querySelectorAll(".nav-item")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      document
        .querySelectorAll(".tab-panel")
        .forEach((panel) => panel.classList.remove("active"));
      document.getElementById(`tab-${targetTab}`).classList.add("active");
    });
  });

  document
    .getElementById("parameter-select")
    .addEventListener("change", (e) => {
      state.selectedParameter = e.target.value;
      renderEvolutionTab();
    });

  document.getElementById("results-search").addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderAllResultsTable();
  });

  document
    .getElementById("anamnesis-form")
    .addEventListener("submit", handleAnamnesisSubmit);

  document
    .getElementById("download-anamnesis-btn")
    .addEventListener("click", handleDownloadAnamnesis);

  document
    .getElementById("upload-exam-form")
    .addEventListener("submit", handleUploadExam);

  document
    .getElementById("refresh-exams-btn")
    .addEventListener("click", async () => {
      await refreshWorkspaceData();
      showToast("Status atualizado.");
    });

  loadUsers();
});