"use client";

import { useState } from "react";
import { CheckCircle2, CircleDollarSign, Clock3, LoaderCircle, ReceiptText } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useBaba } from "@/components/providers/baba-provider";
import { monthlyPriceCents, paymentSummary } from "@/lib/domain/payments";
import { EmptyState, ScreenHeading, StatCard } from "@/components/ui/screen";

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function PaymentsScreen() {
  const { role } = useAuth();
  const baba = useBaba();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const summary = paymentSummary(baba.players);
  const billable = baba.players.filter((player) => monthlyPriceCents(player) > 0).sort((left, right) => Number(left.paid) - Number(right.paid) || left.name.localeCompare(right.name, "pt-BR"));

  const toggle = async (playerId: string) => {
    setError("");
    setBusyId(playerId);
    try {
      await baba.togglePayment(playerId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o pagamento.");
    } finally {
      setBusyId(null);
    }
  };

  return <>
    <ScreenHeading eyebrow="Financeiro" title="Pagamentos do mês" description="Controle mensalistas, goleiros e pendências em uma única lista." />
    <div className="stat-grid payment-summary"><StatCard label="Previsto" value={money(summary.expectedCents)} note={`${billable.length} mensalistas`} /><StatCard label="Recebido" value={money(summary.paidCents)} note={`${summary.paidCount} pagos`} /><StatCard label="Pendente" value={money(summary.expectedCents - summary.paidCents)} note={`${summary.pendingCount} pendentes`} /></div>
    {!billable.length ? <EmptyState icon={<ReceiptText />} title="Nenhuma cobrança neste mês" text="Cadastre jogadores regulares para organizar os pagamentos." /> : <section className="card payments-card">
      <div className="card-title-row"><div><h2>Mensalistas</h2><p>Vencimento dia 10 · Linha R$ 15 · Goleiro R$ 7</p></div><CircleDollarSign /></div>
      <div className="payments-table">{billable.map((player) => {
        const busy = busyId === player.id;
        return <button key={player.id} className={player.paid ? "is-paid" : ""} disabled={role !== "organizer" || busyId !== null} onClick={() => toggle(player.id)}>
          <span className="avatar">{player.name.slice(0, 2).toUpperCase()}</span>
          <span className="payment-person"><strong>{player.name}</strong><small>{player.type === "goleiro" ? "Goleiro" : "Linha"}</small></span>
          <strong>{money(monthlyPriceCents(player))}</strong>
          <span className={`payment-state ${player.paid ? "paid" : "pending"}`}>{busy ? <LoaderCircle className="spin" /> : player.paid ? <CheckCircle2 /> : <Clock3 />}{player.paid ? "Pago" : "Pendente"}</span>
        </button>;
      })}</div>
      {role !== "organizer" && <p className="inline-empty">Somente o organizador pode alterar os pagamentos.</p>}
    </section>}
    {error && <p className="message error" role="alert">{error}</p>}
  </>;
}
