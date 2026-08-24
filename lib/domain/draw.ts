import type { Player, Team } from "./types";
import { getTeamTheme } from "./team-theme";

export type RandomSource = () => number;

export interface DrawOptions {
  random?: RandomSource;
  drawBatch?: number;
  lateArrival?: boolean;
  startOrder?: number;
  nowMs?: number;
  idFactory?: (kind: "team" | "visitor", order: number) => string;
}

function secureRandom(): number {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0] / 0x1_0000_0000;
  }
  return Math.random();
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `team-${Date.now()}-${Math.floor(secureRandom() * 1_000_000)}`;
}

export function shuffle<T>(items: readonly T[], random: RandomSource = secureRandom): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const sampled = Number(random());
    const unit = Number.isFinite(sampled) ? Math.min(Math.max(sampled, 0), 0.999999999) : 0.5;
    const target = Math.floor(unit * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

export function drawTeams(players: readonly Player[], options: DrawOptions = {}): Team[] {
  const present = players.filter((player) => player.present && player.active);
  const visitors = present.filter((player) => player.status === "convidado");
  const fixed = present.filter((player) => player.status !== "convidado");
  const field = fixed.filter((player) => player.type === "linha");
  const goalkeepers = fixed.filter((player) => player.type === "goleiro");
  const isLateBatch = Boolean(options.lateArrival);

  if (!isLateBatch && present.length < 2) throw new Error("Marque pelo menos 2 jogadores.");
  if (isLateBatch && present.length < 1) throw new Error("Marque quem chegou depois.");
  if (!isLateBatch && field.length < 8) throw new Error("Marque pelo menos 8 jogadores de linha.");

  const random = options.random ?? secureRandom;
  const baseTeamCount = Math.ceil(field.length / 4);
  const minimumTeams = isLateBatch ? 1 : 2;
  const teamCount = field.length || goalkeepers.length
    ? Math.min(5, Math.max(minimumTeams, baseTeamCount || 1))
    : 0;
  const groups = Array.from({ length: teamCount }, () => [] as Player[]);

  shuffle(field, random).forEach((player, index) => {
    const target = index < teamCount * 4 ? Math.floor(index / 4) : index % teamCount;
    groups[target].push(player);
  });

  if (teamCount) {
    const goalkeeperOrder = shuffle(Array.from({ length: teamCount }, (_, index) => index), random);
    shuffle(goalkeepers, random).forEach((player, index) => {
      groups[goalkeeperOrder[index % teamCount]].push(player);
    });
  }

  const timestamp = options.nowMs ?? Date.now();
  const startOrder = options.startOrder ?? 1;
  const batch = options.drawBatch ?? 1;
  const idFactory = options.idFactory ?? (() => randomId());
  const result: Team[] = groups.filter((group) => group.length).map((group, index) => {
    const order = startOrder + index;
    const theme = getTeamTheme(order);
    return {
      id: idFactory("team", order),
      name: `Time ${order}`,
      color: theme.color,
      order,
      playerIds: shuffle(group, random).map((player) => player.id),
      drawBatch: batch,
      lateArrival: isLateBatch,
      active: true,
      stats: { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
      updatedAtMs: timestamp,
    } satisfies Team;
  });

  if (visitors.length) {
    const order = startOrder + result.length;
    result.push({
      id: idFactory("visitor", order),
      name: "Visitante",
      color: "#64748b",
      order,
      playerIds: shuffle(visitors, random).map((player) => player.id),
      drawBatch: batch,
      lateArrival: isLateBatch,
      active: true,
      stats: { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 },
      updatedAtMs: timestamp,
    });
  }

  const ids = result.flatMap((team) => team.playerIds);
  if (new Set(ids).size !== ids.length) throw new Error("O sorteio tentou duplicar um jogador.");
  return result;
}
