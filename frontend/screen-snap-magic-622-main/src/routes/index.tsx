import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronRight, Loader2, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type User } from "@/lib/api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HistoriMED — Usuários e histórico de exames" },
      { name: "description", content: "Escolha um usuário para ver a evolução dos exames, o resumo com IA e o relatório." },
      { property: "og:title", content: "HistoriMED — Usuários e histórico de exames" },
      { property: "og:description", content: "Escolha um usuário para ver a evolução dos exames, o resumo com IA e o relatório." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

const initials = (n: string) => n.split(" ").filter(Boolean).map((x) => x[0]).slice(0, 2).join("").toUpperCase();

function Home() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [q, setQ] = useState("");
  const load = () => api.listUsers().then(setUsers).catch((e) => { toast.error((e as Error).message); setUsers([]); });
  useEffect(() => { load(); }, []);
  const list = (users ?? []).filter((u) => u.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <AppShell actions={<NewUserDialog onCreated={load} />}>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Usuários cadastrados</h1>
          <p className="mt-1 text-muted-foreground">Escolha alguém para abrir o histórico clínico.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por nome..." className="pl-9" />
        </div>
      </div>
      {!users ? (
        <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-12 text-center">
          <Users className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-muted-foreground">{users.length ? "Nenhum usuário com esse nome." : "Nenhum usuário cadastrado ainda."}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((u) => (
            <Link key={u.id} to="/users/$userId" params={{ userId: String(u.id) }}
              className="group flex items-center gap-4 rounded-2xl border bg-card p-5 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary">{initials(u.name)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{u.name}</p>
                <p className="text-sm text-muted-foreground">
                  {[u.idade != null ? `${u.idade} anos` : null, u.sexo].filter(Boolean).join(" · ") || `#${u.id}`}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

function NewUserDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [idade, setIdade] = useState("");
  const [sexo, setSexo] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.register({ name: name.trim(), idade: idade ? Number(idade) : null, sexo: sexo || null });
      toast.success("Usuário cadastrado");
      setOpen(false); setName(""); setIdade(""); setSexo(""); onCreated();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4" /> Novo usuário</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Cadastrar usuário</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="n">Nome</Label><Input id="n" required value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label htmlFor="i">Idade</Label><Input id="i" type="number" min={0} max={130} value={idade} onChange={(e) => setIdade(e.target.value)} /></div>
            <div className="space-y-2"><Label>Sexo</Label>
              <Select value={sexo} onValueChange={setSexo}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{["Feminino", "Masculino", "Outro"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button type="submit" disabled={busy || !name.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Cadastrar</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
