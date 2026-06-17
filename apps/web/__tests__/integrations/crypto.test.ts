/**
 * W91 — integration credential encryption (AES-256-GCM, v1: prefixed).
 * Round-trip, tamper detection, and fail-closed on a missing/invalid key.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// A valid 32-byte base64 key for the happy-path tests.
const KEY = Buffer.alloc(32, 7).toString("base64");

beforeEach(() => { vi.resetModules(); vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", KEY); });
afterEach(() => vi.unstubAllEnvs());

async function load() {
  return await import("../../app/api/_lib/integrations/crypto");
}

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret through the v1 format", async () => {
    const { encryptSecret, decryptSecret } = await load();
    const blob = encryptSecret("super-secret-key-123");
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob.split(":")).toHaveLength(4); // v1:iv:tag:ciphertext
    expect(blob).not.toContain("super-secret-key-123"); // not plaintext
    expect(decryptSecret(blob)).toBe("super-secret-key-123");
  });

  it("produces a different IV (ciphertext) each call for the same input", async () => {
    const { encryptSecret } = await load();
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("detects tampering — a modified ciphertext fails auth", async () => {
    const { encryptSecret, decryptSecret } = await load();
    const blob = encryptSecret("paycheck");
    const parts = blob.split(":");
    const tamperedCt = Buffer.from(parts[3]!, "base64");
    tamperedCt[0]! ^= 0xff;
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${tamperedCt.toString("base64")}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects an unknown version prefix", async () => {
    const { decryptSecret } = await load();
    expect(() => decryptSecret("v2:a:b:c")).toThrow(/version/i);
  });
});

describe("fail-closed on key config", () => {
  it("throws when INTEGRATION_ENCRYPTION_KEY is missing", async () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "");
    const { encryptSecret } = await load();
    expect(() => encryptSecret("x")).toThrow(/INTEGRATION_ENCRYPTION_KEY/);
  });

  it("throws when the key is not 32 bytes", async () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", Buffer.alloc(16, 1).toString("base64"));
    const { encryptSecret } = await load();
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});
