import { createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createViewerSession, readViewerSession, VIEWER_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";
const inputSchema = z.object({ code: z.string().regex(/^\d{4}$/), remember: z.boolean().default(true) });
const attempts = new Map<string, { count: number; resetAt: number }>();

function stringField(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const field = value as { stringValue?: string };
  return String(field.stringValue || "");
}

function boolField(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { booleanValue?: boolean }).booleanValue);
}

function numberField(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const field = value as { integerValue?: string; doubleValue?: number };
  return Number(field.integerValue ?? field.doubleValue ?? 0);
}

export async function POST(request: Request) {
  const headerStore = await headers();
  const ip = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const attempt = attempts.get(ip);
  if (attempt && attempt.resetAt > now && attempt.count >= 8) {
    return NextResponse.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, { status: 429, headers: { "Retry-After": "300" } });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Digite o código completo de 4 dígitos." }, { status: 400 });
  attempts.set(ip, { count: attempt?.resetAt && attempt.resetAt > now ? attempt.count + 1 : 1, resetAt: now + 5 * 60_000 });

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "sitey-caixa-16e06";
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyANqzrj3lzHUqMbClwcVHAVQjswjp1nUiY";
  const hash = createHash("sha256").update(parsed.data.code).digest("hex");
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/baba_access_codes/${hash}?key=${apiKey}`;
  const remote = await fetch(url, { cache: "no-store" });
  if (!remote.ok) return NextResponse.json({ error: "Código inválido, revogado ou expirado." }, { status: 401 });
  const document = await remote.json() as { fields?: Record<string, unknown> };
  const fields = document.fields || {};
  const accountId = stringField(fields.accountId).replace(/[^\w-]/g, "").slice(0, 128);
  if (!accountId || !boolField(fields.active) || numberField(fields.expiresAtMs) <= now) {
    return NextResponse.json({ error: "Código inválido, revogado ou expirado." }, { status: 401 });
  }

  attempts.delete(ip);
  const response = NextResponse.json({ valid: true, accountId, role: "viewer" });
  response.cookies.set(VIEWER_COOKIE, createViewerSession(accountId), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/",
    maxAge: parsed.data.remember ? 30 * 24 * 60 * 60 : undefined,
  });
  return response;
}

export async function GET() {
  const cookieStore = await cookies();
  const session = readViewerSession(cookieStore.get(VIEWER_COOKIE)?.value);
  return NextResponse.json(session ? { authenticated: true, ...session } : { authenticated: false }, { status: session ? 200 : 401 });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(VIEWER_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
