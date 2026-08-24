import { createHmac, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hashViewerCode } from "@/lib/auth/access-code";
import { createViewerSession, readViewerSession, VIEWER_COOKIE } from "@/lib/auth/session";
import { progressiveDelayMs } from "@/lib/auth/rate-limit";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

const inputSchema = z.object({
  code: z.string().regex(/^\d{4}$/),
  remember: z.boolean().default(true),
  deviceId: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/),
});

const MAX_BODY_BYTES = 2_048;
const RATE_WINDOW_MS = 5 * 60_000;

function clientIp(headerStore: Awaited<ReturnType<typeof headers>>): string {
  return headerStore.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || headerStore.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "local";
}

function fingerprint(ip: string, deviceId: string): string {
  const configuredSecret = process.env.BABA_RATE_LIMIT_SECRET || process.env.BABA_SESSION_SECRET;
  if (!configuredSecret && process.env.NODE_ENV === "production") throw new Error("BABA_RATE_LIMIT_SECRET não configurado.");
  const secret = configuredSecret || "development-rate-limit-secret";
  return createHmac("sha256", secret).update(`${ip}|${deviceId}`).digest("hex");
}

function jsonError(message: string, status: number, retryAfterSeconds?: number) {
  return NextResponse.json({ error: message }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : {}),
    },
  });
}

async function blockedUntil(key: string): Promise<number> {
  const snapshot = await getAdminDb().collection("baba_rate_limits").doc(key).get();
  return Number(snapshot.data()?.blockedUntilMs || 0);
}

async function recordFailedAttempt(key: string, now: number): Promise<number> {
  const db = getAdminDb();
  const ref = db.collection("baba_rate_limits").doc(key);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.data();
    const inWindow = Number(previous?.windowStartedAtMs || 0) + RATE_WINDOW_MS > now;
    const attempts = inWindow ? Number(previous?.attempts || 0) + 1 : 1;
    const delayMs = progressiveDelayMs(attempts);
    const nextBlockedUntil = now + delayMs;
    transaction.set(ref, {
      attempts,
      windowStartedAtMs: inWindow ? Number(previous?.windowStartedAtMs) : now,
      blockedUntilMs: nextBlockedUntil,
      expiresAtMs: now + 24 * 60 * 60_000,
      updatedAtMs: now,
    });
    return nextBlockedUntil;
  });
}

async function clearAttempts(key: string) {
  const timestamp = Date.now();
  await getAdminDb().collection("baba_rate_limits").doc(key).set({
    attempts: 0,
    blockedUntilMs: 0,
    windowStartedAtMs: timestamp,
    expiresAtMs: timestamp + 24 * 60 * 60_000,
    updatedAtMs: timestamp,
  }, { merge: true });
}

async function mintViewerToken(accountId: string, accessVersion: number, sessionId: string, sessionExpiresAt: number) {
  const accountDigest = createHmac("sha256", process.env.BABA_SESSION_SECRET || "development-session-secret")
    .update(accountId).digest("hex").slice(0, 24);
  return getAdminAuth().createCustomToken(`viewer_${accountDigest}_${sessionId}`, {
    role: "viewer",
    accountId,
    accessVersion,
    sessionExpiresAt,
  });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return jsonError("Solicitação muito grande.", 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return jsonError("Solicitação muito grande.", 413);
  const parsed = inputSchema.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
  if (!parsed.success) return jsonError("Digite o código completo de 4 dígitos.", 400);

  try {
    const headerStore = await headers();
    const key = fingerprint(clientIp(headerStore), parsed.data.deviceId);
    const now = Date.now();
    const currentBlock = await blockedUntil(key);
    if (currentBlock > now) {
      const seconds = Math.max(1, Math.ceil((currentBlock - now) / 1000));
      return jsonError(`Aguarde ${seconds}s antes de tentar novamente.`, 429, seconds);
    }

    const codeSnapshot = await getAdminDb().collection("baba_access_codes").doc(hashViewerCode(parsed.data.code)).get();
    const access = codeSnapshot.data();
    const accountId = typeof access?.accountId === "string" ? access.accountId : "";
    const accessVersion = Number(access?.accessVersion || 0);
    if (!codeSnapshot.exists || access?.active !== true || Number(access?.expiresAtMs || 0) <= now
      || !/^[\w-]{1,128}$/.test(accountId) || !Number.isSafeInteger(accessVersion) || accessVersion < 1) {
      const nextBlock = await recordFailedAttempt(key, now);
      if (nextBlock > now) return jsonError("Muitas tentativas. Aguarde antes de tentar novamente.", 429, Math.ceil((nextBlock - now) / 1000));
      return jsonError("Código inválido, revogado ou expirado.", 401);
    }

    const security = await getAdminDb().doc(`baba_accounts/${accountId}/meta/security`).get();
    if (!security.exists || Number(security.data()?.viewerAccessVersion || 0) !== accessVersion) {
      const nextBlock = await recordFailedAttempt(key, now);
      if (nextBlock > now) return jsonError("Muitas tentativas. Aguarde antes de tentar novamente.", 429, Math.ceil((nextBlock - now) / 1000));
      return jsonError("Código inválido, revogado ou expirado.", 401);
    }

    await clearAttempts(key);
    const sessionId = randomBytes(12).toString("hex");
    const sessionExpiresAt = now + (parsed.data.remember ? 30 * 24 * 60 * 60_000 : 12 * 60 * 60_000);
    const customToken = await mintViewerToken(accountId, accessVersion, sessionId, sessionExpiresAt);
    const response = NextResponse.json({ valid: true, accountId, role: "viewer", customToken }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(VIEWER_COOKIE, createViewerSession(accountId, accessVersion, parsed.data.remember, sessionId), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: parsed.data.remember ? 30 * 24 * 60 * 60 : undefined,
      priority: "high",
    });
    return response;
  } catch (cause) {
    console.error("[access] Falha ao validar acesso viewer", cause);
    return jsonError("O acesso seguro está indisponível. Tente novamente em instantes.", 503);
  }
}

export async function GET() {
  const cookieStore = await cookies();
  const session = readViewerSession(cookieStore.get(VIEWER_COOKIE)?.value);
  if (!session) return jsonError("Sessão não encontrada.", 401);

  try {
    const security = await getAdminDb().doc(`baba_accounts/${session.accountId}/meta/security`).get();
    if (!security.exists || Number(security.data()?.viewerAccessVersion || 0) !== session.accessVersion) {
      const response = jsonError("Sessão revogada.", 401);
      response.cookies.set(VIEWER_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
      return response;
    }
    const customToken = await mintViewerToken(session.accountId, session.accessVersion, session.sessionId, session.expiresAt);
    return NextResponse.json({ authenticated: true, accountId: session.accountId, role: "viewer", customToken }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[access] Falha ao restaurar sessão viewer", cause);
    return jsonError("Não foi possível restaurar o acesso.", 503);
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(VIEWER_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
