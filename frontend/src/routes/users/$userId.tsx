import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, FileText, FileUp, LineChart as LineIcon, Loader2, Printer,
  RefreshCw, Sparkles, Trash2, TrendingDown, TrendingUp, UserX,
} from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { api, isAbnormal, isOffline, parseRange, reportUrl, type Dashboard, type Exam, type ExamResult } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/users/$userId")({
  head: () => ({
    meta: [
      { title: "Perfil clínico — HistoriMED" },
      { name: "description", content: "Evolução dos exames, resumo com IA, exames enviados e relatório para impressão." },
      { property: "og:title", content: "Perfil clínico — HistoriMED" },
      { property: "og:description", content: "Evolução dos exames, resumo com IA, exames enviados e relatório para impressão." },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Profile,
});

const fmtDate = (d: string) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" });
const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const byDate = (a: ExamResult, b: ExamResult) => +new Date(a.measured_at) - +new Date(b.measured_at);

function Profile() {
  const { userId } = Route.useParams();
  const id = Number(userId);
  const nav = useNavigate();
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [d, e] = await Promise.all([api.dashboard(id), api.exams(id)]);
      setDash(d); setExams(e); setErr("");
    } catch (e) { setErr((e as Error).message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // Poll while any exam is still being processed.
  useEffect(() => {
    if (!exams.some((e) => e.status === "pending" || e.status === "processing") || isOffline) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [exams, load]);

  const openReport = () => {
    if (isOffline) { window.print(); return; }
    window.open(reportUrl(id), "_blank", "noopener");
  };

  const deleteAccount = async () => {
    try { await api.deleteAccount(id); toast.success("Conta removida"); nav({ to: "/" }); }
    catch (e) { toast.error((e as Error).message); }
  };

  if (err) return <AppShell><div className="py-20 text-center"><p className="text-destructive">{err}</p><Link to="/" className="mt-4 inline-block text-primary underline">Voltar</Link></div></AppShell>;
  if (!dash) return <AppShell><div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div></AppShell>;

  const history = [...dash.results_history].sort(byDate);

  return (
    <AppShell actions={<Button size="sm" variant="outline" onClick={openReport}><Printer className="h-4 w-4" /> Relatório</Button>}>
      <div className="space-y-6">
        <Header dash={dash} history={history} />
        <div className="grid gap-6 lg:grid-cols-5">
          <Summary text={dash.summary ?? null} />
          <Evolution history={history} />
        </div>
        <Trends history={history} />
        <ResultsTable userId={id} history={history} />
        <div className="grid gap-6 lg:grid-cols-5 print:hidden">
          <Upload userId={id} onDone={load} />
          <ExamList userId={id} exams={exams} onChange={load} />
        </div>
        <section className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold">Zona de perigo</h2>
              <p className="text-sm text-muted-foreground">Remove a conta, os exames, resultados, resumos e arquivos deste usuário.</p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="destructive"><UserX className="h-4 w-4" /> Excluir conta</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir a conta de {dash.user_name}?</AlertDialogTitle>
                  <AlertDialogDescription>Todos os exames e resultados serão apagados. Isso não pode ser desfeito.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={deleteAccount} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function latestByParam(history: ExamResult[]) {
  const m = new Map<string, ExamResult>();
  for (const r of history) m.set(r.parameter_name, r);
  return m;
}

function Header({ dash, history }: { dash: Dashboard; history: ExamResult[] }) {
  const latest = latestByParam(history);
  const bad = [...latest.values()].filter(isAbnormal).length;
  const last = history.at(-1);
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2 print:hidden"><Link to="/"><ArrowLeft className="h-4 w-4" /> Usuários</Link></Button>
        <h1 className="font-display text-3xl font-semibold tracking-tight">{dash.user_name}</h1>
        <p className="text-muted-foreground">
          #{dash.user_id} · {latest.size} parâmetros · {history.length} medições{last ? ` · último exame em ${fmtDate(last.measured_at)}` : ""}
        </p>
      </div>
      {history.length > 0 && (
        <div className={cn("flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold",
          bad ? "bg-destructive/10 text-destructive" : "bg-accent text-accent-foreground")}>
          {bad ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          {bad ? `${bad} indicador(es) fora da faixa` : "Todos na faixa de referência"}
        </div>
      )}
    </div>
  );
}

function Summary({ text }: { text?: string | null }) {
  const bullets = (text ?? "").split(/\n+/).map((l) => l.replace(/^\s*[-*•]\s*/, "").trim()).filter(Boolean);
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-card lg:col-span-2">
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold"><Sparkles className="h-5 w-5 text-primary" /> Resumo do histórico clínico</h2>
      {bullets.length === 0 ? (
        <p className="text-sm text-muted-foreground">O resumo aparece depois que o primeiro exame for processado.</p>
      ) : (
        <ul className="space-y-3">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-success" /> <SummaryLine text={b} /></li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-xs text-muted-foreground">Gerado por IA — revise antes de decisões clínicas.</p>
    </section>
  );
}

function SummaryLine({ text }: { text: string }) {
  const parts = text.replace(/&#x20;/gi, " ").split(/(\\?\*{1,2}.+?\\?\*{1,2})/g);
  return <span>{parts.map((part, i) => {
    const match = part.match(/^\\?\*{1,2}(.+?)\\?\*{1,2}$/);
    return match ? <strong key={i}>{match[1]}</strong> : part.replace(/\\\*/g, "*");
  })}</span>;
}

function Evolution({ history }: { history: ExamResult[] }) {
  const params = useMemo(() => Array.from(new Set(history.map((r) => r.parameter_name))), [history]);
  const [param, setParam] = useState("");
  useEffect(() => { if (!params.includes(param)) setParam(params[0] ?? ""); }, [params, param]);
  const latest = latestByParam(history);
  const series = history.filter((r) => r.parameter_name === param);
  const ref = series.at(-1);
  const range = parseRange(ref?.reference_range);
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-card lg:col-span-3">
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold"><LineIcon className="h-5 w-5 text-primary" /> Evolução temporal</h2>
      {params.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">Nenhum resultado processado ainda. Envie um exame abaixo.</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {params.map((p) => (
              <button key={p} onClick={() => setParam(p)}
                className={cn("rounded-full border px-3 py-1 text-xs font-semibold transition",
                  param === p ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                {p}{latest.get(p) && isAbnormal(latest.get(p)!) ? " •" : ""}
              </button>
            ))}
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series.map((r) => ({ date: fmtDate(r.measured_at), value: r.value }))} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" fontSize={12} stroke="var(--muted-foreground)" />
                <YAxis fontSize={12} stroke="var(--muted-foreground)" domain={["auto", "auto"]} />
                {(range.min != null || range.max != null) && (
                  <ReferenceArea {...(range.min != null ? { y1: range.min } : {})} {...(range.max != null ? { y2: range.max } : {})} fill="var(--success)" fillOpacity={0.08} />
                )}
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--card)" }}
                  formatter={(v: number) => [`${v} ${ref?.unit ?? ""}`, param]} />
                <Line type="monotone" dataKey="value" stroke={CHART_COLORS[params.indexOf(param) % 5]} strokeWidth={3} dot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Faixa sombreada: referência ({ref?.reference_range ?? "—"} {ref?.unit ?? ""})</p>
        </>
      )}
    </section>
  );
}

/** Small cards with latest value and change vs. previous measurement. */
function Trends({ history }: { history: ExamResult[] }) {
  const groups = new Map<string, ExamResult[]>();
  for (const r of history) groups.set(r.parameter_name, [...(groups.get(r.parameter_name) ?? []), r]);
  if (!groups.size) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[...groups.entries()].map(([name, rs]) => {
        const last = rs.at(-1)!; const prev = rs.at(-2);
        const diff = prev ? last.value - prev.value : 0;
        const pct = prev && prev.value ? (diff / prev.value) * 100 : 0;
        const bad = isAbnormal(last);
        return (
          <div key={name} className={cn("rounded-2xl border bg-card p-4 shadow-card", bad && "border-destructive/40")}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{last.category ?? "Exame"}</p>
            <p className="mt-1 truncate font-semibold">{name}</p>
            <div className="mt-2 flex items-end justify-between">
              <p className={cn("font-display text-2xl font-semibold", bad && "text-destructive")}>{last.value}<span className="ml-1 text-sm font-normal text-muted-foreground">{last.unit}</span></p>
              {prev && diff !== 0 && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {diff > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}{pct > 0 ? "+" : ""}{pct.toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResultsTable({ userId, history }: { userId: number; history: ExamResult[] }) {
  const [onlyBad, setOnlyBad] = useState(false);
  const [abnormal, setAbnormal] = useState<ExamResult[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!onlyBad) return;
    api.abnormal(userId).then((r) => setAbnormal([...r].sort(byDate))).catch((e) => toast.error((e as Error).message));
  }, [onlyBad, userId, history]);
  const rows = (onlyBad ? abnormal ?? [] : history)
    .filter((r) => r.parameter_name.toLowerCase().includes(q.toLowerCase()))
    .slice().reverse();
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b p-6">
        <h2 className="font-display text-lg font-semibold">Detalhes dos indicadores</h2>
        <div className="flex flex-wrap items-center gap-4 print:hidden">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar parâmetro..." className="h-9 w-48" />
          <div className="flex items-center gap-2">
            <Switch id="bad" checked={onlyBad} onCheckedChange={setOnlyBad} />
            <Label htmlFor="bad" className="cursor-pointer">Só fora da faixa</Label>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>{["Data", "Categoria", "Parâmetro", "Valor", "Unidade", "Referência", "Status"].map((h) => <th key={h} className="px-6 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-6 py-10 text-center text-muted-foreground">{onlyBad && !abnormal ? "Carregando..." : "Nenhum resultado."}</td></tr>
            )}
            {rows.map((r, i) => {
              const bad = isAbnormal(r);
              return (
                <tr key={r.id ?? i} className={cn("border-t", bad && "bg-destructive/5")}>
                  <td className="px-6 py-3 text-muted-foreground">{fmtDate(r.measured_at)}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.category ?? "—"}</td>
                  <td className="px-6 py-3 font-medium">{r.parameter_name}</td>
                  <td className={cn("px-6 py-3 font-semibold", bad && "text-destructive")}>{r.value}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.unit ?? "—"}</td>
                  <td className="px-6 py-3 text-muted-foreground">{r.reference_range ?? "—"}</td>
                  <td className="px-6 py-3">
                    {bad ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold text-destructive"><AlertTriangle className="h-3 w-3" /> Fora da faixa</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground"><CheckCircle2 className="h-3 w-3" /> Normal</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Upload({ userId, onDone }: { userId: number; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [lab, setLab] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const send = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await api.uploadExam(userId, file, lab.trim() || undefined);
      toast.success("Exame enviado! Os resultados aparecem quando o processamento terminar.");
      setFile(null); setLab(""); if (input.current) input.current.value = ""; onDone();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-card lg:col-span-2">
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold"><FileUp className="h-5 w-5 text-primary" /> Enviar exame</h2>
      <button type="button" onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
        className={cn("flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition",
          drag ? "border-primary bg-primary-soft" : "hover:border-primary/50 hover:bg-muted/50")}>
        <FileText className="h-8 w-8 text-muted-foreground" />
        <span className="text-sm font-medium">{file ? file.name : "Arraste o PDF ou imagem aqui, ou clique"}</span>
        {file && <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>}
      </button>
      <input ref={input} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <Input value={lab} onChange={(e) => setLab(e.target.value)} placeholder="Laboratório (opcional)" className="mt-4" />
      <Button className="mt-4 w-full" disabled={!file || busy} onClick={send}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />} Enviar
      </Button>
    </section>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Na fila", cls: "bg-muted text-muted-foreground" },
  processing: { label: "Processando", cls: "bg-warning/15 text-foreground" },
  completed: { label: "Concluído", cls: "bg-accent text-accent-foreground" },
  failed: { label: "Falhou", cls: "bg-destructive/10 text-destructive" },
};

function ExamList({ userId, exams, onChange }: { userId: number; exams: Exam[]; onChange: () => void }) {
  const del = async (e: Exam) => {
    try { await api.deleteExam(userId, e.id); toast.success("Exame excluído"); onChange(); }
    catch (err) { toast.error((err as Error).message); }
  };
  const sorted = [...exams].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  return (
    <section className="rounded-2xl border bg-card shadow-card lg:col-span-3">
      <div className="flex items-center justify-between border-b p-6">
        <h2 className="font-display text-lg font-semibold">Exames carregados <span className="text-muted-foreground">({exams.length})</span></h2>
        <Button variant="ghost" size="sm" onClick={onChange}><RefreshCw className="h-4 w-4" /> Atualizar</Button>
      </div>
      {sorted.length === 0 ? (
        <p className="p-10 text-center text-muted-foreground">Nenhum exame enviado ainda.</p>
      ) : (
        <ul>
          {sorted.map((e) => {
            const st = STATUS[e.status] ?? { label: e.status, cls: "bg-muted" };
            return (
              <li key={e.id} className="flex items-center gap-4 border-b p-4 last:border-0">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary"><FileText className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{e.file_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[e.laboratory_name, e.exam_date ? `exame de ${fmtDate(e.exam_date)}` : null, `enviado ${fmtDate(e.created_at)}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", st.cls)}>
                  {e.status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}{st.label}
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button variant="ghost" size="icon" aria-label={`Excluir ${e.file_name}`}><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Excluir este exame?</AlertDialogTitle>
                      <AlertDialogDescription>"{e.file_name}" e seus resultados serão removidos do histórico.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => del(e)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
