import "server-only";

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

function accessSecret(): string {
  const value = process.env.BABA_ACCESS_CODE_SECRET || process.env.BABA_SESSION_SECRET;
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error("BABA_ACCESS_CODE_SECRET não configurado.");
  }
  return value || "development-only-access-secret-change-me";
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(`encryption:${accessSecret()}`).digest();
}

export function hashViewerCode(code: string): string {
  return createHmac("sha256", accessSecret()).update(`viewer-code:${code}`).digest("hex");
}

export function encryptViewerCode(code: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptViewerCode(value: string): string | null {
  const [version, encodedIv, encodedTag, encodedData] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedData) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encodedData, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

