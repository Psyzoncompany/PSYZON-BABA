"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, type DocumentData } from "firebase/firestore";
import { Download, Medal, Star } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useBaba } from "@/components/providers/baba-provider";
import { db } from "@/lib/firebase/client";
import { buildManualRanking, buildRanking, sortGoalkeepers, sortRanking, type RankingCriterion } from "@/lib/domain/competition";
import { calculateStars, sortBestRanking } from "@/lib/domain/stars";
import type { RankingRow } from "@/lib/domain/types";
import { EmptyState, ScreenHeading } from "@/components/ui/screen";

type Scope = "month" | "general" | "day" | "goalkeeper" | "history";
const scopeLabels: Record<Scope, string> = { month: "Do mês", general: "Geral", day: "Do dia", goalkeeper: "Goleiro", history: "Histórico" };
const criteria: { value: RankingCriterion; label: string }[] = [{ value: "best", label: "Melhores" }, { value: "goals", label: "Gols" }, { value: "wins", label: "Vitórias" }, { value: "losses", label: "Derrotas" }, { value: "worst", label: "Pior jogador" }, { value: "titles", label: "Títulos" }, { value: "efficiency", label: "Aproveitamento" }];

function fromStats(id: string, data: DocumentData): RankingRow {
  const games = Number(data.games || 0); const wins = Number(data.wins || 0); const draws = Number(data.draws || 0);
  return { playerId: id, name: String(data.name || "Jogador"), playerType: data.playerType === "goleiro" ? "goleiro" : "linha", games, wins, draws, losses: Number(data.losses || 0), goals: Number(data.goals || 0), points: wins * 3 + draws, efficiency: games ? Math.round((((wins * 3 + draws) / (games * 3)) * 100) * 10) / 10 : 0, babas: Number(data.babas || 0), titles: Number(data.titles || 0), mvps: Number(data.mvps || 0), yellowCards: Number(data.yellowCards || 0), redCards: Number(data.redCards || 0), goalsAgainst: Number(data.goalsAgainst || 0), cleanGames: Number(data.cleanGames || 0) };
}

function StarBar({ value }: { value: number }) {
  return <div className="stars" aria-label={`${value.toLocaleString("pt-BR")} estrelas`}>{Array.from({ length: 5 }, (_, index) => {
    const fill = Math.max(0, Math.min(1, value - index));
    return <span className={`star-shell ${fill >= 1 ? "full" : fill >= 0.5 ? "half" : ""}`} key={index}><Star /><Star className="star-fill" /></span>;
  })}</div>;
}

