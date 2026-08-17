"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarDays, CircleDollarSign, DatabaseZap, Download, LoaderCircle, LogOut, Palette, Printer } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useBaba } from "@/components/providers/baba-provider";
import { importLegacyHistory } from "@/lib/firebase/import-legacy-history";
import { ScreenHeading } from "@/components/ui/screen";

export function MoreScreen() {
  const auth = useAuth();
  const baba = useBaba();
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const backup = () => {
    const payload = JSON.stringify({ schemaVersion: 3, exportedAt: new Date().toISOString(), players: baba.players, babas: baba.babas, teams: baba.teams, games: baba.games }, null, 2);
    const href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `baba-psyzon-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const importHistory = async () => {
    if (!auth.accountId || auth.role !== "organizer") return;
    if (!window.confirm("Importar os jogadores e babas finalizados do site antigo? A importação pode ser repetida sem duplicar os registros.")) return;
    setError("");
    setMessage("");
    setImporting(true);
    try {
      const result = await importLegacyHistory(auth.accountId);
      setMessage(`${result.babas} babas, ${result.games} jogos e ${result.players} jogadores encontrados no site antigo.`);
    } catch (cause) {
      console.error("[importação] Falha ao importar histórico legado", cause);
      setError(cause instanceof Error ? cause.message : "Não foi possível importar o histórico antigo.");
    } finally {
      setImporting(false);
    }
  };

  return <>
    <ScreenHeading eyebrow="Mais opções" title="Tudo do seu baba" description="Histórico, pagamentos, aparência, arquivos e acesso." />
    <div className="menu-grid">
      <Link href="/app/historico"><span><CalendarDays /></span><div><strong>Histórico</strong><small>Veja os babas finalizados</small></div></Link>
      <Link href="/app/pagamentos"><span><CircleDollarSign /></span><div><strong>Pagamentos</strong><small>Organize pagos e pendentes</small></div></Link>
      <Link href="/aparencia"><span><Palette /></span><div><strong>Aparência</strong><small>Tema, densidade e animações</small></div></Link>
      <button onClick={() => window.print()}><span><Printer /></span><div><strong>Imprimir / PDF</strong><small>Salve a tela atual em PDF</small></div></button>
      {auth.role === "organizer" && <button onClick={importHistory} disabled={importing}><span>{importing ? <LoaderCircle className="spin" /> : <DatabaseZap />}</span><div><strong>{importing ? "Importando…" : "Importar site antigo"}</strong><small>Trazer jogadores e histórico sem duplicar</small></div></button>}
      {auth.role === "organizer" && <button onClick={backup}><span><Download /></span><div><strong>Exportar backup</strong><small>Baixar dados atuais em JSON</small></div></button>}
      <button className="logout-item" onClick={async () => { await auth.logout(); router.replace("/"); }}><span><LogOut /></span><div><strong>Sair / trocar acesso</strong><small>Voltar para a tela inicial</small></div></button>
    </div>
    {(message || error) && <p className={`message ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{error || message}</p>}
  </>;
}
