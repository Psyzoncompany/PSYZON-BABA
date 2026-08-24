import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRequestIdentity } from "@/lib/auth/request-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { monthlyPriceCents } from "@/lib/domain/payments";
import type { MonthlyPayment, Player } from "@/lib/domain/types";
import { createPaymentsPdf } from "@/lib/pdf/reports";

export const runtime = "nodejs";
const schema = z.object({ monthKey: z.string().regex(/^\d{4}-\d{2}$/) });

export async function POST(request: Request) {
  try {
    const identity = await requireRequestIdentity(request);
    if (identity.role !== "organizer") return NextResponse.json({ error: "Relatório financeiro restrito ao organizador." }, { status: 403 });
    const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
    const account = getAdminDb().collection("baba_accounts").doc(identity.accountId);
    const [playersSnapshot, paymentsSnapshot] = await Promise.all([account.collection("players").get(), account.collection("payments").doc(parsed.data.monthKey).collection("players").get()]);
    const payments = new Map(paymentsSnapshot.docs.map((item) => [item.id, { playerId: item.id, ...item.data() } as MonthlyPayment]));
    const players = playersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Player)).filter((player) => player.status !== "convidado");
    const rows = players.map((player) => {
      const amountCents = monthlyPriceCents(player); const payment = payments.get(player.id);
      const status = !player.active || player.status === "desativado" ? "desativado" as const : player.status === "novato" ? "novato" as const : payment?.status === "paid" ? "paid" as const : "pending" as const;
      return { name: player.name, type: player.type === "goleiro" ? "Goleiro" : "Jogador de linha", status, amountCents };
    }).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    const monthDate = new Date(`${parsed.data.monthKey}-01T12:00:00-03:00`); const monthLabel = monthDate.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); const dueDateLabel = new Date(`${parsed.data.monthKey}-10T12:00:00-03:00`).toLocaleDateString("pt-BR");
    const pdf = await createPaymentsPdf({ monthLabel, dueDateLabel, rows });
    return new NextResponse(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="pagamentos-${parsed.data.monthKey}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (cause) {
    console.error("[pdf-payments] Falha ao gerar relatório", cause);
    return NextResponse.json({ error: "Não foi possível gerar o relatório financeiro." }, { status: 401 });
  }
}
