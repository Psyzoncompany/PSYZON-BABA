"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, CircleUserRound, ClipboardPenLine, FileDown, LoaderCircle, Shuffle, UserPlus, UsersRound } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useBaba } from "@/components/providers/baba-provider";
import { getTeamTheme } from "@/lib/domain/team-theme";
import { EmptyState, ScreenHeading } from "@/components/ui/screen";

function actionError(cause: unknown, fallback: string) {
  const code = typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "";
  if (code.includes("permission-denied")) return "Seu acesso não pode alterar o baba. Entre novamente como organizador.";
  if (code.includes("unavailable") || !navigator.onLine) return "Sem conexão com o Firebase. Verifique a internet e tente novamente.";
  return cause instanceof Error ? cause.message : fallback;
}

export function TeamsScreen() {
  const { role } = useAuth();
  const baba = useBaba();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [manualCount, setManualCount] = useState(2);
  const [lateIds, setLateIds] = useState<string[]>([]);
  const activePlayers = baba.players.filter((player) => player.active && player.status !== "desativado");
  const present = activePlayers.filter((player) => player.present);
  const fieldCount = present.filter((player) => player.type === "linha" && player.status !== "convidado").length;
  const goalkeeperCount = present.filter((player) => player.type === "goleiro" && player.status !== "convidado").length;
  const estimatedTeams = Math.min(5, Math.max(2, Math.ceil(fieldCount / 4)));
  const playerById = useMemo(() => new Map(baba.players.map((player) => [player.id, player])), [baba.players]);
  const paymentById = useMemo(() => new Map(baba.payments.map((payment) => [payment.playerId, payment.status])), [baba.payments]);
  const assigned = useMemo(() => new Set(baba.teams.flatMap((team) => team.playerIds)), [baba.teams]);
  const unassigned = present.filter((player) => !assigned.has(player.id));

  const run = async (key: string, operation: () => Promise<void>, success: string) => {
    setError(""); setMessage(""); setBusy(key);
    try { await operation(); setMessage(success); }
    catch (cause) { setError(actionError(cause, "Não foi possível concluir.")); }
    finally { setBusy(null); }
  };

  if (!baba.activeBaba) return <><ScreenHeading eyebrow="Times" title="Organização dos times" description="Presenças, modo de anotação e elenco do dia." /><EmptyState icon={<UsersRound />} title="Crie o baba de hoje" text="Inicie um encontro no painel do organizador para liberar as presenças." action={role === "organizer" && <Link className="button primary" href="/organizador">Ir ao painel</Link>} /></>;

  return <>
    <ScreenHeading eyebrow="Organização dos times" title={baba.teams.length ? "Times sorteados" : "Preparação dos times"} description={baba.teams.length ? `${present.length} presentes · ${baba.teams.length} times · modo ${baba.activeBaba.matchMode === "online" ? "Pelo Site" : "Manual"}.` : "Marque os presentes e escolha como os resultados serão anotados."} action={baba.activeBaba.matchMode === "manual" && baba.teams.length ? <Link className="button secondary" href="/app/ficha-manual"><FileDown /> Ficha para imprimir</Link> : undefined} />
    {role === "viewer" && <p className="message" role="status">Modo jogador: acompanhe os times em tempo real. Somente o organizador pode alterá-los.</p>}

    {!baba.teams.length ? <div className="setup-stack">
      <section className="card preparation-card">
        <div className="card-title-row"><div><p className="eyebrow">Tudo pronto para o sorteio?</p><h2>Confira os participantes</h2></div><UsersRound /></div>
        <div className="preparation-stats"><span><strong>{present.length}</strong>Presentes</span><span><strong>{estimatedTeams}</strong>Times</span><span><strong>{goalkeeperCount}</strong>Goleiros</span></div>
        <div className="mode-picker"><div><strong>Modo de anotação</strong><small>Escolha antes do sorteio. Depois, o modo fica bloqueado.</small></div><div className="mode-options"><button className={baba.activeBaba.matchMode === "online" ? "selected" : ""} disabled={role !== "organizer" || Boolean(busy)} onClick={() => run("mode-online", () => baba.setMatchMode("online"), "Modo Pelo Site selecionado.")}><Shuffle /><span><strong>Pelo Site</strong><small>Placares, gols, cronômetro e rodízio</small></span>{baba.activeBaba.matchMode === "online" && <Check />}</button><button className={baba.activeBaba.matchMode === "manual" ? "selected" : ""} disabled={role !== "organizer" || Boolean(busy)} onClick={() => run("mode-manual", () => baba.setMatchMode("manual"), "Modo Manual selecionado.")}><ClipboardPenLine /><span><strong>Manual (Papel/PDF)</strong><small>Ficha impressa e totais finais</small></span>{baba.activeBaba.matchMode === "manual" && <Check />}</button></div></div>
      </section>

      <section className="card attendance-card">
        <div className="card-title-row"><div><h2>1. Jogadores presentes</h2><p>{present.length} selecionados · {fieldCount} de linha</p></div><span className={`count-ring ${fieldCount >= 8 ? "ready" : ""}`}>{present.length}</span></div>
        <div className="attendance-list">{activePlayers.map((player) => {
          const playerBusy = busy === player.id; const payment = paymentById.get(player.id);
          return <button key={player.id} className={player.present ? "selected" : ""} disabled={role !== "organizer" || Boolean(busy)} aria-pressed={player.present} onClick={() => run(player.id, () => baba.togglePresence(player.id), player.present ? `${player.name} removido da presença.` : `${player.name} marcado como presente.`)}><span className="avatar">{player.name.slice(0, 2).toUpperCase()}</span><span><strong>{player.name}</strong><small>{player.type === "goleiro" ? "Goleiro" : "Linha"} · {player.status === "novato" ? "Novato" : role === "organizer" ? payment === "paid" ? "Pago" : "Pendente" : "Regular"}</small></span><span className="presence-check">{playerBusy ? <LoaderCircle className="spin" /> : player.present ? <Check /> : null}</span></button>;
        })}</div>
        {!activePlayers.length && <p className="inline-empty">Cadastre jogadores no painel do organizador.</p>}
      </section>

      <div className="formation-grid">
        <section className="card draw-choice"><Shuffle /><div><h2>Sortear times</h2><p>Distribui linha e goleiros sem repetição.</p></div><button className="button primary" disabled={role !== "organizer" || fieldCount < 8 || Boolean(busy)} onClick={() => run("draw", baba.draw, "Times sorteados e sincronizados.")}>{busy === "draw" ? <LoaderCircle className="spin" /> : <Shuffle />} Sortear agora</button>{fieldCount < 8 && <small>Marque pelo menos {8 - fieldCount} jogadores de linha.</small>}</section>
        <section className="card draw-choice"><ClipboardPenLine /><div><h2>Montar manualmente</h2><p>Crie times vazios e escolha o destino de cada jogador.</p></div><div className="manual-team-count"><select value={manualCount} onChange={(event) => setManualCount(Number(event.target.value))} aria-label="Quantidade de times">{[2, 3, 4, 5].map((count) => <option key={count} value={count}>{count} times</option>)}</select><button className="button secondary" disabled={role !== "organizer" || !present.length || Boolean(busy)} onClick={() => run("empty", () => baba.createEmptyTeams(manualCount), "Times vazios criados.")}>{busy === "empty" ? <LoaderCircle className="spin" /> : <UserPlus />} Criar times</button></div></section>
      </div>
    </div> : <>
      <div className="team-grid">{baba.teams.map((team) => {
        const theme = getTeamTheme(team.order);
        return <article className="team-card reveal-team" key={team.id} style={{ "--team": team.color || theme.color, animationDelay: `${Math.min(team.order * 90, 450)}ms` } as React.CSSProperties}>
          <header><span className="team-crest"><Image src={theme.crest} width={48} height={48} alt={`Escudo do ${theme.club}`} /></span><div><h2>{team.name}</h2><p>{theme.club} · {team.playerIds.length} jogadores · lote {team.drawBatch}</p></div>{team.lateArrival && <span className="badge">Chegou depois</span>}</header>
          <div className="roster">{team.playerIds.map((id, index) => { const player = playerById.get(id); return <div key={id}><span>{index + 1}</span><CircleUserRound /><strong>{player?.name || "Jogador"}</strong>{role === "organizer" ? <select aria-label={`Mover ${player?.name || "jogador"}`} value={team.id} onChange={(event) => run(`move-${id}`, () => baba.movePlayer(id, event.target.value || null), "Elenco atualizado. Jogos encerrados foram preservados.")} disabled={Boolean(busy)}><option value="">Sem time</option>{baba.teams.map((destination) => <option value={destination.id} key={destination.id}>{destination.name}</option>)}</select> : player?.type === "goleiro" ? <small>GOL</small> : null}</div>; })}{!team.playerIds.length && <p className="inline-empty">Time vazio. Use a lista abaixo para adicionar jogadores.</p>}</div>
        </article>;
      })}</div>
      {unassigned.length > 0 && <section className="card late-arrivals"><div className="card-title-row"><div><h2>Presentes sem time</h2><p>Adicione manualmente ou crie um novo lote no fim da fila.</p></div><UserPlus /></div><div className="attendance-list">{unassigned.map((player) => <button key={player.id} className={lateIds.includes(player.id) ? "selected" : ""} disabled={role !== "organizer" || Boolean(busy)} aria-pressed={lateIds.includes(player.id)} onClick={() => setLateIds((current) => current.includes(player.id) ? current.filter((id) => id !== player.id) : [...current, player.id])}><span className="avatar">{player.name.slice(0, 2).toUpperCase()}</span><span><strong>{player.name}</strong><small>{player.type === "goleiro" ? "Goleiro" : "Linha"}</small></span><span className="presence-check">{lateIds.includes(player.id) && <Check />}</span></button>)}</div><div className="sticky-card-action"><select aria-label="Adicionar jogador selecionado ao time" defaultValue="" onChange={(event) => { const target = event.target.value; const first = lateIds[0]; if (target && first) void run(`move-${first}`, () => baba.movePlayer(first, target), "Jogador adicionado ao time."); event.target.value = ""; }} disabled={lateIds.length !== 1 || role !== "organizer"}><option value="">Adicionar 1 jogador a…</option>{baba.teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select><button className="button primary" disabled={!lateIds.length || role !== "organizer" || Boolean(busy)} onClick={() => run("late", () => baba.drawLateArrivals(lateIds), "Novo lote criado no fim da fila.")}>{busy === "late" ? <LoaderCircle className="spin" /> : <Shuffle />} Sortear novo lote</button></div></section>}
    </>}
    {(error || message) && <p className={`message ${error ? "error" : "success"}`} aria-live="polite">{error || message}</p>}
  </>;
}
