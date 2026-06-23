/**
 * W95.7.3d-h1 — model resolution fails LOUDLY (structured 500s); the legacy
 * hardcoded-slug fallback is gone. routeFor + the generation_models catalog are
 * the only resolution path. Plus a source-grep guard for the removed slugs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

vi.hoisted(() => { process.env.MUAPI_API_KEY = "k"; process.env.NEXT_PUBLIC_POCKETBASE_URL = "https://pb.test"; });
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: async () => ({ content: [{ type: "text", text: "enriched dense prompt long enough" }] }) }; } }));
vi.mock("../../app/api/_lib/auth/super-admin", () => ({ trySuperAdminByUserId: async () => null }));
vi.mock("../../app/api/_lib/pb", () => ({ getAdminToken: async () => "tok" }));
vi.mock("../../app/api/_lib/credits", () => ({ getCreditState: async () => ({ totalRemaining: { image: 100, video: 100 }, monthlyAllowance: { image: 100, video: 100 }, plan: "growth" }) }));

const sub = vi.hoisted(() => ({ fn: vi.fn(async (..._a: unknown[]) => ({ id: "p1" })) }));
vi.mock("../../app/api/_lib/integrations/muapi/predictions", async () => {
  const actual = await vi.importActual<typeof import("../../app/api/_lib/integrations/muapi/predictions")>("../../app/api/_lib/integrations/muapi/predictions");
  return { ...actual, submitPrediction: sub.fn };
});
vi.mock("../../app/api/_lib/generation/jobs", () => ({
  createJob: async () => "job-1", completeJob: async () => ({ status: "completed", url: "u", remaining: 1 }),
  fingerprintFor: () => "fp", findInflightByFingerprint: async () => null,
}));

const route = vi.hoisted(() => ({ models: ["a"] as string[] }));
vi.mock("../../app/api/_lib/generation/routing", () => ({ routeFor: () => route.models }));
const cat = vi.hoisted(() => ({ present: new Set<string>() }));
vi.mock("../../app/api/_lib/generation/catalog", () => ({ modelTierWeight: async (name: string) => (cat.present.has(name) ? { tier: "pro", credit_weight: 8, dynamic_pricing: false } : null) }));

import { POST } from "../../app/api/integrations/muapi/route";

const post = (body: object) => POST(new Request("https://t/api/integrations/muapi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const body = { userId: "u1", kind: "image", prompt: "a red apple", tier: "pro", department: "marketing" };

beforeEach(() => { sub.fn.mockClear(); route.models = ["a"]; cat.present = new Set(["a"]); });
afterEach(() => vi.restoreAllMocks());

describe("W95.7.3d-h1 — resolveModel fails loudly", () => {
  it("routeFor empty → 500 routing_unresolved (four-field body), no Muapi call", async () => {
    route.models = [];
    const res = await post(body);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "routing_unresolved", department: "marketing", kind: "image", tier: "pro" });
    expect(sub.fn).not.toHaveBeenCalled();
  });

  it("first slug absent from catalog → falls to the next, submits with it", async () => {
    route.models = ["missing", "present"]; cat.present = new Set(["present"]);
    const res = await post(body);
    expect(res.status).toBe(202);
    expect(sub.fn).toHaveBeenCalledTimes(1);
    expect(sub.fn.mock.calls[0]![0]).toBe("present");
  });

  it("ALL slugs absent from catalog → falls back to the verified primary slug + submits (h4)", async () => {
    route.models = ["x", "y"]; cat.present = new Set(); // empty/unsynced catalog
    const res = await post(body);
    expect(res.status).toBe(202); // no longer a hard 500 — generation proceeds
    expect(sub.fn).toHaveBeenCalledTimes(1);
    expect(sub.fn.mock.calls[0]![0]).toBe("x"); // the verified primary slug
  });

  it("valid routing + catalog → submits with the exact first slug", async () => {
    route.models = ["good-slug"]; cat.present = new Set(["good-slug"]);
    const res = await post(body);
    expect(res.status).toBe(202);
    expect(sub.fn.mock.calls[0]![0]).toBe("good-slug");
  });

  it("E2E: no routing entry → structured 500, zero Muapi calls attempted", async () => {
    route.models = [];
    await post({ ...body, department: "design" });
    expect(sub.fn).not.toHaveBeenCalled();
  });
});

describe("W95.7.3d-h1 — legacy slugs removed from source", () => {
  it("no genuinely-legacy slugs (flux-dev-image / bare veo3) in app/ or lib/ source", () => {
    // NOTE: `flux-dev` was REMOVED from this forbidden set on 2026-06-23 — the
    // live Muapi catalog confirms `flux-dev` is the real image-pro model. h1 had
    // wrongly assumed it was legacy and substituted the nonexistent "flux-1-dev",
    // which is why generation drifted. `flux-dev-image` and bare `veo3` remain
    // genuinely legacy. (h4: video now routes to text-to-video models like
    // openai-sora-2-pro-text-to-video — the old i2v slugs needed a source image.)
    const webRoot = resolve(__dirname, "..", "..");
    const forbidden = /flux-dev-image|"veo3"/;
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "__tests__" || e.name === "node_modules" || e.name === ".next") continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(e.name) && forbidden.test(readFileSync(full, "utf8"))) hits.push(full.replace(webRoot, ""));
      }
    };
    walk(resolve(webRoot, "app")); walk(resolve(webRoot, "lib"));
    expect(hits, `legacy slug literals found:\n${hits.join("\n")}`).toEqual([]);
  });
});
