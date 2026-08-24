import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRequestIdentity } from "@/lib/auth/request-auth";
import { loadHistoricalRankings } from "@/lib/firebase/history-ranking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  scope: z.enum(["general", "month", "goalkeeper", "history"]),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export async function GET(request: Request) {
  try {
    const identity = await requireRequestIdentity(request);
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ scope: url.searchParams.get("scope"), month: url.searchParams.get("month") || undefined });
    if (!parsed.success) {
      return NextResponse.json({ error: "Período do ranking inválido." }, { status: 400 });
    }
    if ((parsed.data.scope === "month" || parsed.data.scope === "history") && !parsed.data.month) {
      return NextResponse.json({ error: "Período do ranking inválido." }, { status: 400 });
    }
    const month = parsed.data.scope === "month" || parsed.data.scope === "history" ? parsed.data.month : undefined;
    const result = await loadHistoricalRankings(identity.accountId, month);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (cause) {
    console.error("[rankings] Falha ao reconstruir histórico", cause);
    const unauthorized = cause instanceof Error && ["UNAUTHENTICATED", "FORBIDDEN"].includes(cause.message);
    return NextResponse.json({ error: unauthorized ? "Entre novamente para ver o ranking." : "Não foi possível carregar o ranking pelo histórico." }, { status: unauthorized ? 401 : 500 });
  }
}
