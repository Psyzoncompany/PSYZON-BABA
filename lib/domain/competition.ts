import type { Game, ManualTeamResult, PlayerType, RankingRow, Team } from "./types";

export function teamPoints(team: Team): number {
  return team.stats.wins * 3 + team.stats.draws;
}

export function sortTable(teams: readonly Team[]): Team[] {
  return [...teams].sort((a, b) => teamPoints(b) - teamPoints(a)
    || (b.stats.goalsFor - b.stats.goalsAgainst) - (a.stats.goalsFor - a.stats.goalsAgainst)
    || b.stats.goalsFor - a.stats.goalsFor
    || a.name.localeCompare(b.name, "pt-BR"));
}

export function previewTable(teams: readonly Team[], game: Game | null | undefined): Team[] {
  if (!game || game.status === "finished") return sortTable(teams);
  return sortTable(teams.map((team) => {
    if (team.id !== game.teamAId && team.id !== game.teamBId) return team;
    const own = team.id === game.teamAId ? game.scoreA : game.scoreB;
    const against = team.id === game.teamAId ? game.scoreB : game.scoreA;
    return { ...team, stats: { ...team.stats, wins: team.stats.wins + Number(own > against), draws: team.stats.draws + Number(own === against), losses: team.stats.losses + Number(own < against), goalsFor: team.stats.goalsFor + own, goalsAgainst: team.stats.goalsAgainst + against } };
  }));
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

export type RotationResult =
  | { kind: "ready"; court: [string, string]; queue: string[] }
  | { kind: "random_required"; tiedTeams: [string, string] }
  | { kind: "manual_required"; tiedTeams: [string, string]; incomingTeamId: string };

export function nextRotation(teamA: string, teamB: string, queue: readonly string[], scoreA: number, scoreB: number): RotationResult {
  if (teamA === teamB) throw new Error("O mesmo time não pode ocupar os dois lados da quadra.");
  const normalized = [...new Set(queue)].filter((id) => id !== teamA && id !== teamB);
  if (scoreA !== scoreB) {
    const winner = scoreA > scoreB ? teamA : teamB;
    const loser = scoreA > scoreB ? teamB : teamA;
    return { kind: "ready", court: [winner, normalized[0] ?? loser], queue: [...normalized.slice(1), loser] };
  }

  const activeCount = normalized.length + 2;
  if (activeCount === 2) return { kind: "random_required", tiedTeams: [teamA, teamB] };
  if (activeCount === 3) return { kind: "manual_required", tiedTeams: [teamA, teamB], incomingTeamId: normalized[0] };
  return { kind: "ready", court: [normalized[0], normalized[1]], queue: [...normalized.slice(2), teamA, teamB] };
}

export function resolveRandomDraw(teamA: string, teamB: string, random: () => number): RotationResult {
  const sampled = Number(random());
  const teamAStays = Number.isFinite(sampled) ? sampled < 0.5 : true;
  return { kind: "ready", court: teamAStays ? [teamA, teamB] : [teamB, teamA], queue: [] };
}

export function resolveManualDraw(winnerId: string, teamA: string, teamB: string, incomingTeamId: string): RotationResult {
  if (winnerId !== teamA && winnerId !== teamB) throw new Error("Escolha um dos times que empatou.");
  const loserId = winnerId === teamA ? teamB : teamA;
  return { kind: "ready", court: [winnerId, incomingTeamId], queue: [loserId] };
}

function emptyRanking(playerId: string, name: string, playerType?: PlayerType): RankingRow {
  return {
    playerId,
    name,
    playerType,
    games: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals: 0,
    points: 0,
    efficiency: 0,
    babas: 0,
    titles: 0,
    mvps: 0,
    yellowCards: 0,
    redCards: 0,
    goalsAgainst: 0,
    cleanGames: 0,
  };
}

function finishRanking(rows: Map<string, RankingRow>): RankingRow[] {
  rows.forEach((row) => {
    row.points = row.wins * 3 + row.draws;
    row.efficiency = row.games ? Math.round((row.points / (row.games * 3)) * 1000) / 10 : 0;
  });
  return [...rows.values()];
}

export function buildRanking(
  games: readonly Game[],
  _teams: readonly Team[],
  playerNames: ReadonlyMap<string, string>,
  playerTypes: ReadonlyMap<string, PlayerType> = new Map(),
): RankingRow[] {
  const rows = new Map<string, RankingRow>();
  const ensure = (playerId: string) => {
    if (!rows.has(playerId)) rows.set(playerId, emptyRanking(playerId, playerNames.get(playerId) ?? "Jogador", playerTypes.get(playerId)));
    return rows.get(playerId)!;
  };

  games.filter((game) => game.status === "finished").forEach((game) => {
    const draw = game.scoreA === game.scoreB;
    const sides = [
      { roster: game.rosterA, own: game.scoreA, against: game.scoreB },
      { roster: game.rosterB, own: game.scoreB, against: game.scoreA },
    ];
    sides.forEach(({ roster, own, against }) => {
      roster.forEach((id) => {
        const row = ensure(id);
        row.games += 1;
        if (draw) row.draws += 1;
        else if (own > against) row.wins += 1;
        else row.losses += 1;
        if (row.playerType === "goleiro") {
          row.goalsAgainst = (row.goalsAgainst || 0) + against;
          if (against === 0) row.cleanGames = (row.cleanGames || 0) + 1;
        }
      });
    });
    game.goalEvents.forEach((goal) => { if (goal.playerId) ensure(goal.playerId).goals += 1; });
  });

  return sortRanking(finishRanking(rows), "goals");
}

export function buildManualRanking(
  results: readonly ManualTeamResult[],
  teams: readonly Team[],
  playerNames: ReadonlyMap<string, string>,
  playerTypes: ReadonlyMap<string, PlayerType> = new Map(),
): RankingRow[] {
  const rows = new Map<string, RankingRow>();
  const ensure = (playerId: string) => {
    if (!rows.has(playerId)) rows.set(playerId, emptyRanking(playerId, playerNames.get(playerId) ?? "Jogador", playerTypes.get(playerId)));
    return rows.get(playerId)!;
  };

  results.forEach((result) => {
    const team = teams.find((item) => item.id === result.teamId);
    if (!team) return;
    const games = result.wins + result.draws + result.losses;
    team.playerIds.forEach((playerId) => {
      const row = ensure(playerId);
      row.games += games;
      row.wins += result.wins;
      row.draws += result.draws;
      row.losses += result.losses;
      row.goals += Math.max(0, Math.trunc(result.goalsByPlayer[playerId] || 0));
    });
  });
  return sortRanking(finishRanking(rows), "goals");
}

export type RankingCriterion = "best" | "goals" | "wins" | "losses" | "worst" | "titles" | "efficiency";

export function sortRanking(rows: readonly RankingRow[], criterion: RankingCriterion): RankingRow[] {
  const sorted = [...rows];
  return sorted.sort((a, b) => {
    if (criterion === "goals") return b.goals - a.goals || b.wins - a.wins || a.name.localeCompare(b.name, "pt-BR");
    if (criterion === "wins") return b.wins - a.wins || b.goals - a.goals || a.name.localeCompare(b.name, "pt-BR");
    if (criterion === "losses" || criterion === "worst") return b.losses - a.losses || a.goals - b.goals || a.name.localeCompare(b.name, "pt-BR");
    if (criterion === "titles") return (b.titles || 0) - (a.titles || 0) || b.wins - a.wins || a.name.localeCompare(b.name, "pt-BR");
    if (criterion === "efficiency") return b.efficiency - a.efficiency || b.wins - a.wins || a.name.localeCompare(b.name, "pt-BR");
    return b.points - a.points || b.wins - a.wins || b.goals - a.goals || a.name.localeCompare(b.name, "pt-BR");
  });
}

export function sortGoalkeepers(rows: readonly RankingRow[]): RankingRow[] {
  return [...rows].filter((row) => row.playerType === "goleiro").sort((a, b) => a.losses - b.losses
    || b.wins - a.wins
    || b.draws - a.draws
    || (a.goalsAgainst || 0) - (b.goalsAgainst || 0)
    || ((a.goalsAgainst || 0) / Math.max(1, a.games)) - ((b.goalsAgainst || 0) / Math.max(1, b.games))
    || b.games - a.games
    || a.name.localeCompare(b.name, "pt-BR"));
}

export function teamFromManualResult(team: Team, result: ManualTeamResult): Team {
  const goalsFor = Object.values(result.goalsByPlayer).reduce((sum, goals) => sum + Math.max(0, Math.trunc(goals)), 0);
  return {
    ...team,
    stats: {
      wins: result.wins,
      draws: result.draws,
      losses: result.losses,
      goalsFor,
      goalsAgainst: 0,
    },
    updatedAtMs: result.updatedAtMs,
  };
}
