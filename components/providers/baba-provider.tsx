"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  collection, doc, onSnapshot, runTransaction, setDoc, updateDoc, writeBatch,
  type DocumentData, type FirestoreError, type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "./auth-provider";
import { buildManualRanking, buildRanking, championIds, nextRotation, resolveManualDraw, resolveRandomDraw, teamFromManualResult } from "@/lib/domain/competition";
import { drawTeams } from "@/lib/domain/draw";
import { normalizeBabaStatus } from "@/lib/domain/legacy";
import { createMonthlyPayment, monthKey, monthlyPriceCents } from "@/lib/domain/payments";
import { getTeamTheme } from "@/lib/domain/team-theme";
import type { Baba, Game, ManualTeamResult, MatchMode, MonthlyPayment, Player, Team } from "@/lib/domain/types";

export type SyncStatus = "connecting" | "saving" | "online" | "offline" | "pending";

interface BabaValue {
  loading: boolean; syncStatus: SyncStatus; syncError: string; retryConnection(): void; players: Player[]; teams: Team[]; games: Game[]; babas: Baba[]; activeBaba: Baba | null;
  payments: MonthlyPayment[]; manualResults: ManualTeamResult[];
  addPlayer(name: string, type: Player["type"]): Promise<void>;
  updatePlayer(id: string, patch: Partial<Player>): Promise<void>;
  togglePresence(id: string): Promise<void>; togglePayment(id: string): Promise<void>;
  createBaba(dateKey: string): Promise<void>; setMatchMode(mode: MatchMode): Promise<void>; draw(): Promise<void>; drawLateArrivals(playerIds: string[]): Promise<void>;
  createEmptyTeams(count: number): Promise<void>; movePlayer(playerId: string, teamId: string | null): Promise<void>;
  saveManualResult(result: ManualTeamResult): Promise<void>;
  prepareGame(teamAId?: string, teamBId?: string): Promise<void>; startOrPauseGame(): Promise<void>;
  addGoal(teamId: string, playerId: string | null): Promise<void>; undoGoal(): Promise<void>; finishGame(): Promise<void>;
  resolveTieBreak(winnerId?: string): Promise<void>; undoLastGame(): Promise<void>;
  finishBaba(): Promise<void>; generateViewerCode(): Promise<string>; getViewerCode(): Promise<string | null>; revokeViewerCode(): Promise<void>; resetActiveBaba(): Promise<void>;
}

const BabaContext = createContext<BabaValue | null>(null);
const now = () => Date.now();

function mapPlayer(id: string, data: DocumentData): Player {
  const status = data.status || (data.novato || data.noviceActive ? "novato" : "regular");
  return {
    id, name: String(data.name || data.nome || "Jogador"), type: data.type === "goleiro" || data.tipo === "goleiro" ? "goleiro" : "linha",
    status: ["regular", "novato", "convidado", "desativado"].includes(status) ? status : "regular",
    active: data.active !== false && data.ativo !== false && status !== "desativado", present: Boolean(data.present), paid: Boolean(data.paid),
    createdAtMs: Number(data.createdAtMs || data.criadoEm || 0), updatedAtMs: Number(data.updatedAtMs || 0),
  };
}

function mapTeam(id: string, data: DocumentData): Team {
  const sourceStats = data.stats || data;
  return {
    id, name: String(data.name || data.nome || `Time ${data.order || 1}`), color: String(data.color || "#1867d2"), order: Number(data.order || 1),
    playerIds: Array.isArray(data.playerIds) ? data.playerIds : Array.isArray(data.jogadores) ? data.jogadores : [],
    drawBatch: Number(data.drawBatch || 1), lateArrival: Boolean(data.lateArrival), active: data.active !== false && data.status !== "removed",
    stats: { wins: Number(sourceStats.wins ?? sourceStats.vitorias ?? 0), draws: Number(sourceStats.draws ?? sourceStats.empates ?? 0), losses: Number(sourceStats.losses ?? sourceStats.derrotas ?? 0), goalsFor: Number(sourceStats.goalsFor ?? sourceStats.golsPro ?? 0), goalsAgainst: Number(sourceStats.goalsAgainst ?? sourceStats.golsContra ?? 0) },
    updatedAtMs: Number(data.updatedAtMs || 0),
  };
}

function mapBaba(id: string, data: DocumentData): Baba {
  const status = normalizeBabaStatus(data.status);
  const legacyChampion = data.campeaoDoBaba;
  const championTeamIds = Array.isArray(data.championTeamIds)
    ? data.championTeamIds.map(String)
    : legacyChampion && typeof legacyChampion === "object"
      ? [String(legacyChampion.teamId || legacyChampion.timeId || legacyChampion.id || "legacy-champion")]
      : [];
  return {
    id, dateKey: String(data.dateKey || data.dataISO || new Date().toISOString().slice(0, 10)), status,
    matchMode: data.matchMode === "manual" ? "manual" : "online", modeLocked: Boolean(data.modeLocked), currentGameId: data.currentGameId || null,
    queue: Array.isArray(data.queue) ? data.queue : Array.isArray(data.currentQueue) ? data.currentQueue : [],
    pendingTieBreak: data.pendingTieBreak && typeof data.pendingTieBreak === "object" ? data.pendingTieBreak : null,
    drawBatchCount: Number(data.drawBatchCount || 0), championTeamIds,
    createdAtMs: Number(data.createdAtMs || data.criadoEm || 0), finishedAtMs: Number(data.finishedAtMs || data.finalizadoEm || 0) || null,
    deletedAtMs: Number(data.deletedAtMs || (data.deleted ? data.updatedAtMs : 0)) || null, updatedAtMs: Number(data.updatedAtMs || 0),
  };
}

