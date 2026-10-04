import { Link, useNavigate } from "@tanstack/react-router";
import { Activity, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { saveSession } from "@/lib/session";
import type { Session } from "@/lib/api";

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-hero text-primary-foreground">
        <Activity className="h-5 w-5" />
      </span>
      <span className="font-display text-lg font-semibold tracking-tight">
        Histori<span className="text-primary">MED</span>
      </span>
    </Link>
  );
}

export function AppShell({ session, children }: { session: Session; children: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Logo />
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold">{session.name}</p>
              <p className="text-xs text-muted-foreground">
                {session.role === "doctor" ? "Médico(a)" : "Paciente"}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { saveSession(null); nav({ to: "/login" }); }}>
              <LogOut className="h-4 w-4" /> Sair
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
