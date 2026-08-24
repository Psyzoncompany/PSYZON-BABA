import type { RankingRow } from "./types";

export const STAR_LEVELS = [
  { level: 0, title: "Sem estrela", color: "#94a3b8" },
  { level: 1, title: "Iniciante", color: "#7c8798" },
  { level: 2, title: "Promessa", color: "#b97843" },
  { level: 3, title: "Destaque", color: "#aab4c2" },
  { level: 4, title: "Craque", color: "#e3ab20" },
  { level: 5, title: "Lenda do Baba", color: "#3ca5d9" },
] as const;

export function performanceScore(row: RankingRow): number {
  if (row.playerType === "goleiro") {
    const unbeatenGames = Math.max(0, row.games - row.losses);
    return row.wins * 6 + row.draws * 2 + unbeatenGames * 2;
  }
  return row.wins * 6
    + row.draws * 2
    + row.goals * 3
    + (row.mvps || 0) * 5
    - (row.yellowCards || 0)
    - (row.redCards || 0) * 3;
}

export function minimumGames(completedBabas: number): number {
  return completedBabas >= 10 ? 10 : Math.max(1, Math.min(5, Math.ceil(Math.max(0, completedBabas) / 2)));
}

export function calculateStars(row: RankingRow, group: readonly RankingRow[], completedBabas: number) {
  const required = minimumGames(completedBabas);
  const eligibleGroup = group.filter((candidate) => candidate.games >= required);
  const scores = eligibleGroup.map(performanceScore);
  const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const raw = performanceScore(row);
  const adjusted = completedBabas < 10 ? raw * 0.7 + average * 0.3 : raw;
  const ratio = average > 0 ? adjusted / average : 0;
  const thresholds = [0.8, 1, 1.25, 1.5, 1.8] as const;
  let stars = thresholds.filter((value) => ratio >= value).length;
  const eligible = row.games >= required && average > 0;
  if (!eligible) stars = 0;
  const lower = stars === 0 ? 0 : thresholds[stars - 1];
  const upper = thresholds[stars] ?? lower;
  const progress = stars >= 5 || upper <= lower
    ? 100
    : Math.max(0, Math.min(100, ((ratio - lower) / (upper - lower)) * 100));
  const displayStars = eligible ? Math.min(5, stars + (stars < 5 && progress >= 50 ? 0.5 : 0)) : 0;

  return {
    stars,
    displayStars,
    score: raw,
    adjustedScore: adjusted,
    groupAverage: average,
    ratio,
    progress,
    eligible,
    missingGames: Math.max(0, required - row.games),
    level: STAR_LEVELS[stars],
  };
}

export function sortBestRanking(rows: readonly RankingRow[], completedBabas: number): RankingRow[] {
  const ratings = new Map(rows.map((row) => [row.playerId, calculateStars(row, rows, completedBabas)]));
  return [...rows].sort((a, b) => {
    const left = ratings.get(a.playerId)!;
    const right = ratings.get(b.playerId)!;
    return right.displayStars - left.displayStars
      || right.score - left.score
      || right.ratio - left.ratio
      || b.wins - a.wins
      || b.goals - a.goals
      || a.name.localeCompare(b.name, "pt-BR");
  });
}
