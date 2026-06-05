/**
 * PR-Tranche-2 Item 1 — GDPR data export route tests.
 *
 * Covers:
 *   - Missing auth → 401
 *   - Invalid token → 401
 *   - Successful export emits expected collection set
 *   - Sanitization: password/passwordHash/tokenKey stripped from user record
 *   - Content-Disposition attachment header set
 *   - Pagination of collections with many rows
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "fake_admin_token",
  pbUrl: () => "https://pb.example.test",
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
}));

import { POST } from "../../app/api/account/export-data/route";

const USER_ID = "u_test_user";
const USER_EMAIL = "user@example.com";

let fetchMock: ReturnType<typeof vi.fn>;

function makeReq(pbToken = "user_token"): Request {
  return new Request(
    `https://staffd.test/api/account/export-data?pbToken=${encodeURIComponent(pbToken)}`,
    { method: "POST" },
  );
}

const okJson = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/account/export-data", () => {
  it("returns 401 without pbToken", async () => {
    const res = await POST(new Request("https://staffd.test/api/account/export-data", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when auth-refresh fails", async () => {
    fetchMock.mockResolvedValueOnce(okJson({}, 401));
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });

  it("emits a valid JSON archive with expected collections + Content-Disposition", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) {
        return okJson({ record: { id: USER_ID, email: USER_EMAIL } });
      }
      if (u.endsWith(`/api/collections/users/records/${USER_ID}`)) {
        return okJson({
          id: USER_ID,
          email: USER_EMAIL,
          name: "Test User",
          password: "SHOULD_BE_STRIPPED",
          passwordHash: "SHOULD_BE_STRIPPED",
          tokenKey: "SHOULD_BE_STRIPPED",
          verified: true,
          created: "2026-01-01",
        });
      }
      // Empty list for every collection
      if (u.includes("/records?filter=")) {
        return okJson({ items: [], totalPages: 0 });
      }
      return okJson({}, 404);
    });

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Disposition")).toContain(USER_ID);

    const archive = await res.json();
    expect(archive.user_id).toBe(USER_ID);
    expect(archive.staffd_version).toBe("GDPR-A-v1");
    expect(archive.collections).toBeDefined();
    // Expected collection keys present
    for (const c of ["users", "subscriptions", "businesses", "documents", "vault_briefs", "conversations", "clients"]) {
      expect(archive.collections[c]).toBeDefined();
    }
  });

  it("strips password / passwordHash / tokenKey from user record", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) {
        return okJson({ record: { id: USER_ID, email: USER_EMAIL } });
      }
      if (u.endsWith(`/api/collections/users/records/${USER_ID}`)) {
        return okJson({
          id: USER_ID,
          email: USER_EMAIL,
          password: "PLAINTEXT_LEAK",
          passwordHash: "BCRYPT_HASH",
          tokenKey: "SECRET_KEY",
          verified: true,
        });
      }
      if (u.includes("/records?filter=")) return okJson({ items: [], totalPages: 0 });
      return okJson({}, 404);
    });

    const res = await POST(makeReq());
    const archive = await res.json();
    const userRow = archive.collections.users[0] as Record<string, unknown>;
    expect(userRow.password).toBeUndefined();
    expect(userRow.passwordHash).toBeUndefined();
    expect(userRow.tokenKey).toBeUndefined();
    expect(userRow.verified).toBeUndefined();
    // Non-secret fields preserved
    expect(userRow.email).toBe(USER_EMAIL);
    expect(userRow.id).toBe(USER_ID);
  });

  it("paginates collections — fetches multiple pages when totalPages > 1", async () => {
    const callCounts: Record<string, number> = {};
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) {
        return okJson({ record: { id: USER_ID, email: USER_EMAIL } });
      }
      if (u.endsWith(`/api/collections/users/records/${USER_ID}`)) {
        return okJson({ id: USER_ID, email: USER_EMAIL });
      }
      // Track per-collection page calls
      const m = u.match(/\/api\/collections\/([^/]+)\/records\?/);
      if (m) {
        const c = m[1]!;
        callCounts[c] = (callCounts[c] ?? 0) + 1;
        const pageMatch = u.match(/[?&]page=(\d+)/);
        const page = pageMatch ? Number.parseInt(pageMatch[1]!, 10) : 1;
        if (c === "documents" && page === 1) {
          return okJson({ items: [{ id: "d1" }, { id: "d2" }], totalPages: 2 });
        }
        if (c === "documents" && page === 2) {
          return okJson({ items: [{ id: "d3" }], totalPages: 2 });
        }
        return okJson({ items: [], totalPages: 0 });
      }
      return okJson({}, 404);
    });

    const res = await POST(makeReq());
    const archive = await res.json();
    expect(archive.collections.documents.length).toBe(3);
    expect(callCounts.documents).toBeGreaterThanOrEqual(2);
  });
});
