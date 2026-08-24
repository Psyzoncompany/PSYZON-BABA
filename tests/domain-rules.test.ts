import { describe, expect, it } from "vitest";
import { progressiveDelayMs } from "@/lib/auth/rate-limit";
import {
  buildManualRanking,
  buildRanking,
  aggregateRankingRows,
  nextRotation,
  previewTable,
  resolveManualDraw,
  resolveRandomDraw,
  sortGoalkeepers,
  sortRanking,
  teamFromManualResult,
} from "@/lib/domain/competition";
import { drawTeams } from "@/lib/domain/draw";
import { createMonthlyPayment, dueDateKey, monthKey } from "@/lib/domain/payments";
import { calculateStars, performanceScore, sortBestRanking } from "@/lib/domain/stars";
import type { Game, ManualTeamResult, Player, RankingRow, Team } from "@/lib/domain/types";

const player = (id: string, type: Player["type"] = "linha", status: Player["status"] = "regular"): Player => ({
  id, name: id, type, status, active: true, present: true, paid: false, createdAtMs: 0, updatedAtMs: 0,
});

const team = (id: string, playerIds: string[] = []): Team => ({
  id, name: id, color: "#000", order: 1, playerIds, drawBatch: 1, lateArrival: false, active: true,
  stats: { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 }, updatedAtMs: 0,
});

const ranking = (id: string, patch: Partial<RankingRow> = {}): RankingRow => ({
  playerId: id, name: id, games: 10, wins: 0, draws: 0, losses: 0, goals: 0, points: 0, efficiency: 0, ...patch,
});

describe("proteção contra força bruta", () => {
  it("aplica atraso progressivo depois de quatro falhas e limita em 30 segundos", () => {
    expect([1, 2, 3, 4].map(progressiveDelayMs)).toEqual([0, 0, 0, 0]);
    expect(progressiveDelayMs(5)).toBe(500);
    expect(progressiveDelayMs(6)).toBe(1_000);
    expect(progressiveDelayMs(99)).toBe(30_000);
  });
});

describe("sorteio por lote", () => {
  it("é determinístico com RNG, relógio e ids injetados", () => {
    const players = Array.from({ length: 8 }, (_, index) => player(`L${index}`));
    const options = { random: () => 0.25, nowMs: 123, idFactory: (_kind: "team" | "visitor", order: number) => `T${order}` };
    expect(drawTeams(players, options)).toEqual(drawTeams(players, options));
  });

  it("cria novo lote sequencial para quem chegou depois sem duplicar", () => {
    const late = [player("L9"), player("L10"), player("G3", "goleiro")];
    const teams = drawTeams(late, { lateArrival: true, drawBatch: 2, startOrder: 4, random: () => 0.4, idFactory: (_, order) => `T${order}` });
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ order: 4, drawBatch: 2, lateArrival: true });
    expect(new Set(teams.flatMap((item) => item.playerIds)).size).toBe(3);
  });
});

describe("desempates de rodízio", () => {
  it("não escolhe silenciosamente o vencedor no empate de três times", () => {
    expect(nextRotation("a", "b", ["a", "b", "c"], 2, 2)).toEqual({ kind: "manual_required", tiedTeams: ["a", "b"], incomingTeamId: "c" });
    expect(resolveManualDraw("b", "a", "b", "c")).toEqual({ kind: "ready", court: ["b", "c"], queue: ["a"] });
  });

  it("resolve empate de dois times com RNG injetado", () => {
    expect(resolveRandomDraw("a", "b", () => 0.2)).toEqual({ kind: "ready", court: ["a", "b"], queue: [] });
    expect(resolveRandomDraw("a", "b", () => 0.8)).toEqual({ kind: "ready", court: ["b", "a"], queue: [] });
  });
});

