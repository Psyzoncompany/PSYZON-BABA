"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, LoaderCircle, Medal, Star } from "lucide-react";
import { PlayerCardDialog } from "@/components/player-card-dialog";
import { useAuth } from "@/components/providers/auth-provider";
import { useBaba } from "@/components/providers/baba-provider";
import { EmptyState, ScreenHeading } from "@/components/ui/screen";
import { buildManualRanking, buildRanking, sortGoalkeepers, sortRanking, type RankingCriterion } from "@/lib/domain/competition";
import { monthKey } from "@/lib/domain/payments";
import { calculateStars, sortBestRanking } from "@/lib/domain/stars";
import type { RankingRow } from "@/lib/domain/types";

type Scope = "month" | "general" | "day" | "goalkeeper" | "history";

interface RankingResponse {
  rows: RankingRow[];
  completedBabas: number;
  selectedBabas: number;
  error?: string;
}

const scopeLabels: Record<Scope, string> = {
  month: "Do mês",
  general: "Geral",
  day: "Do dia",
  goalkeeper: "Goleiro",
  history: "Histórico",
};

const criteria: { value: RankingCriterion; label: string }[] = [
  { value: "best", label: "Melhores" },
  { value: "goals", label: "Gols" },
  { value: "wins", label: "Vitórias" },
  { value: "losses", label: "Derrotas" },
  { value: "worst", label: "Pior jogador" },
  { value: "titles", label: "Títulos" },
  { value: "efficiency", label: "Aproveitamento" },
];

function StarBar({ value }: { value: number }) {
  return <div className="stars" aria-label={`${value.toLocaleString("pt-BR")} estrelas`}>
    {Array.from({ length: 5 }, (_, index) => {
      const fill = Math.max(0, Math.min(1, value - index));
      return <span className={`star-shell ${fill >= 1 ? "full" : fill >= 0.5 ? "half" : ""}`} key={index}>
        <Star />
        <Star className="star-fill" />
      </span>;
    })}
  </div>;
}

