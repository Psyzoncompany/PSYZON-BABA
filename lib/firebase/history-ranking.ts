import "server-only";

import type { DocumentData, DocumentReference, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { aggregateRankingRows, buildManualRanking, buildRanking } from "@/lib/domain/competition";
import type { Game, ManualTeamResult, PlayerType, RankingRow, Team } from "@/lib/domain/types";
import { getAdminDb } from "@/lib/firebase/admin";

function rowFromDocument(id: string, data: DocumentData): RankingRow {
  const games = Number(data.games || 0); const wins = Number(data.wins || 0); const draws = Number(data.draws || 0);
  return {
    playerId: id,
    name: String(data.name || "Jogador"),
    playerType: data.playerType === "goleiro" ? "goleiro" : "linha",
    games,
    wins,
    draws,
    losses: Number(data.losses || 0),
    goals: Number(data.goals || 0),
    points: wins * 3 + draws,
    efficiency: games ? Math.round(((wins * 3 + draws) / (games * 3)) * 1_000) / 10 : 0,
    babas: Math.max(1, Number(data.babas || 0)),
    titles: Number(data.titles || 0),
    mvps: Number(data.mvps || 0),
    yellowCards: Number(data.yellowCards || 0),
    redCards: Number(data.redCards || 0),
    goalsAgainst: Number(data.goalsAgainst || 0),
    cleanGames: Number(data.cleanGames || 0),
  };
}

function teamFromDocument(id: string, data: DocumentData): Team {
  const stats = data.stats || data;
  return {
    id, name: String(data.name || data.nome || "Time"), color: String(data.color || "#1769dc"), order: Number(data.order || 1),
    playerIds: Array.isArray(data.playerIds) ? data.playerIds.map(String) : Array.isArray(data.jogadores) ? data.jogadores.map(String) : [],
    drawBatch: Number(data.drawBatch || 1), lateArrival: Boolean(data.lateArrival), active: data.active !== false && !data.deleted,
    stats: { wins: Number(stats.wins ?? stats.vitorias ?? 0), draws: Number(stats.draws ?? stats.empates ?? 0), losses: Number(stats.losses ?? stats.derrotas ?? 0), goalsFor: Number(stats.goalsFor ?? stats.golsPro ?? 0), goalsAgainst: Number(stats.goalsAgainst ?? stats.golsContra ?? 0) },
    updatedAtMs: Number(data.updatedAtMs || 0),
  };
}

function gameFromDocument(id: string, data: DocumentData): Game {
  return {
    id, sequence: Number(data.sequence || data.numeroJogo || 1), teamAId: String(data.teamAId || data.timeA || ""), teamBId: String(data.teamBId || data.timeB || ""),
    teamAName: String(data.teamAName || data.timeANome || "Time A"), teamBName: String(data.teamBName || data.timeBNome || "Time B"),
    rosterA: Array.isArray(data.rosterA) ? data.rosterA.map(String) : Array.isArray(data.jogadoresTimeA) ? data.jogadoresTimeA.map(String) : [],
    rosterB: Array.isArray(data.rosterB) ? data.rosterB.map(String) : Array.isArray(data.jogadoresTimeB) ? data.jogadoresTimeB.map(String) : [],
    scoreA: Number(data.scoreA ?? data.placarA ?? 0), scoreB: Number(data.scoreB ?? data.placarB ?? 0), status: data.status === "finished" || data.status === "finalizado" ? "finished" : "prepared",
    durationSeconds: Number(data.durationSeconds || 480), timerStartedAtMs: null, timerRemainingSeconds: Number(data.timerRemainingSeconds || 0), goalEvents: Array.isArray(data.goalEvents) ? data.goalEvents : [],
    createdAtMs: Number(data.createdAtMs || 0), finishedAtMs: Number(data.finishedAtMs || 0) || null, updatedAtMs: Number(data.updatedAtMs || 0),
  };
}

async function calculateBabaRows(
  baba: QueryDocumentSnapshot,
  names: ReadonlyMap<string, string>,
  types: ReadonlyMap<string, PlayerType>,
): Promise<RankingRow[]> {
  const reference = baba.ref as DocumentReference;
  const contribution = await reference.collection("player_stats").get();
  if (!contribution.empty) return contribution.docs.map((item) => rowFromDocument(item.id, item.data()));

  const [teamsSnapshot, gamesSnapshot, manualSnapshot] = await Promise.all([
    reference.collection("teams").get(), reference.collection("games").get(), reference.collection("manual_results").get(),
  ]);
  const teams = teamsSnapshot.docs.map((item) => teamFromDocument(item.id, item.data())).filter((item) => item.active);
  const rows = baba.data().matchMode === "manual"
    ? buildManualRanking(manualSnapshot.docs.map((item) => ({ teamId: item.id, wins: Number(item.data().wins || 0), draws: Number(item.data().draws || 0), losses: Number(item.data().losses || 0), goalsByPlayer: item.data().goalsByPlayer || {}, updatedAtMs: Number(item.data().updatedAtMs || 0) } as ManualTeamResult)), teams, names, types)
    : buildRanking(gamesSnapshot.docs.map((item) => gameFromDocument(item.id, item.data())), teams, names, types);
  const champions = Array.isArray(baba.data().championTeamIds) ? baba.data().championTeamIds.map(String) : [];
  return rows.map((row) => ({ ...row, babas: 1, titles: teams.some((team) => champions.includes(team.id) && team.playerIds.includes(row.playerId)) ? 1 : 0 }));
}

export async function loadHistoricalRankings(accountId: string, month?: string) {
  const account = getAdminDb().collection("baba_accounts").doc(accountId);
  const [playersSnapshot, babasSnapshot] = await Promise.all([
    account.collection("players").get(),
    account.collection("babas").where("status", "==", "finished").get(),
  ]);
  const names = new Map(playersSnapshot.docs.map((item) => [item.id, String(item.data().name || "Jogador")]));
  const types = new Map(playersSnapshot.docs.map((item) => [item.id, item.data().type === "goleiro" ? "goleiro" as const : "linha" as const]));
  const excluded = new Set(playersSnapshot.docs.filter((item) => ["convidado", "desativado"].includes(String(item.data().status))).map((item) => item.id));
  const finished = babasSnapshot.docs.filter((item) => !item.data().deletedAtMs && !item.data().deleted);
  const selected = month ? finished.filter((item) => String(item.data().dateKey || item.data().dataISO || "").startsWith(`${month}-`)) : finished;
  const groups = await Promise.all(selected.map((item) => calculateBabaRows(item, names, types)));
  return {
    rows: aggregateRankingRows(groups)
      .filter((row) => !excluded.has(row.playerId))
      .map((row) => ({ ...row, name: names.get(row.playerId) || row.name, playerType: types.get(row.playerId) || row.playerType })),
    completedBabas: finished.length,
    selectedBabas: selected.length,
  };
}
