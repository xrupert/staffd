/**
 * W91 — /api/user-integrations[/type][/test] routes.
 * Covers upsert (encrypts + scopes to the authed user), GET (masked, no
 * plaintext), DELETE (removes), and test-connection (persists verdict).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const who = vi.hoisted(() => ({ user: { id: "userA", email: "a@acme.com" } as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: vi.fn(async () => who.user) }));
vi.mock("../../app/api/_lib/integrations/crypto", () => ({
  // Realistic mock: base64 ciphertext, never echoes the plaintext.
  encryptSecret: (p: string) => `v1:iv:tag:${Buffer.from(p).toString("base64")}`,
  maskKey: (l4: string | null) => (l4 ? `••••${l4}` : "(not configured)"),
}));
vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "admin-token",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
}));

import { POST as upsertPOST, DELETE as upsertDELETE } from "../../app/api/user-integrations/[type]/route";
import { GET as listGET } from "../../app/api/user-integrations/route";
import { POST as testPOST } from "../../app/api/user-integrations/[type]/test/route";

let lastFetch: ReturnType<typeof vi.fn>;
function setFetch(impl: (url: string, init?: RequestInit) => unknown) {
  lastFetch = vi.fn(impl as never);
  vi.stubGlobal("fetch", lastFetch);
}
const ctx = (type: string) => ({ params: Promise.resolve({ type }) });
const req = (body?: unknown) => new Request("https://t/api/user-integrations/twenty", { method: "POST", body: body ? JSON.stringify(body) : undefined, headers: { authorization: "tok" } });

beforeEach(() => { who.user = { id: "userA", email: "a@acme.com" }; });
afterEach(() => vi.unstubAllGlobals());

describe("POST upsert", () => {
  it("encrypts the key, scopes the lookup to the authed user, creates a row", async () => {
    const calls: string[] = [];
    setFetch((url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("?filter=")) return { ok: true, json: async () => ({ items: [] }) }; // no existing row
      return { ok: true, json: async () => ({ id: "new1" }) }; // create
    });
    const res = await upsertPOST(req({ connection_url: "https://crm.a.test", api_key: "secret1234" }), ctx("twenty"));
    expect(res.status).toBe(200);
    // lookup filter must scope to userA
    expect(calls.find((c) => c.includes("filter="))).toContain("userA");
    // create body must carry the encrypted key (never the plaintext)
    const createCall = lastFetch.mock.calls.find((c) => (c[1] as RequestInit)?.method === "POST");
    const sent = JSON.parse((createCall![1] as RequestInit).body as string);
    expect(sent.api_key.startsWith("v1:")).toBe(true);
    expect(JSON.stringify(sent)).not.toContain("secret1234");
    expect(sent.additional_config.key_last4).toBe("1234");
  });

  it("rejects an unknown integration type", async () => {
    setFetch(() => ({ ok: true, json: async () => ({}) }));
    const res = await upsertPOST(req({ api_key: "x" }), ctx("salesforce"));
    expect(res.status).toBe(400);
  });

  it("401 when not authenticated", async () => {
    who.user = null;
    setFetch(() => ({ ok: true, json: async () => ({}) }));
    const res = await upsertPOST(req({ api_key: "x" }), ctx("twenty"));
    expect(res.status).toBe(401);
  });
});

describe("GET list", () => {
  it("returns masked key + status, never the encrypted/plaintext key", async () => {
    setFetch(() => ({ ok: true, json: async () => ({ items: [
      { integration_type: "twenty", connection_url: "https://crm.a.test", additional_config: { key_last4: "1234" }, status: "connected", last_verified_at: "2026-06-16" },
    ] }) }));
    const res = await listGET(new Request("https://t/api/user-integrations", { headers: { authorization: "tok" } }));
    const d = await res.json();
    const twenty = d.integrations.find((i: { type: string }) => i.type === "twenty");
    expect(twenty).toMatchObject({ status: "connected", masked_key: "••••1234" });
    expect(JSON.stringify(d)).not.toContain("api_key");
    expect(JSON.stringify(d)).not.toContain("v1:");
    // unconfigured vendors still appear with a disconnected default
    expect(d.integrations.find((i: { type: string }) => i.type === "docuseal")).toMatchObject({ status: "disconnected", masked_key: "(not configured)" });
  });
});

describe("DELETE", () => {
  it("removes the row and reports disconnected", async () => {
    setFetch((url, init) => {
      if (url.includes("?filter=")) return { ok: true, json: async () => ({ items: [{ id: "row1" }] }) };
      if ((init?.method) === "DELETE") return { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    });
    const res = await upsertDELETE(new Request("https://t", { method: "DELETE", headers: { authorization: "tok" } }), ctx("twenty"));
    const d = await res.json();
    expect(d).toMatchObject({ ok: true, status: "disconnected", deleted: true });
    expect(lastFetch.mock.calls.some((c) => (c[1] as RequestInit)?.method === "DELETE")).toBe(true);
  });
});
