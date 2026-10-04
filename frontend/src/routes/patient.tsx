import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileText, Loader2, UploadCloud, X, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, OfflineError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/patient")({
  head: () => ({
    meta: [
      { title: "Meus exames — HistoriMED" },
      { name: "description", content: "Envie seus exames laboratoriais para análise com IA." },
      { property: "og:title", content: "Meus exames — HistoriMED" },
      { property: "og:description", content: "Envie seus exames laboratoriais para análise com IA." },
    ],
  }),
  component: PatientPage,
});

interface Upload { key: string; name: string; lab?: string; status: "processing" | "done" | "error"; demo?: boolean; }

function PatientPage() {
  const [s, loaded] = useSession();
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [lab, setLab] = useState("");
  const [drag, setDrag] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);

  useEffect(() => { if (loaded && (!s || s.role !== "patient")) nav({ to: "/login" }); }, [s, loaded, nav]);
  if (!s || s.role !== "patient") return null;

  const pick = (f?: File | null) => {
    if (!f) return;
    if (!/pdf|image/.test(f.type)) { toast.error("Envie um PDF ou imagem."); return; }
    setFile(f);
  };

  const send = async () => {
    if (!file) return;
    setSending(true);
    const key = crypto.randomUUID();
    const finish = (demo: boolean) => setTimeout(
      () => setUploads((u) => u.map((x) => (x.key === key ? { ...x, status: "done" } : x))), demo ? 4000 : 8000);
    try {
      await api.uploadExam(s.user_id, file, lab || undefined);
      setUploads((u) => [{ key, name: file.name, lab, status: "processing" }, ...u]);
      toast.success("Exame enviado! A IA está analisando.");
      finish(false);
    } catch (err) {
      if (err instanceof OfflineError) {
        setUploads((u) => [{ key, name: file.name, lab, status: "processing", demo: true }, ...u]);
        toast.info("API offline — simulando o processamento.");
        finish(true);
      } else toast.error((err as Error).message);
    } finally { setSending(false); setFile(null); setLab(""); }
  };

  return (
    <AppShell session={s}>
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Olá, {s.name.split(" ")[0]} 👋</h1>
          <p className="mt-2 text-muted-foreground">Envie seus exames e seu médico terá tudo organizado em um só lugar.</p>
        </div>

        <div className="space-y-5 rounded-2xl border bg-card p-6 shadow-card">
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
            className={cn("flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition",
              drag ? "border-primary bg-primary-soft" : "border-input hover:border-primary/50 hover:bg-muted/50")}
          >
            <span className="grid h-14 w-14 place-items-center rounded-full bg-primary-soft text-primary"><UploadCloud className="h-7 w-7" /></span>
            <div>
              <p className="font-semibold">Arraste o arquivo aqui ou clique para escolher</p>
              <p className="text-sm text-muted-foreground">PDF ou imagem (JPG, PNG)</p>
            </div>
            <input ref={inputRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </div>

          {file && (
            <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
              <FileText className="h-5 w-5 text-primary" />
              <span className="flex-1 truncate text-sm font-medium">{file.name}</span>
              <button onClick={() => setFile(null)} aria-label="Remover"><X className="h-4 w-4 text-muted-foreground" /></button>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="lab">Laboratório <span className="text-muted-foreground">(opcional)</span></Label>
            <Input id="lab" placeholder="Ex.: Fleury, Dasa, Hermes Pardini" value={lab} onChange={(e) => setLab(e.target.value)} />
          </div>
          <Button size="lg" className="w-full" disabled={!file || sending} onClick={send}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Enviar exame
          </Button>
        </div>

        {uploads.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-display text-lg font-semibold">Envios recentes</h2>
            {uploads.map((u) => (
              <div key={u.key} className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-card">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{u.name}</p>
                  <p className="text-xs text-muted-foreground">{u.lab || "Laboratório não informado"}{u.demo && " · demonstração"}</p>
                </div>
                {u.status === "processing" ? (
                  <span className="flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
                    <Sparkles className="h-3.5 w-3.5 animate-pulse" /> Processando via IA...
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Concluído
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
