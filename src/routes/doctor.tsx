import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Loader2, Search, Sparkles, LineChart as LineIcon, WifiOff } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api, isAbnormal, mockDashboard, mockPatients, OfflineError, refLabel, type Dashboard, type Patient } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/doctor")({
  head: () => ({
    meta: [
      { title: "Painel médico — HistoriMED" },
      { name: "description", content: "Pesquise pacientes e veja resumo clínico com IA e evolução dos exames." },
      { property: "og:title", content: "Painel médico — HistoriMED" },
      { property: "og:description", content: "Pesquise pacientes e veja resumo clínico com IA e evolução dos exames." },
    ],
  }),
  component: DoctorPage,
});

const fmtDate = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" });

function DoctorPage() {
  const [s, loaded] = useSession();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Patient[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [offline, setOffline] = useState(false);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [loadingDash, setLoadingDash] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { if (loaded && (!s || s.role !== "doctor")) nav({ to: "/login" }); }, [s, loaded, nav]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); return; }
    const t = setTimeout(async () => {
      setSearching(true); setErr("");
      try { setResults(await api.searchPatients(term)); setOffline(false); }
      catch (e) {
        if (e instanceof OfflineError) {
          setOffline(true);
          setResults(mockPatients.filter((p) => p.name.toLowerCase().includes(term.toLowerCase())));
        } else setErr((e as Error).message);
      } finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  const open = async (p: Patient) => {
    setLoadingDash(true);
    try { setDash(await api.dashboard(p.id)); }
    catch (e) {
      if (e instanceof OfflineError) { setOffline(true); setDash(mockDashboard(p.id)); }
      else setErr((e as Error).message);
    } finally { setLoadingDash(false); }
  };

  if (!s || s.role !== "doctor") return null;

  return (
    <AppShell session={s}>
      {offline && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm">
          <WifiOff className="h-4 w-4" /> API indisponível — exibindo dados de demonstração.
        </div>
      )}
      {dash ? (
        <PatientDashboard dash={dash} onBack={() => setDash(null)} />
      ) : (
        <div className="mx-auto max-w-2xl space-y-6 pt-6">
          <div className="text-center">
            <h1 className="font-display text-3xl font-semibold tracking-tight">Ficha clínica do paciente</h1>
            <p className="mt-2 text-muted-foreground">Busque pelo nome para ver o resumo e a evolução dos exames.</p>
          </div>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar paciente pelo nome..."
              className="h-14 rounded-2xl bg-card pl-12 text-base shadow-card" />
            {searching && <Loader2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-primary" />}
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          {q.trim().length > 0 && q.trim().length < 2 && <p className="text-sm text-muted-foreground">Digite pelo menos 2 caracteres.</p>}
          {offline && !results && <p className="text-center text-sm text-muted-foreground">Dica: experimente buscar "La".</p>}
          {results && (
            <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
              {results.length === 0 ? (
                <p className="p-6 text-center text-muted-foreground">Nenhum paciente encontrado.</p>
              ) : results.map((p) => (
                <button key={p.id} onClick={() => open(p)} disabled={loadingDash}
                  className="flex w-full items-center gap-4 border-b p-4 text-left transition last:border-0 hover:bg-muted/60">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-primary-soft font-semibold text-primary">
                    {p.name.split(" ").map((x) => x[0]).slice(0, 2).join("")}
                  </span>
                  <div className="flex-1">
                    <p className="font-semibold">{p.name}</p>
                    {p.email && <p className="text-sm text-muted-foreground">{p.email}</p>}
                  </div>
                  {loadingDash ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function PatientDashboard({ dash, onBack }: { dash: Dashboard; onBack: () => void }) {
  const params = useMemo(() => Array.from(new Set(dash.results_history.map((r) => r.parameter_name))), [dash]);
  const [param, setParam] = useState<string>(params[0] ?? "");
  const series = dash.results_history.filter((r) => r.parameter_name === param);
  const ref = series[0] as (typeof series)[number] | undefined;
  const latest = useMemo(() => {
    const m = new Map<string, (typeof dash.results_history)[number]>();
    for (const r of dash.results_history) m.set(r.parameter_name, r);
    return m;
  }, [dash]);
  const abnormalCount = [...latest.values()].filter(isAbnormal).length;
  const bullets = dash.summary.split(/\n+/).map((l) => l.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-3 mb-2"><ArrowLeft className="h-4 w-4" /> Nova busca</Button>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{dash.patient_name}</h1>
          <p className="text-muted-foreground">Paciente #{dash.patient_id} · {dash.results_history.length} medições registradas</p>
        </div>
        <div className={cn("flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold",
          abnormalCount ? "bg-destructive/10 text-destructive" : "bg-accent text-accent-foreground")}>
          {abnormalCount ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          {abnormalCount ? `${abnormalCount} indicador(es) fora da faixa` : "Todos na faixa de referência"}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="rounded-2xl border bg-card p-6 shadow-card lg:col-span-2">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-primary" /> Resumo do histórico clínico
          </h2>
          <ul className="space-y-3">
            {bullets.map((b, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-success" /> {b}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs text-muted-foreground">Gerado por IA — revise antes de decisões clínicas.</p>
        </section>

        <section className="rounded-2xl border bg-card p-6 shadow-card lg:col-span-3">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold">
            <LineIcon className="h-5 w-5 text-primary" /> Evolução temporal
          </h2>
          {params.length === 0 ? (
            <p className="py-16 text-center text-muted-foreground">Nenhum resultado processado ainda.</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                {params.map((p, i) => (
                  <button key={p} onClick={() => setParam(p)}
                    className={cn("rounded-full border px-3 py-1 text-xs font-semibold transition",
                      param === p ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                    {p}{latest.get(p) && isAbnormal(latest.get(p)!) && i >= 0 ? " •" : ""}
                  </button>
                ))}
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series.map((r) => ({ date: fmtDate(r.measured_at), value: r.value }))} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" fontSize={12} stroke="var(--muted-foreground)" />
                    <YAxis fontSize={12} stroke="var(--muted-foreground)" domain={["auto", "auto"]} />
                    {ref?.reference_min != null && ref?.reference_max != null && (
                      <ReferenceArea y1={ref.reference_min} y2={ref.reference_max} fill="var(--success)" fillOpacity={0.08} />
                    )}
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)" }}
                      formatter={(v: number) => [`${v} ${ref?.unit ?? ""}`, param]} />
                    <Line type="monotone" dataKey="value" stroke={CHART_COLORS[params.indexOf(param) % 5]} strokeWidth={3} dot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Faixa sombreada: referência ({ref ? refLabel(ref) : "—"} {ref?.unit})</p>
            </>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-card">
        <h2 className="border-b p-6 font-display text-lg font-semibold">Histórico de indicadores</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>{["Data", "Parâmetro", "Valor", "Unidade", "Referência", "Status"].map((h) => <th key={h} className="px-6 py-3 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {[...dash.results_history].reverse().map((r, i) => {
                const bad = isAbnormal(r);
                return (
                  <tr key={i} className={cn("border-t", bad && "bg-destructive/5")}>
                    <td className="px-6 py-3 text-muted-foreground">{fmtDate(r.measured_at)}</td>
                    <td className="px-6 py-3 font-medium">{r.parameter_name}</td>
                    <td className={cn("px-6 py-3 font-semibold", bad && "text-destructive")}>{r.value}</td>
                    <td className="px-6 py-3 text-muted-foreground">{r.unit ?? "—"}</td>
                    <td className="px-6 py-3 text-muted-foreground">{refLabel(r)}</td>
                    <td className="px-6 py-3">
                      {bad ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive">
                          <AlertTriangle className="h-3 w-3" /> Fora da faixa
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">
                          <CheckCircle2 className="h-3 w-3" /> Normal
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
