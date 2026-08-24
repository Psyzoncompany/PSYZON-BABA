import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRequestIdentity } from "@/lib/auth/request-auth";
import { getAdminDb } from "@/lib/firebase/admin";
import { createManualSheetPdf } from "@/lib/pdf/reports";
import type { Player, Team } from "@/lib/domain/types";

export const runtime = "nodejs";
const schema = z.object({ babaId: z.string().min(1).max(128) });

export async function POST(request: Request) {
  try {
    const identity = await requireRequestIdentity(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Baba inválido." }, { status: 400 });
    const db = getAdminDb(); const account = db.collection("baba_accounts").doc(identity.accountId); const babaRef = account.collection("babas").doc(parsed.data.babaId);
    const [baba, teamsSnapshot, playersSnapshot] = await Promise.all([babaRef.get(), babaRef.collection("teams").get(), account.collection("players").get()]);
    if (!baba.exists || baba.data()?.matchMode !== "manual") return NextResponse.json({ error: "Ficha disponível somente para um baba manual." }, { status: 404 });
    const teams = teamsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Team)).filter((team) => team.active !== false).sort((a, b) => a.order - b.order);
    const players = playersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Player));
    const dateKey = String(baba.data()?.dateKey || ""); const dateLabel = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? new Date(`${dateKey}T12:00:00-03:00`).toLocaleDateString("pt-BR") : dateKey;
    const pdf = await createManualSheetPdf({ dateLabel, teams, players });
    return new NextResponse(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="ficha-manual-${dateKey}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (cause) {
    console.error("[pdf-manual] Falha ao gerar ficha", cause);
    return NextResponse.json({ error: "Não foi possível gerar a ficha." }, { status: 401 });
  }
}

