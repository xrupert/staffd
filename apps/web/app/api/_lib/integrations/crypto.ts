/**
 * W91 — credential encryption at rest (AES-256-GCM).
 *
 * Stored blob format: "v1:<iv-b64>:<authTag-b64>:<ciphertext-b64>".
 * The "v1:" version prefix is deliberate — it lets a future tranche (V2)
 * introduce a new scheme / rotate keys without breaking existing rows: the
 * decryptor dispatches on the prefix.
 *
 * Fail-closed: every call validates INTEGRATION_ENCRYPTION_KEY (a base64
 * 32-byte key). Missing or wrong-length → throw. We NEVER silently store
 * plaintext.
 *
 * PB has no native field encryption (any version), so app-layer crypto is
 * genuinely required here (Standard #20).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function key(): Buffer {
  const raw = (process.env.INTEGRATION_ENCRYPTION_KEY ?? "").trim();
  if (!raw) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is not set — credential encryption is unavailable (fail-closed).");
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(`INTEGRATION_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}).`);
  }
  return buf;
}

/** Encrypt a plaintext secret → "v1:iv:tag:ciphertext" (all base64). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** Decrypt a stored blob. Throws on unknown version or failed auth (tamper). */
export function decryptSecret(blob: string): string {
  const [version, ivB64, tagB64, ctB64] = blob.split(":");
  if (version !== "v1") {
    throw new Error(`Unsupported credential version: ${version ?? "(none)"}`);
  }
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("Malformed credential blob.");
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
  return pt.toString("utf8");
}

/** Masked display hint for a key — never returns the plaintext. */
export function maskKey(last4: string | null | undefined): string {
  return last4 ? `••••${last4}` : "(not configured)";
}
