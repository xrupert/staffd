/**
 * T1-8 — setup-route auth gate contract.
 *
 * /api/setup/* routes run idempotent schema migrations against production
 * PocketBase. Pre-T1-8 they were completely open — anyone could POST and
 * re-run a migration. checkSetupAuth is the security contract enforced by
 * middleware on every /api/setup/* request.
 *
 * Fail-closed: if ADMIN_SECRET is not configured, setup is LOCKED (503),
 * never open. This forces the operator to configure the secret before any
 * setup route can run.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { checkSetupAuth, isSuperAdminSession, authorizeSetup } from "../../app/api/_lib/setup-auth";

describe("checkSetupAuth (T1-8 setup-route gate)", () => {
  it("fails CLOSED with 503 when ADMIN_SECRET is not configured", () => {
    expect(checkSetupAuth({ provided: "anything", expected: "" })).toMatchObject({ ok: false, status: 503 });
  });

  it("fails closed with 503 even when no header is provided and secret unset", () => {
    expect(checkSetupAuth({ provided: null, expected: undefined })).toMatchObject({ ok: false, status: 503 });
  });

  it("returns 401 when the provided secret does not match", () => {
    expect(checkSetupAuth({ provided: "wrong", expected: "s3cret" })).toMatchObject({ ok: false, status: 401 });
  });

  it("returns 401 when no header is provided but a secret is configured", () => {
    expect(checkSetupAuth({ provided: null, expected: "s3cret" })).toMatchObject({ ok: false, status: 401 });
  });

  it("authorizes when the provided secret matches exactly", () => {
    expect(checkSetupAuth({ provided: "s3cret", expected: "s3cret" })).toEqual({ ok: true });
  });

  it("does not authorize on a prefix / partial match", () => {
    expect(checkSetupAuth({ provided: "s3cre", expected: "s3cret" })).toMatchObject({ ok: false, status: 401 });
  });
});

// W95.3.4 — dual-auth: setup routes accept the shared secret OR a super-admin
// session JWT. Standard #24 — the alternate path is added, the gate not weakened.
describe("isSuperAdminSession (W95.3.4 super-admin JWT verification)", () => {
  const cfg = { pbUrl: "https://pb.test", adminEmail: "boss@staffd.com" };
  afterEach(() => vi.unstubAllGlobals());

  it("returns false for an empty token without hitting the network", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await isSuperAdminSession("", cfg)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns true when auth-refresh resolves to the admin email (case-insensitive)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ record: { email: "BOSS@staffd.com" } }) })));
    expect(await isSuperAdminSession("jwt", cfg)).toBe(true);
  });

  it("returns false when the session belongs to a non-admin user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ record: { email: "rando@x.com" } }) })));
    expect(await isSuperAdminSession("jwt", cfg)).toBe(false);
  });

  it("returns false when auth-refresh rejects the token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    expect(await isSuperAdminSession("jwt", cfg)).toBe(false);
  });
});

describe("authorizeSetup (W95.3.4 dual-auth combinator)", () => {
  const base = { expectedSecret: "s3cret", pbUrl: "https://pb.test", adminEmail: "boss@staffd.com" };
  afterEach(() => vi.unstubAllGlobals());

  it("authorizes via the shared secret without touching PB", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await authorizeSetup({ ...base, secretHeader: "s3cret", authHeader: null })).toEqual({ ok: true });
    expect(f).not.toHaveBeenCalled();
  });

  it("authorizes via a super-admin session JWT when the secret is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ record: { email: "boss@staffd.com" } }) })));
    expect(await authorizeSetup({ ...base, secretHeader: null, authHeader: "super-jwt" })).toEqual({ ok: true });
  });

  it("rejects with 401 when both the secret and the session are absent/invalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    expect(await authorizeSetup({ ...base, secretHeader: "wrong", authHeader: "bad-jwt" })).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a non-super-admin JWT (no secret) with 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ record: { email: "rando@x.com" } }) })));
    expect(await authorizeSetup({ ...base, secretHeader: null, authHeader: "user-jwt" })).toMatchObject({ ok: false, status: 401 });
  });

  it("still fails CLOSED (503) when ADMIN_SECRET is unset and no valid session is presented", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    expect(await authorizeSetup({ ...base, expectedSecret: "", secretHeader: null, authHeader: null })).toMatchObject({ ok: false, status: 503 });
  });
});
