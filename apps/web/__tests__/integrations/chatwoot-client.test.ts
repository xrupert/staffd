/**
 * W95.6 — ChatwootClient leak-guard: inbox-per-customer (staffd-<userId>),
 * find-or-create with name-lookup race mitigation, inbox-scoped reads, no raw
 * HTTP escape hatch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "tok",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
}));

import { ChatwootClient } from "../../app/api/_lib/integrations/chatwoot/client";
import * as mod from "../../app/api/_lib/integrations/chatwoot/client";

const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
// Configurable backend state.
let bizInboxId: number | null;     // businesses.chatwoot_inbox_id
let existingInboxes: { id: number; name?: string }[];
let createdInboxId: number;
function setFetch() {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, method, body });
    // businesses lookup (cached inbox id)
    if (url.includes("/businesses/records?") && method === "GET") {
      return { ok: true, status: 200, json: async () => ({ items: [{ id: "biz-1", chatwoot_inbox_id: bizInboxId ?? undefined }] }) };
    }
    if (url.includes("/businesses/records/") && method === "PATCH") return { ok: true, json: async () => ({}) };
    // Chatwoot inbox list / create
    if (url.includes("/inboxes") && method === "GET") return { ok: true, status: 200, json: async () => ({ payload: existingInboxes }) };
    if (url.includes("/inboxes") && method === "POST") return { ok: true, status: 200, json: async () => ({ id: createdInboxId }) };
    // conversations / messages
    if (url.includes("/conversations?")) return { ok: true, status: 200, json: async () => ({ data: { payload: [{ id: 7, status: "open", timestamp: 1700000000, meta: { sender: { name: "Acme" } }, last_non_activity_message: { content: "help me please with my order" } }] } }) };
    if (url.match(/\/conversations\/\d+\/messages/)) return { ok: true, status: 200, json: async () => ({ payload: [{ id: 2, content: "second", message_type: 1, created_at: 1700000200 }, { id: 1, content: "first", message_type: 0, created_at: 1700000100 }] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }));
}

beforeEach(() => {
  bizInboxId = null; existingInboxes = []; createdInboxId = 99;
  vi.stubEnv("CHATWOOT_URL", "https://cw.test"); vi.stubEnv("CHATWOOT_API_KEY", "k"); vi.stubEnv("CHATWOOT_ACCOUNT_ID", "1");
  setFetch();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("ChatwootClient leak-guard", () => {
  it("refuses an untenanted client", () => {
    expect(() => ChatwootClient.forCustomer("")).toThrow(/customerId|tenant/i);
    expect(() => ChatwootClient.forCustomer(null)).toThrow();
  });

  it("does NOT export a raw HTTP helper (structural guard)", () => {
    expect(Object.keys(mod)).toEqual(["ChatwootClient"]);
  });

  it("findOrCreateInbox CREATES staffd-<userId> when absent + caches it on businesses", async () => {
    const r = await ChatwootClient.forCustomer("userA").findOrCreateInbox();
    expect(r.inbox_id).toBe(99);
    const create = calls.find((c) => c.url.endsWith("/inboxes") && c.method === "POST");
    expect((create!.body as { name: string }).name).toBe("staffd-userA");
    expect(calls.some((c) => c.url.includes("/businesses/records/biz-1") && c.method === "PATCH")).toBe(true);
  });

  it("REUSES the cached businesses inbox id (no list, no create)", async () => {
    bizInboxId = 42;
    const r = await ChatwootClient.forCustomer("userA").findOrCreateInbox();
    expect(r.inbox_id).toBe(42);
    expect(calls.some((c) => c.url.includes("/inboxes") && c.method === "POST")).toBe(false);
  });

  it("REUSES an existing inbox found by name (race/self-heal — no duplicate create)", async () => {
    existingInboxes = [{ id: 55, name: "staffd-userA" }];
    const r = await ChatwootClient.forCustomer("userA").findOrCreateInbox();
    expect(r.inbox_id).toBe(55);
    expect(calls.some((c) => c.url.endsWith("/inboxes") && c.method === "POST")).toBe(false);
  });

  it("listConversations injects the resolved inbox_id and maps shape", async () => {
    bizInboxId = 42;
    const convos = await ChatwootClient.forCustomer("userA").listConversations({ status: "open" });
    expect(calls.some((c) => c.url.includes("/conversations?inbox_id=42&status=open"))).toBe(true);
    expect(convos[0]).toMatchObject({ id: 7, sender: "Acme", status: "open" });
    expect(convos[0]!.snippet.length).toBeLessThanOrEqual(40);
  });

  it("listMessages returns oldest-first with outgoing flag", async () => {
    const msgs = await ChatwootClient.forCustomer("userA").listMessages(7);
    expect(msgs.map((m) => m.content)).toEqual(["first", "second"]); // sorted by createdAt asc
    expect(msgs.find((m) => m.content === "second")!.outgoing).toBe(true);
  });
});
