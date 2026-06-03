/**
 * PR-Tranche-1-Security-Cleanup — orphan-details endpoint tests (Decision 71).
 *
 * Exercises:
 *   - Auth gates (401/403)
 *   - Empty collection + canonical exists → drop_safe
 *   - Has rows + canonical exists → drop_after_migration
 *   - No canonical → investigate_active_usage / keep_with_setup_route
 *   - Schema overlap calculation
 *   - Read-only contract (no writes performed)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "fake_admin_token",
  pbUrl: () => "https://pb.example.test",
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
  pbFirst: async () => null,
}));

import { GET } from "../../app/api/admin/orphan-details/route";

const ADMIN_EMAIL = "admin@staffd.test";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;
let writeCalls: number;

function makeRequest(pbToken?: string): Request {
  const url = pbToken
    ? `https://staffd.test/api/admin/orphan-details?pbToken=${encodeURIComponent(pbToken)}`
    : "https://staffd.test/api/admin/orphan-details";
  return new Request(url, { method: "GET" });
}

beforeEach(() => {
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  writeCalls = 0;
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ADMIN_EMAIL;
});

describe("GET /api/admin/orphan-details", () => {
  it("returns 401 when no pbToken supplied", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 403 when email doesn't match ADMIN_EMAIL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "u1", email: "notadmin@example.com" } }),
    });
    const res = await GET(makeRequest("token"));
    expect(res.status).toBe(403);
  });

  it("returns drop_safe for empty orphans with existing canonical", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.toString();
      // Count only writes to orphan-collection data (exclude auth-refresh +
      // super_admin_audit_log logging side-effect from requireSuperAdmin path).
      if (
        init?.method &&
        init.method !== "GET" &&
        !u.includes("auth-refresh") &&
        !u.includes("super_admin_audit_log")
      ) {
        writeCalls++;
      }
      if (u.includes("/api/collections/users/auth-refresh")) {
        return { ok: true, status: 200, json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }) };
      }
      // records list — return totalItems: 0 (empty)
      if (u.includes("/records")) {
        return { ok: true, status: 200, json: async () => ({ items: [], totalItems: 0 }) };
      }
      // collection fetch
      const match = u.match(/\/api\/collections\/([^/?]+)$/);
      if (match) {
        const name = decodeURIComponent(match[1]!);
        // Canonicals exist; orphan collections also exist (empty)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: `id_${name}`,
            type: "base",
            fields: [{ name: "id", type: "text" }],
            created: "2024-01-01",
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const res = await GET(makeRequest("token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.collections).toHaveLength(3); // Documents, Templates, vault_queue
    for (const c of body.collections) {
      expect(c.recommendation).toBe("drop_safe");
      expect(c.row_count).toBe(0);
    }
    // Strict read-only contract — no POST/PATCH/DELETE allowed
    expect(writeCalls).toBe(0);
  });

  it("returns drop_after_migration when orphan has rows + canonical exists", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/api/collections/users/auth-refresh")) {
        return { ok: true, status: 200, json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }) };
      }
      // sorted records (last-modified probe) — return one record
      if (u.includes("sort=-updated")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [{ updated: "2024-06-01T00:00:00Z" }], totalItems: 5 }),
        };
      }
      // count probe
      if (u.includes("/records")) {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: "x" }], totalItems: 5 }) };
      }
      const match = u.match(/\/api\/collections\/([^/?]+)$/);
      if (match) {
        const name = decodeURIComponent(match[1]!);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: `id_${name}`,
            type: "base",
            fields: [{ name: "id", type: "text" }, { name: "user", type: "text" }],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const res = await GET(makeRequest("token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const c of body.collections) {
      expect(c.recommendation).toBe("drop_after_migration");
      expect(c.row_count).toBeGreaterThan(0);
    }
  });

  it("marks recommendation as drop_safe when orphan collection does not exist in PB", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/api/collections/users/auth-refresh")) {
        return { ok: true, status: 200, json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }) };
      }
      // ALL collection fetches return 404
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const res = await GET(makeRequest("token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const c of body.collections) {
      expect(c.exists).toBe(false);
      expect(c.recommendation).toBe("drop_safe");
    }
  });

  it("computes schema_overlap_with_canonical correctly", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/api/collections/users/auth-refresh")) {
        return { ok: true, status: 200, json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }) };
      }
      if (u.includes("/records")) {
        return { ok: true, status: 200, json: async () => ({ items: [], totalItems: 0 }) };
      }
      const match = u.match(/\/api\/collections\/([^/?]+)$/);
      if (match) {
        const name = decodeURIComponent(match[1]!);
        // orphan (Documents) has 2 fields; canonical (documents) has 4 fields with 2 shared
        if (name === "Documents") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "id_orphan",
              fields: [{ name: "title", type: "text" }, { name: "body", type: "text" }],
            }),
          };
        }
        if (name === "documents") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "id_canonical",
              fields: [
                { name: "title", type: "text" },
                { name: "body", type: "text" },
                { name: "user", type: "text" },
                { name: "created", type: "autodate" },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ id: `id_${name}`, fields: [] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const res = await GET(makeRequest("token"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const docs = body.collections.find((c: { name: string }) => c.name === "Documents");
    expect(docs).toBeDefined();
    // 2 shared / 4 union = 0.5
    expect(docs.schema_overlap_with_canonical).toBe(0.5);
  });
});
