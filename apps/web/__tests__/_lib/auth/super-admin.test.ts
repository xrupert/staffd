/**
 * PR-Tranche-1.5 — super-admin shared helper tests (Decision 74).
 *
 * Covers:
 *   - isSuperAdmin: matching email, mismatch, null user, missing ADMIN_EMAIL,
 *     case + whitespace normalization
 *   - requireSuperAdmin: missing token → 401, invalid token → 401,
 *     non-admin email → 403, missing ADMIN_EMAIL → 503, super-admin → success
 *   - SuperAdminAuthError carries status + errorCode
 *   - toAuthErrorResponse converts to JSON Response with correct status
 *   - trySuperAdminFromToken: non-throwing variant
 *   - trySuperAdminByUserId: non-throwing variant, fetches via admin token
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "fake_admin_token",
  pbUrl: () => "https://pb.example.test",
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
}));

import {
  isSuperAdmin,
  requireSuperAdmin,
  SuperAdminAuthError,
  toAuthErrorResponse,
  trySuperAdminFromToken,
  trySuperAdminByUserId,
  type SuperAdminUser,
} from "../../../app/api/_lib/auth/super-admin";

const ADMIN_EMAIL = "admin@staffd.test";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

beforeEach(() => {
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ADMIN_EMAIL;
});

// ─── isSuperAdmin ───────────────────────────────────────────────────────

describe("isSuperAdmin", () => {
  it("returns true for matching email", () => {
    const user: SuperAdminUser = { id: "u1", email: ADMIN_EMAIL };
    expect(isSuperAdmin(user)).toBe(true);
  });

  it("returns false for non-matching email", () => {
    expect(isSuperAdmin({ id: "u1", email: "other@example.com" })).toBe(false);
  });

  it("returns false for null user", () => {
    expect(isSuperAdmin(null)).toBe(false);
    expect(isSuperAdmin(undefined)).toBe(false);
  });

  it("normalizes whitespace and case", () => {
    expect(isSuperAdmin({ id: "u1", email: `  ${ADMIN_EMAIL.toUpperCase()}  ` })).toBe(true);
  });

  it("returns false when ADMIN_EMAIL env var is missing", () => {
    delete process.env.ADMIN_EMAIL;
    expect(isSuperAdmin({ id: "u1", email: ADMIN_EMAIL })).toBe(false);
  });

  it("returns false when user has empty email", () => {
    expect(isSuperAdmin({ id: "u1", email: "" })).toBe(false);
  });
});

// ─── requireSuperAdmin ──────────────────────────────────────────────────

function makeReq(pbToken?: string): Request {
  const url = pbToken
    ? `https://staffd.test/api/admin/test?pbToken=${encodeURIComponent(pbToken)}`
    : "https://staffd.test/api/admin/test";
  return new Request(url, { method: "GET" });
}

describe("requireSuperAdmin", () => {
  it("throws 401 missing_auth when no pbToken supplied", async () => {
    await expect(requireSuperAdmin(makeReq())).rejects.toMatchObject({
      status: 401,
      errorCode: "missing_auth",
    });
  });

  it("throws 401 unauthorized when auth-refresh fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    await expect(requireSuperAdmin(makeReq("bad_token"))).rejects.toMatchObject({
      status: 401,
      errorCode: "unauthorized",
    });
  });

  it("throws 503 admin_not_configured when ADMIN_EMAIL missing", async () => {
    delete process.env.ADMIN_EMAIL;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }),
    });
    await expect(requireSuperAdmin(makeReq("any_token"))).rejects.toMatchObject({
      status: 503,
      errorCode: "admin_not_configured",
    });
  });

  it("throws 403 forbidden when email doesn't match", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "u1", email: "not@admin.test" } }),
    });
    await expect(requireSuperAdmin(makeReq("any_token"))).rejects.toMatchObject({
      status: 403,
      errorCode: "forbidden",
    });
  });

  it("returns SuperAdminUser on success", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "u_admin", email: ADMIN_EMAIL } }),
    });
    const me = await requireSuperAdmin(makeReq("good_token"));
    expect(me).toEqual({ id: "u_admin", email: ADMIN_EMAIL });
  });

  it("accepts Authorization header as fallback when no query param", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "u_admin", email: ADMIN_EMAIL } }),
    });
    const req = new Request("https://staffd.test/api/admin/test", {
      headers: { Authorization: "header_token" },
    });
    const me = await requireSuperAdmin(req);
    expect(me.id).toBe("u_admin");
  });
});

// ─── toAuthErrorResponse ────────────────────────────────────────────────

describe("toAuthErrorResponse", () => {
  it("converts SuperAdminAuthError to JSON Response with correct status", async () => {
    const err = new SuperAdminAuthError(403, "forbidden");
    const res = toAuthErrorResponse(err);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("forbidden");
  });

  it("re-throws non-auth errors", () => {
    const err = new Error("something else");
    expect(() => toAuthErrorResponse(err)).toThrow("something else");
  });
});

// ─── trySuperAdminFromToken ─────────────────────────────────────────────

describe("trySuperAdminFromToken", () => {
  it("returns null for empty token", async () => {
    expect(await trySuperAdminFromToken("")).toBeNull();
    expect(await trySuperAdminFromToken(null)).toBeNull();
    expect(await trySuperAdminFromToken(undefined)).toBeNull();
  });

  it("returns null when auth-refresh fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    expect(await trySuperAdminFromToken("any")).toBeNull();
  });

  it("returns null for non-admin user", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "u1", email: "user@example.com" } }),
    });
    expect(await trySuperAdminFromToken("any")).toBeNull();
  });

  it("returns user for super-admin", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "u_admin", email: ADMIN_EMAIL } }),
    });
    const me = await trySuperAdminFromToken("any");
    expect(me).toEqual({ id: "u_admin", email: ADMIN_EMAIL });
  });
});

// ─── trySuperAdminByUserId ──────────────────────────────────────────────

describe("trySuperAdminByUserId", () => {
  it("returns null for empty userId", async () => {
    expect(await trySuperAdminByUserId("")).toBeNull();
    expect(await trySuperAdminByUserId(null)).toBeNull();
  });

  it("returns null when ADMIN_EMAIL missing", async () => {
    delete process.env.ADMIN_EMAIL;
    expect(await trySuperAdminByUserId("u1")).toBeNull();
  });

  it("returns null when user fetch fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    expect(await trySuperAdminByUserId("u1")).toBeNull();
  });

  it("returns null for non-admin user", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "u1", email: "user@example.com" }),
    });
    expect(await trySuperAdminByUserId("u1")).toBeNull();
  });

  it("returns user for super-admin", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "u_admin", email: ADMIN_EMAIL }),
    });
    const me = await trySuperAdminByUserId("u_admin");
    expect(me).toEqual({ id: "u_admin", email: ADMIN_EMAIL });
  });
});
