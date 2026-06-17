/**
 * W95.2 — ListmonkClient leak-guard: list-per-customer (staffd-<userId>),
 * no untenanted access, every op scoped to the customer's list.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ListmonkClient } from "../../app/api/_lib/integrations/listmonk/client";
import * as mod from "../../app/api/_lib/integrations/listmonk/client";

const calls: { url: string; method: string; body: unknown }[] = [];
function setFetch(impl: (url: string, method: string) => unknown) {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : null });
    return { ok: true, status: 200, json: async () => impl(url, method) };
  }));
}

beforeEach(() => {
  vi.stubEnv("LISTMONK_URL", "https://lm.operator.test");
  vi.stubEnv("LISTMONK_USERNAME", "api");
  vi.stubEnv("LISTMONK_PASSWORD", "pass");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("ListmonkClient leak-guard", () => {
  it("refuses an untenanted client", () => {
    expect(() => ListmonkClient.forCustomer("")).toThrow(/customerId|tenant/i);
    expect(() => ListmonkClient.forCustomer(null)).toThrow();
  });

  it("addSubscriber creates the staffd-<userId> list when missing, then scopes the subscriber to it", async () => {
    setFetch((url, method) => {
      if (url.includes("/api/lists?") ) return { data: { results: [] } };          // no existing list
      if (url.includes("/api/lists") && method === "POST") return { data: { id: 7 } }; // create → id 7
      return { data: { id: 99 } };                                                  // subscriber add
    });
    const ok = await ListmonkClient.forCustomer("userA").addSubscriber({ email: "x@y.com", name: "X" });
    expect(ok).toBe(true);
    const created = calls.find((c) => c.url.endsWith("/api/lists") && c.method === "POST");
    expect((created!.body as { name: string }).name).toBe("staffd-userA");
    const sub = calls.find((c) => c.url.includes("/api/subscribers") && c.method === "POST");
    expect((sub!.body as { lists: number[] }).lists).toEqual([7]);
  });

  it("reuses an existing staffd-<userId> list (no duplicate create)", async () => {
    setFetch((url) => {
      if (url.includes("/api/lists?")) return { data: { results: [{ id: 5, name: "staffd-userA" }] } };
      return { data: { id: 1 } };
    });
    await ListmonkClient.forCustomer("userA").addSubscriber({ email: "x@y.com" });
    expect(calls.some((c) => c.url.endsWith("/api/lists") && c.method === "POST")).toBe(false);
    expect((calls.find((c) => c.url.includes("/api/subscribers"))!.body as { lists: number[] }).lists).toEqual([5]);
  });

  it("listSubscribers always injects the list_id filter", async () => {
    setFetch((url) => {
      if (url.includes("/api/lists?")) return { data: { results: [{ id: 5, name: "staffd-userA" }] } };
      return { data: { results: [{ email: "a@b.com", name: "A" }] } };
    });
    const subs = await ListmonkClient.forCustomer("userA").listSubscribers();
    expect(subs).toHaveLength(1);
    expect(calls.some((c) => c.url.includes("list_id=5"))).toBe(true);
  });

  it("does NOT export a raw HTTP helper (structural guard)", () => {
    expect(Object.keys(mod)).toContain("ListmonkClient");
    expect(Object.keys(mod).some((k) => /lm|http|fetch|raw/i.test(k))).toBe(false);
  });
});
