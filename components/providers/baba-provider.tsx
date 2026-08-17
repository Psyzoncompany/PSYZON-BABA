"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  collection, doc, getDoc, onSnapshot, runTransaction, setDoc, updateDoc, writeBatch,
  type DocumentData, type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { useAuth } from "./auth-provider";
import { championIds, nextRotation } from "@/lib/domain/competition";
import { drawTeams } from "@/lib/domain/draw";
import type { Baba, Game, MatchMode, Player, Team } from "@/lib/domain/types";

export type SyncStatus = "connecting" | "saving" | "online" | "offline" | "pending";

interface BabaValue {
  loading: boolean; syncStatus: SyncStatus; players: Player[]; teams: Team[]; games: Game[]; babas: Baba[]; activeBaba: Baba | null;
  addPlayer(name: string, type: Player["type"]): Promise<void>;
  updatePlayer(id: string, patch: Partial<Player>): Promise<void>;
  togglePresence(id: string): Promise<void>; togglePayment(id: string): Promise<void>;
  createBaba(dateKey: string): Promise<void>; setMode(mode: MatchMode): Promise<void>; draw(): Promise<void>;
  prepareGame(teamAId?: string, teamBId?: string): Promise<void>; startOrPauseGame(): Promise<void>;
  addGoal(teamId: string, playerId: string | null): Promise<void>; undoGoal(): Promise<void>; finishGame(): Promise<void>;
  finishBaba(): Promise<void>; generateViewerCode(): Promise<string>; resetActiveBaba(): Promise<void>;
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
  return {
    id, dateKey: String(data.dateKey || data.dataISO || new Date().toISOString().slice(0, 10)), status: data.status || "open",
    matchMode: data.matchMode === "manual" ? "manual" : "online", currentGameId: data.currentGameId || null,
    queue: Array.isArray(data.queue) ? data.queue : Array.isArray(data.currentQueue) ? data.currentQueue : [],
    drawBatchCount: Number(data.drawBatchCount || 0), championTeamIds: Array.isArray(data.championTeamIds) ? data.championTeamIds : [],
    createdAtMs: Number(data.createdAtMs || data.criadoEm || 0), finishedAtMs: Number(data.finishedAtMs || data.finalizadoEm || 0) || null, updatedAtMs: Number(data.updatedAtMs || 0),
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

export function BabaProvider({ children }: { children: React.ReactNode }) {
  const { accountId, role } = useAuth();
  const [players, setPlayers] = useState<Player[]>([]); const [teams, setTeams] = useState<Team[]>([]); const [games, setGames] = useState<Game[]>([]); const [babas, setBabas] = useState<Baba[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting");
  const activeBaba = useMemo(() => babas.find((item) => item.id === activeId) || babas.find((item) => item.status !== "finished") || null, [babas, activeId]);

  useEffect(() => {
    const online = () => setSyncStatus("online"); const offline = () => setSyncStatus("offline");
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    if (!navigator.onLine) offline();
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, []);

  useEffect(() => {
    // Reset tenant-scoped state before attaching listeners for the next account.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlayers([]); setTeams([]); setGames([]); setBabas([]); setActiveId(null);
    if (!accountId) { setLoading(false); return; }
    setLoading(true); setSyncStatus(navigator.onLine ? "connecting" : "offline");
    const unsubs: Unsubscribe[] = [];
    unsubs.push(onSnapshot(collection(db, "baba_accounts", accountId, "players"), { includeMetadataChanges: true }, (snapshot) => {
      setPlayers(snapshot.docs.map((item) => mapPlayer(item.id, item.data())).filter((item) => item.active));
      setSyncStatus(snapshot.metadata.hasPendingWrites ? "pending" : navigator.onLine ? "online" : "offline"); setLoading(false);
    }));
    unsubs.push(onSnapshot(collection(db, "baba_accounts", accountId, "babas"), (snapshot) => {
      const items = snapshot.docs.map((item) => mapBaba(item.id, item.data())).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      setBabas(items); setActiveId((current) => current || items.find((item) => item.status !== "finished")?.id || null);
    }));
    unsubs.push(onSnapshot(doc(db, "baba_accounts", accountId, "meta", "live"), (snapshot) => {
      if (snapshot.exists()) setActiveId(snapshot.data().activeBabaId || null);
    }));
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [accountId]);

  useEffect(() => {
    // Avoid rendering the previous baba while the new realtime listeners connect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTeams([]); setGames([]);
    if (!accountId || !activeBaba?.id) return;
    const unsubTeams = onSnapshot(collection(db, "baba_accounts", accountId, "babas", activeBaba.id, "teams"), (snapshot) => setTeams(snapshot.docs.map((item) => mapTeam(item.id, item.data())).filter((item) => item.active).sort((a, b) => a.order - b.order)));
    const unsubGames = onSnapshot(collection(db, "baba_accounts", accountId, "babas", activeBaba.id, "games"), (snapshot) => setGames(snapshot.docs.map((item) => mapGame(item.id, item.data())).sort((a, b) => a.sequence - b.sequence)));
    return () => { unsubTeams(); unsubGames(); };
  }, [accountId, activeBaba?.id]);

  const owner = useCallback(() => { if (!accountId || role !== "organizer") throw new Error("Apenas o organizador pode alterar dados."); return accountId; }, [accountId, role]);
  const saving = useCallback(async <T,>(operation: () => Promise<T>) => { setSyncStatus("saving"); try { return await operation(); } finally { setSyncStatus(navigator.onLine ? "online" : "pending"); } }, []);

  const addPlayer = useCallback((name: string, type: Player["type"]) => saving(async () => {
    const uid = owner(); const id = crypto.randomUUID(); const timestamp = now();
    await setDoc(doc(db, "baba_accounts", uid, "players", id), { id, playerId: id, name: name.trim(), nome: name.trim(), type, tipo: type, status: "regular", active: true, ativo: true, present: false, paid: false, schemaVersion: 3, createdAtMs: timestamp, updatedAtMs: timestamp });
  }), [owner, saving]);

  const updatePlayer = useCallback((id: string, patch: Partial<Player>) => saving(async () => {
    const uid = owner(); const normalized: Record<string, unknown> = { ...patch, updatedAtMs: now() };
    if (patch.name) normalized.nome = patch.name; if (patch.type) normalized.tipo = patch.type; if (patch.active !== undefined) normalized.ativo = patch.active;
    await updateDoc(doc(db, "baba_accounts", uid, "players", id), normalized);
  }), [owner, saving]);
  const togglePresence = useCallback(async (id: string) => { const player = players.find((item) => item.id === id); if (player) await updatePlayer(id, { present: !player.present }); }, [players, updatePlayer]);
  const togglePayment = useCallback(async (id: string) => { const player = players.find((item) => item.id === id); if (player) await updatePlayer(id, { paid: !player.paid }); }, [players, updatePlayer]);

  const createBaba = useCallback((dateKey: string) => saving(async () => {
    const uid = owner(); const id = crypto.randomUUID(); const timestamp = now(); const batch = writeBatch(db);
    batch.set(doc(db, "baba_accounts", uid, "babas", id), { id, dateKey, dataISO: dateKey, status: "open", matchMode: "online", currentGameId: null, queue: [], drawBatchCount: 0, championTeamIds: [], schemaVersion: 3, createdAtMs: timestamp, updatedAtMs: timestamp });
    batch.set(doc(db, "baba_accounts", uid, "meta", "live"), { activeBabaId: id, status: "open", schemaVersion: 3, updatedAtMs: timestamp }, { merge: true });
    await batch.commit(); setActiveId(id);
  }), [owner, saving]);

  const setMode = useCallback((mode: MatchMode) => saving(async () => {
    const uid = owner(); if (!activeBaba || teams.length) throw new Error("O modo fica bloqueado depois do sorteio.");
    await updateDoc(doc(db, "baba_accounts", uid, "babas", activeBaba.id), { matchMode: mode, updatedAtMs: now() });
  }), [owner, saving, activeBaba, teams.length]);

  const draw = useCallback(() => saving(async () => {
    const uid = owner(); if (!activeBaba) throw new Error("Inicie um baba primeiro.");
    const newTeams = drawTeams(players, { drawBatch: activeBaba.drawBatchCount + 1 }); const batch = writeBatch(db);
    newTeams.forEach((team) => batch.set(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "teams", team.id), team));
    batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id), { status: "drawn", queue: newTeams.map((team) => team.id), drawBatchCount: activeBaba.drawBatchCount + 1, updatedAtMs: now() });
    await batch.commit();
  }), [owner, saving, activeBaba, players]);

  const prepareGame = useCallback((teamAId?: string, teamBId?: string) => saving(async () => {
    const uid = owner(); if (!activeBaba) throw new Error("Nenhum baba em andamento.");
    const ids = [teamAId, teamBId].filter(Boolean) as string[]; const queue = ids.length === 2 ? ids : activeBaba.queue.length >= 2 ? activeBaba.queue : teams.map((team) => team.id);
    const teamA = teams.find((team) => team.id === queue[0]); const teamB = teams.find((team) => team.id === queue[1]); if (!teamA || !teamB) throw new Error("São necessários dois times.");
    const id = crypto.randomUUID(); const timestamp = now(); const game: Game = { id, sequence: games.length + 1, teamAId: teamA.id, teamBId: teamB.id, teamAName: teamA.name, teamBName: teamB.name, rosterA: [...teamA.playerIds], rosterB: [...teamB.playerIds], scoreA: 0, scoreB: 0, status: "prepared", durationSeconds: 480, timerStartedAtMs: null, timerRemainingSeconds: 480, goalEvents: [], createdAtMs: timestamp, finishedAtMs: null, updatedAtMs: timestamp };
    const batch = writeBatch(db); batch.set(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "games", id), game); batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id), { currentGameId: id, status: "playing", queue: [teamA.id, teamB.id, ...queue.filter((item) => item !== teamA.id && item !== teamB.id)], updatedAtMs: timestamp }); await batch.commit();
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
    await runTransaction(db, async (transaction) => { const ref = doc(db, "baba_accounts", uid, "babas", activeBaba.id, "games", currentGame.id); const snap = await transaction.get(ref); const game = mapGame(snap.id, snap.data() || {}); const event = { id: crypto.randomUUID(), playerId, playerNameSnapshot: player?.name || "Sem artilheiro", teamId, minute: Math.max(0, Math.floor((game.durationSeconds - game.timerRemainingSeconds) / 60)), createdAtMs: timestamp }; transaction.update(ref, { scoreA: game.scoreA + (teamId === game.teamAId ? 1 : 0), scoreB: game.scoreB + (teamId === game.teamBId ? 1 : 0), goalEvents: [...game.goalEvents, event], updatedAtMs: timestamp }); });
  }), [owner, saving, activeBaba, currentGame, players]);

  const undoGoal = useCallback(() => saving(async () => {
    const uid = owner(); if (!activeBaba || !currentGame?.goalEvents.length) throw new Error("Nenhum gol para desfazer."); const last = currentGame.goalEvents.at(-1)!;
    await updateDoc(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "games", currentGame.id), { scoreA: Math.max(0, currentGame.scoreA - (last.teamId === currentGame.teamAId ? 1 : 0)), scoreB: Math.max(0, currentGame.scoreB - (last.teamId === currentGame.teamBId ? 1 : 0)), goalEvents: currentGame.goalEvents.slice(0, -1), updatedAtMs: now() });
  }), [owner, saving, activeBaba, currentGame]);

  const finishGame = useCallback(() => saving(async () => {
    const uid = owner(); if (!activeBaba || !currentGame) throw new Error("Nenhuma partida ativa."); const teamA = teams.find((team) => team.id === currentGame.teamAId)!; const teamB = teams.find((team) => team.id === currentGame.teamBId)!; const rotation = nextRotation(teamA.id, teamB.id, activeBaba.queue, currentGame.scoreA, currentGame.scoreB); const timestamp = now(); const batch = writeBatch(db);
    const updateStats = (team: Team, own: number, against: number) => ({ ...team.stats, wins: team.stats.wins + (own > against ? 1 : 0), draws: team.stats.draws + (own === against ? 1 : 0), losses: team.stats.losses + (own < against ? 1 : 0), goalsFor: team.stats.goalsFor + own, goalsAgainst: team.stats.goalsAgainst + against });
    batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "games", currentGame.id), { status: "finished", timerStartedAtMs: null, finishedAtMs: timestamp, updatedAtMs: timestamp });
    batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "teams", teamA.id), { stats: updateStats(teamA, currentGame.scoreA, currentGame.scoreB), updatedAtMs: timestamp });
    batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id, "teams", teamB.id), { stats: updateStats(teamB, currentGame.scoreB, currentGame.scoreA), updatedAtMs: timestamp });
    batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id), { currentGameId: null, queue: [...rotation.court, ...rotation.queue], updatedAtMs: timestamp }); await batch.commit();
  }), [owner, saving, activeBaba, currentGame, teams]);

  const finishBaba = useCallback(() => saving(async () => {
    const uid = owner(); if (!activeBaba) throw new Error("Nenhum baba em andamento."); const timestamp = now(); const champions = championIds(teams);
    const batch = writeBatch(db); batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id), { status: "finished", championTeamIds: champions, currentGameId: null, finishedAtMs: timestamp, updatedAtMs: timestamp }); batch.set(doc(db, "baba_accounts", uid, "meta", "live"), { activeBabaId: null, status: "finished", updatedAtMs: timestamp }, { merge: true }); await batch.commit();
  }), [owner, saving, activeBaba, teams]);

  const resetActiveBaba = useCallback(() => saving(async () => {
    const uid = owner(); if (!activeBaba) return; const timestamp = now(); const batch = writeBatch(db); batch.update(doc(db, "baba_accounts", uid, "babas", activeBaba.id), { status: "finished", deleted: true, finishedAtMs: timestamp, updatedAtMs: timestamp }); batch.set(doc(db, "baba_accounts", uid, "meta", "live"), { activeBabaId: null, status: "none", updatedAtMs: timestamp }, { merge: true }); await batch.commit();
  }), [owner, saving, activeBaba]);

  const generateViewerCode = useCallback(() => saving(async () => {
    const uid = owner(); const bytes = new TextEncoder().encode(`${uid}:0`); const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)); const code = String(new DataView(digest.buffer).getUint32(0, false) % 10_000).padStart(4, "0"); const hashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)); const hash = [...new Uint8Array(hashBytes)].map((item) => item.toString(16).padStart(2, "0")).join(""); const timestamp = now(); const configRef = doc(db, "baba_access_config", uid); const previous = await getDoc(configRef); const previousHash = previous.data()?.currentCodeHash; const batch = writeBatch(db); if (previousHash && previousHash !== hash) batch.set(doc(db, "baba_access_codes", previousHash), { active: false, revokedAtMs: timestamp, updatedAtMs: timestamp }, { merge: true }); batch.set(configRef, { currentCodeHash: hash, active: true, expiresAtMs: 253402300799000, updatedAtMs: timestamp, updatedBy: uid, schemaVersion: 1 }, { merge: true }); batch.set(doc(db, "baba_access_codes", hash), { accountId: uid, active: true, expiresAtMs: 253402300799000, createdAtMs: timestamp, updatedAtMs: timestamp, schemaVersion: 1 }, { merge: true }); await batch.commit(); return code;
  }), [owner, saving]);

  const value = useMemo<BabaValue>(() => ({ loading, syncStatus, players, teams, games, babas, activeBaba, addPlayer, updatePlayer, togglePresence, togglePayment, createBaba, setMode, draw, prepareGame, startOrPauseGame, addGoal, undoGoal, finishGame, finishBaba, generateViewerCode, resetActiveBaba }), [loading, syncStatus, players, teams, games, babas, activeBaba, addPlayer, updatePlayer, togglePresence, togglePayment, createBaba, setMode, draw, prepareGame, startOrPauseGame, addGoal, undoGoal, finishGame, finishBaba, generateViewerCode, resetActiveBaba]);
  return <BabaContext.Provider value={value}>{children}</BabaContext.Provider>;
}

export function useBaba() { const value = useContext(BabaContext); if (!value) throw new Error("useBaba precisa de BabaProvider"); return value; }
