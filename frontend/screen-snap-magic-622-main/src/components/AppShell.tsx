import { Link } from "@tanstack/react-router";
import { Activity, WifiOff } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { isOffline, onOffline } from "@/lib/api";

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

export function AppShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const [offline, setOff] = useState(false);
  useEffect(() => { setOff(isOffline); return onOffline(setOff); }, []);
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur print:hidden">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Logo />
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      </header>
      {offline && (
        <div className="border-b border-warning/40 bg-warning/10 print:hidden">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-sm">
            <WifiOff className="h-4 w-4" /> API indisponível — exibindo dados de demonstração.
          </div>
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
