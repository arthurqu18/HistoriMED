import type { ReactNode } from "react";
import { ShieldCheck, LineChart, Sparkles } from "lucide-react";
import { Logo } from "./AppShell";

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-hero p-12 text-primary-foreground lg:flex">
        <div className="font-display text-2xl font-semibold">HistoriMED</div>
        <div className="space-y-8">
          <h2 className="font-display text-4xl font-semibold leading-tight">
            Todo o histórico laboratorial do paciente, em um só lugar.
          </h2>
          <ul className="space-y-4 text-primary-foreground/90">
            <li className="flex gap-3"><Sparkles className="h-5 w-5 shrink-0" /> Resumos clínicos gerados por IA</li>
            <li className="flex gap-3"><LineChart className="h-5 w-5 shrink-0" /> Evolução de indicadores ao longo do tempo</li>
            <li className="flex gap-3"><ShieldCheck className="h-5 w-5 shrink-0" /> Alertas de valores fora da referência</li>
          </ul>
        </div>
        <p className="text-sm text-primary-foreground/70">MVP · uso demonstrativo</p>
      </aside>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-8">
          <div className="lg:hidden"><Logo /></div>
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-muted-foreground">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
