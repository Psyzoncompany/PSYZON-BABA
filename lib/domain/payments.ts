import type { Player } from "./types";

export function monthlyPriceCents(player: Pick<Player, "type" | "status" | "active">): number {
  if (!player.active || player.status !== "regular") return 0;
  return player.type === "goleiro" ? 700 : 1500;
}

export function paymentSummary(players: readonly Player[]) {
  return players.reduce((result, player) => {
    const amount = monthlyPriceCents(player);
    result.expectedCents += amount;
    if (player.paid && amount) { result.paidCents += amount; result.paidCount += 1; }
    else if (amount) result.pendingCount += 1;
    return result;
  }, { expectedCents: 0, paidCents: 0, paidCount: 0, pendingCount: 0 });
}

export function resolvePaymentConflict<T extends { updatedAtMs: number }>(local: T, remote: T): T {
  return local.updatedAtMs >= remote.updatedAtMs ? local : remote;
}
