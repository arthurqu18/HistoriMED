export const API_BASE_URL =
  (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? "http://localhost:8001";

export interface User { id: number; name: string; idade?: number | null; sexo?: string | null; }
export interface ExamResult {
  id?: number;
  category?: string | null;
  parameter_name: string;
  value: number;
  unit?: string | null;
  reference_range?: string | null;
  is_abnormal: number | boolean;
  measured_at: string;
}
export interface Dashboard { user_id: number; user_name: string; summary?: string | null; results_history: ExamResult[]; }
export type ExamStatus = "pending" | "processing" | "completed" | "failed";
export interface Exam { id: number; user_id: number; file_name: string; laboratory_name?: string | null; exam_date?: string | null; status: ExamStatus; created_at: string; }

export class OfflineError extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(`${API_BASE_URL}${path}`, init); }
  catch { throw new OfflineError("API indisponível"); }
  if (!res.ok) {
    let detail = `Erro ${res.status}`;
    try { const j = await res.json(); if (typeof j.detail === "string") detail = j.detail; else if (Array.isArray(j.detail)) detail = j.detail.map((d: { msg: string }) => d.msg).join("; "); } catch { /* ignore */ }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Calls the API; on network failure runs the demo fallback and flags offline mode. */
let offlineListeners: ((v: boolean) => void)[] = [];
export let isOffline = false;
function setOffline(v: boolean) { if (v !== isOffline) { isOffline = v; offlineListeners.forEach((l) => l(v)); } }
export function onOffline(l: (v: boolean) => void) { offlineListeners.push(l); return () => { offlineListeners = offlineListeners.filter((x) => x !== l); }; }

async function withFallback<T>(call: () => Promise<T>, mock: () => T): Promise<T> {
  try { const r = await call(); setOffline(false); return r; }
  catch (e) { if (e instanceof OfflineError) { setOffline(true); return mock(); } throw e; }
}

export const reportUrl = (id: number) => `${API_BASE_URL}/users/${id}/report`;

export const api = {
  listUsers: () => withFallback(() => req<User[]>("/users/show_users"), () => [...demo.users]),
  register: (d: { name: string; idade?: number | null; sexo?: string | null }) =>
    withFallback(
      () => req<User>("/users/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) }),
      () => { const u = { id: Math.max(0, ...demo.users.map((x) => x.id)) + 1, ...d }; demo.users.push(u); return u; },
    ),
  deleteAccount: (id: number) =>
    withFallback(() => req<void>(`/users/${id}/delete-account`, { method: "DELETE" }),
      () => { demo.users = demo.users.filter((u) => u.id !== id); }),
  dashboard: (id: number) => withFallback(() => req<Dashboard>(`/users/${id}/dashboard`), () => mockDashboard(id)),
  abnormal: (id: number) => withFallback(() => req<ExamResult[]>(`/users/${id}/dashboard/is_abnormal`),
    () => mockDashboard(id).results_history.filter(isAbnormal)),
  exams: (id: number) => withFallback(() => req<Exam[]>(`/users/${id}/show_exams_for_user`), () => demo.exams.filter((e) => e.user_id === id)),
  uploadExam: (id: number, file: File, lab?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (lab) fd.append("laboratory_name", lab);
    return withFallback(() => req<Exam>(`/users/${id}/upload-exam/`, { method: "POST", body: fd }), () => {
      const e: Exam = { id: Date.now(), user_id: id, file_name: file.name, laboratory_name: lab ?? null, status: "pending", created_at: new Date().toISOString() };
      demo.exams.unshift(e); return e;
    });
  },
  deleteExam: (userId: number, examId: number) =>
    withFallback(() => req<void>(`/users/${userId}/${examId}/delete_exam_for_user`, { method: "DELETE" }),
      () => { demo.exams = demo.exams.filter((e) => e.id !== examId); }),
};

// ---------- Demo data (used only when the API is unreachable) ----------
const demo: { users: User[]; exams: Exam[] } = {
  users: [
    { id: 1, name: "Laura Mendes", idade: 34, sexo: "Feminino" },
    { id: 2, name: "Lucas Andrade", idade: 52, sexo: "Masculino" },
    { id: 3, name: "Larissa Costa", idade: 27, sexo: "Feminino" },
  ],
  exams: [1, 2, 3].flatMap((u) => [
    { id: u * 10 + 1, user_id: u, file_name: "hemograma_set2026.pdf", laboratory_name: "Lab Fleury", exam_date: "2026-09-30", status: "completed" as const, created_at: "2026-10-01T10:00:00" },
    { id: u * 10 + 2, user_id: u, file_name: "bioquimica_jul2026.pdf", laboratory_name: "Dasa", exam_date: "2026-07-22", status: "completed" as const, created_at: "2026-07-23T09:30:00" },
  ]),
};

export function mockDashboard(id: number): Dashboard {
  const u = demo.users.find((x) => x.id === id) ?? { id, name: "Usuário demo" };
  const dates = ["2025-10-12", "2026-01-18", "2026-04-09", "2026-07-22", "2026-09-30"];
  const series: Record<string, { cat: string; unit: string; min: number; max: number; v: number[] }> = {
    Glicemia: { cat: "Bioquímica", unit: "mg/dL", min: 70, max: 99, v: [92, 98, 104, 109, 101] },
    "Colesterol Total": { cat: "Lipidograma", unit: "mg/dL", min: 0, max: 190, v: [212, 205, 196, 184, 178] },
    HDL: { cat: "Lipidograma", unit: "mg/dL", min: 40, max: 90, v: [44, 46, 49, 52, 55] },
    "Hemoglobina Glicada": { cat: "Bioquímica", unit: "%", min: 4, max: 5.7, v: [5.4, 5.6, 5.8, 6.0, 5.8] },
  };
  const results: ExamResult[] = [];
  let rid = 1;
  for (const [name, s] of Object.entries(series))
    s.v.forEach((value, i) => results.push({
      id: rid++, category: s.cat, parameter_name: name, value, unit: s.unit,
      reference_range: `${s.min} - ${s.max}`, is_abnormal: value < s.min || value > s.max ? 1 : 0, measured_at: dates[i]!,
    }));
  return {
    user_id: u.id, user_name: u.name,
    summary: "- Glicemia de jejum em tendência de alta desde jan/2026, atingindo 109 mg/dL em jul/2026.\n- Hemoglobina glicada acima de 5,7% nos dois últimos exames — sugere acompanhamento metabólico.\n- Colesterol total em queda consistente, de volta à faixa desejável (178 mg/dL).\n- HDL em melhora progressiva (44 → 55 mg/dL).\n- Sugestão: repetir glicemia e HbA1c em 90 dias.",
    results_history: results,
  };
}

/** The API sends is_abnormal as 0/1. */
export function isAbnormal(r: ExamResult) { return Boolean(r.is_abnormal); }

/** Parses "70 - 99", "70–99", "< 190", "> 40" into numeric bounds for the chart band. */
export function parseRange(range?: string | null): { min: number | null; max: number | null } {
  if (!range) return { min: null, max: null };
  const s = range.replace(",", ".");
  const nums = s.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  if (/^\s*(<|até|ate)/i.test(s) && nums[0] != null) return { min: null, max: nums[0] };
  if (/^\s*>/.test(s) && nums[0] != null) return { min: nums[0], max: null };
  if (nums.length >= 2) return { min: nums[0]!, max: nums[1]! };
  return { min: null, max: null };
}
