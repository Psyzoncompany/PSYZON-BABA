"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useBaba } from "@/components/providers/baba-provider";
import { getTeamTheme } from "@/lib/domain/team-theme";

export function ManualSheetScreen() {
  const auth = useAuth(); const baba = useBaba(); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const playerById = new Map(baba.players.map((player) => [player.id, player]));
  const download = async () => {
    if (!baba.activeBaba || !auth.user) return; setBusy(true); setError("");
    try { const token = await auth.user.getIdToken(); const response = await fetch("/api/reports/manual-sheet", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ babaId: baba.activeBaba.id }) }); if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Não foi possível gerar a ficha."); const href = URL.createObjectURL(await response.blob()); const anchor = document.createElement("a"); anchor.href = href; anchor.download = `ficha-manual-${baba.activeBaba.dateKey}.pdf`; anchor.click(); URL.revokeObjectURL(href); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível gerar a ficha."); }
    finally { setBusy(false); }
  };
  return <main className="standalone-page manual-sheet-page"><header className="standalone-toolbar"><Link className="icon-button" href="/app/ao-vivo" aria-label="Voltar"><ArrowLeft /></Link><strong>Ficha manual</strong><div className="sheet-actions"><button className="button secondary" onClick={() => window.print()}><Printer /> Imprimir</button><button className="button primary" onClick={() => void download()} disabled={busy || !baba.activeBaba}><Download /> {busy ? "Gerando…" : "Baixar PDF"}</button></div></header><div className="manual-print-sheet"><header><p className="eyebrow">Baba Psyzon</p><h1>Ficha manual do baba</h1><p>{baba.activeBaba ? new Date(`${baba.activeBaba.dateKey}T12:00:00`).toLocaleDateString("pt-BR") : "Nenhum baba ativo"}</p></header>{baba.teams.map((team) => <section className="print-team" key={team.id} style={{ "--team": team.color } as React.CSSProperties}><div><h2>{team.name}</h2><span>{getTeamTheme(team.order).club}</span><strong>V ____ &nbsp; E ____ &nbsp; D ____ &nbsp; PTS ____</strong></div>{team.playerIds.map((id) => <p key={id}><span>{playerById.get(id)?.name || "Jogador"}</span><span>Gols ______</span></p>)}<footer>Observações: __________________________________________________________</footer></section>)}{error && <p className="message error" role="alert">{error}</p>}</div></main>;
}

