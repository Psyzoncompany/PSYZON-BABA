import { createHmac, timingSafeEqual } from "node:crypto";

export const VIEWER_COOKIE = "psyzon_viewer_session";

interface ViewerSession {
  accountId: string;
  role: "viewer";
  expiresAt: number;
  version: 1;
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

export function createViewerSession(accountId: string): string {
  const payload = encode(JSON.stringify({ accountId, role: "viewer", expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, version: 1 } satisfies ViewerSession));
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
    if (value.role !== "viewer" || value.version !== 1 || value.expiresAt <= Date.now() || !/^[\w-]{1,128}$/.test(value.accountId)) return null;
    return value;
  } catch { return null; }
}
