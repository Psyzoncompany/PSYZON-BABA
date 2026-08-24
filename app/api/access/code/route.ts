import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { decryptViewerCode, encryptViewerCode, hashViewerCode } from "@/lib/auth/access-code";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function organizerId(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new Error("UNAUTHENTICATED");
  const decoded = await getAdminAuth().verifyIdToken(token, true);
  if (decoded.role === "viewer") throw new Error("FORBIDDEN");
  return decoded.uid;
}

async function uniqueCode(accountId: string): Promise<{ code: string; hash: string }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const code = String(randomInt(0, 10_000)).padStart(4, "0");
    const hash = hashViewerCode(code);
    const existing = await getAdminDb().collection("baba_access_codes").doc(hash).get();
    if (!existing.exists || existing.data()?.accountId === accountId) return { code, hash };
  }
  throw new Error("CODE_SPACE_BUSY");
}

export async function GET(request: Request) {
  try {
    const accountId = await organizerId(request);
    const snapshot = await getAdminDb().collection("baba_access_config").doc(accountId).get();
    const encryptedCode = snapshot.data()?.encryptedCode;
    const code = typeof encryptedCode === "string" ? decryptViewerCode(encryptedCode) : null;
    return NextResponse.json({ active: snapshot.data()?.active === true && Boolean(code), code }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (message === "UNAUTHENTICATED") return error("Entre novamente como organizador.", 401);
    if (message === "FORBIDDEN") return error("Este acesso não pode administrar códigos.", 403);
    return error("Não foi possível consultar o código.", 503);
  }
}

export async function POST(request: Request) {
  try {
    const accountId = await organizerId(request);
    const db = getAdminDb();
    const configRef = db.collection("baba_access_config").doc(accountId);
    const securityRef = db.doc(`baba_accounts/${accountId}/meta/security`);
    const previous = await configRef.get();
    const { code, hash } = await uniqueCode(accountId);
    const timestamp = Date.now();

    const accessVersion = await db.runTransaction(async (transaction) => {
      const security = await transaction.get(securityRef);
      const nextVersion = Math.max(0, Number(security.data()?.viewerAccessVersion || 0)) + 1;
      const oldHash = previous.data()?.currentCodeHash;
      if (typeof oldHash === "string" && oldHash !== hash) {
        transaction.set(db.collection("baba_access_codes").doc(oldHash), { active: false, revokedAtMs: timestamp, updatedAtMs: timestamp }, { merge: true });
      }
      transaction.set(db.collection("baba_access_codes").doc(hash), {
        accountId,
        accessVersion: nextVersion,
        active: true,
        expiresAtMs: 253402300799000,
        createdAtMs: timestamp,
        updatedAtMs: timestamp,
        schemaVersion: 2,
      });
      transaction.set(configRef, {
        accountId,
        currentCodeHash: hash,
        encryptedCode: encryptViewerCode(code),
        accessVersion: nextVersion,
        active: true,
        expiresAtMs: 253402300799000,
        updatedAtMs: timestamp,
        updatedBy: accountId,
        schemaVersion: 2,
      }, { merge: true });
      transaction.set(securityRef, { viewerAccessVersion: nextVersion, updatedAtMs: timestamp, schemaVersion: 3 }, { merge: true });
      transaction.create(db.collection("baba_accounts").doc(accountId).collection("audit").doc(), {
        action: previous.exists ? "viewer_code_rotated" : "viewer_code_created",
        actorId: accountId,
        createdAtMs: timestamp,
        schemaVersion: 3,
      });
      return nextVersion;
    });

    return NextResponse.json({ code, active: true, accessVersion }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[access-code] Falha ao rotacionar código", cause);
    const message = cause instanceof Error ? cause.message : "";
    if (message === "UNAUTHENTICATED") return error("Entre novamente como organizador.", 401);
    if (message === "FORBIDDEN") return error("Este acesso não pode administrar códigos.", 403);
    return error("Não foi possível gerar um código seguro.", 503);
  }
}

export async function DELETE(request: Request) {
  try {
    const accountId = await organizerId(request);
    const db = getAdminDb();
    const configRef = db.collection("baba_access_config").doc(accountId);
    const securityRef = db.doc(`baba_accounts/${accountId}/meta/security`);
    const timestamp = Date.now();
    await db.runTransaction(async (transaction) => {
      const [config, security] = await Promise.all([transaction.get(configRef), transaction.get(securityRef)]);
      const nextVersion = Math.max(0, Number(security.data()?.viewerAccessVersion || 0)) + 1;
      const oldHash = config.data()?.currentCodeHash;
      if (typeof oldHash === "string") transaction.set(db.collection("baba_access_codes").doc(oldHash), { active: false, revokedAtMs: timestamp, updatedAtMs: timestamp }, { merge: true });
      transaction.set(configRef, { active: false, accessVersion: nextVersion, updatedAtMs: timestamp }, { merge: true });
      transaction.set(securityRef, { viewerAccessVersion: nextVersion, updatedAtMs: timestamp, schemaVersion: 3 }, { merge: true });
      transaction.create(db.collection("baba_accounts").doc(accountId).collection("audit").doc(), { action: "viewer_code_revoked", actorId: accountId, createdAtMs: timestamp, schemaVersion: 3 });
    });
    return NextResponse.json({ active: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[access-code] Falha ao revogar código", cause);
    return error("Não foi possível revogar o código.", 503);
  }
}
