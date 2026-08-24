import "server-only";

import { getAdminAuth } from "@/lib/firebase/admin";

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
    if (!accountId) throw new Error("FORBIDDEN");
    return { uid: decoded.uid, accountId, role: "viewer" };
  }
  return { uid: decoded.uid, accountId: decoded.uid, role: "organizer" };
}