function periodTitle(scope: Scope, historyMonth: string, currentMonth: string, activeDate?: string) {
  if (scope === "day") return activeDate
    ? new Date(`${activeDate}T12:00:00`).toLocaleDateString("pt-BR")
    : "Baba atual";
  if (scope === "general" || scope === "goalkeeper") return "Todos os babas salvos";
  const period = scope === "history" ? historyMonth : currentMonth;
  return new Date(`${period}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export function RankingScreen() {
  const auth = useAuth();
  const baba = useBaba();
  const currentMonth = monthKey();
  const [scope, setScope] = useState<Scope>("month");
  const [criterion, setCriterion] = useState<RankingCriterion>("best");
  const [historyMonth, setHistoryMonth] = useState(currentMonth);
  const [generalRows, setGeneralRows] = useState<RankingRow[]>([]);
  const [periodRows, setPeriodRows] = useState<RankingRow[]>([]);
  const [historicalCompleted, setHistoricalCompleted] = useState<number | null>(null);
  const [selectedBabas, setSelectedBabas] = useState(0);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const historyRevision = useMemo(() => baba.babas
    .filter((item) => item.status === "finished")
    .map((item) => `${item.id}:${item.updatedAtMs}:${item.deletedAtMs || 0}`)
    .sort()
    .join("|"), [baba.babas]);
  const localCompleted = baba.babas.filter((item) => item.status === "finished" && !item.deletedAtMs).length;
  const completed = historicalCompleted ?? localCompleted;
  const names = useMemo(() => new Map(baba.players.map((player) => [player.id, player.name])), [baba.players]);
  const types = useMemo(() => new Map(baba.players.map((player) => [player.id, player.type])), [baba.players]);
  const dayRows = useMemo(() => baba.activeBaba?.matchMode === "manual"
    ? buildManualRanking(baba.manualResults, baba.teams, names, types)
    : buildRanking(baba.games, baba.teams, names, types),
  [baba.activeBaba?.matchMode, baba.manualResults, baba.teams, baba.games, names, types]);

  useEffect(() => {
    if (!auth.user) return;

    const controller = new AbortController();
    const load = async (targetScope: "general" | "month" | "history", month?: string) => {
      const token = await auth.user!.getIdToken();
      const search = new URLSearchParams({ scope: targetScope });
      if (month) search.set("month", month);
      const response = await fetch(`/api/rankings?${search}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await response.json() as RankingResponse;
      if (!response.ok) throw new Error(result.error || "Não foi possível carregar o ranking.");
      return result;
    };

    const loadRankings = async () => {
      setLoading(true);
      setError("");
      try {
        const period = scope === "month"
          ? load("month", currentMonth)
          : scope === "history"
            ? load("history", historyMonth)
            : null;
        const [general, selected] = await Promise.all([load("general"), period]);
        if (controller.signal.aborted) return;
        setGeneralRows(general.rows);
        setHistoricalCompleted(general.completedBabas);
        if (selected) {
          setPeriodRows(selected.rows);
          setSelectedBabas(selected.selectedBabas);
        } else {
          setPeriodRows([]);
          setSelectedBabas(general.selectedBabas);
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar o ranking.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    void loadRankings();
    return () => controller.abort();
  }, [auth.user, currentMonth, historyMonth, historyRevision, scope]);

  const source = scope === "day"
    ? dayRows
    : scope === "month" || scope === "history"
      ? periodRows
      : generalRows;
  const rows = useMemo(() => {
    if (scope === "goalkeeper") return sortGoalkeepers(source);
    if (criterion === "best") return sortBestRanking(source, completed);
    return sortRanking(source, criterion);
  }, [source, scope, criterion, completed]);

  const selectedRow = rows.find((row) => row.playerId === selectedPlayerId)
    || generalRows.find((row) => row.playerId === selectedPlayerId)
    || dayRows.find((row) => row.playerId === selectedPlayerId);
  const selectedHistoryRow = generalRows.find((row) => row.playerId === selectedPlayerId);
  const selectedDayRow = dayRows.find((row) => row.playerId === selectedPlayerId);
  const selectedPlayer = baba.players.find((player) => player.id === selectedPlayerId);

  const exportRanking = async () => {
    setExporting(true);
    setError("");
    try {
      const token = auth.user ? await auth.user.getIdToken() : "";
      const response = await fetch("/api/reports/ranking", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token ? `Bearer ${token}` : "" },
        body: JSON.stringify({ scope, criterion, historyMonth }),
      });
      const data = await response.blob();
      if (!response.ok) throw new Error("Não foi possível gerar o PDF.");
      const href = URL.createObjectURL(data);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `ranking-${scope}-${historyMonth}.pdf`;
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível exportar.");
    } finally {
      setExporting(false);
    }
  };

  return <>
    <ScreenHeading
      eyebrow="Desempenho"
      title="Ranking dos jogadores"
      description="Os rankings do mês, geral e histórico são recalculados a partir dos babas finalizados."
      action={<button className="button secondary" disabled={!rows.length || exporting} onClick={() => void exportRanking()}>
        <Download /> {exporting ? "Gerando…" : "Exportar este ranking"}
      </button>}
    />
    <section className="card ranking-controls">
      <div><strong>Selecionar ranking</strong><small>Um painel por vez</small></div>
      <div className="segmented ranking-scopes" role="tablist">
        {(Object.keys(scopeLabels) as Scope[]).map((value) => <button
          role="tab"
          aria-selected={scope === value}
          className={scope === value ? "active" : ""}
          key={value}
          onClick={() => setScope(value)}
        >{scopeLabels[value]}</button>)}
      </div>
      {scope === "history" && <label>Mês do histórico
        <input type="month" value={historyMonth} onChange={(event) => setHistoryMonth(event.target.value)} />
      </label>}
      <label>Ordenar ranking
        <select value={criterion} onChange={(event) => setCriterion(event.target.value as RankingCriterion)}>
          {criteria.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
        </select>
      </label>
    </section>
    <div className="ranking-period">
      <div>
        <p className="eyebrow">Ranking {scopeLabels[scope].toLocaleLowerCase("pt-BR")}</p>
        <h2>{periodTitle(scope, historyMonth, currentMonth, baba.activeBaba?.dateKey)}</h2>
        <small>{scope === "day" ? "Dados do baba atual" : `${scope === "general" || scope === "goalkeeper" ? completed : selectedBabas} babas finalizados`}</small>
      </div>
      <span>{rows.length} jogadores</span>
    </div>
    {loading && scope !== "day"
      ? <div className="ranking-loading" role="status"><LoaderCircle className="spin" /> Recalculando pelo histórico…</div>
      : !rows.length
        ? <EmptyState icon={<Medal />} title="Ainda sem dados neste ranking" text={scope === "day" ? "Finalize uma partida ou salve os totais manuais." : "Somente babas finalizados entram neste período."} />
        : <>
          <p className="ranking-card-hint">Toque em um jogador para abrir o card completo.</p>
          <div className="ranking-list">
            {rows.map((row, index) => {
              const rating = calculateStars(row, rows, completed);
              return <button
                type="button"
                key={row.playerId}
                className={index < 3 ? `rank-card podium rank-${index + 1}` : "rank-card"}
                onClick={() => setSelectedPlayerId(row.playerId)}
                aria-label={`Abrir card de ${row.name}`}
              >
                <span className="rank-position">{index + 1}</span>
                <span className="avatar">{row.name.slice(0, 2).toUpperCase()}</span>
                <div className="rank-identity">
                  <strong>{row.name}</strong>
                  <StarBar value={rating.displayStars} />
                  <small>{rating.eligible ? `${rating.level.title} · score ${rating.score}` : `Faltam ${rating.missingGames} jogos para receber estrelas`}</small>
                </div>
                <div className="rank-metrics">
                  <span><strong>{row.goals}</strong> gols</span>
                  <span><strong>{row.wins}</strong> vitórias</span>
                  <span><strong>{row.losses}</strong> derrotas</span>
                  <span><strong>{row.titles || 0}</strong> títulos</span>
                  <span><strong>{row.efficiency}%</strong> aprov.</span>
                </div>
              </button>;
            })}
          </div>
        </>}
    {error && <p className="message error" role="alert">{error}</p>}
    {selectedRow && <PlayerCardDialog
      player={selectedPlayer}
      row={selectedRow}
      dayRow={selectedDayRow}
      historyRow={selectedHistoryRow}
      group={generalRows.length ? generalRows : rows}
      completedBabas={completed}
      onClose={() => setSelectedPlayerId(null)}
    />}
  </>;
}