function mapGame(id: string, data: DocumentData): Game {
  return {
    id, sequence: Number(data.sequence || data.numeroJogo || 1), teamAId: String(data.teamAId || data.timeA || ""), teamBId: String(data.teamBId || data.timeB || ""),
    teamAName: String(data.teamAName || data.timeANome || "Time A"), teamBName: String(data.teamBName || data.timeBNome || "Time B"),
    rosterA: data.rosterA || data.jogadoresTimeA || [], rosterB: data.rosterB || data.jogadoresTimeB || [], scoreA: Number(data.scoreA ?? data.placarA ?? 0), scoreB: Number(data.scoreB ?? data.placarB ?? 0),
    status: data.status || "prepared", durationSeconds: Number(data.durationSeconds || 480), timerStartedAtMs: data.timerStartedAtMs ?? data.timerStartedAt ?? null,
    timerRemainingSeconds: Number(data.timerRemainingSeconds ?? 480), goalEvents: Array.isArray(data.goalEvents) ? data.goalEvents : [],
    createdAtMs: Number(data.createdAtMs || data.dataHora || 0), finishedAtMs: Number(data.finishedAtMs || data.finalizadoEm || 0) || null, updatedAtMs: Number(data.updatedAtMs || 0),
  };
}

function mapPayment(id: string, data: DocumentData): MonthlyPayment {
  return {
    playerId: id,
    monthKey: String(data.monthKey || ""),
    status: data.status === "paid" || data.status === "exempt" ? data.status : "pending",
    amountCents: Number(data.amountCents || 0),
    dueDateKey: String(data.dueDateKey || ""),
    updatedAtMs: Number(data.updatedAtMs || 0),
    updatedBy: String(data.updatedBy || ""),
  };
}

function mapManualResult(id: string, data: DocumentData): ManualTeamResult {
  const goalsByPlayer = data.goalsByPlayer && typeof data.goalsByPlayer === "object" ? data.goalsByPlayer : {};
  return {
    teamId: id,
    wins: Math.max(0, Number(data.wins || 0)),
    draws: Math.max(0, Number(data.draws || 0)),
    losses: Math.max(0, Number(data.losses || 0)),
    goalsByPlayer,
    updatedAtMs: Number(data.updatedAtMs || 0),
  };
}

