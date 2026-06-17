/**
 * W95.2 — DocusealClient leak-guard: staffdCustomerId metadata tag on create,
 * client-side metadata filter on list (defensive tenant isolation).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DocusealClient } from "../../app/api/_lib/integrations/docuseal/client";
import * as mod from "../../app/api/_lib/integrations/docuseal/client";

let lastBody: Record<string, unknown> | null;
function setFetch(json: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    lastBody = init?.body ? JSON.parse(init.body as string) : null;
    return { ok: true, status: 200, json: async () => json };
  }));
}

beforeEach(() => {
  lastBody = null;
  vi.stubEnv("DOCUSEAL_URL", "https://sign.operator.test");
  vi.stubEnv("DOCUSEAL_API_KEY", "key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("DocusealClient leak-guard", () => {
  it("refuses an untenanted client", () => {
    expect(() => DocusealClient.forCustomer("")).toThrow(/customerId|tenant/i);
  });

  it("createSubmission injects the staffdCustomerId metadata tag", async () => {
    setFetch({ id: 42, slug: "abc" });
    const r = await DocusealClient.forCustomer("userA").createSubmission({ templateId: 1, name: "NDA", signerEmail: "s@x.com" });
    expect(r).toMatchObject({ id: 42 });
    expect((lastBody!.metadata as { staffdCustomerId: string }).staffdCustomerId).toBe("userA");
  });

  it("listSubmissions returns ONLY this tenant's submissions (client-side metadata filter)", async () => {
    setFetch({ data: [
      { id: 1, status: "pending", metadata: { staffdCustomerId: "userA" } },
      { id: 2, status: "completed", metadata: { staffdCustomerId: "userB" } }, // other tenant — must be excluded
      { id: 3, status: "pending", metadata: { staffdCustomerId: "userA" } },
    ] });
    const subs = await DocusealClient.forCustomer("userA").listSubmissions();
    expect(subs.map((s) => s.id).sort()).toEqual([1, 3]);
    expect(subs.some((s) => s.id === 2)).toBe(false); // no cross-tenant leak
  });

  it("createSubmission returns null on a failed response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 422, json: async () => ({}) })));
    expect(await DocusealClient.forCustomer("userA").createSubmission({ templateId: 1, name: "x", signerEmail: "s@x.com" })).toBeNull();
  });

  it("does NOT export a raw HTTP helper (structural guard)", () => {
    expect(Object.keys(mod)).toContain("DocusealClient");
    expect(Object.keys(mod).some((k) => /^ds$|http|fetch|raw/i.test(k))).toBe(false);
  });
});
