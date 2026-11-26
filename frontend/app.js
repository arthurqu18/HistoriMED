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

// --- DADOS DE DEMONSTRAÇÃO E PERSISTÊNCIA LOCAL ---

const DEMO_STORAGE_KEY = "historimed_demo_data_v1";

function dateMonthsAgo(months) {
  const date = new Date();
  const dayOfMonth = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() - months);
  const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(dayOfMonth, lastDayOfMonth));
  return date.toISOString().slice(0, 10);
}

function getBiomarkerCatalog(sex) {
  return [
    {
      name: "Hemoglobina",
      category: "Hematologia",
      unit: "g/dL",
      low: sex === "feminino" ? 12 : 13.5,
      high: sex === "feminino" ? 16 : 17.5,
      reference: sex === "feminino" ? "12,0–16,0" : "13,5–17,5",
    },
    {
      name: "Glicose em jejum",
      category: "Metabolismo",
      unit: "mg/dL",
      low: 70,
      high: 99,
      reference: "70–99",
    },
    {
      name: "Colesterol LDL",
      category: "Perfil lipídico",
      unit: "mg/dL",
      low: 0,
      high: 100,
      reference: "0–100",
    },
    {
      name: "Colesterol HDL",
      category: "Perfil lipídico",
      unit: "mg/dL",
      low: sex === "feminino" ? 50 : 40,
      high: 100,
      reference: sex === "feminino" ? "50–100" : "40–100",
    },
    {
      name: "Triglicerídeos",
      category: "Perfil lipídico",
      unit: "mg/dL",
      low: 0,
      high: 150,
      reference: "0–150",
    },
    {
      name: "Vitamina D",
      category: "Vitaminas",
      unit: "ng/mL",
      low: 30,
      high: 100,
      reference: "30–100",
    },
    {
      name: "TSH",
      category: "Tireoide",
      unit: "µUI/mL",
      low: 0.4,
      high: 4,
      reference: "0,4–4,0",
    },
    {
      name: "Creatinina",
      category: "Função renal",
      unit: "mg/dL",
      low: sex === "feminino" ? 0.6 : 0.7,
      high: sex === "feminino" ? 1.1 : 1.3,
      reference: sex === "feminino" ? "0,6–1,1" : "0,7–1,3",
    },
  ];
}

function createExam(id, monthsAgo, patient, values, laboratoryName) {
  const measuredAt = dateMonthsAgo(monthsAgo);
  const catalog = getBiomarkerCatalog(patient.sexo);
  return {
    id,
    file_name: `Painel_laboratorial_${measuredAt}.pdf`,
    laboratory_name: laboratoryName,
    exam_date: measuredAt,
    status: "completed",
    results: catalog.map((marker, index) => {
      const value = values[index];
      return {
        parameter_name: marker.name,
        category: marker.category,
        value: String(value),
        unit: marker.unit,
        reference_range: marker.reference,
        is_abnormal: value < marker.low || value > marker.high ? 1 : 0,
        measured_at: measuredAt,
      };
    }),
  };
}

function createMockData() {
  const patients = [
    {
      id: 1,
      name: "Rafael Martins",
      idade: 42,
      sexo: "masculino",
      summary: "## Síntese clínica consolidada\n\nHistórico demonstrativo com quatro coletas nos últimos 12 meses. **Glicose em jejum, LDL, triglicerídeos e vitamina D** estão fora das faixas de referência na coleta mais recente.\n\n- LDL e triglicerídeos apresentam tendência de elevação ao longo do período.\n- Glicose em jejum aumentou gradualmente; a última medida está acima da referência.\n- Vitamina D permanece abaixo da referência nas coletas recentes.\n- Hemoglobina, HDL, TSH e creatinina mantêm resultados dentro das faixas apresentadas.\n\n*Dados fictícios para demonstração; não representam avaliação ou recomendação médica.*",
      exams: [],
    },
    {
      id: 2,
      name: "Mariana Costa",
      idade: 31,
      sexo: "feminino",
      summary: "## Síntese clínica consolidada\n\nHistórico demonstrativo com quatro coletas nos últimos 12 meses. **Vitamina D** está abaixo da referência na coleta mais recente e o **LDL** permanece discretamente elevado.\n\n- TSH apresentou redução gradual e está dentro da faixa de referência na última coleta.\n- Hemoglobina, glicose em jejum, HDL, triglicerídeos e creatinina permanecem dentro das referências apresentadas.\n- LDL teve elevação em relação às primeiras coletas, com discreta redução na medição mais recente.\n\n*Dados fictícios para demonstração; não representam avaliação ou recomendação médica.*",
      exams: [],
    },
  ];

  const collectionMonths = [11, 7, 3, 0];
  const profiles = [
    {
      patient: patients[0],
      values: [
        [15.1, 94, 118, 46, 132, 24, 2.1, 1.0],
        [14.8, 102, 126, 44, 158, 27, 2.4, 1.02],
        [14.6, 108, 142, 43, 181, 22, 2.5, 1.04],
        [14.7, 112, 151, 42, 196, 19, 2.3, 1.03],
      ],
    },
    {
      patient: patients[1],
      values: [
        [13.2, 88, 96, 58, 112, 34, 4.5, 0.78],
        [13.0, 91, 103, 56, 121, 29, 4.2, 0.80],
        [12.8, 92, 112, 54, 128, 25, 3.8, 0.82],
        [12.6, 95, 108, 55, 119, 27, 3.6, 0.81],
      ],
    },
  ];

  profiles.forEach(({ patient, values }, patientIndex) => {
    patient.exams = collectionMonths.map((monthsAgo, index) =>
      createExam(
        (patientIndex + 1) * 100 + index + 1,
        monthsAgo,
        patient,
        values[index],
        ["Laboratório Sabin", "Fleury", "Hermes Pardini", "Laboratório São Lucas"][index]
      )
    );
  });
  return { nextPatientId: 3, nextExamId: 205, patients };
}