export function BabaProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const { accountId, role } = auth;
  const [players, setPlayers] = useState<Player[]>([]); const [teams, setTeams] = useState<Team[]>([]); const [games, setGames] = useState<Game[]>([]); const [babas, setBabas] = useState<Baba[]>([]);
  const [payments, setPayments] = useState<MonthlyPayment[]>([]); const [manualResults, setManualResults] = useState<ManualTeamResult[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting");
  const [syncError, setSyncError] = useState(""); const [listenerVersion, setListenerVersion] = useState(0);
  const activeBaba = useMemo(() => babas.find((item) => item.id === activeId) || babas.find((item) => item.status !== "finished") || null, [babas, activeId]);
  const listenerError = useCallback((cause: FirestoreError) => {
    console.error("[realtime] Listener do Firestore negado", cause);
    setSyncStatus(navigator.onLine ? "connecting" : "offline");
    setSyncError(cause.code === "permission-denied" ? "Sem permissão para sincronizar. Publique as regras do Firebase e entre novamente." : "A sincronização falhou. Tente conectar novamente.");
    setLoading(false);
  }, []);
  const retryConnection = useCallback(() => { setSyncError(""); setListenerVersion((value) => value + 1); }, []);

  useEffect(() => {
    const online = () => setSyncStatus("online"); const offline = () => setSyncStatus("offline");
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    if (!navigator.onLine) offline();
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);

  useEffect(() => {
    // Reset tenant-scoped state before attaching listeners for the next account.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlayers([]); setTeams([]); setGames([]); setBabas([]); setPayments([]); setManualResults([]); setActiveId(null); setSyncError("");
    if (!accountId) { setLoading(false); return; }
    setLoading(true); setSyncStatus(navigator.onLine ? "connecting" : "offline");
    const unsubs: Unsubscribe[] = [];
    unsubs.push(onSnapshot(collection(db, "baba_accounts", accountId, "players"), { includeMetadataChanges: true }, (snapshot) => {
      setPlayers(snapshot.docs.map((item) => mapPlayer(item.id, item.data())).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "pt-BR")));
      setSyncStatus(snapshot.metadata.hasPendingWrites ? "pending" : navigator.onLine ? "online" : "offline"); setLoading(false);
    }, listenerError));
    unsubs.push(onSnapshot(collection(db, "baba_accounts", accountId, "babas"), (snapshot) => {
      const items = snapshot.docs.map((item) => mapBaba(item.id, item.data())).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      setBabas(items); setActiveId((current) => current || items.find((item) => item.status !== "finished")?.id || null);
    }, listenerError));
    unsubs.push(onSnapshot(doc(db, "baba_accounts", accountId, "meta", "live"), (snapshot) => {
      if (snapshot.exists()) setActiveId(snapshot.data().activeBabaId || null);
    }, listenerError));
    if (role === "organizer") {
      unsubs.push(onSnapshot(collection(db, "baba_accounts", accountId, "payments", monthKey(), "players"), (snapshot) => {
        setPayments(snapshot.docs.map((item) => mapPayment(item.id, item.data())));
      }, listenerError));
    }
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [accountId, role, listenerVersion, listenerError]);

  useEffect(() => {
    // Avoid rendering the previous baba while the new realtime listeners connect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTeams([]); setGames([]); setManualResults([]);
    if (!accountId || !activeBaba?.id) return;
    const unsubTeams = onSnapshot(collection(db, "baba_accounts", accountId, "babas", activeBaba.id, "teams"), (snapshot) => setTeams(snapshot.docs.map((item) => mapTeam(item.id, item.data())).filter((item) => item.active).sort((a, b) => a.order - b.order)), listenerError);
    const unsubGames = onSnapshot(collection(db, "baba_accounts", accountId, "babas", activeBaba.id, "games"), (snapshot) => setGames(snapshot.docs.map((item) => mapGame(item.id, item.data())).sort((a, b) => a.sequence - b.sequence)), listenerError);
    const unsubManual = onSnapshot(collection(db, "baba_accounts", accountId, "babas", activeBaba.id, "manual_results"), (snapshot) => setManualResults(snapshot.docs.map((item) => mapManualResult(item.id, item.data()))), listenerError);
    return () => { unsubTeams(); unsubGames(); unsubManual(); };
  }, [accountId, activeBaba?.id, listenerVersion, listenerError]);

  const owner = useCallback(() => { if (!accountId || role !== "organizer") throw new Error("Apenas o organizador pode alterar dados."); return accountId; }, [accountId, role]);
  const saving = useCallback(async <T,>(operation: () => Promise<T>) => { setSyncStatus("saving"); try { return await operation(); } finally { setSyncStatus(navigator.onLine ? "online" : "pending"); } }, []);

  const addPlayer = useCallback((name: string, type: Player["type"]) => saving(async () => {
    const uid = owner(); const id = crypto.randomUUID(); const timestamp = now();
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 80) throw new Error("Informe um nome com até 80 caracteres.");
    const created: Player = { id, name: normalizedName, type, status: "regular", active: true, present: false, paid: false, createdAtMs: timestamp, updatedAtMs: timestamp };
    const payment = createMonthlyPayment(created, monthKey(), uid, timestamp);
    const batch = writeBatch(db);
    batch.set(doc(db, "baba_accounts", uid, "players", id), { ...created, playerId: id, nome: normalizedName, tipo: type, ativo: true, schemaVersion: 3 });
    batch.set(doc(db, "baba_accounts", uid, "payments", payment.monthKey, "players", id), { ...payment, schemaVersion: 3 });
    await batch.commit();
  }), [owner, saving]);

  const updatePlayer = useCallback((id: string, patch: Partial<Player>) => saving(async () => {
    const uid = owner(); const normalized: Record<string, unknown> = { ...patch, updatedAtMs: now() };
    if (patch.name) normalized.nome = patch.name; if (patch.type) normalized.tipo = patch.type; if (patch.active !== undefined) normalized.ativo = patch.active;
    await updateDoc(doc(db, "baba_accounts", uid, "players", id), normalized);
  }), [owner, saving]);
  const togglePresence = useCallback((id: string) => saving(async () => {
    const uid = owner(); const player = players.find((item) => item.id === id);
    if (!player || !player.active) return;
    const timestamp = now(); const batch = writeBatch(db);
    batch.update(doc(db, "baba_accounts", uid, "players", id), { present: !player.present, updatedAtMs: timestamp });
    if (!payments.some((payment) => payment.playerId === id)) {
      const payment = createMonthlyPayment(player, monthKey(), uid, timestamp);
      batch.set(doc(db, "baba_accounts", uid, "payments", payment.monthKey, "players", id), { ...payment, schemaVersion: 3 });
    }
    await batch.commit();
  }), [owner, saving, players, payments]);

  const togglePayment = useCallback((id: string) => saving(async () => {
    const uid = owner(); const player = players.find((item) => item.id === id);
    if (!player || monthlyPriceCents(player) === 0) throw new Error("Este jogador é isento neste mês.");
    const current = payments.find((payment) => payment.playerId === id) || createMonthlyPayment(player, monthKey(), uid);
    const next: MonthlyPayment = { ...current, status: current.status === "paid" ? "pending" : "paid", amountCents: monthlyPriceCents(player), updatedAtMs: now(), updatedBy: uid };
    await setDoc(doc(db, "baba_accounts", uid, "payments", next.monthKey, "players", id), { ...next, schemaVersion: 3 }, { merge: true });
  }), [owner, saving, players, payments]);

  const createBaba = useCallback((dateKey: string) => saving(async () => {
    const uid = owner(); const id = crypto.randomUUID(); const timestamp = now(); const batch = writeBatch(db);
    batch.set(doc(db, "baba_accounts", uid, "babas", id), { id, dateKey, dataISO: dateKey, status: "open", matchMode: "online", modeLocked: false, currentGameId: null, queue: [], pendingTieBreak: null, drawBatchCount: 0, championTeamIds: [], schemaVersion: 3, createdAtMs: timestamp, updatedAtMs: timestamp });
    batch.set(doc(db, "baba_accounts", uid, "meta", "live"), { activeBabaId: id, status: "open", schemaVersion: 3, updatedAtMs: timestamp }, { merge: true });
    await batch.commit(); setActiveId(id);
  }), [owner, saving]);

  const setMatchMode = useCallback((mode: MatchMode) => saving(async () => {
    const uid = owner();
    if (!activeBaba) throw new Error("Inicie um baba primeiro.");
    if (activeBaba.modeLocked || teams.length || games.length) throw new Error("O modo fica bloqueado depois que existem times ou partidas.");
    await updateDoc(doc(db, "baba_accounts", uid, "babas", activeBaba.id), { matchMode: mode, updatedAtMs: now() });
  }), [owner, saving, activeBaba, teams.length, games.length]);

  const draw = useCallback(() => saving(async () => {
    const uid = owner(); if (!activeBaba) throw new Error("Inicie um baba primeiro.");
    const newTeams = drawTeams(players, { drawBatch: activeBaba.drawBatchCount + 1 }); const batch = writeBatch(db);
    newTeams.forEach((team) => batch.set(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "teams", team.id), team));
    batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id), { status: "drawn", modeLocked: true, queue: newTeams.map((team) => team.id), drawBatchCount: activeBaba.drawBatchCount + 1, updatedAtMs: now() });
    await batch.commit();
  }), [owner, saving, activeBaba, players]);

  const drawLateArrivals = useCallback((playerIds: string[]) => saving(async () => {
    const uid = owner(); if (!activeBaba || !teams.length) throw new Error("Faça o primeiro sorteio antes de criar um novo lote.");
    const assigned = new Set(teams.flatMap((team) => team.playerIds));
    const selected = players.filter((player) => playerIds.includes(player.id) && player.active && player.present && !assigned.has(player.id));
    if (!selected.length) throw new Error("Selecione quem chegou depois e ainda está sem time.");
    const nextOrder = Math.max(...teams.map((team) => team.order), 0) + 1;
    const lateTeams = drawTeams(selected, { lateArrival: true, drawBatch: activeBaba.drawBatchCount + 1, startOrder: nextOrder });
    const batch = writeBatch(db); const timestamp = now();
    lateTeams.forEach((team) => batch.set(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "teams", team.id), team));
    batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id), {
      queue: [...activeBaba.queue, ...lateTeams.map((team) => team.id)],
      drawBatchCount: activeBaba.drawBatchCount + 1,
      updatedAtMs: timestamp,
    });
    await batch.commit();
  }), [owner, saving, activeBaba, teams, players]);

  const createEmptyTeams = useCallback((count: number) => saving(async () => {
    const uid = owner(); if (!activeBaba) throw new Error("Inicie um baba primeiro.");
    if (teams.length || games.length) throw new Error("Os times já foram criados.");
    if (!Number.isInteger(count) || count < 2 || count > 5) throw new Error("Escolha entre 2 e 5 times.");
    const timestamp = now(); const created = Array.from({ length: count }, (_, index) => {
      const order = index + 1; const theme = getTeamTheme(order);
      return { id: crypto.randomUUID(), name: `Time ${order}`, color: theme.color, order, playerIds: [], drawBatch: 1, lateArrival: false, active: true, stats: { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 }, updatedAtMs: timestamp } satisfies Team;
    });
    const batch = writeBatch(db); created.forEach((team) => batch.set(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "teams", team.id), team));
    batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id), { status: "drawn", modeLocked: true, queue: created.map((team) => team.id), drawBatchCount: 1, updatedAtMs: timestamp });
    await batch.commit();
  }), [owner, saving, activeBaba, teams.length, games.length]);

  const movePlayer = useCallback((playerId: string, teamId: string | null) => saving(async () => {
    const uid = owner(); if (!activeBaba) throw new Error("Nenhum baba em andamento.");
    const player = players.find((item) => item.id === playerId); if (!player) throw new Error("Jogador não encontrado.");
    if (teamId && !teams.some((team) => team.id === teamId)) throw new Error("Time de destino não encontrado.");
    const timestamp = now(); const batch = writeBatch(db);
    teams.forEach((team) => {
      const without = team.playerIds.filter((id) => id !== playerId);
      const nextIds = team.id === teamId ? [...without, playerId] : without;
      if (nextIds.length !== team.playerIds.length || team.id === teamId) {
        batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "teams", team.id), { playerIds: nextIds, updatedAtMs: timestamp });
      }
    });
    await batch.commit();
  }), [owner, saving, activeBaba, players, teams]);

  const saveManualResult = useCallback((result: ManualTeamResult) => saving(async () => {
    const uid = owner(); if (!activeBaba || activeBaba.matchMode !== "manual") throw new Error("Este baba não está no modo manual.");
    const team = teams.find((item) => item.id === result.teamId); if (!team) throw new Error("Time não encontrado.");
    const integers = [result.wins, result.draws, result.losses, ...Object.values(result.goalsByPlayer)];
    if (integers.some((value) => !Number.isInteger(value) || value < 0 || value > 999)) throw new Error("Use somente números inteiros positivos.");
    if (Object.keys(result.goalsByPlayer).some((playerId) => !team.playerIds.includes(playerId))) throw new Error("Há um artilheiro fora do elenco deste time.");
    const timestamp = now(); const normalized = { ...result, updatedAtMs: timestamp };
    const updatedTeam = teamFromManualResult(team, normalized); const batch = writeBatch(db);
    batch.set(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "manual_results", team.id), { ...normalized, schemaVersion: 3 });
    batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "teams", team.id), { stats: updatedTeam.stats, updatedAtMs: timestamp });
    await batch.commit();
  }), [owner, saving, activeBaba, teams]);

  const prepareGame = useCallback((teamAId?: string, teamBId?: string) => saving(async () => {
    const uid = owner(); if (!activeBaba) throw new Error("Nenhum baba em andamento.");
    if (activeBaba.matchMode !== "online") throw new Error("No modo manual, informe os totais finais em vez de criar partidas.");
    if (activeBaba.pendingTieBreak) throw new Error("Resolva o desempate antes de preparar a próxima partida.");
    const ids = [teamAId, teamBId].filter(Boolean) as string[]; const queue = ids.length === 2 ? ids : activeBaba.queue.length >= 2 ? activeBaba.queue : teams.map((team) => team.id);
    const teamA = teams.find((team) => team.id === queue[0]); const teamB = teams.find((team) => team.id === queue[1]); if (!teamA || !teamB) throw new Error("São necessários dois times.");
    const id = crypto.randomUUID(); const timestamp = now(); const game: Game = { id, sequence: games.length + 1, teamAId: teamA.id, teamBId: teamB.id, teamAName: teamA.name, teamBName: teamB.name, rosterA: [...teamA.playerIds], rosterB: [...teamB.playerIds], scoreA: 0, scoreB: 0, status: "prepared", durationSeconds: 480, timerStartedAtMs: null, timerRemainingSeconds: 480, goalEvents: [], createdAtMs: timestamp, finishedAtMs: null, updatedAtMs: timestamp };
    const batch = writeBatch(db); batch.set(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "games", id), game); batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id), { currentGameId: id, status: "playing", modeLocked: true, queue: [teamA.id, teamB.id, ...queue.filter((item) => item !== teamA.id && item !== teamB.id)], updatedAtMs: timestamp }); await batch.commit();
  }), [owner, saving, activeBaba, teams, games.length]);

  const currentGame = games.find((game) => game.id === activeBaba?.currentGameId) || [...games].reverse().find((game) => game.status !== "finished");
  const startOrPauseGame = useCallback(() => saving(async () => {
    const uid = owner(); if (!activeBaba || !currentGame) throw new Error("Prepare uma partida primeiro."); const timestamp = now();
    if (currentGame.status === "running") {
      const elapsed = currentGame.timerStartedAtMs ? Math.floor((timestamp - currentGame.timerStartedAtMs) / 1000) : 0;
      await updateDoc(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "games", currentGame.id), { status: "paused", timerStartedAtMs: null, timerRemainingSeconds: Math.max(0, currentGame.timerRemainingSeconds - elapsed), updatedAtMs: timestamp });
    } else await updateDoc(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "games", currentGame.id), { status: "running", timerStartedAtMs: timestamp, updatedAtMs: timestamp });
  }), [owner, saving, activeBaba, currentGame]);

  const addGoal = useCallback((teamId: string, playerId: string | null) => saving(async () => {
    const uid = owner(); if (!activeBaba || !currentGame) throw new Error("Nenhuma partida ativa."); const player = players.find((item) => item.id === playerId); const timestamp = now();
    await runTransaction(db, async (transaction) => {
      const ref = doc(db, "baba_accounts", uid, "babas", activeBaba.id, "games", currentGame.id); const snap = await transaction.get(ref); const game = mapGame(snap.id, snap.data() || {});
      if (game.status !== "running" && game.status !== "paused") throw new Error("Inicie o jogo antes de marcar gols.");
      if (teamId !== game.teamAId && teamId !== game.teamBId) throw new Error("Time inválido para esta partida.");
      const roster = teamId === game.teamAId ? game.rosterA : game.rosterB;
      if (playerId && !roster.includes(playerId)) throw new Error("O autor do gol não pertence ao elenco congelado deste time.");
      const elapsedSinceResume = game.status === "running" && game.timerStartedAtMs ? Math.floor((timestamp - game.timerStartedAtMs) / 1000) : 0;
      const remaining = Math.max(0, game.timerRemainingSeconds - elapsedSinceResume);
      const event = { id: crypto.randomUUID(), playerId, playerNameSnapshot: player?.name || "Sem artilheiro", teamId, minute: Math.max(0, Math.floor((game.durationSeconds - remaining) / 60)), createdAtMs: timestamp };
      transaction.update(ref, { scoreA: game.scoreA + Number(teamId === game.teamAId), scoreB: game.scoreB + Number(teamId === game.teamBId), goalEvents: [...game.goalEvents, event], updatedAtMs: timestamp });
    });
  }), [owner, saving, activeBaba, currentGame, players]);

  const undoGoal = useCallback(() => saving(async () => {
    const uid = owner(); if (!activeBaba || !currentGame) throw new Error("Nenhum gol para desfazer.");
    await runTransaction(db, async (transaction) => { const ref = doc(db, "baba_accounts", uid, "babas", activeBaba.id, "games", currentGame.id); const snapshot = await transaction.get(ref); const stored = mapGame(snapshot.id, snapshot.data() || {}); const last = stored.goalEvents.at(-1); if (!last || stored.status === "finished") throw new Error("Nenhum gol ativo para desfazer."); transaction.update(ref, { scoreA: Math.max(0, stored.scoreA - Number(last.teamId === stored.teamAId)), scoreB: Math.max(0, stored.scoreB - Number(last.teamId === stored.teamBId)), goalEvents: stored.goalEvents.slice(0, -1), updatedAtMs: now() }); });
  }), [owner, saving, activeBaba, currentGame]);

  const finishGame = useCallback(() => saving(async () => {
    const uid = owner(); if (!activeBaba || !currentGame) throw new Error("Nenhuma partida ativa.");
    const babaRef = doc(db, "baba_accounts", uid, "babas", activeBaba.id); const gameRef = doc(db, "baba_accounts", uid, "babas", activeBaba.id, "games", currentGame.id);
    await runTransaction(db, async (transaction) => {
      const [gameSnapshot, babaSnapshot] = await Promise.all([transaction.get(gameRef), transaction.get(babaRef)]);
      if (!gameSnapshot.exists() || !babaSnapshot.exists()) throw new Error("Partida não encontrada.");
      const storedGame = mapGame(gameSnapshot.id, gameSnapshot.data()); if (storedGame.status === "finished") return;
      const storedBaba = mapBaba(babaSnapshot.id, babaSnapshot.data());
      const teamARef = doc(db, "baba_accounts", uid, "babas", activeBaba.id, "teams", storedGame.teamAId); const teamBRef = doc(db, "baba_accounts", uid, "babas", activeBaba.id, "teams", storedGame.teamBId);
      const [teamASnapshot, teamBSnapshot] = await Promise.all([transaction.get(teamARef), transaction.get(teamBRef)]);
      if (!teamASnapshot.exists() || !teamBSnapshot.exists()) throw new Error("Os times desta partida não foram encontrados.");
      const teamA = mapTeam(teamASnapshot.id, teamASnapshot.data()); const teamB = mapTeam(teamBSnapshot.id, teamBSnapshot.data());
      const rotation = nextRotation(teamA.id, teamB.id, storedBaba.queue, storedGame.scoreA, storedGame.scoreB); const timestamp = now();
      const updateStats = (team: Team, own: number, against: number) => ({ ...team.stats, wins: team.stats.wins + Number(own > against), draws: team.stats.draws + Number(own === against), losses: team.stats.losses + Number(own < against), goalsFor: team.stats.goalsFor + own, goalsAgainst: team.stats.goalsAgainst + against });
      transaction.set(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "undo_snapshots", storedGame.id), { id: storedGame.id, sequence: storedGame.sequence, game: storedGame, teamAStats: teamA.stats, teamBStats: teamB.stats, queue: storedBaba.queue, createdAtMs: timestamp, schemaVersion: 3 });
      transaction.update(gameRef, { status: "finished", timerStartedAtMs: null, finishedAtMs: timestamp, updatedAtMs: timestamp });
      transaction.update(teamARef, { stats: updateStats(teamA, storedGame.scoreA, storedGame.scoreB), updatedAtMs: timestamp });
      transaction.update(teamBRef, { stats: updateStats(teamB, storedGame.scoreB, storedGame.scoreA), updatedAtMs: timestamp });
      const babaUpdate = rotation.kind === "ready"
        ? { currentGameId: null, status: "playing", pendingTieBreak: null, queue: [...rotation.court, ...rotation.queue], updatedAtMs: timestamp }
        : { currentGameId: null, status: "tie_break_pending", pendingTieBreak: rotation.kind === "random_required" ? { kind: "random", teamAId: rotation.tiedTeams[0], teamBId: rotation.tiedTeams[1] } : { kind: "manual_odd_even", teamAId: rotation.tiedTeams[0], teamBId: rotation.tiedTeams[1], incomingTeamId: rotation.incomingTeamId }, updatedAtMs: timestamp };
      transaction.update(babaRef, babaUpdate);
    });
  }), [owner, saving, activeBaba, currentGame]);

  const resolveTieBreak = useCallback((winnerId?: string) => saving(async () => {
    const uid = owner();
    if (!activeBaba?.pendingTieBreak) throw new Error("Não há desempate pendente.");
    const pending = activeBaba.pendingTieBreak;
    const rotation = pending.kind === "random"
      ? resolveRandomDraw(pending.teamAId, pending.teamBId, () => {
          const value = new Uint32Array(1); crypto.getRandomValues(value); return value[0] / 0x1_0000_0000;
        })
      : resolveManualDraw(winnerId || "", pending.teamAId, pending.teamBId, pending.incomingTeamId || "");
    if (rotation.kind !== "ready") throw new Error("Não foi possível concluir o desempate.");
    await updateDoc(doc(db, "baba_accounts", uid, "babas", activeBaba.id), {
      status: "playing",
      pendingTieBreak: null,
      queue: [...rotation.court, ...rotation.queue],
      updatedAtMs: now(),
    });
  }), [owner, saving, activeBaba]);

  const undoLastGame = useCallback(() => saving(async () => {
    const uid = owner(); if (!activeBaba) throw new Error("Nenhum baba em andamento.");
    if (currentGame && currentGame.status !== "finished") throw new Error("Há uma partida preparada ou em andamento.");
    const last = [...games].reverse().find((game) => game.status === "finished"); if (!last) throw new Error("Nenhum jogo finalizado para desfazer.");
    const snapshotRef = doc(db, "baba_accounts", uid, "babas", activeBaba.id, "undo_snapshots", last.id); const gameRef = doc(db, "baba_accounts", uid, "babas", activeBaba.id, "games", last.id); const babaRef = doc(db, "baba_accounts", uid, "babas", activeBaba.id);
    await runTransaction(db, async (transaction) => {
      const [snapshot, gameSnapshot] = await Promise.all([transaction.get(snapshotRef), transaction.get(gameRef)]); const data = snapshot.data();
      if (!snapshot.exists() || !gameSnapshot.exists() || !data?.game) throw new Error("Snapshot de desfazer não encontrado.");
      const stored = mapGame(gameSnapshot.id, gameSnapshot.data()); if (stored.status !== "finished") throw new Error("Este jogo já foi desfeito.");
      const teamARef = doc(db, "baba_accounts", uid, "babas", activeBaba.id, "teams", stored.teamAId); const teamBRef = doc(db, "baba_accounts", uid, "babas", activeBaba.id, "teams", stored.teamBId);
      transaction.update(teamARef, { stats: data.teamAStats, updatedAtMs: now() }); transaction.update(teamBRef, { stats: data.teamBStats, updatedAtMs: now() });
      transaction.set(gameRef, { ...data.game, status: "prepared", timerStartedAtMs: null, finishedAtMs: null, updatedAtMs: now() });
      transaction.update(babaRef, { currentGameId: stored.id, status: "playing", pendingTieBreak: null, queue: data.queue, updatedAtMs: now() });
    });
  }), [owner, saving, activeBaba, currentGame, games]);

  const finishBaba = useCallback(() => saving(async () => {
    const uid = owner(); if (!activeBaba) throw new Error("Nenhum baba em andamento.");
    if (currentGame && currentGame.status !== "finished") throw new Error("Finalize a partida em andamento antes de encerrar o baba.");
    if (activeBaba.pendingTieBreak) throw new Error("Resolva o desempate pendente antes de finalizar.");
    if (activeBaba.matchMode === "manual" && teams.some((team) => !manualResults.some((result) => result.teamId === team.id))) {
      throw new Error("Informe os totais de todos os times antes de finalizar.");
    }

    const timestamp = now(); const champions = championIds(teams); const nameMap = new Map(players.map((player) => [player.id, player.name])); const typeMap = new Map(players.map((player) => [player.id, player.type]));
    const currentRows = (activeBaba.matchMode === "manual"
      ? buildManualRanking(manualResults, teams, nameMap, typeMap)
      : buildRanking(games, teams, nameMap, typeMap))
      .filter((row) => {
        const status = players.find((player) => player.id === row.playerId)?.status;
        return status !== "convidado" && status !== "desativado";
      })
      .map((row) => ({
        ...row,
        babas: 1,
        titles: teams.some((team) => champions.includes(team.id) && team.playerIds.includes(row.playerId)) ? 1 : 0,
      }));
    const period = activeBaba.dateKey.slice(0, 7);

    await runTransaction(db, async (transaction) => {
      const eventRefs = currentRows.map((row) => doc(db, "baba_accounts", uid, "babas", activeBaba.id, "player_stats", row.playerId));
      const generalRefs = currentRows.map((row) => doc(db, "baba_accounts", uid, "player_stats", row.playerId));
      const monthRefs = currentRows.map((row) => doc(db, "baba_accounts", uid, "months", period, "rankings", row.playerId));
      const [eventSnapshots, generalSnapshots, monthSnapshots] = await Promise.all([
        Promise.all(eventRefs.map((ref) => transaction.get(ref))),
        Promise.all(generalRefs.map((ref) => transaction.get(ref))),
        Promise.all(monthRefs.map((ref) => transaction.get(ref))),
      ]);
      const numericFields = ["games", "wins", "draws", "losses", "goals", "babas", "titles", "mvps", "yellowCards", "redCards", "goalsAgainst", "cleanGames"] as const;
      currentRows.forEach((row, index) => {
        const previous = eventSnapshots[index].data() || {};
        const contribution = { ...row, updatedAtMs: timestamp, sourceBabaId: activeBaba.id, schemaVersion: 3 };
        const mergeAggregate = (aggregate: DocumentData | undefined) => {
          const next: Record<string, unknown> = { playerId: row.playerId, name: row.name, playerType: row.playerType || "linha", updatedAtMs: timestamp, schemaVersion: 3 };
          numericFields.forEach((field) => { next[field] = Number(aggregate?.[field] || 0) + Number(row[field] || 0) - Number(previous[field] || 0); });
          return next;
        };
        transaction.set(eventRefs[index], contribution);
        transaction.set(generalRefs[index], mergeAggregate(generalSnapshots[index].data()), { merge: true });
        transaction.set(monthRefs[index], { ...mergeAggregate(monthSnapshots[index].data()), monthKey: period }, { merge: true });
      });
      transaction.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id), { status: "finished", championTeamIds: champions, currentGameId: null, finishedAtMs: timestamp, updatedAtMs: timestamp });
      transaction.set(doc(db, "baba_accounts", uid, "meta", "live"), { activeBabaId: null, status: "finished", updatedAtMs: timestamp }, { merge: true });
    });
  }), [owner, saving, activeBaba, currentGame, teams, manualResults, players, games]);

  const resetActiveBaba = useCallback(() => saving(async () => {
    const uid = owner(); if (!activeBaba) return; const timestamp = now(); const batch = writeBatch(db); batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id), { status: "finished", deleted: true, deletedAtMs: timestamp, finishedAtMs: timestamp, updatedAtMs: timestamp }); batch.set(doc(db, "baba_accounts", uid, "meta", "live"), { activeBabaId: null, status: "none", updatedAtMs: timestamp }, { merge: true }); await batch.commit();
  }), [owner, saving, activeBaba]);

  const generateViewerCode = useCallback(() => saving(async () => {
    owner();
    const token = await auth.organizerToken();
    const response = await fetch("/api/access/code", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({})) as { code?: string; error?: string };
    if (!response.ok || !data.code) throw new Error(data.error || "Não foi possível gerar o código.");
    return data.code;
  }), [owner, saving, auth]);

  const getViewerCode = useCallback(async () => {
    owner();
    const token = await auth.organizerToken();
    const response = await fetch("/api/access/code", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await response.json().catch(() => ({})) as { code?: string | null; error?: string };
    if (!response.ok) throw new Error(data.error || "Não foi possível consultar o código.");
    return data.code || null;
  }, [owner, auth]);

  const revokeViewerCode = useCallback(() => saving(async () => {
    owner();
    const token = await auth.organizerToken();
    const response = await fetch("/api/access/code", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(data.error || "Não foi possível revogar o código.");
  }), [owner, saving, auth]);

  const value = useMemo<BabaValue>(() => ({ loading, syncStatus, syncError, retryConnection, players, teams, games, babas, activeBaba, payments, manualResults, addPlayer, updatePlayer, togglePresence, togglePayment, createBaba, setMatchMode, draw, drawLateArrivals, createEmptyTeams, movePlayer, saveManualResult, prepareGame, startOrPauseGame, addGoal, undoGoal, finishGame, resolveTieBreak, undoLastGame, finishBaba, generateViewerCode, getViewerCode, revokeViewerCode, resetActiveBaba }), [loading, syncStatus, syncError, retryConnection, players, teams, games, babas, activeBaba, payments, manualResults, addPlayer, updatePlayer, togglePresence, togglePayment, createBaba, setMatchMode, draw, drawLateArrivals, createEmptyTeams, movePlayer, saveManualResult, prepareGame, startOrPauseGame, addGoal, undoGoal, finishGame, resolveTieBreak, undoLastGame, finishBaba, generateViewerCode, getViewerCode, revokeViewerCode, resetActiveBaba]);
  return <BabaContext.Provider value={value}>{children}</BabaContext.Provider>;
}

export function useBaba() { const value = useContext(BabaContext); if (!value) throw new Error("useBaba precisa de BabaProvider"); return value; }
