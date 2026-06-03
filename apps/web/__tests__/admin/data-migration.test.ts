/**
 * PR-Tranche-1-Final-Cleanup — data migration + drop endpoint tests
 * (Decision 73).
 *
 * Covers:
 *   - migrate-orphans-preflight (read-only schema diff)
 *   - migrate-orphans-execute (idempotent migration with ID preservation)
 *   - drop-orphan-collection (gated destructive op)
 *
 * Pattern matches the existing __tests__/admin/*.test.ts files: mocks
 * global fetch + _lib/pb; structural assertions on response bodies +
 * verification of the contract guarantees (idempotency, ID preservation,
 * confirm-token enforcement, programmatic safety gate).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "fake_admin_token",
  pbUrl: () => "https://pb.example.test",
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
  pbFirst: async () => null,
}));

import { POST as preflightPOST } from "../../app/api/admin/migrate-orphans-preflight/route";
import { POST as executePOST } from "../../app/api/admin/migrate-orphans-execute/route";
import { POST as dropPOST } from "../../app/api/admin/drop-orphan-collection/route";

const ADMIN_EMAIL = "admin@staffd.test";

type FetchMock = ReturnType<typeof vi.fn>;
let fetchMock: FetchMock;

function makeReq(path: string, body?: unknown, pbToken = "token"): Request {
  return new Request(`https://staffd.test${path}?pbToken=${encodeURIComponent(pbToken)}`, {
    method: "POST",
    body: body ? JSON.stringify(body) : null,
    headers: body ? { "Content-Type": "application/json" } : undefined,
  });
}

const okJson = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
  text: async () => (typeof data === "string" ? data : JSON.stringify(data)),
});

const adminAuthMock = okJson({ record: { id: "u_super", email: ADMIN_EMAIL } });

beforeEach(() => {
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ADMIN_EMAIL;
});

// ─── migrate-orphans-preflight ─────────────────────────────────────────

describe("POST /api/admin/migrate-orphans-preflight", () => {
  it("requires super-admin", async () => {
    const res = await preflightPOST(
      new Request("https://staffd.test/api/admin/migrate-orphans-preflight", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns schema diff with can_migrate=true when fields compatible + source has rows", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) return adminAuthMock;
      // Source = Documents: 2 fields
      if (u.endsWith("/api/collections/Documents")) {
        return okJson({
          id: "id_Documents",
          fields: [
            { name: "user", type: "text", required: true },
            { name: "output", type: "text", required: true },
          ],
        });
      }
      // Canonical = documents: same fields
      if (u.endsWith("/api/collections/documents")) {
        return okJson({
          id: "id_documents",
          fields: [
            { name: "user", type: "text", required: true },
            { name: "output", type: "text", required: true },
          ],
        });
      }
      // Templates collections — return empty / not found to focus on Documents pair
      if (u.includes("/api/collections/Templates") || u.includes("/api/collections/templates")) {
        return okJson({ items: [], totalItems: 0, totalPages: 0 });
      }
      // Row counts
      if (u.includes("Documents/records")) return okJson({ items: [{ id: "r1" }], totalItems: 4 });
      if (u.includes("documents/records")) return okJson({ items: [], totalItems: 0 });
      return okJson({}, 404);
    });

    const res = await preflightPOST(makeReq("/api/admin/migrate-orphans-preflight"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const docsPair = body.pairs.find((p: { source: string }) => p.source === "Documents");
    expect(docsPair).toBeDefined();
    expect(docsPair.source_row_count).toBe(4);
    expect(docsPair.canonical_row_count).toBe(0);
    expect(docsPair.can_migrate).toBe(true);
    expect(docsPair.block_reasons).toEqual([]);
  });

  it("blocks migration when canonical requires field that source lacks", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) return adminAuthMock;
      if (u.endsWith("/api/collections/Documents")) {
        return okJson({
          id: "id_Documents",
          fields: [{ name: "output", type: "text", required: true }],
          // missing 'user' which canonical requires
        });
      }
      if (u.endsWith("/api/collections/documents")) {
        return okJson({
          id: "id_documents",
          fields: [
            { name: "user", type: "text", required: true },
            { name: "output", type: "text", required: true },
          ],
        });
      }
      if (u.includes("Documents/records")) return okJson({ items: [{ id: "r1" }], totalItems: 1 });
      return okJson({ items: [], totalItems: 0 });
    });

    const res = await preflightPOST(makeReq("/api/admin/migrate-orphans-preflight"));
    const body = await res.json();
    const docsPair = body.pairs.find((p: { source: string }) => p.source === "Documents");
    expect(docsPair.can_migrate).toBe(false);
    expect(docsPair.block_reasons.some((r: string) => r.includes("'user'"))).toBe(true);
  });
});

// ─── migrate-orphans-execute ───────────────────────────────────────────

describe("POST /api/admin/migrate-orphans-execute", () => {
  it("requires super-admin", async () => {
    const res = await executePOST(
      new Request("https://staffd.test/api/admin/migrate-orphans-execute", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("requires exact confirm token", async () => {
    fetchMock.mockResolvedValueOnce(adminAuthMock);
    const res = await executePOST(
      makeReq("/api/admin/migrate-orphans-execute", {
        source: "Documents",
        canonical: "documents",
        confirm: "wrong",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("missing_or_wrong_confirm");
    expect(body.expected).toBe("MIGRATE-Documents");
  });

  it("rejects mismatched source/canonical pair", async () => {
    fetchMock.mockResolvedValueOnce(adminAuthMock);
    const res = await executePOST(
      makeReq("/api/admin/migrate-orphans-execute", {
        source: "Documents",
        canonical: "templates", // wrong
        confirm: "MIGRATE-Documents",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_canonical");
  });

  it("migrates all rows preserving IDs (happy path)", async () => {
    const sourceRows = [
      { id: "abc123", user: "u1", output: "row 1", collectionId: "x", collectionName: "Documents" },
      { id: "def456", user: "u2", output: "row 2", collectionId: "x", collectionName: "Documents" },
    ];
    const createdBodies: Record<string, unknown>[] = [];
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) return adminAuthMock;
      // List source rows (paged)
      if (u.includes("Documents/records") && (init?.method === "GET" || !init?.method) && u.includes("page=")) {
        return okJson({ items: sourceRows, totalPages: 1 });
      }
      // Existence check on canonical — return 404 (not yet migrated)
      if (u.match(/\/api\/collections\/documents\/records\/[^/?]+$/) && (init?.method === "GET" || !init?.method)) {
        return okJson({}, 404);
      }
      // POST create on canonical — record the body, succeed with same id
      if (u.endsWith("/api/collections/documents/records") && init?.method === "POST") {
        const sent = JSON.parse(init.body as string);
        createdBodies.push(sent);
        return okJson({ id: sent.id });
      }
      return okJson({}, 404);
    });

    const res = await executePOST(
      makeReq("/api/admin/migrate-orphans-execute", {
        source: "Documents",
        canonical: "documents",
        confirm: "MIGRATE-Documents",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts.migrated).toBe(2);
    expect(body.counts.already_migrated).toBe(0);
    expect(body.counts.failed).toBe(0);
    expect(body.ids_preserved).toBe(true);

    // ID preservation: each created body should carry the source id
    expect(createdBodies.map((b) => b.id)).toEqual(["abc123", "def456"]);
    // Sanitization: collectionId/collectionName/expand stripped
    for (const b of createdBodies) {
      expect(b).not.toHaveProperty("collectionId");
      expect(b).not.toHaveProperty("collectionName");
    }
  });

  it("is idempotent — re-run on already-migrated rows reports already_migrated", async () => {
    const sourceRows = [{ id: "abc123", user: "u1", output: "row 1" }];
    let createCalls = 0;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) return adminAuthMock;
      if (u.includes("Documents/records") && u.includes("page=")) {
        return okJson({ items: sourceRows, totalPages: 1 });
      }
      // Existence check returns 200 (already migrated)
      if (u.match(/\/api\/collections\/documents\/records\/[^/?]+$/)) {
        return okJson({ id: "abc123" });
      }
      if (u.endsWith("/api/collections/documents/records") && init?.method === "POST") {
        createCalls++;
        return okJson({ id: "should-not-be-called" });
      }
      return okJson({}, 404);
    });

    const res = await executePOST(
      makeReq("/api/admin/migrate-orphans-execute", {
        source: "Documents",
        canonical: "documents",
        confirm: "MIGRATE-Documents",
      }),
    );
    const body = await res.json();
    expect(body.counts.already_migrated).toBe(1);
    expect(body.counts.migrated).toBe(0);
    expect(createCalls).toBe(0); // no PB writes on idempotent re-run
  });

  it("supports dry_run mode (no PB writes)", async () => {
    const sourceRows = [{ id: "abc123", user: "u1", output: "row 1" }];
    let createCalls = 0;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) return adminAuthMock;
      if (u.includes("Documents/records") && u.includes("page=")) {
        return okJson({ items: sourceRows, totalPages: 1 });
      }
      if (u.match(/\/api\/collections\/documents\/records\/[^/?]+$/)) {
        return okJson({}, 404);
      }
      if (init?.method === "POST" && u.endsWith("/api/collections/documents/records")) {
        createCalls++;
        return okJson({ id: "x" });
      }
      return okJson({}, 404);
    });

    const res = await executePOST(
      makeReq("/api/admin/migrate-orphans-execute", {
        source: "Documents",
        canonical: "documents",
        confirm: "MIGRATE-Documents",
        dry_run: true,
      }),
    );
    const body = await res.json();
    expect(body.dry_run).toBe(true);
    expect(body.counts.dry_run).toBe(1);
    expect(body.counts.migrated).toBe(0);
    expect(createCalls).toBe(0);
  });
});

// ─── drop-orphan-collection ────────────────────────────────────────────

describe("POST /api/admin/drop-orphan-collection", () => {
  it("requires super-admin", async () => {
    const res = await dropPOST(
      new Request("https://staffd.test/api/admin/drop-orphan-collection", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects collection not in allow-list", async () => {
    fetchMock.mockResolvedValueOnce(adminAuthMock);
    const res = await dropPOST(
      makeReq("/api/admin/drop-orphan-collection", {
        collection_name: "documents", // canonical, NOT allowed to drop
        confirm: "DROP-documents",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("collection_not_in_allowlist");
  });

  it("rejects without correct confirm token", async () => {
    fetchMock.mockResolvedValueOnce(adminAuthMock);
    const res = await dropPOST(
      makeReq("/api/admin/drop-orphan-collection", {
        collection_name: "vault_queue",
        confirm: "wrong",
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("missing_or_wrong_confirm");
    expect(body.expected).toBe("DROP-vault_queue");
  });

  it("drops empty collection (vault_queue) when confirm token correct", async () => {
    let deleteCalled = false;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) return adminAuthMock;
      // Source row count = 0
      if (u.includes("vault_queue/records")) return okJson({ items: [], totalPages: 0 });
      if (u.endsWith("/api/collections/vault_queue")) return okJson({ id: "id_vq" });
      if (u.endsWith("/api/collections/id_vq") && init?.method === "DELETE") {
        deleteCalled = true;
        return okJson({});
      }
      return okJson({}, 404);
    });

    const res = await dropPOST(
      makeReq("/api/admin/drop-orphan-collection", {
        collection_name: "vault_queue",
        confirm: "DROP-vault_queue",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dropped).toBe("vault_queue");
    expect(body.rows_dropped).toBe(0);
    expect(body.safety_reason).toContain("row_count == 0");
    expect(deleteCalled).toBe(true);
  });

  it("refuses to drop non-empty Documents without verified_migrated_to", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) return adminAuthMock;
      if (u.includes("Documents/records")) {
        return okJson({ items: [{ id: "r1" }, { id: "r2" }], totalPages: 1 });
      }
      return okJson({}, 404);
    });

    const res = await dropPOST(
      makeReq("/api/admin/drop-orphan-collection", {
        collection_name: "Documents",
        confirm: "DROP-Documents",
        // no verified_migrated_to
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("verified_migrated_to_required");
    expect(body.expected).toBe("documents");
    expect(body.row_count).toBe(2);
  });

  it("refuses drop when migration is incomplete (source id missing in canonical)", async () => {
    let deleteCalled = false;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) return adminAuthMock;
      // Source has 2 rows
      if (u.includes("/api/collections/Documents/records") && u.includes("page=")) {
        return okJson({ items: [{ id: "r1" }, { id: "r2" }], totalPages: 1 });
      }
      // Canonical: r1 exists, r2 does NOT
      if (u.endsWith("/api/collections/documents/records/r1")) return okJson({ id: "r1" });
      if (u.endsWith("/api/collections/documents/records/r2")) return okJson({}, 404);
      if (init?.method === "DELETE") {
        deleteCalled = true;
        return okJson({});
      }
      return okJson({}, 404);
    });

    const res = await dropPOST(
      makeReq("/api/admin/drop-orphan-collection", {
        collection_name: "Documents",
        confirm: "DROP-Documents",
        verified_migrated_to: "documents",
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("migration_incomplete");
    expect(body.missing_in_target).toEqual(["r2"]);
    expect(deleteCalled).toBe(false);
  });

  it("drops non-empty Documents when all source ids verified in canonical", async () => {
    let deleteCalled = false;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) return adminAuthMock;
      if (u.includes("/api/collections/Documents/records") && u.includes("page=")) {
        return okJson({ items: [{ id: "r1" }, { id: "r2" }], totalPages: 1 });
      }
      // Canonical: both ids exist
      if (u.match(/\/api\/collections\/documents\/records\/[^/?]+$/)) {
        return okJson({ id: "exists" });
      }
      if (u.endsWith("/api/collections/Documents") && (init?.method === "GET" || !init?.method)) {
        return okJson({ id: "id_Docs" });
      }
      if (u.endsWith("/api/collections/id_Docs") && init?.method === "DELETE") {
        deleteCalled = true;
        return okJson({});
      }
      return okJson({}, 404);
    });

    const res = await dropPOST(
      makeReq("/api/admin/drop-orphan-collection", {
        collection_name: "Documents",
        confirm: "DROP-Documents",
        verified_migrated_to: "documents",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dropped).toBe("Documents");
    expect(body.rows_dropped).toBe(2);
    expect(body.safety_reason).toContain("verified in canonical");
    expect(deleteCalled).toBe(true);
  });
});
