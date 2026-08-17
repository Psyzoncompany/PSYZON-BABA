import type { Game, RankingRow, Team } from "./types";

export function teamPoints(team: Team): number {
  return team.stats.wins * 3 + team.stats.draws;
}

export function sortTable(teams: readonly Team[]): Team[] {
  return [...teams].sort((a, b) => teamPoints(b) - teamPoints(a)
    || (b.stats.goalsFor - b.stats.goalsAgainst) - (a.stats.goalsFor - a.stats.goalsAgainst)
    || b.stats.goalsFor - a.stats.goalsFor
    || a.name.localeCompare(b.name, "pt-BR"));
}

export function championIds(teams: readonly Team[]): string[] {
  const sorted = [...teams].sort((a, b) => teamPoints(b) - teamPoints(a)
    || b.stats.wins - a.stats.wins
    || (b.stats.goalsFor - b.stats.goalsAgainst) - (a.stats.goalsFor - a.stats.goalsAgainst)
    || b.stats.goalsFor - a.stats.goalsFor);
  const first = sorted[0];
  if (!first) return [];
  return sorted.filter((team) => teamPoints(team) === teamPoints(first)
    && team.stats.wins === first.stats.wins
    && team.stats.goalsFor - team.stats.goalsAgainst === first.stats.goalsFor - first.stats.goalsAgainst
    && team.stats.goalsFor === first.stats.goalsFor).map((team) => team.id);
}

export function nextRotation(teamA: string, teamB: string, queue: readonly string[], scoreA: number, scoreB: number) {
  const waiting = queue.filter((id) => id !== teamA && id !== teamB);
  if (scoreA !== scoreB) {
    const winner = scoreA > scoreB ? teamA : teamB;
    const loser = scoreA > scoreB ? teamB : teamA;
    return { court: [winner, waiting[0] ?? loser], queue: [...waiting.slice(1), loser], tieBreak: false };
  }
  const activeCount = waiting.length + 2;
  if (activeCount === 2) {
    return { court: [teamA, teamB], queue: [], tieBreak: false, randomTieRequired: true };
  }
  if (activeCount === 3) return { court: [teamA, waiting[0]], queue: [teamB], tieBreak: true };
  return { court: [waiting[0], waiting[1]], queue: [...waiting.slice(2), teamA, teamB], tieBreak: false };
}

export function buildRanking(games: readonly Game[], teams: readonly Team[], playerNames: ReadonlyMap<string, string>): RankingRow[] {
  const rows = new Map<string, RankingRow>();
  const ensure = (playerId: string) => {
    if (!rows.has(playerId)) rows.set(playerId, { playerId, name: playerNames.get(playerId) ?? "Jogador", games: 0, wins: 0, draws: 0, losses: 0, goals: 0, points: 0, efficiency: 0 });
    return rows.get(playerId)!;
  };
  games.filter((game) => game.status === "finished").forEach((game) => {
    const draw = game.scoreA === game.scoreB;
    [[game.rosterA, game.scoreA, game.scoreB], [game.rosterB, game.scoreB, game.scoreA]].forEach(([roster, own, against]) => {
      (roster as string[]).forEach((id) => {
        const row = ensure(id); row.games += 1;
        if (draw) row.draws += 1; else if ((own as number) > (against as number)) row.wins += 1; else row.losses += 1;
      });
    });
    game.goalEvents.forEach((goal) => { if (goal.playerId) ensure(goal.playerId).goals += 1; });
  });
  rows.forEach((row) => { row.points = row.wins * 3 + row.draws; row.efficiency = row.games ? Math.round((row.points / (row.games * 3)) * 100) : 0; });
  return [...rows.values()].sort((a, b) => b.goals - a.goals || b.wins - a.wins || b.efficiency - a.efficiency || a.name.localeCompare(b.name, "pt-BR"));
}
