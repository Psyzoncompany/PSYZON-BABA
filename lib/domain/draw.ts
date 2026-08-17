import type { Player, Team } from "./types";
import { getTeamTheme } from "./team-theme";

export type RandomSource = () => number;

export function shuffle<T>(items: readonly T[], random: RandomSource = Math.random): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const sampled = Number(random());
    const unit = Number.isFinite(sampled) ? Math.min(Math.max(sampled, 0), 0.999999999) : Math.random();
    const target = Math.floor(unit * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function drawTeams(
  players: readonly Player[],
  options: { random?: RandomSource; drawBatch?: number; lateArrival?: boolean; startOrder?: number } = {},
): Team[] {
  const present = players.filter((player) => player.present && player.active);
  const visitors = present.filter((player) => player.status === "convidado");
  const fixed = present.filter((player) => player.status !== "convidado");
  const field = fixed.filter((player) => player.type === "linha");
  const goalkeepers = fixed.filter((player) => player.type === "goleiro");
  if (present.length < 2) throw new Error("Marque pelo menos 2 jogadores.");
  if (!options.lateArrival && field.length < 8) throw new Error("Marque pelo menos 8 jogadores de linha.");

  const random = options.random ?? Math.random;
  const teamCount = Math.min(5, Math.max(2, Math.ceil(field.length / 4)));
  const groups = Array.from({ length: teamCount }, () => [] as Player[]);
  shuffle(field, random).forEach((player, index) => {
    const target = index < teamCount * 4 ? Math.floor(index / 4) : index % teamCount;
    groups[target].push(player);
  });
  const goalkeeperOrder = shuffle(Array.from({ length: teamCount }, (_, index) => index), random);
  shuffle(goalkeepers, random).forEach((player, index) => groups[goalkeeperOrder[index % teamCount]].push(player));

  const now = Date.now();
  const startOrder = options.startOrder ?? 1;
  const batch = options.drawBatch ?? 1;
  const result: Team[] = groups.filter((group) => group.length).map((group, index) => {
    const order = startOrder + index;
    const theme = getTeamTheme(order);
    return {
      id: crypto.randomUUID(),
      name: `Time ${order}`,
      color: theme.color,
      order,
      playerIds: shuffle(group, random).map((player) => player.id),
      drawBatch: batch,
      lateArrival: Boolean(options.lateArrival),
      active: true,
      stats: { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
      updatedAtMs: now,
    } satisfies Team;
  });

  if (visitors.length) {
    result.push({
      id: crypto.randomUUID(), name: "Visitante", color: "#64748b", order: startOrder + result.length,
      playerIds: visitors.map((player) => player.id), drawBatch: batch, lateArrival: Boolean(options.lateArrival),
      active: true, stats: { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 }, updatedAtMs: now,
    });
  }
  return result;
}
