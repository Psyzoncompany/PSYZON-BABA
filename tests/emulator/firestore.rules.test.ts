import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";

let environment: RulesTestEnvironment;
const projectId = "sitey-caixa-16e06";
const accountId = "owner-account-123";
const otherAccountId = "other-account-456";
const future = Date.now() + 60 * 60_000;

beforeAll(async () => {
  const [host, rawPort] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(rawPort), rules: readFileSync("firestore.rules", "utf8") },
    storage: { host: "127.0.0.1", port: Number((process.env.FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1:9199").split(":")[1]), rules: readFileSync("storage.rules", "utf8") },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "baba_accounts", accountId, "meta", "security"), { viewerAccessVersion: 2, updatedAtMs: Date.now() });
    await setDoc(doc(db, "baba_accounts", accountId, "players", "p1"), { id: "p1", name: "Jogador", type: "linha", status: "regular", active: true, updatedAtMs: 1 });
    await uploadBytes(ref(context.storage(), `baba_accounts/${accountId}/players/p1.png`), new Uint8Array([137, 80, 78, 71]), { contentType: "image/png" });
  });
});

describe("arquivos por conta", () => {
  it("permite imagem do organizador e bloqueia tipo inválido e exclusão", async () => {
    const storage = environment.authenticatedContext(accountId).storage();
    await assertSucceeds(uploadBytes(ref(storage, `baba_accounts/${accountId}/goals/g1.webp`), new Uint8Array([1, 2, 3]), { contentType: "image/webp" }));
    await assertFails(uploadBytes(ref(storage, `baba_accounts/${accountId}/goals/g1.txt`), new Uint8Array([1]), { contentType: "text/plain" }));
    await assertFails(deleteObject(ref(storage, `baba_accounts/${accountId}/players/p1.png`)));
  });

  it("viewer atual lê, mas nunca grava", async () => {
    const storage = environment.authenticatedContext("viewer-storage", { role: "viewer", accountId, accessVersion: 2, sessionExpiresAt: future }).storage();
    await assertSucceeds(getBytes(ref(storage, `baba_accounts/${accountId}/players/p1.png`)));
    await assertFails(uploadBytes(ref(storage, `baba_accounts/${accountId}/players/viewer.png`), new Uint8Array([1]), { contentType: "image/png" }));
  });

  it("nega viewer rotacionado e conta diferente", async () => {
    const stale = environment.authenticatedContext("viewer-storage-stale", { role: "viewer", accountId, accessVersion: 1, sessionExpiresAt: future }).storage();
    const other = environment.authenticatedContext(otherAccountId).storage();
    await assertFails(getBytes(ref(stale, `baba_accounts/${accountId}/players/p1.png`)));
    await assertFails(getBytes(ref(other, `baba_accounts/${accountId}/players/p1.png`)));
  });
});

afterAll(async () => environment.cleanup());

describe("isolamento multi-tenant", () => {
  it("permite ao organizador ler e gravar somente a própria conta", async () => {
    const owner = environment.authenticatedContext(accountId).firestore();
    const other = environment.authenticatedContext(otherAccountId).firestore();
    await assertSucceeds(getDoc(doc(owner, "baba_accounts", accountId, "players", "p1")));
    await assertSucceeds(setDoc(doc(owner, "baba_accounts", accountId, "players", "p2"), { id: "p2", name: "Novo", type: "goleiro", status: "regular", active: true, updatedAtMs: 2 }));
    await assertFails(getDoc(doc(other, "baba_accounts", accountId, "players", "p1")));
    await assertFails(setDoc(doc(other, "baba_accounts", accountId, "players", "p3"), { id: "p3", name: "Intruso", type: "linha", status: "regular", active: true, updatedAtMs: 2 }));
  });

  it("impede hard delete mesmo para o organizador", async () => {
    const owner = environment.authenticatedContext(accountId).firestore();
    await assertFails(deleteDoc(doc(owner, "baba_accounts", accountId, "players", "p1")));
  });
});

describe("viewer por claims", () => {
  it("lê a conta correta e nunca escreve", async () => {
    const viewer = environment.authenticatedContext("viewer-session", { role: "viewer", accountId, accessVersion: 2, sessionExpiresAt: future }).firestore();
    await assertSucceeds(getDoc(doc(viewer, "baba_accounts", accountId, "players", "p1")));
    await assertFails(setDoc(doc(viewer, "baba_accounts", accountId, "players", "p2"), { id: "p2", name: "Viewer", type: "linha", status: "regular", active: true, updatedAtMs: 2 }));
  });

  it("nega sessão rotacionada, expirada e outra conta", async () => {
    const stale = environment.authenticatedContext("viewer-stale", { role: "viewer", accountId, accessVersion: 1, sessionExpiresAt: future }).firestore();
    const expired = environment.authenticatedContext("viewer-expired", { role: "viewer", accountId, accessVersion: 2, sessionExpiresAt: 1 }).firestore();
    const wrongTenant = environment.authenticatedContext("viewer-other", { role: "viewer", accountId: otherAccountId, accessVersion: 2, sessionExpiresAt: future }).firestore();
    await assertFails(getDoc(doc(stale, "baba_accounts", accountId, "players", "p1")));
    await assertFails(getDoc(doc(expired, "baba_accounts", accountId, "players", "p1")));
    await assertFails(getDoc(doc(wrongTenant, "baba_accounts", accountId, "players", "p1")));
  });

  it("não acessa índice de códigos nem coleções globais legadas", async () => {
    const viewer = environment.authenticatedContext("viewer-session", { role: "viewer", accountId, accessVersion: 2, sessionExpiresAt: future }).firestore();
    await assertFails(getDoc(doc(viewer, "baba_access_codes", "a".repeat(64))));
    await assertFails(getDoc(doc(viewer, "baba_commission_config", accountId)));
    await assertFails(getDoc(doc(viewer, "baba_players", "p1")));
  });
});
