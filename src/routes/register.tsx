import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Stethoscope, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/AuthLayout";
import { api, OfflineError, type Role } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Criar conta — HistoriMED" },
      { name: "description", content: "Cadastre-se no HistoriMED como paciente ou médico." },
      { property: "og:title", content: "Criar conta — HistoriMED" },
      { property: "og:description", content: "Cadastre-se no HistoriMED como paciente ou médico." },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const nav = useNavigate();
  const [role, setRole] = useState<Role>("patient");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.register({ ...form, role });
      toast.success("Conta criada! Faça login para continuar.");
      nav({ to: "/login" });
    } catch (err) {
      toast.error(err instanceof OfflineError ? "API local não respondeu. Verifique se o backend está rodando." : (err as Error).message);
    } finally { setLoading(false); }
  };

  const roles = [
    { v: "patient" as Role, label: "Sou paciente", icon: User },
    { v: "doctor" as Role, label: "Sou médico(a)", icon: Stethoscope },
  ];

  return (
    <AuthLayout title="Criar conta" subtitle="Escolha seu perfil e preencha seus dados.">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {roles.map(({ v, label, icon: Icon }) => (
            <button type="button" key={v} onClick={() => setRole(v)}
              className={cn("flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-sm font-semibold transition",
                role === v ? "border-primary bg-primary-soft text-primary" : "border-border hover:border-primary/40")}>
              <Icon className="h-6 w-6" /> {label}
            </button>
          ))}
        </div>
        {(["name", "email", "password"] as const).map((k) => (
          <div key={k} className="space-y-2">
            <Label htmlFor={k}>{{ name: "Nome completo", email: "E-mail", password: "Senha" }[k]}</Label>
            <Input id={k} required type={k === "name" ? "text" : k} value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </div>
        ))}
        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />} Criar conta
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Já tem conta? <Link to="/login" className="font-semibold text-primary hover:underline">Entrar</Link>
      </p>
    </AuthLayout>
  );
}
