import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HistoriMED — Exames e evolução clínica com IA" },
      { name: "description", content: "Centralize exames laboratoriais e veja resumos com IA e gráficos de evolução." },
      { property: "og:title", content: "HistoriMED — Exames e evolução clínica com IA" },
      { property: "og:description", content: "Centralize exames laboratoriais e veja resumos com IA e gráficos de evolução." },
    ],
  }),
  component: Index,
});

function Index() {
  const [s, loaded] = useSession();
  const nav = useNavigate();
  useEffect(() => {
    if (!loaded) return;
    nav({ to: !s ? "/login" : s.role === "doctor" ? "/doctor" : "/patient", replace: true });
  }, [s, loaded, nav]);
  return <div className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
}