async function readDemoData() {
  const serialized = localStorage.getItem(DEMO_STORAGE_KEY);
  if (!serialized) {
    const initialData = createMockData();
    localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(initialData));
    return initialData;
  }

  const data = JSON.parse(serialized);
  if (!data || !Array.isArray(data.patients)) {
    throw new Error("Os dados locais da demonstração estão inválidos. Restaure os dados iniciais para continuar.");
  }
  return data;
}

async function saveDemoData(data) {
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(data));
}

async function runDemoAction(action) {
  try {
    return await action();
  } catch (error) {
    showToast(error.message || "Não foi possível acessar os dados locais.", true);
    return undefined;
  }
}

const mockData = {
  async listPatients() {
    const data = await readDemoData();
    return data.patients.map(({ id, name, idade, sexo }) => ({ id, name, idade, sexo }));
  },

  async createPatient({ name, idade, sexo }) {
    const data = await readDemoData();
    const patient = {
      id: data.nextPatientId || Date.now(),
      name,
      idade,
      sexo,
      summary: "## Síntese clínica consolidada\n\nAinda não há exames neste dossiê. Envie um PDF para simular a inclusão de resultados laboratoriais.\n\n*Dados fictícios para demonstração.*",
      exams: [],
    };
    data.nextPatientId = patient.id + 1;
    data.patients.push(patient);
    await saveDemoData(data);
    return { id: patient.id, name, idade, sexo };
  },

  async getWorkspace(patientId) {
    const data = await readDemoData();
    const patient = data.patients.find((item) => item.id === patientId);
    if (!patient) throw new Error("Paciente não encontrado nos dados locais.");
    const results = patient.exams.flatMap((exam) => exam.results || []);
    results.sort((a, b) => a.measured_at.localeCompare(b.measured_at));
    const latestByParameter = new Map();
    results.forEach((result) => latestByParameter.set(result.parameter_name, result));
    return {
      dashboard: { summary: patient.summary, results_history: results },
      abnormal: [...latestByParameter.values()].filter((result) => result.is_abnormal === 1),
      exams: [...patient.exams].sort((a, b) => b.exam_date.localeCompare(a.exam_date)),
    };
  },

  async beginExamUpload(patientId, fileName, laboratoryName) {
    const data = await readDemoData();
    const patient = data.patients.find((item) => item.id === patientId);
    if (!patient) throw new Error("Paciente não encontrado nos dados locais.");
    const exam = {
      id: data.nextExamId || Date.now(),
      file_name: fileName,
      laboratory_name: laboratoryName,
      exam_date: dateMonthsAgo(0),
      status: "processing",
      results: [],
    };
    data.nextExamId = exam.id + 1;
    patient.exams.push(exam);
    await saveDemoData(data);
    return exam.id;
  },

  async completeExamUpload(patientId, examId, values) {
    const data = await readDemoData();
    const patient = data.patients.find((item) => item.id === patientId);
    const exam = patient?.exams.find((item) => item.id === examId);
    if (!patient || !exam) throw new Error("O exame em processamento não foi encontrado.");
    const catalog = getBiomarkerCatalog(patient.sexo);
    exam.results = catalog.map((marker, index) => ({
      parameter_name: marker.name,
      category: marker.category,
      value: String(values[index]),
      unit: marker.unit,
      reference_range: marker.reference,
      is_abnormal: values[index] < marker.low || values[index] > marker.high ? 1 : 0,
      measured_at: exam.exam_date,
    }));
    exam.status = "completed";
    patient.summary = buildClinicalSummary(patient, patient.exams.flatMap((item) => item.results || []));
    await saveDemoData(data);
    return true;
  },

  async deleteExam(patientId, examId) {
    const data = await readDemoData();
    const patient = data.patients.find((item) => item.id === patientId);
    if (!patient) throw new Error("Paciente não encontrado nos dados locais.");
    patient.exams = patient.exams.filter((item) => item.id !== examId);
    patient.summary = buildClinicalSummary(patient, patient.exams.flatMap((item) => item.results || []));
    await saveDemoData(data);
    return true;
  },

  async deletePatient(patientId) {
    const data = await readDemoData();
    data.patients = data.patients.filter((patient) => patient.id !== patientId);
    await saveDemoData(data);
    return true;
  },
};

