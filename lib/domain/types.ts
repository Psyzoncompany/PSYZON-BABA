export type PlayerType = "linha" | "goleiro";
export type PlayerStatus = "regular" | "novato" | "convidado" | "desativado";
export type MatchMode = "online" | "manual";
export type BabaStatus = "open" | "drawn" | "prepared" | "playing" | "tie_break_pending" | "finished";

export interface Player {
  id: string;
  name: string;
  type: PlayerType;
  status: PlayerStatus;
  active: boolean;
  present: boolean;
  paid: boolean;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface TeamStats {
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  order: number;
  playerIds: string[];
  drawBatch: number;
  lateArrival: boolean;
  active: boolean;
  stats: TeamStats;
  updatedAtMs: number;
}

export interface GoalEvent {
  id: string;
  playerId: string | null;
  playerNameSnapshot: string;
  teamId: string;
  minute: number;
  createdAtMs: number;
}

export interface RosterPlayerSnapshot {
  id: string;
  name: string;
  type: PlayerType;
}

export interface Game {
  id: string;
  sequence: number;
  teamAId: string;
  teamBId: string;
  teamAName: string;
  teamBName: string;
  rosterA: string[];
  rosterB: string[];
  rosterASnapshot?: RosterPlayerSnapshot[];
  rosterBSnapshot?: RosterPlayerSnapshot[];
  scoreA: number;
  scoreB: number;
  status: "prepared" | "running" | "paused" | "finished";
  durationSeconds: number;
  timerStartedAtMs: number | null;
  timerRemainingSeconds: number;
  goalEvents: GoalEvent[];
  createdAtMs: number;
  finishedAtMs: number | null;
  updatedAtMs: number;
}

export interface PendingTieBreak {
  kind: "random" | "manual_odd_even";
  teamAId: string;
  teamBId: string;
  incomingTeamId?: string;
}

export interface Baba {
  id: string;
  dateKey: string;
  status: BabaStatus;
  matchMode: MatchMode;
  modeLocked?: boolean;
  currentGameId: string | null;
  queue: string[];
  pendingTieBreak?: PendingTieBreak | null;
  drawBatchCount: number;
  championTeamIds: string[];
  createdAtMs: number;
  finishedAtMs: number | null;
  deletedAtMs?: number | null;
  updatedAtMs: number;
}

export interface RankingRow {
  playerId: string;
  name: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  points: number;
  efficiency: number;
  babas?: number;
  titles?: number;
  mvps?: number;
  yellowCards?: number;
  redCards?: number;
  goalsAgainst?: number;
  cleanGames?: number;
  playerType?: PlayerType;
}

export interface MonthlyPayment {
  playerId: string;
  monthKey: string;
  status: "paid" | "pending" | "exempt";
  amountCents: number;
  dueDateKey: string;
  updatedAtMs: number;
  updatedBy: string;
}

export interface ManualTeamResult {
  teamId: string;
  wins: number;
  draws: number;
  losses: number;
  goalsByPlayer: Record<string, number>;
  updatedAtMs: number;
}
