/**
 * W95.7 — buildHealthReport (pure) + GET /api/admin/health (route).
 * The substrate self-check: green when every registry satisfies the V1
 * contract; flags missing handlers / workers / collections / pending migrations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildHealthReport, EXPECTED_INTENTS, EXPECTED_WORKERS, EXPECTED_RECIPES, type HealthInputs } from "../../app/api/_lib/admin/health";

// A fully-green baseline; each test perturbs one dimension.
function green(): HealthInputs {
  return {
    expectedCollections: ["a", "b", "c"],
    foundCollections: ["a", "b", "c"],
    commitHandlers: [...EXPECTED_INTENTS, "disable_autopilot", "undo"],
    workerHandlers: [...EXPECTED_WORKERS],
    recipeIds: [...EXPECTED_RECIPES],
    vendorConfigured: { twenty: true, listmonk: true, chatwoot: false, docuseal: false, plausible: true },
    migrations: [{ route: "contacts", applied: true }, { route: "businesses-v3", applied: true }],
  };
}

describe("buildHealthReport (W95.7)", () => {
  it("ok:true and full shape when everything satisfies the V1 contract", () => {
    const r = buildHealthReport(green());
    expect(r.ok).toBe(true);
    expect(r.collections).toMatchObject({ expected_count: 3, found_count: 3, missing: [], extra: [] });
    expect(r.intents.missing_handlers).toEqual([]);
    expect(r.workers.missing).toEqual([]);
    expect(r.migrations).toMatchObject({ total: 2, applied: 2, pending: [] });
    expect(r.recipes.paradigm_doc_in_sync).toBe(true);
    // Vendor map always lists all five with client_present true.
    expect(Object.keys(r.vendor_clients).sort()).toEqual(["chatwoot", "docuseal", "listmonk", "plausible", "twenty"]);
    expect(r.vendor_clients.twenty).toEqual({ client_present: true, env_configured: true });
    expect(r.vendor_clients.chatwoot).toEqual({ client_present: true, env_configured: false });
  });

  it("detects a missing intent handler", () => {
    const i = green();
    i.commitHandlers = i.commitHandlers.filter((h) => h !== "reply_to_ticket");
    const r = buildHealthReport(i);
    expect(r.ok).toBe(false);
    expect(r.intents.missing_handlers).toEqual(["reply_to_ticket"]);
  });

  it("detects a missing worker", () => {
    const i = green();
    i.workerHandlers = i.workerHandlers.filter((w) => w !== "chatwoot_send_worker");
    const r = buildHealthReport(i);
    expect(r.ok).toBe(false);
    expect(r.workers.missing).toEqual(["chatwoot_send_worker"]);
  });

  it("detects a missing collection (and reports extras separately)", () => {
    const i = green();
    i.foundCollections = ["a", "c", "surprise"];
    const r = buildHealthReport(i);
    expect(r.ok).toBe(false);
    expect(r.collections.missing).toEqual(["b"]);
    expect(r.collections.extra).toEqual(["surprise"]);
  });

  it("ignores PocketBase system collections (_-prefixed) when computing extras", () => {
    // PB v0.23+ ships _mfas/_otps/_externalAuths/_authOrigins/_superusers as
    // framework infrastructure — they are never app schema, so the substrate
    // check must not flag them as drift (mirrors verify-row-rules' `_` skip).
    const i = green();
    i.foundCollections = ["a", "b", "c", "_superusers", "_mfas", "_otps", "_externalAuths", "_authOrigins"];
    const r = buildHealthReport(i);
    expect(r.collections.extra).toEqual([]);
    expect(r.collections.found_count).toBe(3);
    expect(r.collections.missing).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("detects pending migrations", () => {
    const i = green();
    i.migrations = [{ route: "contacts", applied: true }, { route: "businesses-v3", applied: false }];
    const r = buildHealthReport(i);
    expect(r.ok).toBe(false);
    expect(r.migrations.pending).toEqual(["businesses-v3"]);
  });

  // W95.7.3b — the async generation job ledger is a registered V1 collection.
  it("generation_jobs is in EXPECTED_COLLECTIONS (W95.7.3b)", () => {
    expect(EXPECTED_COLLECTIONS.some((e) => e.name === "generation_jobs")).toBe(true);
  });

  it("flags recipe drift when an unexpected recipe appears", () => {
    const i = green();
    i.recipeIds = [...EXPECTED_RECIPES, "rogue_recipe"];
    const r = buildHealthReport(i);
    expect(r.ok).toBe(false);
    expect(r.recipes.paradigm_doc_in_sync).toBe(false);
  });
});

// ── Route ──
const adminMock = vi.hoisted(() => ({ ok: true }));
vi.mock("../../app/api/_lib/auth/super-admin", () => ({
  requireSuperAdmin: vi.fn(async () => { if (!adminMock.ok) { const e = new Error("forbidden") as Error & { __auth: boolean }; e.__auth = true; throw e; } return { id: "admin", email: "boss@staffd.com" }; }),
  toAuthErrorResponse: () => Response.json({ error: "forbidden" }, { status: 403 }),
}));
vi.mock("../../app/api/_lib/pb", () => ({ pbUrl: () => "https://pb.test", getAdminToken: async () => "tok", adminHeaders: (t: string) => ({ Authorization: t }), pbEscape: (s: string) => s }));

import { GET } from "../../app/api/admin/health/route";
import { EXPECTED_COLLECTIONS } from "../../app/api/_lib/security/row-rules";

beforeEach(() => { adminMock.ok = true; });
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/admin/health (W95.7 route)", () => {
  it("403 for a non-super-admin", async () => {
    adminMock.ok = false;
    expect((await GET(new Request("https://t/api/admin/health"))).status).toBe(403);
  });

  it("returns a green report when PB has every expected collection + field", async () => {
    // Stub /api/collections to echo every expected collection WITH the fields
    // each detectField migration looks for, so nothing reads as pending.
    const detectFields: Record<string, string[]> = {
      documents: ["file", "docuseal_submission_id"],
      businesses: ["chatwoot_inbox_id", "plausible_site_id"],
      workflows: ["draft_output"],
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/collections?")) {
        const items = EXPECTED_COLLECTIONS.map((e) => ({ name: e.name, fields: (detectFields[e.name] ?? []).map((name) => ({ name })) }));
        // workflow_tasks collection backs the "workflow-tasks" migration too.
        return { ok: true, status: 200, json: async () => ({ items }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }));
    const res = await GET(new Request("https://t/api/admin/health", { headers: { authorization: "tok" } }));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.collections.missing).toEqual([]);
    expect(d.intents.missing_handlers).toEqual([]);
    expect(d.workers.missing).toEqual([]);
    expect(d.recipes.registered).toEqual([...EXPECTED_RECIPES]);
    expect(d.migrations.pending).toEqual([]);
    expect(typeof d.ok).toBe("boolean");
    expect(d.ok).toBe(true);
  });
});
