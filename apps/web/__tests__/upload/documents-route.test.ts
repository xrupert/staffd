/**
 * W95.3 — POST /api/upload/documents: writes to the EXISTING documents
 * collection with a source marker (agent_name="Uploaded document") + a Vault
 * decision (source=upload). Type allowlist enforced; vendor-free.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const who = vi.hoisted(() => ({ user: { id: "userA", email: "a@x.com" } as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: vi.fn(async () => who.user) }));

const rec = vi.hoisted(() => ({ fn: vi.fn(async (_i: Record<string, unknown>) => ({ ok: true })) }));
vi.mock("../../app/api/_lib/vault/outcomes", () => ({ recordDecision: rec.fn }));

vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "admin-token",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
}));

import { POST } from "../../app/api/upload/documents/route";

let calls: { url: string; method: string; body: Record<string, unknown> | null }[];
function setFetch() {
  calls = [];
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, method, body });
    if (url.includes("/documents/records") && method === "POST") return { ok: true, json: async () => ({ id: `d-${++n}` }) };
    return { ok: true, json: async () => ({}) };
  }));
}
function docReq(files: { name: string; content?: string }[]) {
  const fd = new FormData();
  for (const f of files) fd.append("file", new File([f.content ?? "x"], f.name));
  return new Request("https://t/api/upload/documents", { method: "POST", body: fd });
}

beforeEach(() => { who.user = { id: "userA", email: "a@x.com" }; rec.fn.mockClear(); setFetch(); });
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/upload/documents", () => {
  it("writes a documents row marked as an upload and records a Vault decision", async () => {
    const res = await POST(docReq([{ name: "notes.txt", content: "hello world" }]));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, total: 1, succeeded: 1, failed: 0 });

    const write = calls.find((c) => c.url.includes("/documents/records") && c.method === "POST");
    expect(write!.body).toMatchObject({ user: "userA", agent_name: "Uploaded document", department: "library", prompt: "notes.txt", output: "hello world" });

    expect(rec.fn).toHaveBeenCalledTimes(1);
    expect(rec.fn.mock.calls[0]![0]).toMatchObject({ userId: "userA", decision_kind: "document_uploaded" });
  });

  it("rejects unsupported file types without writing them", async () => {
    const res = await POST(docReq([{ name: "evil.exe" }, { name: "ok.md", content: "# hi" }]));
    const d = await res.json() as { total: number; succeeded: number; failed: number; errors: { row: number; reason: string }[] };
    expect(d).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(d.errors[0]!.reason).toMatch(/unsupported/i);
    expect(calls.filter((c) => c.url.includes("/documents/records") && c.method === "POST")).toHaveLength(1);
  });

  it("401 unauth; 400 when no file provided", async () => {
    who.user = null;
    expect((await POST(docReq([{ name: "a.txt" }]))).status).toBe(401);
    who.user = { id: "userA", email: "a@x.com" };
    expect((await POST(new Request("https://t/api/upload/documents", { method: "POST", body: new FormData() }))).status).toBe(400);
  });
});
