import "server-only";

import { applicationDefault, cert, getApp, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function readServiceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ServiceAccount & { private_key?: string; privateKey?: string };
    const privateKey = parsed.privateKey ?? parsed.private_key;
    return {
      ...parsed,
      privateKey: typeof privateKey === "string" ? privateKey.replace(/\\n/g, "\n") : privateKey,
    };
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON não contém um JSON válido.");
  }
}

function adminApp(): App {
  if (getApps().length) return getApp();
  const serviceAccount = readServiceAccount();
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "sitey-caixa-16e06";

  return initializeApp({
    projectId,
    credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
  });
}

export function getAdminAuth() {
  return getAuth(adminApp());
}

export function getAdminDb() {
  return getFirestore(adminApp());
}