export function RankingScreen() {
  const auth = useAuth(); const baba = useBaba(); const [scope, setScope] = useState<Scope>("month"); const [criterion, setCriterion] = useState<RankingCriterion>("best"); const [historyMonth, setHistoryMonth] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bahia", year: "numeric", month: "2-digit" }).slice(0, 7)); const [historicalRows, setHistoricalRows] = useState<RankingRow[]>([]); const [exporting, setExporting] = useState(false); const [error, setError] = useState("");
  const completed = baba.babas.filter((item) => item.status === "finished" && !item.deletedAtMs).length;
  const names = useMemo(() => new Map(baba.players.map((player) => [player.id, player.name])), [baba.players]); const types = useMemo(() => new Map(baba.players.map((player) => [player.id, player.type])), [baba.players]);
  const generallyEligible = useMemo(() => new Set(baba.players.filter((player) => player.status !== "convidado" && player.status !== "desativado").map((player) => player.id)), [baba.players]);
  const dayRows = useMemo(() => baba.activeBaba?.matchMode === "manual" ? buildManualRanking(baba.manualResults, baba.teams, names, types) : buildRanking(baba.games, baba.teams, names, types), [baba.activeBaba?.matchMode, baba.manualResults, baba.teams, baba.games, names, types]);

  useEffect(() => {
    if (scope !== "history" || !auth.accountId) return;
    return onSnapshot(collection(db, "baba_accounts", auth.accountId, "months", historyMonth, "rankings"), (snapshot) => setHistoricalRows(snapshot.docs.map((item) => fromStats(item.id, item.data()))), () => setHistoricalRows([]));
  }, [scope, auth.accountId, historyMonth]);

  const unfilteredSource = scope === "day" ? dayRows : scope === "general" || scope === "goalkeeper" ? baba.generalRanking : scope === "history" ? historicalRows : baba.monthlyRanking;
  const source = scope === "day" ? unfilteredSource : unfilteredSource.filter((row) => generallyEligible.has(row.playerId));
  const rows = useMemo(() => {
    if (scope === "goalkeeper") return sortGoalkeepers(source);
    if (criterion === "best") return sortBestRanking(source, completed);
    return sortRanking(source, criterion);
  }, [source, scope, criterion, completed]);

  const exportRanking = async () => {
    setExporting(true); setError("");
    try {
      const token = auth.user ? await auth.user.getIdToken() : "";
      const response = await fetch("/api/reports/ranking", { method: "POST", headers: { "Content-Type": "application/json", Authorization: token ? `Bearer ${token}` : "" }, body: JSON.stringify({ scope, criterion, historyMonth }) });
      const data = await response.blob(); if (!response.ok) throw new Error("Não foi possível gerar o PDF.");
      const href = URL.createObjectURL(data); const anchor = document.createElement("a"); anchor.href = href; anchor.download = `ranking-${scope}-${historyMonth}.pdf`; anchor.click(); URL.revokeObjectURL(href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível exportar."); }
    finally { setExporting(false); }
  };

  return <>
    <ScreenHeading eyebrow="Desempenho" title="Ranking dos jogadores" description="Um painel por vez, com o mesmo motor de estrelas usado no histórico e no PDF." action={<button className="button secondary" disabled={!rows.length || exporting} onClick={() => void exportRanking()}><Download /> {exporting ? "Gerando…" : "Exportar este ranking"}</button>} />
    <section className="card ranking-controls"><div><strong>Selecionar ranking</strong><small>Um painel por vez</small></div><div className="segmented ranking-scopes" role="tablist">{(Object.keys(scopeLabels) as Scope[]).map((value) => <button role="tab" aria-selected={scope === value} className={scope === value ? "active" : ""} key={value} onClick={() => setScope(value)}>{scopeLabels[value]}</button>)}</div>{scope === "history" && <label>Mês do histórico<input type="month" value={historyMonth} onChange={(event) => setHistoryMonth(event.target.value)} /></label>}<label>Ordenar ranking<select value={criterion} onChange={(event) => setCriterion(event.target.value as RankingCriterion)}>{criteria.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></label></section>
    <div className="ranking-period"><div><p className="eyebrow">Ranking {scopeLabels[scope].toLocaleLowerCase("pt-BR")}</p><h2>{scope === "day" ? baba.activeBaba ? new Date(`${baba.activeBaba.dateKey}T12:00:00`).toLocaleDateString("pt-BR") : "Baba atual" : scope === "general" || scope === "goalkeeper" ? "Todos os babas salvos" : new Date(`${scope === "history" ? historyMonth : new Date().toISOString().slice(0, 7)}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</h2></div><span>{rows.length} jogadores</span></div>
    {!rows.length ? <EmptyState icon={<Medal />} title="Ainda sem dados neste ranking" text={scope === "day" ? "Finalize uma partida ou salve os totais manuais." : "Somente babas finalizados entram neste período."} /> : <div className="ranking-list">{rows.map((row, index) => { const rating = calculateStars(row, rows, completed); return <article key={row.playerId} className={index < 3 ? `rank-card podium rank-${index + 1}` : "rank-card"}><span className="rank-position">{index + 1}</span><span className="avatar">{row.name.slice(0, 2).toUpperCase()}</span><div className="rank-identity"><strong>{row.name}</strong><StarBar value={rating.displayStars} /><small>{rating.eligible ? `${rating.level.title} · score ${rating.score}` : `Faltam ${rating.missingGames} jogos para receber estrelas`}</small></div><div className="rank-metrics"><span><strong>{row.goals}</strong> gols</span><span><strong>{row.wins}</strong> vitórias</span><span><strong>{row.losses}</strong> derrotas</span><span><strong>{row.titles || 0}</strong> títulos</span><span><strong>{row.efficiency}%</strong> aprov.</span></div></article>; })}</div>}
    {error && <p className="message error" role="alert">{error}</p>}
  </>;
}
