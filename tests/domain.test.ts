import { describe, expect, it } from "vitest";
import { championIds, nextRotation, sortTable, teamPoints } from "@/lib/domain/competition";
import { drawTeams } from "@/lib/domain/draw";
import { normalizeBabaStatus } from "@/lib/domain/legacy";
import { monthlyPriceCents, paymentSummary, resolvePaymentConflict } from "@/lib/domain/payments";
import { calculateStars, minimumGames } from "@/lib/domain/stars";
import type { Player, RankingRow, Team } from "@/lib/domain/types";

const player = (id: string, type: Player["type"] = "linha", status: Player["status"] = "regular"): Player => ({ id, name: id, type, status, active: true, present: true, paid: false, createdAtMs: 0, updatedAtMs: 0 });
const team = (id: string, wins: number, draws: number, goalsFor: number, goalsAgainst: number): Team => ({ id, name: id, color: "#000", order: 1, playerIds: [], drawBatch: 1, lateArrival: false, active: true, stats: { wins, draws, losses: 0, goalsFor, goalsAgainst }, updatedAtMs: 0 });

describe("sorteio", () => {
  it("não duplica jogadores e cria o primeiro jogo com os dois primeiros times", () => {
    const players = [...Array.from({ length: 13 }, (_, index) => player(`L${index}`)), player("G1", "goleiro"), player("G2", "goleiro")];
    const teams = drawTeams(players, { random: () => 0.42 }); const ids = teams.flatMap((item) => item.playerIds);
    expect(teams).toHaveLength(4); expect(new Set(ids).size).toBe(ids.length); expect(ids).toHaveLength(players.length);
  });
  it("distribui goleiros de forma circular e equilibrada", () => {
    const players = [...Array.from({ length: 12 }, (_, index) => player(`L${index}`)), ...Array.from({ length: 5 }, (_, index) => player(`G${index}`, "goleiro"))];
    const teams = drawTeams(players, { random: () => 0.1 }); const counts = teams.map((item) => item.playerIds.filter((id) => id.startsWith("G")).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
  it("mantém visitantes em um time separado", () => {
    const players = [...Array.from({ length: 8 }, (_, index) => player(`L${index}`)), player("V1", "linha", "convidado")];
    expect(drawTeams(players, { random: () => 0.3 }).at(-1)?.name).toBe("Visitante");
  });
});

describe("rodízio", () => {
  it("mantém vencedor e manda perdedor ao fim", () => expect(nextRotation("a", "b", ["a", "b", "c", "d"], 2, 1)).toEqual({ court: ["a", "c"], queue: ["d", "b"], tieBreak: false }));
  it("exige sorteio no empate com dois times", () => expect(nextRotation("a", "b", ["a", "b"], 1, 1).randomTieRequired).toBe(true));
  it("exige ímpar/par no empate com três times", () => expect(nextRotation("a", "b", ["a", "b", "c"], 1, 1).tieBreak).toBe(true));
  it("retira os dois no empate com quatro times", () => expect(nextRotation("a", "b", ["a", "b", "c", "d"], 1, 1)).toEqual({ court: ["c", "d"], queue: ["a", "b"], tieBreak: false }));
});

describe("tabela e campeão", () => {
  it("calcula pontos e ordena por saldo", () => { const items = [team("B", 1, 0, 3, 2), team("A", 1, 0, 4, 2)]; expect(teamPoints(items[0])).toBe(3); expect(sortTable(items)[0].id).toBe("A"); });
  it("aceita co-campeões quando todos os critérios empatam", () => { const items = [team("A", 2, 1, 5, 2), team("B", 2, 1, 5, 2)]; expect(championIds(items)).toEqual(["A", "B"]); });
});

describe("pagamentos", () => {
  it("cobra R$15 de linha e R$7 de goleiro, isentando novato", () => { expect(monthlyPriceCents(player("L"))).toBe(1500); expect(monthlyPriceCents(player("G", "goleiro"))).toBe(700); expect(monthlyPriceCents(player("N", "linha", "novato"))).toBe(0); });
  it("resume valores e resolve conflito por jogador", () => { const a = player("A"); a.paid = true; const b = player("B", "goleiro"); expect(paymentSummary([a, b])).toEqual({ expectedCents: 2200, paidCents: 1500, paidCount: 1, pendingCount: 1 }); expect(resolvePaymentConflict({ paid: false, updatedAtMs: 20 }, { paid: true, updatedAtMs: 10 }).paid).toBe(false); });
});

describe("compatibilidade do histórico", () => {
  it("não trata baba finalizado do site antigo como baba ativo", () => {
    expect(normalizeBabaStatus("finalizado")).toBe("finished");
    expect(normalizeBabaStatus("sorteado")).toBe("drawn");
    expect(normalizeBabaStatus("em_andamento")).toBe("playing");
  });
});

describe("estrelas", () => {
  const row = (id: string, wins: number, goals: number, games = 5): RankingRow => ({ playerId: id, name: id, games, wins, draws: 0, losses: 0, goals, points: wins * 3, efficiency: 80 });
  it("usa elegibilidade progressiva e mínimo maduro", () => { expect(minimumGames(1)).toBe(1); expect(minimumGames(9)).toBe(5); expect(minimumGames(10)).toBe(10); });
  it("produz estrelas e meia estrela pelo progresso", () => { const group = [row("A", 5, 5), row("B", 2, 1)]; const rating = calculateStars(group[0], group, 5); expect(rating.eligible).toBe(true); expect(rating.displayStars).toBeGreaterThan(0); });
  it("explica jogos faltantes", () => { const group = [row("A", 1, 1, 1), row("B", 1, 1, 5)]; expect(calculateStars(group[0], group, 9).missingGames).toBe(4); });
});
