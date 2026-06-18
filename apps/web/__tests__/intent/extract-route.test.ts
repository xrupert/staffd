/**
 * W95.5 — POST /api/intent/extract autopilot branching: single + enabled →
 * autofire; single + graduation-due → graduationOffer; ambiguous (2) → always
 * modal (never autofire).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const who = vi.hoisted(() => ({ user: { id: "userA", email: "a@x.com" } as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: vi.fn(async () => who.user) }));

const ex = vi.hoisted(() => ({ intents: [] as { type: string; fields: Record<string, string>; confidence: number }[] }));
vi.mock("../../app/api/_lib/orchestrator/intent", () => ({ extractIntent: vi.fn(async () => ex.intents) }));

const pol = vi.hoisted(() => ({ auto: false, offer: false }));
vi.mock("../../app/api/_lib/autopilot/policy", () => ({
  shouldAutopilot: vi.fn(async () => pol.auto),
  shouldOfferGraduation: vi.fn(async () => pol.offer),
}));

import { POST } from "../../app/api/intent/extract/route";
const req = (message = "hi") => new Request("https://t/api/intent/extract", { method: "POST", headers: { authorization: "tok", "Content-Type": "application/json" }, body: JSON.stringify({ message }) });

beforeEach(() => { who.user = { id: "userA", email: "a@x.com" }; ex.intents = []; pol.auto = false; pol.offer = false; });
afterEach(() => vi.restoreAllMocks());

describe("POST /api/intent/extract — autopilot", () => {
  it("single + autopilot enabled → autofire", async () => {
    ex.intents = [{ type: "create_contact", fields: { name: "Jane" }, confidence: 0.9 }];
    pol.auto = true;
    expect(await (await POST(req())).json()).toMatchObject({ autofire: true });
  });

  it("single + graduation due → graduationOffer (no autofire)", async () => {
    ex.intents = [{ type: "create_contact", fields: { name: "Jane" }, confidence: 0.9 }];
    pol.offer = true;
    const d = await (await POST(req())).json();
    expect(d.graduationOffer).toBe(true);
    expect(d.autofire).toBeUndefined();
  });

  it("ambiguous (2 intents) NEVER autofires even if enabled", async () => {
    ex.intents = [
      { type: "capture_lead", fields: { name: "John" }, confidence: 0.82 },
      { type: "create_contact", fields: { name: "John" }, confidence: 0.78 },
    ];
    pol.auto = true;
    const d = await (await POST(req())).json();
    expect(d.autofire).toBeUndefined();
    expect(d.intents).toHaveLength(2);
  });

  it("single + nothing special → plain modal", async () => {
    ex.intents = [{ type: "create_task", fields: { title: "x" }, confidence: 0.9 }];
    const d = await (await POST(req())).json();
    expect(d.autofire).toBeUndefined();
    expect(d.graduationOffer).toBeUndefined();
  });

  it("401 unauth", async () => { who.user = null; expect((await POST(req())).status).toBe(401); });
});