function buildClinicalSummary(patient, results) {
  if (!results.length) {
    return "## Síntese clínica consolidada\n\nNão há resultados laboratoriais neste dossiê no momento.\n\n*Dados fictícios para demonstração.*";
  }

  const historyByParameter = new Map();
  results.forEach((result) => {
    if (!historyByParameter.has(result.parameter_name)) {
      historyByParameter.set(result.parameter_name, []);
    }
    historyByParameter.get(result.parameter_name).push(result);
  });

  const latestResults = [...historyByParameter.values()].map((history) =>
    history.sort((a, b) => a.measured_at.localeCompare(b.measured_at)).at(-1)
  );
  const abnormal = latestResults.filter((result) => result.is_abnormal === 1);
  const observations = abnormal.length
    ? abnormal.map((result) => `- **${result.parameter_name}**: ${result.value} ${result.unit}, fora da referência (${result.reference_range}).`)
    : ["- Nenhum parâmetro está fora da referência na coleta mais recente."];
  const trends = [...historyByParameter.entries()]
    .filter(([, history]) => history.length > 1)
    .map(([name, history]) => {
      const ordered = history.sort((a, b) => a.measured_at.localeCompare(b.measured_at));
      const firstValue = Number(ordered[0].value);
      const lastValue = Number(ordered.at(-1).value);
      const direction = lastValue > firstValue ? "aumentou" : lastValue < firstValue ? "reduziu" : "permaneceu estável";
      return `- ${name} ${direction} de ${ordered[0].value} para ${ordered.at(-1).value} ${ordered.at(-1).unit} no período registrado.`;
    });

  return [
    "## Síntese clínica consolidada",
    "",
    `Histórico demonstrativo de ${patient.name}, com ${results.length} resultados laboratoriais.`,
    "",
    "**Parâmetros fora da referência na coleta mais recente:**",
    ...observations,
    "",
    "**Tendências observadas:**",
    ...(trends.length ? trends : ["- Ainda não há coletas suficientes para comparar tendências."]),
    "",
    "*Dados fictícios para demonstração; não representam avaliação ou recomendação médica.*",
  ].join("\n");
}

// --- TELA 1: PERFIS E CADASTRO ---

