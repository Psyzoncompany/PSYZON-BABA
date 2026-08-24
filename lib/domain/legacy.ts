import type { Baba } from "./types";

export function normalizeBabaStatus(value: unknown): Baba["status"] {
  const status = String(value || "open").toLowerCase();
  if (status === "finalizado" || status === "finished") return "finished";
  if (status === "sorteado" || status === "drawn") return "drawn";
  if (status === "prepared" || status === "preparado") return "prepared";
  if (status === "tie_break_pending" || status === "desempate_pendente") return "tie_break_pending";
  if (["playing", "jogando", "em_andamento", "active"].includes(status)) return "playing";
  return "open";
}
