/**
 * PR-Bundle-10-Security-Audit — verify-row-rules route tests.
 *
 * Mocks global fetch to control PB responses. Exercises:
 *   - Missing/invalid auth → 401
 *   - Non-admin user → 403
 *   - Admin not configured → 503
 *   - Super-admin with matching rules → ✅
 *   - Super-admin with mismatched rules → 🔴 + gap detail
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the pb helper before importing the route — the route imports
// getAdminToken + pbUrl from it.
vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "fake_admin_token",
  pbUrl: () => "https://pb.example.test",
  // Other exports the module has — not used by this route but kept for safety
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
  pbFirst: async () => null,
}));

import { GET } from "../../app/api/admin/verify-row-rules/route";

const ADMIN_EMAIL = "admin@staffd.test";
const ADMIN_TOKEN = "admin_pb_token";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

const USER_OWNED_RULES = {
  listRule: "user = @request.auth.id",
  viewRule: "user = @request.auth.id",
  createRule: "user = @request.auth.id",
  updateRule: "user = @request.auth.id",
  deleteRule: "user = @request.auth.id",
};

function makeRequest(opts: { pbToken?: string } = {}): Request {
  const url = opts.pbToken
    ? `https://staffd.test/api/admin/verify-row-rules?pbToken=${encodeURIComponent(opts.pbToken)}`
    : "https://staffd.test/api/admin/verify-row-rules";
  return new Request(url, { method: "GET" });
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

describe("GET /api/admin/verify-row-rules", () => {
  it("returns 401 when no pbToken supplied", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("missing_auth");
  });

  it("returns 401 when whoAmI fails (PB auth-refresh rejects)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    const res = await GET(makeRequest({ pbToken: "invalid" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 403 when authenticated but email doesn't match ADMIN_EMAIL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "u1", email: "notadmin@example.com" } }),
    });
    const res = await GET(makeRequest({ pbToken: ADMIN_TOKEN }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("forbidden");
  });

  it("returns 503 when ADMIN_EMAIL env var is missing", async () => {
    delete process.env.ADMIN_EMAIL;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }),
    });
    const res = await GET(makeRequest({ pbToken: ADMIN_TOKEN }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("admin_not_configured");
  });

  it("returns 200 with all ✅ when every collection's rules match", async () => {
    // First call: whoAmI (auth-refresh)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }),
    });
    // Second call: list all collections (live drift detection)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          // Return only the expected collections — no unexpected ones
          { name: "subscriptions" }, { name: "businesses" }, { name: "documents" },
          { name: "vault_briefs" }, { name: "vault_decisions" }, { name: "vault_patterns" },
          { name: "vault_retrieval_metrics" }, { name: "vault_voice_profile" },
          { name: "vault_embeddings_index" }, { name: "vault_ingest_queue" },
          { name: "conversations" }, { name: "conversation_threads" },
          { name: "push_subscriptions" }, { name: "scheduled_content" },
          { name: "bookings" }, { name: "orchestrator_decisions" },
          { name: "clients" }, { name: "document_versions" },
          { name: "users" }, { name: "templates" },
        ],
      }),
    });
    // Subsequent calls: per-collection fetchCollectionRules
    // Return correct rules per expected pattern for each.
    const correctFor = (name: string) => {
      if (name === "clients") {
        return {
          listRule: "agency_user = @request.auth.id",
          viewRule: "agency_user = @request.auth.id",
          createRule: "agency_user = @request.auth.id",
          updateRule: "agency_user = @request.auth.id",
          deleteRule: "agency_user = @request.auth.id",
        };
      }
      if (name === "document_versions") {
        return {
          listRule: "document.user = @request.auth.id",
          viewRule: "document.user = @request.auth.id",
          createRule: "document.user = @request.auth.id",
          updateRule: "document.user = @request.auth.id",
          deleteRule: "document.user = @request.auth.id",
        };
      }
      if (name === "users") {
        return {
          listRule: null,
          viewRule: "id = @request.auth.id",
          createRule: null,
          updateRule: "id = @request.auth.id",
          deleteRule: "id = @request.auth.id",
        };
      }
      return USER_OWNED_RULES;
    };

    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      const match = u.match(/\/api\/collections\/([^/?]+)$/);
      if (match) {
        const name = decodeURIComponent(match[1]!);
        return {
          ok: true,
          status: 200,
          json: async () => ({ name, ...correctFor(name) }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    // Replay the first 2 mocks since mockImplementation overrides them.
    // To keep things simple, just bypass the first two and let
    // mockImplementation handle the chain — but we lose the whoAmI/list
    // sequence. Easier: pre-call them, then reset to mockImplementation.

    // Restart with mockImplementation that handles ALL fetch calls.
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/api/collections/users/auth-refresh")) {
        return { ok: true, status: 200, json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }) };
      }
      if (u.match(/\/api\/collections\?perPage=/)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { name: "subscriptions" }, { name: "businesses" }, { name: "documents" },
              { name: "vault_briefs" }, { name: "vault_decisions" }, { name: "vault_patterns" },
              { name: "vault_retrieval_metrics" }, { name: "vault_voice_profile" },
              { name: "vault_embeddings_index" }, { name: "vault_ingest_queue" },
              { name: "conversations" }, { name: "conversation_threads" },
              { name: "push_subscriptions" }, { name: "scheduled_content" },
              { name: "bookings" }, { name: "orchestrator_decisions" },
              { name: "clients" }, { name: "document_versions" },
              { name: "users" }, { name: "templates" },
            ],
          }),
        };
      }
      const match = u.match(/\/api\/collections\/([^/?]+)$/);
      if (match) {
        const name = decodeURIComponent(match[1]!);
        return {
          ok: true,
          status: 200,
          json: async () => ({ name, ...correctFor(name) }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const res = await GET(makeRequest({ pbToken: ADMIN_TOKEN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overall_status).toBe("✅");
    expect(body.gap_count).toBe(0);
    expect(body.collections_checked).toBe(20);
    expect(body.collections.every((c: { status: string }) => c.status === "✅")).toBe(true);
  });

  it("returns 🔴 status with gap detail when a collection has wrong list rule", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/api/collections/users/auth-refresh")) {
        return { ok: true, status: 200, json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }) };
      }
      if (u.match(/\/api\/collections\?perPage=/)) {
        return { ok: true, status: 200, json: async () => ({ items: [{ name: "subscriptions" }] }) };
      }
      if (u.endsWith("/api/collections/subscriptions")) {
        // WRONG list rule — empty, allowing cross-tenant reads
        return {
          ok: true,
          status: 200,
          json: async () => ({
            name: "subscriptions",
            listRule: null, // 🔴 should be `user = @request.auth.id`
            viewRule: "user = @request.auth.id",
            createRule: "user = @request.auth.id",
            updateRule: "user = @request.auth.id",
            deleteRule: "user = @request.auth.id",
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const res = await GET(makeRequest({ pbToken: ADMIN_TOKEN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overall_status).toBe("🔴");

    const subs = body.collections.find((c: { name: string }) => c.name === "subscriptions");
    expect(subs).toBeDefined();
    expect(subs.status).toBe("🔴");
    expect(subs.gaps.length).toBeGreaterThan(0);
    expect(subs.gaps.some((g: string) => g.includes("list rule missing"))).toBe(true);
  });

  it("returns 🔴 with collection_not_found gap when collection missing from PB", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("/api/collections/users/auth-refresh")) {
        return { ok: true, status: 200, json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }) };
      }
      if (u.match(/\/api\/collections\?perPage=/)) {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      // ALL collection fetches return 404
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const res = await GET(makeRequest({ pbToken: ADMIN_TOKEN }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overall_status).toBe("🔴");
    expect(body.collections.every((c: { gaps: string[] }) => c.gaps.includes("collection_not_found"))).toBe(true);
  });
});
