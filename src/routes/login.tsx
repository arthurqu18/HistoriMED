import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/AuthLayout";
import { api, OfflineError, type Session } from "@/lib/api";
import { saveSession } from "@/lib/session";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar — HistoriMED" },
      { name: "description", content: "Acesse o HistoriMED como paciente ou médico." },
      { property: "og:title", content: "Entrar — HistoriMED" },
      { property: "og:description", content: "Acesse o HistoriMED como paciente ou médico." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const enter = (s: Session) => {
    saveSession(s);
    nav({ to: s.role === "doctor" ? "/doctor" : "/patient" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      enter(await api.login(email, password));
    } catch (err) {
      if (err instanceof OfflineError) toast.error("API local não respondeu. Use um dos acessos de demonstração abaixo.");
      else toast.error((err as Error).message);
    } finally { setLoading(false); }
  };

  return (
    <AuthLayout title="Bem-vindo de volta" subtitle="Entre com seu e-mail e senha.">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pw">Senha</Label>
          <Input id="pw" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />} Entrar
        </Button>
      </form>
      <div className="rounded-xl border border-dashed bg-muted/50 p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Modo demonstração</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => enter({ user_id: 1, name: "Laura Mendes", email: "laura@exemplo.com", role: "patient" })}>
            Paciente (Laura)
          </Button>
          <Button variant="outline" onClick={() => enter({ user_id: 99, name: "Dr. Roberto Lima", email: "roberto@exemplo.com", role: "doctor" })}>
            Médico (Roberto)
          </Button>
        </div>
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Não tem conta? <Link to="/register" className="font-semibold text-primary hover:underline">Cadastre-se</Link>
      </p>
    </AuthLayout>
  );
}
