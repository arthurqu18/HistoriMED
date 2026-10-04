export const API_BASE_URL =
  (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? "http://localhost:8001";

export type Role = "patient" | "doctor";
export interface Session { user_id: number; name: string; email: string; role: Role; }
export interface Patient { id: number; name: string; email?: string; }
export interface ExamResult {
  id?: number;
  parameter_name: string;
  value: number;
  unit?: string | null;
  reference_range?: string | null;
  reference_min?: number | null;
  reference_max?: number | null;
  is_abnormal?: boolean | number | null;
  measured_at: string;
}
export interface Dashboard { patient_id: number; patient_name: string; summary: string; results_history: ExamResult[]; }
export interface ExamUpload { id: number; file_name: string; laboratory_name?: string | null; status: string; }

export class OfflineError extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, init);
  } catch {
    throw new OfflineError("API indisponível");
  }
  if (!res.ok) {
    let detail = `Erro ${res.status}`;
    try { const j = await res.json(); if (typeof j.detail === "string") detail = j.detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
}

const json = (body: unknown): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

export const api = {
  login: (email: string, password: string) => req<Session>("/login", json({ email, password })),
  register: (d: { name: string; email: string; password: string; role: Role }) =>
    req<Patient & { role: Role }>("/users/register", json(d)),
  uploadExam: (patientId: number, file: File, lab?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (lab) fd.append("laboratory_name", lab);
    return req<ExamUpload>(`/patient/${patientId}/upload-exam/`, { method: "POST", body: fd });
  },
  searchPatients: (name: string) =>
    req<Patient[]>(`/doctor/search-patients?name=${encodeURIComponent(name)}`),
  dashboard: (id: number) => req<Dashboard>(`/doctor/patient/${id}/dashboard`),
};

// ---------- Mock fallback data ----------
export const mockPatients: Patient[] = [
  { id: 1, name: "Laura Mendes", email: "laura@exemplo.com" },
  { id: 2, name: "Lucas Andrade", email: "lucas@exemplo.com" },
  { id: 3, name: "Larissa Costa", email: "larissa@exemplo.com" },
];

export function mockDashboard(id: number): Dashboard {
  const p = mockPatients.find((x) => x.id === id) ?? mockPatients[0]!;
  const dates = ["2025-10-12", "2026-01-18", "2026-04-09", "2026-07-22", "2026-09-30"];
  const series: Record<string, { unit: string; min: number; max: number; v: number[] }> = {
    Glicemia: { unit: "mg/dL", min: 70, max: 99, v: [92, 98, 104, 109, 101] },
    "Colesterol Total": { unit: "mg/dL", min: 0, max: 190, v: [212, 205, 196, 184, 178] },
    HDL: { unit: "mg/dL", min: 40, max: 90, v: [44, 46, 49, 52, 55] },
    "Hemoglobina Glicada": { unit: "%", min: 4, max: 5.7, v: [5.4, 5.6, 5.8, 6.0, 5.8] },
  };
  const results: ExamResult[] = [];
  for (const [name, s] of Object.entries(series))
    s.v.forEach((value, i) =>
      results.push({
        parameter_name: name, value, unit: s.unit, reference_min: s.min, reference_max: s.max,
        reference_range: `${s.min} – ${s.max}`, is_abnormal: value < s.min || value > s.max,
        measured_at: dates[i]!,
      }),
    );
  return {
    patient_id: p.id,
    patient_name: p.name,
    summary:
      "- Glicemia de jejum em tendência de alta desde jan/2026, atingindo 109 mg/dL em jul/2026 (faixa de pré-diabetes).\n- Hemoglobina glicada acima de 5,7% nos dois últimos exames — sugere acompanhamento metabólico.\n- Colesterol total em queda consistente, voltando à faixa desejável (178 mg/dL).\n- HDL em melhora progressiva (44 → 55 mg/dL).\n- Recomendação: reavaliar dieta e atividade física; repetir glicemia e HbA1c em 90 dias.",
    results_history: results,
  };
}

export function isAbnormal(r: ExamResult) {
  if (typeof r.is_abnormal === "boolean") return r.is_abnormal;
  // A API do backend serializa is_abnormal como 0/1 (coluna Integer do SQLAlchemy).
  if (typeof r.is_abnormal === "number") return r.is_abnormal !== 0;
  if (r.reference_min != null && r.value < r.reference_min) return true;
  if (r.reference_max != null && r.value > r.reference_max) return true;
  return false;
}
export function refLabel(r: ExamResult) {
  if (r.reference_range) return r.reference_range;
  if (r.reference_min != null || r.reference_max != null)
    return `${r.reference_min ?? "—"} – ${r.reference_max ?? "—"}`;
  return "—";
}
