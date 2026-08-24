import type { MonthlyPayment, Player } from "./types";

export function monthlyPriceCents(player: Pick<Player, "type" | "status" | "active">): number {
  if (!player.active || player.status !== "regular") return 0;
  return player.type === "goleiro" ? 700 : 1500;
}

export function monthKey(date: Date = new Date()): string {
  const year = new Intl.DateTimeFormat("en", { timeZone: "America/Bahia", year: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("en", { timeZone: "America/Bahia", month: "2-digit" }).format(date);
  return `${year}-${month}`;
}

export function dueDateKey(paymentMonth: string): string {
  if (!/^\d{4}-\d{2}$/.test(paymentMonth)) throw new Error("Mês de pagamento inválido.");
  return `${paymentMonth}-10`;
}

export function createMonthlyPayment(player: Player, paymentMonth: string, actorId: string, timestamp = Date.now()): MonthlyPayment {
  const amountCents = monthlyPriceCents(player);
  return {
    playerId: player.id,
    monthKey: paymentMonth,
    status: amountCents ? "pending" : "exempt",
    amountCents,
    dueDateKey: dueDateKey(paymentMonth),
    updatedAtMs: timestamp,
    updatedBy: actorId,
  };
}

export function paymentSummary(players: readonly Player[], payments: readonly MonthlyPayment[] = []) {
  const byPlayer = new Map(payments.map((payment) => [payment.playerId, payment]));
  return players.reduce((result, player) => {
    const amount = monthlyPriceCents(player);
    const payment = byPlayer.get(player.id);
    const paid = payment ? payment.status === "paid" : player.paid;
    result.expectedCents += amount;
    if (paid && amount) { result.paidCents += amount; result.paidCount += 1; }
    else if (amount) result.pendingCount += 1;
    return result;
  }, { expectedCents: 0, paidCents: 0, paidCount: 0, pendingCount: 0 });
}

export function resolvePaymentConflict<T extends { updatedAtMs: number }>(local: T, remote: T): T {
  return local.updatedAtMs >= remote.updatedAtMs ? local : remote;
}