async function loadUsers() {
  const users = await runDemoAction(() => mockData.listPatients());
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

  const created = await runDemoAction(() =>
    mockData.createPatient({ name, idade, sexo })
  );

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
  document.getElementById("print-report-link").href = "#";

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
  const workspace = await runDemoAction(() => mockData.getWorkspace(userId));
  if (!workspace) return;

  state.dashboard = workspace.dashboard;
  state.abnormalResults = workspace.abnormal;
  state.exams = workspace.exams;

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

function handlePrintReport(event) {
  event.preventDefault();
  if (!state.currentUser) return;

  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    showToast("Permita a abertura de uma nova janela para imprimir o relatório.", true);
    return;
  }

  const results = state.dashboard?.results_history || [];
  const rows = results
    .map((result) => `
      <tr>
        <td>${escapeHtml(formatDate(result.measured_at))}</td>
        <td>${escapeHtml(result.parameter_name)}</td>
        <td>${escapeHtml(result.value)} ${escapeHtml(result.unit || "")}</td>
        <td>${escapeHtml(result.reference_range || "—")}</td>
        <td>${result.is_abnormal === 1 ? "Fora da faixa" : "Normal"}</td>
      </tr>
    `)
    .join("");

  reportWindow.document.write(`<!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Relatório clínico — ${escapeHtml(state.currentUser.name)}</title>
        <style>
          body { max-width: 1000px; margin: 40px auto; padding: 0 24px; color: #142026; font: 14px/1.6 "IBM Plex Sans", Arial, sans-serif; }
          h1, h2 { color: #1F5B5B; } h1 { margin-bottom: 4px; }
          .meta { color: #526068; margin: 0 0 28px; }
          .summary { white-space: pre-wrap; background: #F2F4F0; padding: 18px; border-radius: 8px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th, td { padding: 8px; border-bottom: 1px solid #E0E4DD; text-align: left; }
          th { background: #F2F4F0; } .notice { margin-top: 28px; color: #526068; font-size: 12px; }
          @media print { body { margin: 0; } }
        </style>
      </head>
      <body>
        <h1>HistoriMED · Relatório clínico</h1>
        <p class="meta">${escapeHtml(state.currentUser.name)} · ${escapeHtml(formatProfile(state.currentUser))} · Gerado em ${escapeHtml(new Date().toLocaleDateString("pt-BR"))}</p>
        <h2>Síntese clínica</h2>
        <div class="summary">${escapeHtml(state.dashboard?.summary || "Sem síntese disponível.")}</div>
        <h2>Histórico de resultados</h2>
        <table>
          <thead><tr><th>Data</th><th>Parâmetro</th><th>Resultado</th><th>Referência</th><th>Status</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5">Nenhum resultado disponível.</td></tr>'}</tbody>
        </table>
        <p class="notice">Dados fictícios armazenados localmente para demonstração. Este relatório não substitui avaliação médica.</p>
      </body>
    </html>`);
  reportWindow.document.close();
  reportWindow.focus();
  setTimeout(() => reportWindow.print(), 250);
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

function saveAnamnesis(notify = false) {
  if (!state.currentUser) return;

  const complaint = document.getElementById("anam-complaint").value.trim();
  if (!complaint) {
    if (notify) {
      showToast("Descreva o motivo principal da consulta.", true);
    }
    return false;
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

  try {
    localStorage.setItem(
      getAnamnesisStorageKey(state.currentUser.id),
      JSON.stringify(data)
    );
  } catch (error) {
    showToast(error.message || "Não foi possível salvar a ficha localmente.", true);
    return false;
  }

  document.getElementById("anamnesis-preview").textContent = buildAnamnesisText(
    state.currentUser,
    data
  );
  document.getElementById("download-anamnesis-btn").disabled = false;
  if (notify) {
    showToast("Ficha pré-consulta atualizada.");
  }
  return true;
}

function handleAnamnesisSubmit(event) {
  event.preventDefault();
  if (!state.currentUser) return;
  if (!saveAnamnesis(true)) {
    return;
  }
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
      const deleted = await runDemoAction(() =>
        mockData.deleteExam(state.currentUser.id, examId)
      );
      if (deleted) {
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
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    showToast("Selecione um arquivo com extensão .pdf.", true);
    return;
  }

  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const originalButtonText = submitButton.textContent;
  const patientId = state.currentUser.id;
  const patientSex = state.currentUser.sexo;
  submitButton.disabled = true;
  submitButton.textContent = "Extraindo texto do PDF...";
  showToast("Extraindo texto do PDF e estruturando biomarcadores...");
  const examId = await runDemoAction(() =>
    mockData.beginExamUpload(patientId, file.name, labInput.value.trim())
  );
  if (examId === undefined) {
    submitButton.disabled = false;
    submitButton.textContent = originalButtonText;
    return;
  }

  if (state.currentUser?.id === patientId) await refreshWorkspaceData();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const values = patientSex === "feminino"
    ? [12.7, 94, 110, 56, 124, 27, 3.5, 0.82]
    : [14.8, 109, 154, 43, 188, 21, 2.4, 1.02];
  const completed = await runDemoAction(() =>
    mockData.completeExamUpload(patientId, examId, values)
  );

  if (completed) {
    labInput.value = "";
    fileInput.value = "";
    showToast("Exame fictício estruturado e adicionado ao histórico.");
    if (state.currentUser?.id === patientId) await refreshWorkspaceData();
  }
  submitButton.disabled = false;
  submitButton.textContent = originalButtonText;
}

async function handleDeleteAccount() {
  if (!state.currentUser) return;
  const patientId = state.currentUser.id;
  const deleted = await runDemoAction(() => mockData.deletePatient(patientId));
  if (deleted) {
    localStorage.removeItem(getAnamnesisStorageKey(patientId));
    showToast("Conta e todos os dados removidos.");
    exitWorkspace();
  }
}

function handleRestoreDemoData() {
  const confirmed = window.confirm("Restaurar os pacientes e exames fictícios iniciais? As alterações desta demonstração serão removidas.");
  if (!confirmed) return;
  Object.keys(localStorage)
    .filter((key) => key.startsWith("historimed_"))
    .forEach((key) => localStorage.removeItem(key));
  window.location.reload();
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

  document
    .getElementById("print-report-link")
    .addEventListener("click", handlePrintReport);

  document
    .getElementById("restore-demo-data-btn")
    .addEventListener("click", handleRestoreDemoData);

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

  const anamnesisForm = document.getElementById("anamnesis-form");
  anamnesisForm.addEventListener("submit", handleAnamnesisSubmit);
  anamnesisForm.addEventListener("input", () => {
    if (document.getElementById("anam-complaint").value.trim()) {
      saveAnamnesis();
    }
  });

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