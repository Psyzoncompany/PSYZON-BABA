"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, CircleUserRound, LoaderCircle, Shuffle, UsersRound } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useBaba } from "@/components/providers/baba-provider";
import { getTeamTheme } from "@/lib/domain/team-theme";
import { EmptyState, ScreenHeading } from "@/components/ui/screen";

function actionError(cause: unknown, fallback: string) {
  const code = typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "";
  if (code.includes("permission-denied")) return "Seu acesso não tem permissão para alterar o baba. Entre novamente como organizador.";
  if (code.includes("unavailable") || !navigator.onLine) return "Sem conexão com o Firebase. Verifique a internet e tente novamente.";
  return cause instanceof Error ? cause.message : fallback;
}

export function TeamsScreen() {
  const { role } = useAuth();
  const baba = useBaba();
  const [error, setError] = useState("");
  const [busyPlayerId, setBusyPlayerId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const present = baba.players.filter((player) => player.present);
  const eligibleCount = present.filter((player) => player.type === "linha" && player.status !== "convidado").length;
  const playerById = useMemo(() => new Map(baba.players.map((player) => [player.id, player])), [baba.players]);

  const togglePresence = async (playerId: string) => {
    setError("");
    setBusyPlayerId(playerId);
    try {
      await baba.togglePresence(playerId);
    } catch (cause) {
      console.error("[times] Falha ao salvar presença", cause);
      setError(actionError(cause, "Não foi possível atualizar a presença."));
    } finally {
      setBusyPlayerId(null);
    }
  };

  const draw = async () => {
    setError("");
    setDrawing(true);
    try {
      await baba.draw();
    } catch (cause) {
      console.error("[times] Falha ao sortear", cause);
      setError(actionError(cause, "Não foi possível sortear."));
    } finally {
      setDrawing(false);
    }
  };

  const drawButton = role === "organizer" && baba.activeBaba && !baba.teams.length
    ? <button className="button primary" onClick={draw} disabled={drawing || eligibleCount < 8}>{drawing ? <LoaderCircle className="spin" /> : <Shuffle />} {drawing ? "Sorteando…" : "Sortear times"}</button>
    : undefined;

  return <>
    <ScreenHeading eyebrow="Times" title={baba.teams.length ? `${baba.teams.length} times em campo` : "Monte os times do dia"} description={baba.teams.length ? `${present.length} pessoas distribuídas sem repetição.` : "Marque quem chegou. O sorteio equilibra linha e goleiros."} action={drawButton} />
    {role === "viewer" && <p className="message" role="status">Você está no modo jogador. Somente o organizador seleciona presenças e sorteia os times.</p>}
    {!baba.activeBaba ? <EmptyState icon={<UsersRound />} title="Comece pelo painel" text="Inicie um baba para marcar presenças e sortear." action={role === "organizer" && <Link className="button primary" href="/organizador">Iniciar baba</Link>} /> : !baba.teams.length ? <section className="card attendance-card">
      <div className="card-title-row"><div><h2>Quem está presente?</h2><p>{present.length} selecionados</p></div><span className={`count-ring ${eligibleCount >= 8 ? "ready" : ""}`}>{present.length}</span></div>
      <div className="attendance-list">{baba.players.map((player) => {
        const busy = busyPlayerId === player.id;
        return <button key={player.id} className={player.present ? "selected" : ""} disabled={role !== "organizer" || busyPlayerId !== null || drawing} aria-pressed={player.present} onClick={() => togglePresence(player.id)}>
          <span className="avatar">{player.name.slice(0, 2).toUpperCase()}</span>
          <span><strong>{player.name}</strong><small>{player.type === "goleiro" ? "Goleiro" : "Linha"} · {player.paid ? "Pago" : player.status === "novato" ? "Novato" : "Pendente"}</small></span>
          <span className="presence-check">{busy ? <LoaderCircle className="spin" /> : player.present ? <Check /> : null}</span>
        </button>;
      })}</div>
      {!baba.players.length && <p className="inline-empty">Cadastre jogadores no painel do organizador.</p>}
      <div className="sticky-card-action"><p>{eligibleCount < 8 ? `Faltam ${8 - eligibleCount} jogadores de linha` : "Tudo pronto para o sorteio"}</p>{role === "organizer" && <button className="button primary" onClick={draw} disabled={eligibleCount < 8 || drawing || busyPlayerId !== null}>{drawing ? <LoaderCircle className="spin" /> : <Shuffle />} {drawing ? "Sorteando…" : "Sortear agora"}</button>}</div>
    </section> : <div className="team-grid">{baba.teams.map((team) => {
      const theme = getTeamTheme(team.order);
      return <article className="team-card" key={team.id} style={{ "--team": team.color || theme.color } as React.CSSProperties}>
        <header><span className="team-crest"><Image src={theme.crest} width={48} height={48} alt={`Escudo do ${theme.club}`} /></span><div><h2>{team.name}</h2><p>{theme.club} · {team.playerIds.length} jogadores</p></div>{team.lateArrival && <span className="badge">Chegou depois</span>}</header>
        <div className="roster">{team.playerIds.map((id, index) => { const player = playerById.get(id); return <div key={id}><span>{index + 1}</span><CircleUserRound /><strong>{player?.name || "Jogador"}</strong>{player?.type === "goleiro" && <small>GOL</small>}</div>; })}</div>
      </article>;
    })}</div>}
    {error && <p className="message error" role="alert">{error}</p>}
  </>;
}
