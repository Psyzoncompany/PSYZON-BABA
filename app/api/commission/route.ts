import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(72).regex(/[a-z]/, "Use uma letra minúscula.").regex(/[A-Z]/, "Use uma letra maiúscula.").regex(/\d/, "Use um número."),
  confirmation: z.string(),
}).refine((value) => value.password === value.confirmation, { message: "As senhas não coincidem.", path: ["confirmation"] });

function responseError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function verifiedGoogleOrganizer(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new Error("UNAUTHENTICATED");
  const decoded = await getAdminAuth().verifyIdToken(token, true);
  if (decoded.role === "viewer" || decoded.firebase?.sign_in_provider !== "google.com") throw new Error("GOOGLE_REQUIRED");
  if (Date.now() / 1_000 - decoded.auth_time > 10 * 60) throw new Error("RECENT_LOGIN_REQUIRED");
  return decoded;
}

export async function GET(request: Request) {
  try {
    const decoded = await verifiedGoogleOrganizer(request);
    const config = await getAdminDb().collection("baba_commission_config").doc(decoded.uid).get();
    return NextResponse.json({ active: config.data()?.active === true, email: decoded.email || config.data()?.email || null }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "";
    if (code === "GOOGLE_REQUIRED" || code === "RECENT_LOGIN_REQUIRED") return responseError("Entre novamente com Google para administrar a comissão.", 403);
    return responseError("Entre novamente como organizador.", 401);
  }
}

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 4_096) return responseError("Solicitação muito grande.", 413);
  try {
    const decoded = await verifiedGoogleOrganizer(request);
    const raw = await request.text(); if (Buffer.byteLength(raw) > 4_096) return responseError("Solicitação muito grande.", 413);
    const parsed = schema.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
    if (!parsed.success) return responseError(parsed.error.issues[0]?.message || "Dados inválidos.", 400);
    if (!decoded.email || parsed.data.email.trim().toLocaleLowerCase("en-US") !== decoded.email.toLocaleLowerCase("en-US")) {
      return responseError("Use exatamente o e-mail da conta Google do organizador.", 400);
    }
    await getAdminAuth().updateUser(decoded.uid, { password: parsed.data.password });
    const timestamp = Date.now(); const db = getAdminDb();
    await Promise.all([
      db.collection("baba_commission_config").doc(decoded.uid).set({ accountId: decoded.uid, email: decoded.email, active: true, updatedAtMs: timestamp, updatedBy: decoded.uid, schemaVersion: 3 }, { merge: true }),
      db.collection("baba_accounts").doc(decoded.uid).collection("audit").add({ action: "commission_password_changed", actorId: decoded.uid, createdAtMs: timestamp, schemaVersion: 3 }),
    ]);
    return NextResponse.json({ active: true, email: decoded.email }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[commission] Falha ao atualizar senha", cause);
    const code = cause instanceof Error ? cause.message : "";
    if (code === "GOOGLE_REQUIRED" || code === "RECENT_LOGIN_REQUIRED") return responseError("Entre novamente com Google para trocar a senha da comissão.", 403);
    return responseError("Não foi possível atualizar a senha da comissão.", 500);
  }
}
