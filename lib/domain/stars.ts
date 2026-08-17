import type { RankingRow } from "./types";

export function performanceScore(row: RankingRow): number {
  return Math.max(0, row.wins * 6 + row.draws * 2 + row.goals * 3);
}

export function minimumGames(completedBabas: number): number {
  return completedBabas >= 10 ? 10 : Math.max(1, Math.min(5, Math.ceil(Math.max(0, completedBabas) / 2)));
}

export function calculateStars(row: RankingRow, group: readonly RankingRow[], completedBabas: number) {
  const required = minimumGames(completedBabas);
  const scores = group.map(performanceScore);
  const average = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const raw = performanceScore(row);
  const adjusted = completedBabas < 10 ? raw * 0.7 + average * 0.3 : raw;
  const ratio = average ? adjusted / average : 0;
  const thresholds = [0.8, 1, 1.25, 1.5, 1.8];
  let stars = thresholds.filter((value) => ratio >= value).length;
  const eligible = row.games >= required && average > 0;
  if (!eligible) stars = 0;
  const lower = stars === 0 ? 0 : thresholds[stars - 1];
  const upper = thresholds[stars] ?? lower;
  const progress = stars >= 5 || upper <= lower ? 100 : Math.max(0, Math.min(99, ((ratio - lower) / (upper - lower)) * 100));
  return { stars, displayStars: eligible ? Math.min(5, stars + (stars < 5 && progress >= 50 ? 0.5 : 0)) : 0, ratio, eligible, missingGames: Math.max(0, required - row.games) };
}
