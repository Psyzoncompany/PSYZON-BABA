import { NextResponse } from "next/server";
import { type DocumentData } from "firebase-admin/firestore";
import { z } from "zod";
import { requireRequestIdentity } from "@/lib/auth/request-auth";
import { buildManualRanking, buildRanking, sortGoalkeepers, sortRanking, type RankingCriterion } from "@/lib/domain/competition";
import { sortBestRanking } from "@/lib/domain/stars";
import type { Game, ManualTeamResult, Player, RankingRow, Team } from "@/lib/domain/types";
import { getAdminDb } from "@/lib/firebase/admin";
import { createRankingPdf } from "@/lib/pdf/reports";

export const runtime = "nodejs";

const schema = z.object({
  scope: z.enum(["month", "general", "day", "goalkeeper", "history"]),
  criterion: z.enum(["best", "goals", "wins", "losses", "worst", "titles", "efficiency"]),
  historyMonth: z.string().regex(/^\d{4}-\d{2}$/),
});
const labels = { month: "Ranking do mês", general: "Ranking geral", day: "Ranking do dia", goalkeeper: "Ranking de goleiros", history: "Histórico mensal" } as const;

function rankingRow(id: string, data: DocumentData): RankingRow {
  const games = Number(data.games || 0); const wins = Number(data.wins || 0); const draws = Number(data.draws || 0);
  return {
    playerId: id, name: String(data.name || "Jogador"), playerType: data.playerType === "goleiro" ? "goleiro" : "linha",
    games, wins, draws, losses: Number(data.losses || 0), goals: Number(data.goals || 0), points: wins * 3 + draws,
    efficiency: games ? Math.round(((wins * 3 + draws) / (games * 3)) * 1_000) / 10 : 0,
    babas: Number(data.babas || 0), titles: Number(data.titles || 0), mvps: Number(data.mvps || 0), yellowCards: Number(data.yellowCards || 0), redCards: Number(data.redCards || 0), goalsAgainst: Number(data.goalsAgainst || 0), cleanGames: Number(data.cleanGames || 0),
  };
}

function player(id: string, data: DocumentData): Player {
  const status = ["regular", "novato", "convidado", "desativado"].includes(String(data.status)) ? data.status : "regular";
  return { id, name: String(data.name || "Jogador"), type: data.type === "goleiro" ? "goleiro" : "linha", status, active: data.active !== false, present: Boolean(data.present), paid: Boolean(data.paid), createdAtMs: Number(data.createdAtMs || 0), updatedAtMs: Number(data.updatedAtMs || 0) } as Player;
}

function team(id: string, data: DocumentData): Team {
  const stats = data.stats || {};
  return { id, name: String(data.name || "Time"), color: String(data.color || "#1867d2"), order: Number(data.order || 1), playerIds: Array.isArray(data.playerIds) ? data.playerIds.map(String) : [], drawBatch: Number(data.drawBatch || 1), lateArrival: Boolean(data.lateArrival), active: data.active !== false, stats: { wins: Number(stats.wins || 0), draws: Number(stats.draws || 0), losses: Number(stats.losses || 0), goalsFor: Number(stats.goalsFor || 0), goalsAgainst: Number(stats.goalsAgainst || 0) }, updatedAtMs: Number(data.updatedAtMs || 0) };
}

function game(id: string, data: DocumentData): Game {
  return { id, sequence: Number(data.sequence || 1), teamAId: String(data.teamAId || ""), teamBId: String(data.teamBId || ""), teamAName: String(data.teamAName || "Time A"), teamBName: String(data.teamBName || "Time B"), rosterA: Array.isArray(data.rosterA) ? data.rosterA.map(String) : [], rosterB: Array.isArray(data.rosterB) ? data.rosterB.map(String) : [], scoreA: Number(data.scoreA || 0), scoreB: Number(data.scoreB || 0), status: data.status === "finished" ? "finished" : data.status === "running" ? "running" : data.status === "paused" ? "paused" : "prepared", durationSeconds: Number(data.durationSeconds || 480), timerStartedAtMs: data.timerStartedAtMs ?? null, timerRemainingSeconds: Number(data.timerRemainingSeconds ?? 480), goalEvents: Array.isArray(data.goalEvents) ? data.goalEvents : [], createdAtMs: Number(data.createdAtMs || 0), finishedAtMs: Number(data.finishedAtMs || 0) || null, updatedAtMs: Number(data.updatedAtMs || 0) };
}

