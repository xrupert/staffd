/**
 * PR-Tranche-1-Security-Cleanup — orphan-decisions endpoint tests (Decision 71).
 *
 * Exercises:
 *   - Auth gates (401/403)
 *   - GET returns empty array when collection not yet created (404)
 *   - GET returns recorded decisions
 *   - POST validates decision enum
 *   - POST creates row with decided_by + status=pending
 *   - POST hint when orphan_decisions collection missing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "fake_admin_token",
  pbUrl: () => "https://pb.example.test",
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
  pbFirst: async () => null,
}));

import { GET, POST } from "../../app/api/admin/orphan-decisions/route";

const ADMIN_EMAIL = "admin@staffd.test";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function makeReq(method: "GET" | "POST", body?: unknown, pbToken = "token"): Request {
  const url = `https://staffd.test/api/admin/orphan-decisions?pbToken=${encodeURIComponent(pbToken)}`;
  return new Request(url, {
    method,
    body: body ? JSON.stringify(body) : null,
    headers: body ? { "Content-Type": "application/json" } : undefined,
  });
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

describe("orphan-decisions endpoint", () => {
  it("GET returns 401 without auth", async () => {
    const res = await GET(new Request("https://staffd.test/api/admin/orphan-decisions"));
    expect(res.status).toBe(401);
  });

  it("GET returns 403 for non-admin", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "u1", email: "not@admin.test" } }),
    });
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(403);
  });

  it("GET returns empty list when orphan_decisions collection not yet created", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) {
        return { ok: true, status: 200, json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }) };
      }
      // orphan_decisions records endpoint → 404
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const res = await GET(makeReq("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.decisions).toEqual([]);
  });

  it("GET returns recorded decisions", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) {
        return { ok: true, status: 200, json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }) };
      }
      if (u.includes("orphan_decisions/records")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: "r1", collection_name: "Documents", decision: "drop_safe", status: "pending" },
            ],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const res = await GET(makeReq("GET"));
    const body = await res.json();
    expect(body.decisions).toHaveLength(1);
    expect(body.decisions[0].collection_name).toBe("Documents");
  });

  it("POST rejects invalid decision enum", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }),
    });
    const res = await POST(makeReq("POST", { collection_name: "Documents", decision: "lol_drop_it" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_decision");
    expect(body.allowed).toContain("drop_safe");
  });

  it("POST rejects missing collection_name", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }),
    });
    const res = await POST(makeReq("POST", { decision: "drop_safe" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("collection_name_required");
  });

  it("POST creates row with decided_by + status=pending", async () => {
    let createdBody: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) {
        return { ok: true, status: 200, json: async () => ({ record: { id: "u_super", email: ADMIN_EMAIL } }) };
      }
      if (init?.method === "POST" && u.includes("orphan_decisions/records")) {
        createdBody = JSON.parse(init.body as string);
        return { ok: true, status: 200, json: async () => ({ id: "rec1" }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const res = await POST(
      makeReq("POST", { collection_name: "vault_queue", decision: "drop_safe", reason: "empty" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe("rec1");
    expect(createdBody).not.toBeNull();
    expect(createdBody!.decided_by).toBe("u_super");
    expect(createdBody!.status).toBe("pending");
    expect(createdBody!.decision).toBe("drop_safe");
    expect(createdBody!.collection_name).toBe("vault_queue");
  });

  it("POST returns 503 with hint when orphan_decisions collection missing", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) {
        return { ok: true, status: 200, json: async () => ({ record: { id: "u1", email: ADMIN_EMAIL } }) };
      }
      // Mimic "collection not created" 404 — include text() since route calls it
      return { ok: false, status: 404, json: async () => ({}), text: async () => "Not Found" };
    });
    const res = await POST(makeReq("POST", { collection_name: "Documents", decision: "drop_safe" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("collection_not_created");
    expect(body.hint).toContain("setup/orphan-decisions");
  });
});
