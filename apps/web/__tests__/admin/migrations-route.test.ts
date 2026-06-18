/**
 * W95.3.4 — /api/admin/migrations: super-admin gated registry + status
 * detection (GET) and admin_migration_log audit write (POST).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const adminMock = vi.hoisted(() => ({ ok: true }));
vi.mock("../../app/api/_lib/auth/super-admin", () => ({
  requireSuperAdmin: vi.fn(async () => {
    if (!adminMock.ok) { const e = new Error("forbidden") as Error & { __auth: boolean }; e.__auth = true; throw e; }
    return { id: "admin", email: "boss@staffd.com" };
  }),
  toAuthErrorResponse: () => Response.json({ error: "forbidden" }, { status: 403 }),
}));

vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "admin-token",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
}));

import { GET, POST } from "../../app/api/admin/migrations/route";
import { MIGRATION_REGISTRY } from "../../app/api/_lib/admin/migrations";

let calls: { url: string; method: string; body: Record<string, unknown> | null }[];
/** existing = set of collection names that "exist" (200); others 404. */
function stubPb(existing: Set<string>) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : null });
    // status-detection probe: /api/collections/<col>/records?perPage=1
    const m = url.match(/\/api\/collections\/([^/]+)\/records/);
    if (m && method === "GET") {
      const col = m[1]!;
      if (url.includes("filter=")) return { ok: existing.has(col), status: existing.has(col) ? 200 : 404, json: async () => ({ items: [] }) };
      const ok = existing.has(col);
      return { ok, status: ok ? 200 : 404, json: async () => ({ items: [] }) };
    }
    if (url.includes("/admin_migration_log/records") && method === "POST") {
      return existing.has("admin_migration_log")
        ? { ok: true, json: async () => ({ id: "log-1" }) }
        : { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  }));
}
const req = (url = "https://t/api/admin/migrations") => new Request(url, { headers: { authorization: "tok" } });

beforeEach(() => { adminMock.ok = true; });
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/admin/migrations", () => {
  it("403 for a non-super-admin", async () => {
    adminMock.ok = false; stubPb(new Set());
    expect((await GET(req())).status).toBe(403);
  });

  it("reports exists/missing per collection (honest server-side detection)", async () => {
    stubPb(new Set(["contacts", "workflow_tasks", "user_integrations"])); // upload_sessions + admin_migration_log missing
    const data = await (await GET(req())).json() as { migrations: { route: string; status: string; collection: string }[] };
    const byRoute = Object.fromEntries(data.migrations.map((m) => [m.route, m.status]));
    expect(byRoute["contacts"]).toBe("exists");
    expect(byRoute["workflow-tasks"]).toBe("exists");
    expect(byRoute["upload-sessions"]).toBe("missing");
    expect(byRoute["admin-migration-log"]).toBe("missing");
    expect(data.migrations).toHaveLength(MIGRATION_REGISTRY.length);
  });
});

describe("POST /api/admin/migrations (audit log)", () => {
  it("writes an admin_migration_log row for a successful run", async () => {
    stubPb(new Set(["admin_migration_log"]));
    const r = await POST(new Request("https://t/api/admin/migrations", {
      method: "POST", headers: { authorization: "tok", "Content-Type": "application/json" },
      body: JSON.stringify({ migration_name: "contacts", result: "created", response_body: "{}", duration_ms: 42 }),
    }));
    expect(await r.json()).toMatchObject({ ok: true });
    const write = calls.find((c) => c.url.includes("/admin_migration_log/records") && c.method === "POST");
    expect(write!.body).toMatchObject({ user: "admin", migration_name: "contacts", result: "created", duration_ms: 42 });
  });

  it("returns ok:false (non-fatal) when the log collection isn't bootstrapped yet", async () => {
    stubPb(new Set()); // admin_migration_log missing
    const r = await POST(new Request("https://t/api/admin/migrations", {
      method: "POST", headers: { authorization: "tok", "Content-Type": "application/json" },
      body: JSON.stringify({ migration_name: "contacts", result: "created" }),
    }));
    expect(await r.json()).toMatchObject({ ok: false, reason: "log_unavailable" });
  });

  it("400 on an unknown migration name", async () => {
    stubPb(new Set(["admin_migration_log"]));
    const r = await POST(new Request("https://t/api/admin/migrations", {
      method: "POST", headers: { authorization: "tok", "Content-Type": "application/json" },
      body: JSON.stringify({ migration_name: "drop_everything" }),
    }));
    expect(r.status).toBe(400);
  });
});

describe("GET status — detectField (schema-extension migration)", () => {
  function stubSchema(documentsHasFile: boolean) {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (/\/api\/collections\/documents$/.test(url) && method === "GET") {
        return { ok: true, status: 200, json: async () => ({ fields: documentsHasFile ? [{ name: "output" }, { name: "file" }] : [{ name: "output" }] }) };
      }
      if (/\/records/.test(url) && method === "GET") return { ok: true, status: 200, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    }));
  }
  const find = (ms: { route: string; status: string }[]) => ms.find((m) => m.route === "documents-v2")!;

  it("documents-v2 reports 'missing' until the file field exists", async () => {
    stubSchema(false);
    const data = await (await GET(req())).json() as { migrations: { route: string; status: string }[] };
    expect(find(data.migrations).status).toBe("missing");
  });

  it("documents-v2 reports 'exists' once the file field is present", async () => {
    stubSchema(true);
    const data = await (await GET(req())).json() as { migrations: { route: string; status: string }[] };
    expect(find(data.migrations).status).toBe("exists");
  });

  it("documents-v3 reports missing/exists by its own detectField (docuseal_submission_id)", async () => {
    const findV3 = (ms: { route: string; status: string }[]) => ms.find((m) => m.route === "documents-v3")!;
    // schema has `file` but NOT docuseal_submission_id → v2 exists, v3 missing
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (/\/api\/collections\/documents$/.test(url) && method === "GET") return { ok: true, status: 200, json: async () => ({ fields: [{ name: "file" }] }) };
      if (/\/records/.test(url) && method === "GET") return { ok: true, status: 200, json: async () => ({ items: [] }) };
      return { ok: true, json: async () => ({}) };
    }));
    const data = await (await GET(req())).json() as { migrations: { route: string; status: string }[] };
    expect(findV3(data.migrations).status).toBe("missing");
  });
});

describe("MIGRATION_REGISTRY", () => {
  it("includes the Model-B3 cold-start collections and marks the log as bootstrap-only", () => {
    const routes = MIGRATION_REGISTRY.map((m) => m.route);
    expect(routes).toEqual(expect.arrayContaining(["contacts", "workflow-tasks", "upload-sessions", "admin-migration-log"]));
    expect(MIGRATION_REGISTRY.find((m) => m.route === "admin-migration-log")!.bootstrap).toBe(true);
    expect(MIGRATION_REGISTRY.find((m) => m.route === "contacts")!.bootstrap).toBeFalsy();
  });

  it("includes the W95.6.y businesses-v3 site-id migration (detectField guards idempotency)", () => {
    const v3 = MIGRATION_REGISTRY.find((m) => m.route === "businesses-v3")!;
    expect(v3).toBeTruthy();
    expect(v3.collection).toBe("businesses");
    expect(v3.detectField).toBe("plausible_site_id"); // re-runs report "exists" once the field is present
  });
});
