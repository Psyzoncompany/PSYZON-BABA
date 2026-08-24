"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CalendarDays, CircleDollarSign, Download, FileUp, Goal, LoaderCircle, LogOut, Palette, Printer } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { ScreenHeading } from "@/components/ui/screen";

export function MoreScreen() {
  const auth = useAuth();
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const backup = async () => {
    setError(""); setMessage(""); setExporting(true);
    try {
      const token = await auth.organizerToken();
      const response = await fetch("/api/backup", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || "Não foi possível exportar o backup.");
      const href = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = href; anchor.download = `baba-psyzon-backup-${new Date().toISOString().slice(0, 10)}.json`; anchor.click();
      URL.revokeObjectURL(href); setMessage("Backup completo exportado com segurança.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível exportar o backup.");
    } finally { setExporting(false); }
  };

  const importBackup = async (file: File) => {
    if (auth.role !== "organizer") return;
    if (file.size > 25 * 1024 * 1024) { setError("O arquivo excede o limite de 25 MB."); return; }
    setError("");
    setMessage("");
    setImporting(true);
    try {
      const backupFile = JSON.parse(await file.text()) as unknown;
      const token = await auth.organizerToken();
      const previewResponse = await fetch("/api/backup", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ mode: "preview", backup: backupFile }) });
      const preview = await previewResponse.json() as { error?: string; documents?: number; collections?: string[]; exportedAt?: string };
      if (!previewResponse.ok) throw new Error(preview.error || "Backup inválido.");
      const approved = window.confirm(`Backup válido com ${preview.documents} documentos em ${preview.collections?.length || 0} coleções. Importar e mesclar com esta conta?`);
      if (!approved) { setMessage("Importação cancelada. Nenhum dado foi alterado."); return; }
      const response = await fetch("/api/backup", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ mode: "apply", confirmation: "IMPORTAR", backup: backupFile }) });
      const result = await response.json() as { error?: string; documents?: number };
      if (!response.ok) throw new Error(result.error || "Não foi possível importar o backup.");
      setMessage(`${result.documents} documentos importados. Os dados foram mesclados sem apagar os atuais.`);
    } catch (cause) {
      console.error("[backup] Falha ao importar", cause);
      setError(cause instanceof Error ? cause.message : "Não foi possível importar o backup.");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return <>
    <ScreenHeading eyebrow="Mais opções" title="Tudo do seu baba" description="Histórico, pagamentos, aparência, arquivos e acesso." />
    <div className="menu-grid">
      <Link href="/app/historico"><span><CalendarDays /></span><div><strong>Histórico</strong><small>Veja os babas finalizados</small></div></Link>
      {auth.role === "organizer" && <Link href="/app/pagamentos"><span><CircleDollarSign /></span><div><strong>Pagamentos</strong><small>Organize pagos e pendentes</small></div></Link>}
      <Link href="/mesa-tatica"><span><Goal /></span><div><strong>Mesa Tática</strong><small>Crie, anime e exporte jogadas</small></div></Link>
      <Link href="/aparencia"><span><Palette /></span><div><strong>Aparência</strong><small>Tema, densidade e animações</small></div></Link>
      <button onClick={() => window.print()}><span><Printer /></span><div><strong>Imprimir / PDF</strong><small>Salve a tela atual em PDF</small></div></button>
      {auth.role === "organizer" && <button onClick={() => fileInput.current?.click()} disabled={importing}><span>{importing ? <LoaderCircle className="spin" /> : <FileUp />}</span><div><strong>{importing ? "Importando…" : "Importar backup"}</strong><small>Validar, revisar e mesclar um JSON</small></div></button>}
      {auth.role === "organizer" && <button onClick={backup} disabled={exporting}><span>{exporting ? <LoaderCircle className="spin" /> : <Download />}</span><div><strong>{exporting ? "Exportando…" : "Exportar backup"}</strong><small>Baixar todos os dados, sem segredos</small></div></button>}
      <button className="logout-item" onClick={async () => { await auth.logout(); router.replace("/"); }}><span><LogOut /></span><div><strong>Sair / trocar acesso</strong><small>Voltar para a tela inicial</small></div></button>
    </div>
    <input ref={fileInput} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); }} />
    {(message || error) && <p className={`message ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{error || message}</p>}
  </>;
}
