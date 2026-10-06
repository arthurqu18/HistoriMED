import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Sparkles, LineChart as LineIcon } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { isAbnormal, refLabel, type Dashboard } from "@/lib/api";
import { cn } from "@/lib/utils";

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const fmtDate = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" });

export function ClinicalDashboard({ dash, onBack }: { dash: Dashboard; onBack?: () => void }) {
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
  const bullets = (dash.summary ?? "").split(/\n+/).map((l) => l.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {onBack && <Button variant="ghost" size="sm" onClick={onBack} className="-ml-3 mb-2"><ArrowLeft className="h-4 w-4" /> Nova busca</Button>}
          <h1 className="font-display text-3xl font-semibold tracking-tight">{dash.patient_name}</h1>
          <p className="text-muted-foreground">{dash.results_history.length} medições registradas</p>
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
          {bullets.length ? (
            <ul className="space-y-3">
              {bullets.map((b, i) => <li key={i} className="flex gap-3 text-sm leading-relaxed"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-success" /> {b}</li>)}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Nenhum resumo clínico disponível ainda.</p>}
          <p className="mt-6 text-xs text-muted-foreground">Gerado por IA — revise com seu médico antes de tomar decisões sobre sua saúde.</p>
        </section>

        <section className="rounded-2xl border bg-card p-6 shadow-card lg:col-span-3">
          <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold">
            <LineIcon className="h-5 w-5 text-primary" /> Evolução temporal
          </h2>
          {params.length === 0 ? (
            <p className="py-16 text-center text-muted-foreground">Seus resultados aparecerão aqui após o processamento dos exames.</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                {params.map((p) => <button key={p} onClick={() => setParam(p)} className={cn("rounded-full border px-3 py-1 text-xs font-semibold transition", param === p ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                  {p}{latest.get(p) && isAbnormal(latest.get(p)!) ? " •" : ""}
                </button>)}
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series.map((r) => ({ date: fmtDate(r.measured_at), value: r.value }))} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" fontSize={12} stroke="var(--muted-foreground)" />
                    <YAxis fontSize={12} stroke="var(--muted-foreground)" domain={["auto", "auto"]} />
                    {ref?.reference_min != null && ref?.reference_max != null && <ReferenceArea y1={ref.reference_min} y2={ref.reference_max} fill="var(--success)" fillOpacity={0.08} />}
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)" }} formatter={(v: number) => [`${v} ${ref?.unit ?? ""}`, param]} />
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
        {dash.results_history.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Nenhum resultado de exame disponível ainda.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground"><tr>{["Data", "Parâmetro", "Valor", "Unidade", "Referência", "Status"].map((h) => <th key={h} className="px-6 py-3 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{[...dash.results_history].reverse().map((r, i) => {
                const bad = isAbnormal(r);
                return <tr key={r.id ?? `${r.parameter_name}-${r.measured_at}-${i}`} className={cn("border-t", bad && "bg-destructive/5")}>
                  <td className="px-6 py-3 text-muted-foreground">{fmtDate(r.measured_at)}</td>
                  <td className="px-6 py-3 font-medium">{r.parameter_name}</td>
                  <td className={cn("px-6 py-3 font-semibold", bad && "text-destructive")}>{r.value}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.unit ?? "—"}</td>
                  <td className="px-6 py-3 text-muted-foreground">{refLabel(r)}</td>
                  <td className="px-6 py-3">{bad ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive"><AlertTriangle className="h-3 w-3" /> Fora da faixa</span>
                  ) : <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground"><CheckCircle2 className="h-3 w-3" /> Normal</span>}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
