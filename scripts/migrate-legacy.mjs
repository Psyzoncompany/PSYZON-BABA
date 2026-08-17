import { createHash } from "node:crypto";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const accountId = String(process.env.BABA_ACCOUNT_UID || "").trim();
const apply = process.argv.includes("--apply");
if (!accountId) throw new Error("Defina BABA_ACCOUNT_UID com o UID do organizador.");
const serviceJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const credential = serviceJson ? cert(JSON.parse(serviceJson)) : applicationDefault();
const app = getApps()[0] || initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID || "sitey-caixa-16e06" });
const db = getFirestore(app);

const mappings = [
  { source: "baba_players", target: `baba_accounts/${accountId}/players` },
  { source: "babas", target: `baba_accounts/${accountId}/babas` },
  { source: "baba_purchase_goals", target: `baba_accounts/${accountId}/purchase_goals` },
  { source: "player_stats", target: `baba_accounts/${accountId}/player_stats` },
];
const report = { mode: apply ? "apply" : "dry-run", accountId, collections: [], checksum: "" };
const checksum = createHash("sha256");

for (const mapping of mappings) {
  const snapshot = await db.collection(mapping.source).get();
  const target = db.collection(mapping.target);
  let existing = 0; let created = 0; let updated = 0;
  for (const source of snapshot.docs) {
    const data = source.data(); checksum.update(`${mapping.source}/${source.id}:${JSON.stringify(data)}`);
    const destination = target.doc(source.id); const current = await destination.get();
    if (current.exists) existing += 1;
    if (apply) {
      await destination.set({ ...data, schemaVersion: 3, migratedFrom: `${mapping.source}/${source.id}`, migratedAtMs: Date.now() }, { merge: true });
      if (current.exists) updated += 1;
      else created += 1;
    }
  }
  report.collections.push({ ...mapping, sourceCount: snapshot.size, existing, created, updated });
}
report.checksum = checksum.digest("hex");
console.log(JSON.stringify(report, null, 2));
console.log(apply ? "Migração aplicada de forma aditiva." : "Dry-run concluído. Execute novamente com --apply após revisar as contagens.");