async function dayRanking(accountId: string) {
  const account = getAdminDb().collection("baba_accounts").doc(accountId);
  const live = await account.collection("meta").doc("live").get(); const babaId = String(live.data()?.activeBabaId || "");
  if (!babaId) return [] as RankingRow[];
  const babaRef = account.collection("babas").doc(babaId);
  const [baba, playersSnapshot, teamsSnapshot, gamesSnapshot, manualSnapshot] = await Promise.all([babaRef.get(), account.collection("players").get(), babaRef.collection("teams").get(), babaRef.collection("games").get(), babaRef.collection("manual_results").get()]);
  if (!baba.exists || baba.data()?.deletedAtMs) return [];
  const players = playersSnapshot.docs.map((item) => player(item.id, item.data())); const teams = teamsSnapshot.docs.map((item) => team(item.id, item.data())).filter((item) => item.active);
  const names = new Map(players.map((item) => [item.id, item.name])); const types = new Map(players.map((item) => [item.id, item.type]));
  if (baba.data()?.matchMode === "manual") {
    const results = manualSnapshot.docs.map((item) => ({ teamId: item.id, wins: Number(item.data().wins || 0), draws: Number(item.data().draws || 0), losses: Number(item.data().losses || 0), goalsByPlayer: item.data().goalsByPlayer || {}, updatedAtMs: Number(item.data().updatedAtMs || 0) } as ManualTeamResult));
    return buildManualRanking(results, teams, names, types);
  }
  return buildRanking(gamesSnapshot.docs.map((item) => game(item.id, item.data())), teams, names, types);
}

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 8_192) return NextResponse.json({ error: "Solicitação muito grande." }, { status: 413 });
  try {
    const identity = await requireRequestIdentity(request);
    const raw = await request.text(); if (Buffer.byteLength(raw) > 8_192) return NextResponse.json({ error: "Solicitação muito grande." }, { status: 413 });
    const parsed = schema.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
    if (!parsed.success) return NextResponse.json({ error: "Seleção de ranking inválida." }, { status: 400 });
    const account = getAdminDb().collection("baba_accounts").doc(identity.accountId);
    const [finished, playersSnapshot] = await Promise.all([account.collection("babas").where("status", "==", "finished").get(), account.collection("players").get()]);
    const completedBabas = finished.docs.filter((item) => !item.data().deletedAtMs).length;
    let rows: RankingRow[];
    if (parsed.data.scope === "day") rows = await dayRanking(identity.accountId);
    else if (parsed.data.scope === "general" || parsed.data.scope === "goalkeeper") rows = (await account.collection("player_stats").get()).docs.map((item) => rankingRow(item.id, item.data()));
    else rows = (await account.collection("months").doc(parsed.data.historyMonth).collection("rankings").get()).docs.map((item) => rankingRow(item.id, item.data()));
    const excluded = new Set(playersSnapshot.docs.filter((item) => ["convidado", "desativado"].includes(String(item.data().status))).map((item) => item.id));
    rows = rows.filter((item) => parsed.data.scope === "day" || !excluded.has(item.playerId));
    if (parsed.data.scope === "goalkeeper") rows = sortGoalkeepers(rows);
    else if (parsed.data.criterion === "best") rows = sortBestRanking(rows, completedBabas);
    else rows = sortRanking(rows, parsed.data.criterion as RankingCriterion);
    const period = parsed.data.scope === "general" || parsed.data.scope === "goalkeeper" ? "Todos os babas salvos" : parsed.data.scope === "day" ? "Baba atual" : parsed.data.historyMonth;
    const pdf = await createRankingPdf({ title: labels[parsed.data.scope], period, criterion: parsed.data.criterion, rows, completedBabas });
    return new NextResponse(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="ranking-${parsed.data.scope}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (cause) {
    console.error("[pdf-ranking] Falha ao gerar relatório", cause);
    return NextResponse.json({ error: "Não foi possível gerar o PDF." }, { status: 401 });
  }
}
