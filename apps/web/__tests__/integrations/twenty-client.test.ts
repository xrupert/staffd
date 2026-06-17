/**
 * W95.1 — TwentyClient leak-guard: no untenanted access; the staffdCustomerId
 * tag is auto-injected on every read filter and every write.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TwentyClient } from "../../app/api/_lib/integrations/twenty/client";
import * as clientModule from "../../app/api/_lib/integrations/twenty/client";

let lastBody: { query: string; variables: Record<string, unknown> } | null;
function setFetch(impl: (body: { query: string; variables: Record<string, unknown> }) => unknown) {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    lastBody = JSON.parse((init?.body as string) ?? "{}");
    return { ok: true, json: async () => impl(lastBody!) };
  }));
}

beforeEach(() => {
  lastBody = null;
  vi.stubEnv("TWENTY_API_URL", "https://crm.operator.test");
  vi.stubEnv("TWENTY_API_KEY", "op-key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("TwentyClient leak-guard", () => {
  it("refuses an untenanted client (no customerId → throw)", () => {
    expect(() => TwentyClient.forCustomer("")).toThrow(/customerId|tenant/i);
    expect(() => TwentyClient.forCustomer(null)).toThrow();
  });

  it("createPerson auto-injects staffdCustomerId = the customerId", async () => {
    setFetch(() => ({ data: { createPerson: { id: "p1", name: { firstName: "Jane" } } } }));
    const id = await TwentyClient.forCustomer("userA").createPerson({ name: "Jane Doe", email: "jane@x.com" });
    expect(id).toBe("p1");
    expect(lastBody!.variables.data).toMatchObject({ staffdCustomerId: "userA" });
    expect((lastBody!.variables.data as { emails?: unknown }).emails).toBeTruthy();
  });

  it("listPeople always injects the tenant filter", async () => {
    setFetch(() => ({ data: { people: { edges: [{ node: { id: "p1", name: { firstName: "Jane" } } }] } } }));
    const people = await TwentyClient.forCustomer("userA").listPeople();
    expect(people).toHaveLength(1);
    expect(lastBody!.query).toContain("staffdCustomerId");
    expect(lastBody!.variables.tag).toBe("userA");
  });

  it("does NOT export a raw GraphQL fetch helper (structural guard — only the class is reachable)", () => {
    const exported = Object.keys(clientModule);
    expect(exported).toContain("TwentyClient");
    expect(exported.some((k) => /gql|graphql|fetch|query|raw/i.test(k))).toBe(false);
  });

  it("createPerson returns null on a GraphQL error (no throw to caller)", async () => {
    setFetch(() => ({ errors: [{ message: "boom" }] }));
    expect(await TwentyClient.forCustomer("userA").createPerson({ name: "Jane" })).toBeNull();
  });
});
