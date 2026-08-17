import {
  collection,
  doc,
  getDocs,
  writeBatch,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "./client";
import { getTeamTheme } from "@/lib/domain/team-theme";

type WriteOperation = { ref: DocumentReference; data: Record<string, unknown> };

const stringArray = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];

function millis(value: unknown, fallback = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function dateKey(data: DocumentData) {
  const direct = String(data.dateKey || data.dataISO || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const year = Number(data.ano);
  const month = Number(data.mes);
  const day = Number(data.dia);
  if (year > 2000 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = typeof data.dataCompleta === "string" ? Date.parse(data.dataCompleta) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function championTeamIds(data: DocumentData) {
  if (Array.isArray(data.championTeamIds)) return stringArray(data.championTeamIds);
  const champion = data.campeaoDoBaba;
  if (!champion || typeof champion !== "object") return [];
  const id = champion.teamId || champion.timeId || champion.id;
  return typeof id === "string" && id ? [id] : [];
}

function safeColor(value: unknown, fallback: string) {
  const candidate = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}

async function commitOperations(operations: WriteOperation[]) {
  const batchSize = 400;
  for (let offset = 0; offset < operations.length; offset += batchSize) {
    const batch = writeBatch(db);
    operations.slice(offset, offset + batchSize).forEach((operation) => batch.set(operation.ref, operation.data, { merge: true }));
    await batch.commit();
  }
}

export async function importLegacyHistory(accountId: string) {
  const [legacyBabas, legacyPlayers, legacyStats] = await Promise.all([
    getDocs(collection(db, "babas")),
    getDocs(collection(db, "baba_players")),
    getDocs(collection(db, "player_stats")),
  ]);
  const finished = legacyBabas.docs.filter((snapshot) => {
    const data = snapshot.data();
    return !data.deleted && ["finalizado", "finished"].includes(String(data.status).toLowerCase());
  });

  const details = await Promise.all(finished.map(async (snapshot) => {
    const [teams, games, goals, participants] = await Promise.all([
      getDocs(collection(snapshot.ref, "teams")),
      getDocs(collection(snapshot.ref, "games")),
      getDocs(collection(snapshot.ref, "goals")),
      getDocs(collection(snapshot.ref, "participants")),
    ]);
    return { snapshot, teams, games, goals, participants };
  }));

  const operations: WriteOperation[] = [];
  legacyPlayers.docs.forEach((snapshot) => {
    const data = snapshot.data();
    const id = snapshot.id;
    const name = String(data.name || data.nome || "").trim().slice(0, 80);
    if (!id || !name) return;
    const type = data.type === "goleiro" || data.tipo === "goleiro" ? "goleiro" : "linha";
    const status = data.status === "novato" || data.novato ? "novato" : data.status === "convidado" ? "convidado" : "regular";
    operations.push({
      ref: doc(db, "baba_accounts", accountId, "players", id),
      data: { ...data, id, playerId: id, name, nome: name, type, tipo: type, status, active: data.active !== false && data.ativo !== false, ativo: data.active !== false && data.ativo !== false, schemaVersion: 3, legacySourceId: snapshot.id, createdAtMs: millis(data.createdAtMs || data.criadoEm), updatedAtMs: Date.now() },
    });
  });

  legacyStats.docs.forEach((snapshot) => {
    const data = snapshot.data();
    const playerId = String(data.playerId || data.jogadorId || snapshot.id);
    operations.push({ ref: doc(db, "baba_accounts", accountId, "player_stats", playerId), data: { ...data, playerId, schemaVersion: 3, legacySourceId: snapshot.id, updatedAtMs: Date.now() } });
  });

  for (const detail of details) {
    const source = detail.snapshot.data();
    const babaId = detail.snapshot.id;
    const targetBaba = doc(db, "baba_accounts", accountId, "babas", babaId);
    operations.push({
      ref: targetBaba,
      data: { ...source, id: babaId, dateKey: dateKey(source), dataISO: dateKey(source), status: "finished", matchMode: "manual", currentGameId: null, queue: stringArray(source.queue || source.currentQueue || source.filaTimes), championTeamIds: championTeamIds(source), schemaVersion: 3, legacySourceId: detail.snapshot.id, createdAtMs: millis(source.createdAtMs || source.criadoEm), finishedAtMs: millis(source.finishedAtMs || source.finalizadoEm), updatedAtMs: Date.now() },
    });

    const rosterByTeam = new Map<string, string[]>();
    detail.participants.docs.forEach((snapshot) => {
      const participant = snapshot.data();
      const teamId = String(participant.teamId || "");
      const playerId = String(participant.playerId || snapshot.id);
      if (!teamId || !playerId || participant.deleted) return;
      const roster = rosterByTeam.get(teamId) || [];
      roster.push(playerId);
      rosterByTeam.set(teamId, roster);
    });

    detail.teams.docs.forEach((snapshot, index) => {
      const data = snapshot.data();
      if (data.deleted) return;
      const id = snapshot.id;
      const order = Number(data.order || index + 1);
      const theme = getTeamTheme(order);
      const playerIds = stringArray(data.playerIds || data.jogadores);
      operations.push({
        ref: doc(targetBaba, "teams", id),
        data: { ...data, id, name: String(data.name || data.nome || `Time ${order}`), color: safeColor(data.color, theme.color), order, playerIds: playerIds.length ? playerIds : rosterByTeam.get(id) || [], drawBatch: Number(data.drawBatch || 1), lateArrival: Boolean(data.lateArrival), active: data.active !== false && !data.deleted, schemaVersion: 3, legacySourceId: snapshot.id, updatedAtMs: Date.now() },
      });
    });

    const goalsByGame = new Map<string, Record<string, unknown>[]>();
    detail.goals.docs.forEach((snapshot) => {
      const data = snapshot.data();
      if (data.deleted) return;
      const gameId = String(data.gameId || "");
      if (!gameId) return;
      const goals = goalsByGame.get(gameId) || [];
      goals.push({ id: String(data.id || snapshot.id), playerId: data.playerId || data.jogadorId || null, playerNameSnapshot: String(data.playerNameSnapshot || data.jogadorNome || "Sem artilheiro"), teamId: String(data.teamId || data.time || ""), minute: Number(data.minute || data.minuto || 0), createdAtMs: millis(data.createdAtMs || data.registradoEm) });
      goalsByGame.set(gameId, goals);
    });

    detail.games.docs.forEach((snapshot, index) => {
      const data = snapshot.data();
      if (data.deleted) return;
      const id = snapshot.id;
      operations.push({
        ref: doc(targetBaba, "games", id),
        data: { ...data, id, sequence: Number(data.sequence || data.numeroJogo || index + 1), teamAId: String(data.teamAId || data.timeA || ""), teamBId: String(data.teamBId || data.timeB || ""), teamAName: String(data.teamAName || data.timeANome || "Time A"), teamBName: String(data.teamBName || data.timeBNome || "Time B"), rosterA: stringArray(data.rosterA || data.jogadoresTimeA), rosterB: stringArray(data.rosterB || data.jogadoresTimeB), scoreA: Number(data.scoreA ?? data.placarA ?? 0), scoreB: Number(data.scoreB ?? data.placarB ?? 0), status: "finished", durationSeconds: Number(data.durationSeconds || 480), timerStartedAtMs: null, timerRemainingSeconds: 0, goalEvents: goalsByGame.get(id) || [], schemaVersion: 3, legacySourceId: snapshot.id, createdAtMs: millis(data.createdAtMs || data.dataHora), finishedAtMs: millis(data.finishedAtMs || data.finalizadoEm), updatedAtMs: Date.now() },
      });
    });
  }

  await commitOperations(operations);
  return { babas: finished.length, players: legacyPlayers.size, games: details.reduce((total, detail) => total + detail.games.size, 0) };
}
