import "server-only";

import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";

export interface RequestIdentity {
  uid: string;
  accountId: string;
  role: "organizer" | "viewer";
}

export async function requireRequestIdentity(request: Request): Promise<RequestIdentity> {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new Error("UNAUTHENTICATED");
  const decoded = await getAdminAuth().verifyIdToken(token, true);
  if (decoded.role === "viewer") {
    const accountId = typeof decoded.accountId === "string" ? decoded.accountId : "";
    const accessVersion = Number(decoded.accessVersion);
    const sessionExpiresAt = Number(decoded.sessionExpiresAt);
    if (!accountId || !Number.isSafeInteger(accessVersion) || accessVersion < 1
      || !Number.isSafeInteger(sessionExpiresAt) || sessionExpiresAt <= Date.now()) throw new Error("FORBIDDEN");
    const security = await getAdminDb().doc(`baba_accounts/${accountId}/meta/security`).get();
    if (!security.exists || Number(security.data()?.viewerAccessVersion) !== accessVersion) throw new Error("FORBIDDEN");
    return { uid: decoded.uid, accountId, role: "viewer" };
  }
  return { uid: decoded.uid, accountId: decoded.uid, role: "organizer" };
}
