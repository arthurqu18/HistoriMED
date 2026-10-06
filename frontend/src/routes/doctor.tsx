import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronRight, Loader2, Search, WifiOff } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ClinicalDashboard } from "@/components/ClinicalDashboard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api, mockDashboard, mockPatients, OfflineError, type Dashboard, type Patient } from "@/lib/api";
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
        <ClinicalDashboard dash={dash} onBack={() => setDash(null)} />
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
