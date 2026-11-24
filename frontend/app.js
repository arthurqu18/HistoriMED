const state = {
  users: [],
  currentUser: null,
  dashboard: null,
  abnormalResults: [],
  exams: [],
  selectedParameter: null,
  searchQuery: "",
  onlyAbnormalResults: false,
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
      return { low, high };
    }
  }

  if (numbers.length === 1) {
    if (text.includes("ATE") || text.includes("ATÉ") || text.includes("INFERIOR") || text.includes("<")) {
      return { low: 0, high: numbers[0] };
    }
    if (text.includes("SUPERIOR") || text.includes("ACIMA") || text.includes(">")) {
      return { low: numbers[0], high: numbers[0] * 1.5 || 10 };
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
      <button type="button" class="profile-row-btn" data-user-id="${user.id}">
        <div>
          <strong>${escapeHtml(user.name)}</strong>
          <span>${escapeHtml(formatProfile(user))}</span>
        </div>
        <span class="row-arrow" aria-hidden="true">→</span>
      </button>
    `
    )
    .join("");

  grid.querySelectorAll(".profile-row-btn").forEach((btn) => {
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

// --- ABA 02: EVOLUÇÃO TEMPORAL & GRÁFICO ---

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

  const abnormalSet = new Set(state.abnormalResults.map((r) => r.parameter_name));
  const prioritized = [
    ...parameterNames.filter((p) => abnormalSet.has(p)),
    ...parameterNames.filter((p) => !abnormalSet.has(p)),
  ];

  if (!state.selectedParameter || !parameterNames.includes(state.selectedParameter)) {
    state.selectedParameter = prioritized[0];
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

  const chartHtml = buildSvgAreaChart(history, state.selectedParameter, unit, latest.reference_range);

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
    ${chartHtml}
  `;

  renderAllResultsTable();
}

function buildSvgAreaChart(history, parameterName, unit, referenceRange) {
  const width = 720;
  const height = 220;
  const padLeft = 72;
  const padRight = 36;
  const padTop = 26;
  const padBottom = 42;

  const bounds = parseReferenceBounds(referenceRange);
  const values = history.map((h) => Number(h.value));
  const candidates = [...values];
  if (bounds) {
    candidates.push(bounds.low, bounds.high);
  }

  const rawMin = Math.min(...candidates);
  const rawMax = Math.max(...candidates);
  const spread = rawMax - rawMin || Math.abs(rawMax) * 0.25 || 1;
  const yMin = Math.max(0, rawMin - spread * 0.18);
  const yMax = rawMax + spread * 0.18;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const valueToY = (v) => padTop + ((yMax - v) / (yMax - yMin)) * plotH;

  // Faixa sombreada de referência (como no vídeo demo)
  let refBandSvg = "";
  if (bounds) {
    const yTopRef = Math.max(padTop, Math.min(padTop + plotH, valueToY(bounds.high)));
    const yBotRef = Math.max(padTop, Math.min(padTop + plotH, valueToY(bounds.low)));
    const bandHeight = Math.max(4, yBotRef - yTopRef);
    refBandSvg = `
      <rect
        x="${padLeft}"
        y="${yTopRef.toFixed(1)}"
        width="${plotW}"
        height="${bandHeight.toFixed(1)}"
        fill="rgba(150, 215, 198, 0.28)"
      />
      <line
        x1="${padLeft}"
        y1="${yTopRef.toFixed(1)}"
        x2="${width - padRight}"
        y2="${yTopRef.toFixed(1)}"
        stroke="#5AA7A7"
        stroke-dasharray="4 4"
        stroke-width="1"
      />
      <line
        x1="${padLeft}"
        y1="${yBotRef.toFixed(1)}"
        x2="${width - padRight}"
        y2="${yBotRef.toFixed(1)}"
        stroke="#5AA7A7"
        stroke-dasharray="4 4"
        stroke-width="1"
      />
    `;
  }

  // Grade horizontal e rótulos do eixo Y
  const tickCount = 4;
  let gridSvg = "";
  for (let i = 0; i <= tickCount; i++) {
    const ratio = i / tickCount;
    const val = yMax - ratio * (yMax - yMin);
    const y = padTop + ratio * plotH;
    const label = Math.abs(val) >= 1000 ? Math.round(val).toLocaleString("pt-BR") : val.toFixed(1);
    gridSvg += `
      <line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="#E6EAE3" />
      <text x="${padLeft - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="11" fill="#526068">${label}</text>
    `;
  }

  const points = history.map((item, idx) => {
    const x =
      history.length === 1
        ? padLeft + plotW / 2
        : padLeft + (idx / (history.length - 1)) * plotW;
    const y = valueToY(Number(item.value));
    return {
      x,
      y,
      value: item.value,
      date: formatDate(item.measured_at),
      abnormal: item.is_abnormal === 1,
    };
  });

  let lineAndAreaSvg = "";
  if (points.length >= 2) {
    const lineCoords = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const baselineY = (padTop + plotH).toFixed(1);
    const firstX = points[0].x.toFixed(1);
    const lastX = points[points.length - 1].x.toFixed(1);
    const areaCoords = `${firstX},${baselineY} ${lineCoords} ${lastX},${baselineY}`;

    lineAndAreaSvg = `
      <polygon points="${areaCoords}" fill="url(#historiAreaGrad)" />
      <polyline
        fill="none"
        stroke="#2E4A78"
        stroke-width="2.75"
        stroke-linecap="round"
        stroke-linejoin="round"
        points="${lineCoords}"
      />
    `;
  }

  const pointsSvg = points
    .map((p) => {
      const displayVal = Number(p.value) >= 1000
        ? Number(p.value).toLocaleString("pt-BR")
        : p.value;
      return `
        <circle
          cx="${p.x.toFixed(1)}"
          cy="${p.y.toFixed(1)}"
          r="6"
          fill="${p.abnormal ? "#B8861B" : "#2E4A78"}"
          stroke="#FFFFFF"
          stroke-width="2.5"
        >
          <title>${escapeHtml(p.date)}: ${escapeHtml(displayVal)} ${escapeHtml(unit)}</title>
        </circle>
        <text
          x="${p.x.toFixed(1)}"
          y="${(p.y - 12).toFixed(1)}"
          text-anchor="middle"
          font-family="IBM Plex Mono, monospace"
          font-size="11"
          font-weight="600"
          fill="#142026"
        >${escapeHtml(displayVal)} ${escapeHtml(unit)}</text>
        <text
          x="${p.x.toFixed(1)}"
          y="${height - 14}"
          text-anchor="middle"
          font-family="IBM Plex Mono, monospace"
          font-size="11"
          fill="#526068"
        >${escapeHtml(p.date)}</text>
      `;
    })
    .join("");

  const legendNote = bounds
    ? `<span class="legend-swatch"><span class="swatch-box"></span> Faixa sombreada: referência (${escapeHtml(referenceRange)})</span>`
    : `<span>Referência: ${escapeHtml(referenceRange || "Não informada")}</span>`;

  const singlePointNote =
    history.length === 1
      ? `<span>1 medição registrada · envie novos laudos para acompanhar a curva</span>`
      : `<span>${history.length} medições registradas</span>`;

  return `
    <div class="chart-stage">
      <div class="chart-legend">
        ${legendNote}
        ${singlePointNote}
      </div>
      <svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Gráfico de evolução de ${escapeHtml(
        parameterName
      )}">
        <defs>
          <linearGradient id="historiAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#6C8CBF" stop-opacity="0.32" />
            <stop offset="100%" stop-color="#96D7C6" stop-opacity="0.02" />
          </linearGradient>
        </defs>
        ${gridSvg}
        ${refBandSvg}
        <line x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${
    padTop + plotH
  }" stroke="#C8CFC4" />
        ${lineAndAreaSvg}
        ${pointsSvg}
      </svg>
    </div>
  `;
}

function renderAllResultsTable() {
  const tbody = document.getElementById("all-results-tbody");
  const results = state.dashboard?.results_history || [];
  const query = state.searchQuery.trim().toLowerCase();

  const filtered = results.filter(
    (r) =>
      (!state.onlyAbnormalResults || r.is_abnormal === 1) &&
      (!query ||
        (r.parameter_name || "").toLowerCase().includes(query) ||
        (r.category || "").toLowerCase().includes(query))
  );

  if (!filtered.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="muted-state">Nenhum resultado encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered
    .map((r) => {
      const abnormal = r.is_abnormal === 1;
      return `
        <tr class="${abnormal ? "row-abnormal" : ""}">
          <td class="mono-num">${escapeHtml(formatDate(r.measured_at))}</td>
          <td><strong>${escapeHtml(r.parameter_name)}</strong></td>
          <td>${escapeHtml(r.category || "—")}</td>
          <td class="mono-num">${escapeHtml(r.value)} ${escapeHtml(r.unit || "")}</td>
          <td class="mono-num">${escapeHtml(r.reference_range || "—")}</td>
          <td>
            <span class="status-pill ${abnormal ? "pill-abnormal" : "pill-normal"}">
              ${abnormal ? "Fora da faixa" : "Normal"}
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
              class="btn btn-danger-soft btn-sm delete-exam-btn"
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

  document.getElementById("changed-only-filter").addEventListener("change", (e) => {
    state.onlyAbnormalResults = e.target.checked;
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