describe("ranking e correções", () => {
  const game: Game = {
    id: "g1", sequence: 1, teamAId: "a", teamBId: "b", teamAName: "A", teamBName: "B",
    rosterA: ["p1", "g1"], rosterB: ["p2"], scoreA: 2, scoreB: 1, status: "finished", durationSeconds: 480,
    timerStartedAtMs: null, timerRemainingSeconds: 0,
    goalEvents: [
      { id: "e1", playerId: "p1", playerNameSnapshot: "P1", teamId: "a", minute: 1, createdAtMs: 1 },
      { id: "e2", playerId: null, playerNameSnapshot: "Sem artilheiro", teamId: "a", minute: 2, createdAtMs: 2 },
      { id: "e3", playerId: "p2", playerNameSnapshot: "P2", teamId: "b", minute: 3, createdAtMs: 3 },
    ],
    createdAtMs: 0, finishedAtMs: 10, updatedAtMs: 10,
  };

  it("preserva o elenco congelado e aceita gol sem artilheiro", () => {
    const rows = buildRanking([game], [team("a", ["outro"])], new Map([["p1", "P1"], ["p2", "P2"], ["g1", "G1"]]), new Map([["g1", "goleiro"]]));
    expect(rows.find((row) => row.playerId === "p1")).toMatchObject({ games: 1, wins: 1, goals: 1 });
    expect(rows.reduce((sum, row) => sum + row.goals, 0)).toBe(2);
    expect(rows.find((row) => row.playerId === "g1")?.goalsAgainst).toBe(1);
  });

  it("mostra prévia da tabela sem mutar estatísticas persistidas", () => {
    const teams = [team("a"), team("b")];
    const before = structuredClone(teams);
    const preview = previewTable(teams, { ...game, status: "running" });
    expect(preview.find((item) => item.id === "a")?.stats).toMatchObject({ wins: 1, goalsFor: 2, goalsAgainst: 1 });
    expect(teams).toEqual(before);
  });

  it("recalcula de forma idempotente depois de uma correção", () => {
    const corrected = { ...game, scoreA: 1, goalEvents: game.goalEvents.slice(1) };
    const once = buildRanking([corrected], [], new Map());
    const twice = buildRanking([corrected], [], new Map());
    expect(twice).toEqual(once);
    expect(once.find((row) => row.playerId === "p1")).toMatchObject({ games: 1, draws: 1, goals: 0 });
  });

  it("ordena pior jogador e goleiros pelos critérios definidos", () => {
    const rows = [
      ranking("A", { losses: 5, goals: 2 }),
      ranking("B", { losses: 5, goals: 1 }),
      ranking("G1", { playerType: "goleiro", losses: 2, wins: 3, goalsAgainst: 8 }),
      ranking("G2", { playerType: "goleiro", losses: 1, wins: 1, goalsAgainst: 10 }),
    ];
    expect(sortRanking(rows, "worst")[0].playerId).toBe("B");
    expect(sortGoalkeepers(rows)[0].playerId).toBe("G2");
  });
});

describe("ranking derivado do histórico", () => {
  it("soma contribuições de babas finalizados e recalcula pontos e aproveitamento", () => {
    const first = ranking("p1", { games: 2, wins: 1, draws: 1, losses: 0, goals: 2, babas: 1, titles: 1 });
    const second = ranking("p1", { games: 1, wins: 0, draws: 0, losses: 1, goals: 1, babas: 1, titles: 0 });
    const [total] = aggregateRankingRows([[first], [second]]);
    expect(total).toMatchObject({ games: 3, wins: 1, draws: 1, losses: 1, goals: 3, points: 4, babas: 2, titles: 1 });
    expect(total.efficiency).toBe(44.4);
  });
});

describe("modo manual", () => {
  it("deriva pontos, gols do time e ranking dos totais informados", () => {
    const result: ManualTeamResult = { teamId: "t1", wins: 2, draws: 1, losses: 1, goalsByPlayer: { p1: 3, p2: 0 }, updatedAtMs: 50 };
    const updated = teamFromManualResult(team("t1", ["p1", "p2"]), result);
    const rows = buildManualRanking([result], [updated], new Map([["p1", "P1"], ["p2", "P2"]]));
    expect(updated.stats).toMatchObject({ wins: 2, draws: 1, losses: 1, goalsFor: 3, goalsAgainst: 0 });
    expect(rows.find((row) => row.playerId === "p1")).toMatchObject({ games: 4, wins: 2, draws: 1, losses: 1, goals: 3, points: 7 });
  });
});

describe("estrelas exatas", () => {
  it("aplica cartões e fórmula específica do goleiro", () => {
    expect(performanceScore(ranking("L", { wins: 2, draws: 1, goals: 3, mvps: 1, yellowCards: 2, redCards: 1 }))).toBe(23);
    expect(performanceScore(ranking("G", { playerType: "goleiro", games: 6, wins: 2, draws: 1, losses: 2 }))).toBe(22);
  });

  it("mostra meia estrela a partir de 50% da faixa", () => {
    const a = ranking("A", { wins: 3 });
    const b = ranking("B", { wins: 2, draws: 1 });
    const rating = calculateStars(a, [a, b], 10);
    expect(rating.ratio).toBe(1.125);
    expect(rating.displayStars).toBe(2.5);
  });

  it("ordena Melhores por estrelas, score, razão, vitórias, gols e nome", () => {
    const rows = [ranking("B", { wins: 2 }), ranking("A", { wins: 3 })];
    expect(sortBestRanking(rows, 10)[0].playerId).toBe("A");
  });
});

describe("pagamento mensal", () => {
  it("cria cobrança por mês, com vencimento no dia 10 e isenção", () => {
    expect(monthKey(new Date("2026-08-24T12:00:00-03:00"))).toBe("2026-08");
    expect(dueDateKey("2026-08")).toBe("2026-08-10");
    expect(createMonthlyPayment(player("L"), "2026-08", "owner", 10)).toMatchObject({ amountCents: 1500, status: "pending", dueDateKey: "2026-08-10", updatedAtMs: 10 });
    expect(createMonthlyPayment(player("N", "linha", "novato"), "2026-08", "owner").status).toBe("exempt");
  });
});
