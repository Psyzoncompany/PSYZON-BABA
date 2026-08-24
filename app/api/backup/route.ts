import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldPath, GeoPoint, Timestamp, type DocumentData, type DocumentReference } from "firebase-admin/firestore";
import { z } from "zod";
import { requireRequestIdentity } from "@/lib/auth/request-auth";
import { getAdminDb } from "@/lib/firebase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_DOCUMENTS = 10_000;
const BLOCKED_COLLECTIONS = new Set(["security", "rate_limits", "audit"]);

const backupDocumentSchema = z.object({
  path: z.string().min(3).max(600),
  data: z.record(z.string(), z.unknown()),
});

const backupSchema = z.object({
  schemaVersion: z.literal(3),
  kind: z.literal("baba-psyzon-backup"),
  exportedAt: z.string().datetime(),
  sourceAccountId: z.string().min(1).max(128),
  documents: z.array(backupDocumentSchema).max(MAX_DOCUMENTS),
});

const importSchema = z.object({
  mode: z.enum(["preview", "apply"]),
  confirmation: z.string().optional(),
  backup: backupSchema,
});

function jsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Timestamp) return { $type: "timestamp", value: value.toDate().toISOString() };
  if (value instanceof GeoPoint) return { $type: "geopoint", latitude: value.latitude, longitude: value.longitude };
  if (value instanceof Date) return { $type: "date", value: value.toISOString() };
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    const reference = value as Partial<DocumentReference>;
    if (typeof reference.path === "string" && typeof reference.firestore === "object") {
      return { $type: "reference", path: reference.path };
    }
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonValue(item)]));
  }
  return String(value);
}

function firestoreValue(value: unknown, accountId: string): unknown {
  if (Array.isArray(value)) return value.map((item) => firestoreValue(item, accountId));
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  if (object.$type === "timestamp" && typeof object.value === "string") return Timestamp.fromDate(new Date(object.value));
  if (object.$type === "date" && typeof object.value === "string") return new Date(object.value);
  if (object.$type === "geopoint" && typeof object.latitude === "number" && typeof object.longitude === "number") return new GeoPoint(object.latitude, object.longitude);
  if (object.$type === "reference" && typeof object.path === "string") {
    const prefix = `baba_accounts/${accountId}/`;
    return object.path.startsWith(prefix) ? getAdminDb().doc(object.path) : object.path;
  }
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, firestoreValue(item, accountId)]));
}

function validRelativePath(path: string) {
  const parts = path.split("/");
  return parts.length >= 2
    && parts.length % 2 === 0
    && parts.every((part) => part.length > 0 && part !== "." && part !== "..")
    && !BLOCKED_COLLECTIONS.has(parts[0]);
}

async function collectDocument(reference: DocumentReference, relativePath: string, target: Array<{ path: string; data: DocumentData }>) {
  if (target.length >= MAX_DOCUMENTS) throw new Error("BACKUP_TOO_LARGE");
  const snapshot = await reference.get();
  if (snapshot.exists) target.push({ path: relativePath, data: jsonValue(snapshot.data()) as DocumentData });
  const collections = await reference.listCollections();
  for (const childCollection of collections) {
    if (BLOCKED_COLLECTIONS.has(childCollection.id)) continue;
    const children = await childCollection.orderBy(FieldPath.documentId()).get();
    for (const child of children.docs) {
      await collectDocument(child.ref, `${relativePath}/${childCollection.id}/${child.id}`, target);
    }
  }
}

async function createBackup(accountId: string) {
  const account = getAdminDb().collection("baba_accounts").doc(accountId);
  const documents: Array<{ path: string; data: DocumentData }> = [];
  const collections = await account.listCollections();
  for (const childCollection of collections) {
    if (BLOCKED_COLLECTIONS.has(childCollection.id)) continue;
    const children = await childCollection.orderBy(FieldPath.documentId()).get();
    for (const child of children.docs) await collectDocument(child.ref, `${childCollection.id}/${child.id}`, documents);
  }
  return {
    schemaVersion: 3 as const,
    kind: "baba-psyzon-backup" as const,
    exportedAt: new Date().toISOString(),
    sourceAccountId: accountId,
    documents,
  };
}

async function requireOrganizer(request: Request) {
  const identity = await requireRequestIdentity(request);
  if (identity.role !== "organizer") throw new Error("FORBIDDEN");
  return identity;
}

export async function GET(request: Request) {
  try {
    const identity = await requireOrganizer(request);
    const backup = await createBackup(identity.accountId);
    const body = JSON.stringify(backup, null, 2);
    if (Buffer.byteLength(body) > MAX_BYTES) return NextResponse.json({ error: "O backup excede o limite de 25 MB." }, { status: 413 });
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="baba-psyzon-backup-${date}.json"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (cause) {
    console.error("[backup] Falha ao exportar", cause);
    return NextResponse.json({ error: "Não foi possível exportar o backup." }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireOrganizer(request);
    const declaredSize = Number(request.headers.get("content-length") || 0);
    if (declaredSize > MAX_BYTES) return NextResponse.json({ error: "O arquivo excede o limite de 25 MB." }, { status: 413 });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BYTES) return NextResponse.json({ error: "O arquivo excede o limite de 25 MB." }, { status: 413 });
    const parsed = importSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return NextResponse.json({ error: "Backup inválido ou de versão incompatível." }, { status: 400 });

    const paths = new Set<string>();
    for (const document of parsed.data.backup.documents) {
      if (!validRelativePath(document.path) || paths.has(document.path)) {
        return NextResponse.json({ error: "O backup contém caminhos inválidos ou duplicados." }, { status: 400 });
      }
      paths.add(document.path);
    }
    const collections = [...new Set(parsed.data.backup.documents.map((item) => item.path.split("/")[0]))].sort();
    const checksum = createHash("sha256").update(JSON.stringify(parsed.data.backup.documents)).digest("hex");
    const summary = { documents: paths.size, collections, checksum, sourceAccountId: parsed.data.backup.sourceAccountId, exportedAt: parsed.data.backup.exportedAt };
    if (parsed.data.mode === "preview") return NextResponse.json(summary);
    if (parsed.data.confirmation !== "IMPORTAR") return NextResponse.json({ error: "Confirmação de importação ausente." }, { status: 400 });

    const account = getAdminDb().collection("baba_accounts").doc(identity.accountId);
    for (let start = 0; start < parsed.data.backup.documents.length; start += 350) {
      const batch = getAdminDb().batch();
      for (const item of parsed.data.backup.documents.slice(start, start + 350)) {
        batch.set(account.collection(item.path.split("/")[0]).doc(item.path.split("/").slice(1).join("/")), firestoreValue(item.data, identity.accountId) as DocumentData, { merge: true });
      }
      await batch.commit();
    }
    const timestamp = Date.now();
    await Promise.all([
      account.collection("imports").doc(`backup-${checksum.slice(0, 20)}`).set({ type: "backup", checksum, documentCount: paths.size, sourceAccountId: parsed.data.backup.sourceAccountId, createdAtMs: timestamp, createdBy: identity.uid, schemaVersion: 3 }, { merge: true }),
      account.collection("audit").add({ action: "backup.imported", checksum, documentCount: paths.size, actorUid: identity.uid, createdAtMs: timestamp, schemaVersion: 3 }),
    ]);
    return NextResponse.json({ ...summary, imported: true });
  } catch (cause) {
    console.error("[backup] Falha ao importar", cause);
    return NextResponse.json({ error: "Não foi possível validar ou importar o backup." }, { status: 400 });
  }
}
