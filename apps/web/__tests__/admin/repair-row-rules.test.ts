/**
 * PR-Tranche-1-Post-Security-Hardening — repair-row-rules route tests.
 *
 * Mocks global fetch + _lib/pb to control PB responses. Exercises:
 *   - Missing/invalid auth → 401
 *   - Non-admin user → 403
 *   - Super-admin with mixed correct/incorrect state → 200 with
 *     per-collection repair report
 *   - Idempotency: re-running on already-correct collections returns
 *     "already-correct" without PB write
 *   - Failed PATCH on one collection doesn't block others
 *   - System-managed collections (users) skipped
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "fake_admin_token",
  pbUrl: () => "https://pb.example.test",
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
  pbFirst: async () => null,
}));

import { POST } from "../../app/api/admin/repair-row-rules/route";

const ADMIN_EMAIL = "admin@staffd.test";
const ADMIN_TOKEN = "admin_pb_token";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

const USER_OWNED_PB = {
  listRule: "user = @request.auth.id",
  viewRule: "user = @request.auth.id",
  createRule: "user = @request.auth.id",
  updateRule: "user = @request.auth.id",
  deleteRule: "user = @request.auth.id",
};

const WIDE_OPEN_PB = {
  listRule: null,
  viewRule: null,
  createRule: null,
  updateRule: null,
  deleteRule: null,
};

function makeRequest(opts: { pbToken?: string } = {}): Request {
  const url = opts.pbToken
    ? `https://staffd.test/api/admin/repair-row-rules?pbToken=${encodeURIComponent(opts.pbToken)}`
    : "https://staffd.test/api/admin/repair-row-rules";
  return new Request(url, { method: "POST" });
}

beforeEach(() => {
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ADMIN_EMAIL;
});

describe("POST /api/admin/repair-row-rules", () => {
  it("returns 401 when no pbToken supplied", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("missing_auth");
  });

  it("returns 401 when whoAmI fails", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    const res = await POST(makeRequest({ pbToken: "invalid" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 403 when email doesn't match ADMIN_EMAIL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "u1", email: "notadmin@example.com" } }),
    });
    const res = await POST(makeRequest({ pbToken: ADMIN_TOKEN }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("forbidden");
  });

  it("repairs collections with wide-open rules", async () => {
    let patchCalls = 0;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.toString();
      // whoAmI
      if (u.includes("/api/collections/users/auth-refresh")) {
        return { ok: true, status: 200, json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }) };
      }
      // GET collection by name — return WIDE_OPEN to force repair
      if (init?.method === undefined || init?.method === "GET") {
        const match = u.match(/\/api\/collections\/([^/?]+)$/);
        if (match) {
          const name = decodeURIComponent(match[1]!);
          // users is system-managed — return USERS_SYSTEM-aligned rules
          if (name === "users") {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id: `id_${name}`,
                listRule: null,
                viewRule: "id = @request.auth.id",
                createRule: null,
                updateRule: "id = @request.auth.id",
                deleteRule: "id = @request.auth.id",
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: `id_${name}`, ...WIDE_OPEN_PB }),
          };
        }
      }
      // PATCH collection — count the repair attempts
      if (init?.method === "PATCH") {
        patchCalls++;
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const res = await POST(makeRequest({ pbToken: ADMIN_TOKEN }));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Every non-system-managed collection should be repaired (or attempted)
    expect(body.total_repaired).toBeGreaterThan(0);
    expect(body.total_skipped).toBe(1); // users
    expect(body.overall_status).toContain("✅");
    expect(patchCalls).toBeGreaterThan(0);
    expect(patchCalls).toBe(body.total_repaired);
  });

  it("reports already-correct without PATCH when rules already match", async () => {
    let patchCalls = 0;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/api/collections/users/auth-refresh")) {
        return { ok: true, status: 200, json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }) };
      }
      if (init?.method === undefined || init?.method === "GET") {
        const match = u.match(/\/api\/collections\/([^/?]+)$/);
        if (match) {
          const name = decodeURIComponent(match[1]!);
          if (name === "users") {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id: `id_${name}`,
                listRule: "id = @request.auth.id",
                viewRule: "id = @request.auth.id",
                createRule: "",
                updateRule: "id = @request.auth.id",
                deleteRule: "id = @request.auth.id",
              }),
            };
          }
          if (name === "vault_ingest_queue") {
            // Decision 71 — ADMIN_ONLY pattern: all null
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: `id_${name}`, ...WIDE_OPEN_PB }),
            };
          }
          if (name === "clients") {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id: `id_${name}`,
                listRule: "agency_user = @request.auth.id",
                viewRule: "agency_user = @request.auth.id",
                createRule: "agency_user = @request.auth.id",
                updateRule: "agency_user = @request.auth.id",
                deleteRule: "agency_user = @request.auth.id",
              }),
            };
          }
          if (name === "document_versions") {
            // Decision 71 — uses USER_OWNED pattern (denormalized user field)
            return {
              ok: true,
              status: 200,
              json: async () => ({ id: `id_${name}`, ...USER_OWNED_PB }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: `id_${name}`, ...USER_OWNED_PB }),
          };
        }
      }
      if (init?.method === "PATCH") {
        patchCalls++;
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const res = await POST(makeRequest({ pbToken: ADMIN_TOKEN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_already_correct).toBeGreaterThan(0);
    expect(body.total_repaired).toBe(0);
    expect(body.overall_status).toContain("✅");
    expect(patchCalls).toBe(0); // idempotent — no PB writes
  });

  it("reports failures per-collection without blocking others", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/api/collections/users/auth-refresh")) {
        return { ok: true, status: 200, json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }) };
      }
      if (init?.method === undefined || init?.method === "GET") {
        const match = u.match(/\/api\/collections\/([^/?]+)$/);
        if (match) {
          const name = decodeURIComponent(match[1]!);
          if (name === "users") {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                id: `id_${name}`,
                listRule: "id = @request.auth.id",
                viewRule: "id = @request.auth.id",
                createRule: "",
                updateRule: "id = @request.auth.id",
                deleteRule: "id = @request.auth.id",
              }),
            };
          }
          // Subscriptions is "missing" — should report skipped-not-found
          if (name === "subscriptions") {
            return { ok: false, status: 404, json: async () => ({}) };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ id: `id_${name}`, ...WIDE_OPEN_PB }),
          };
        }
      }
      if (init?.method === "PATCH") {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const res = await POST(makeRequest({ pbToken: ADMIN_TOKEN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_failed).toBeGreaterThan(0);
    expect(body.overall_status).toContain("🔴");

    const subs = body.repairs.find((r: { collection: string }) => r.collection === "subscriptions");
    expect(subs).toBeDefined();
    expect(subs.status).toContain("not-found");
  });
});
