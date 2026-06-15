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

import { describe, it, expect } from "vitest";
import { checkSetupAuth } from "../../app/api/_lib/setup-auth";

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
