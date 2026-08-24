"use client";

import { useEffect, useRef } from "react";
import { Star, X } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useBaba } from "@/components/providers/baba-provider";
import { calculateStars } from "@/lib/domain/stars";
import type { Player, RankingRow } from "@/lib/domain/types";

function Stars({ value }: { value: number }) {
  return <div className="stars" aria-label={`${value.toLocaleString("pt-BR")} estrelas`}>{Array.from({ length: 5 }, (_, index) => {
    const fill = Math.max(0, Math.min(1, value - index));
    return <span className={`star-shell ${fill >= 1 ? "full" : fill >= 0.5 ? "half" : ""}`} key={index}><Star /><Star className="star-fill" /></span>;
  })}</div>;
}

function Metrics({ title, row }: { title: string; row?: RankingRow }) {
  return <section><h3>{title}</h3><div className="player-card-metrics">
    <span><strong>{row?.goals || 0}</strong>Gols</span><span><strong>{row?.wins || 0}</strong>Vitórias</span>
    <span><strong>{row?.games || 0}</strong>Jogos</span><span><strong>{row?.babas || 0}</strong>Babas</span>
    <span><strong>{row?.titles || 0}</strong>Títulos</span><span><strong>{row?.efficiency || 0}%</strong>Aproveitamento</span>
  </div></section>;
}

const statusLabels = {
  regular: "Regular",
  novato: "Novato",
  convidado: "Convidado",
  desativado: "Desativado",
} as const;

export function PlayerCardDialog({ player, row, dayRow, historyRow, group, completedBabas, onClose }: {
  player?: Player;
  row: RankingRow;
  dayRow?: RankingRow;
  historyRow?: RankingRow;
  group: RankingRow[];
  completedBabas: number;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null); const auth = useAuth(); const baba = useBaba();
  const identity = historyRow || row; const rating = calculateStars(identity, group.length ? group : [identity], completedBabas);
  const team = baba.teams.find((item) => item.playerIds.includes(row.playerId));
  const payment = baba.payments.find((item) => item.playerId === row.playerId);
  useEffect(() => { const current = dialog.current; if (current && !current.open) current.showModal(); return () => { if (current?.open) current.close(); }; }, []);
  return <dialog ref={dialog} className="player-card-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose}>
    <button type="button" className="dialog-close" aria-label="Fechar card do jogador" onClick={onClose} autoFocus><X /></button>
    <header><span className="player-card-avatar">{row.name.slice(0, 2).toUpperCase()}</span><div><p className="eyebrow">Card do jogador</p><h2>{row.name}</h2><p>{player?.type === "goleiro" || row.playerType === "goleiro" ? "Goleiro" : "Jogador de linha"}{team ? ` · ${team.name}` : ""}</p></div></header>
    <div className="player-card-rating"><Stars value={rating.displayStars} /><strong>{rating.level.title}</strong><small>{rating.eligible ? `Score ${rating.score} · razão ${rating.ratio.toFixed(2)}` : `Faltam ${rating.missingGames} jogos para receber estrelas`}</small></div>
    <Metrics title="Baba atual" row={dayRow} />
    <Metrics title="Histórico geral" row={historyRow} />
    <footer><span>Status: <strong>{player ? statusLabels[player.status] : "Histórico"}</strong></span>{auth.role === "organizer" && player && <span>Pagamento: <strong>{payment?.status === "paid" ? "Pago" : payment?.status === "exempt" || player.status !== "regular" || !player.active ? "Isento" : "Pendente"}</strong></span>}</footer>
    <p className="player-card-note">Partidas encerradas, elencos e gols históricos permanecem preservados.</p>
  </dialog>;
}
