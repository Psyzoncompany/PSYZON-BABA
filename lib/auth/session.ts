import { createHmac, timingSafeEqual } from "node:crypto";

export const VIEWER_COOKIE = "psyzon_viewer_session";

interface ViewerSession {
  accountId: string;
  role: "viewer";
  accessVersion: number;
  sessionId: string;
  expiresAt: number;
  version: 2;
}

function secret() {
  const value = process.env.BABA_SESSION_SECRET;
  if (!value && process.env.NODE_ENV === "production") throw new Error("BABA_SESSION_SECRET não configurado.");
  return value || "development-only-session-secret-change-me";
}

function encode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createViewerSession(accountId: string, accessVersion: number, remember: boolean, sessionId: string): string {
  const lifetimeMs = remember ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  const payload = encode(JSON.stringify({ accountId, role: "viewer", accessVersion, sessionId, expiresAt: Date.now() + lifetimeMs, version: 2 } satisfies ViewerSession));
  return `${payload}.${sign(payload)}`;
}

export function readViewerSession(token?: string | null): ViewerSession | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ViewerSession;
    if (value.role !== "viewer" || value.version !== 2 || value.expiresAt <= Date.now()
      || !/^[\w-]{1,128}$/.test(value.accountId) || !Number.isSafeInteger(value.accessVersion)
      || value.accessVersion < 1 || !/^[a-f0-9]{24}$/.test(value.sessionId)) return null;
    return value;
  } catch { return null; }
}
