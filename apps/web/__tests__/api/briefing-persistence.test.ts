/**
 * W49 Tests 1, 2, 6 — /api/briefing persistence.
 *
 * Successful briefs persist to documents (department "ceo", agent_name
 * "Chief of Staff" — SA H3); degraded fallbacks do not (Decision 3 / H4);
 * a failed PB write logs at error level but the brief still streams.
 *
 * Documented intentional exceptions (Decision 8 / H5, audited in W49
 * Phase A): morning-brief persists to its own `vault_briefs` collection
 * (surfaced by MorningBriefCard), and the Chatwoot webhook posts drafts
 * as Chatwoot private notes — neither writes `documents` by design.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const orchestratorMock = vi.hoisted(() => ({
  response: { ok: true, decision: { task: "## Weekly Briefing\n\nReal brief content here." } } as Record<string, unknown>,
}));

vi.mock("../../app/api/_lib/orchestrator", () => ({
  runOrchestrator: async () => orchestratorMock.response,
}));

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin_tok",
  pbUrl: () => "https://pb.example.test",
  pbEscape: (s: string) => s,
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbFirst: async () => null,
}));

vi.mock("../../app/api/_lib/vault/queue", () => ({
  enqueue: vi.fn(async () => undefined),
}));

// h6e — the route now binds the body pbToken to userId; pass that gate here.
vi.mock("../../app/api/_lib/integrations/identity", () => ({
  verifyUserOwnsSelf: async () => true,
}));

import { POST } from "../../app/api/briefing/route";

let docPosts: Array<Record<string, unknown>>;
let docPostOk: boolean;

beforeEach(() => {
  docPosts = [];
  docPostOk = true;
  orchestratorMock.response = {
    ok: true,
    decision: { task: "## Weekly Briefing\n\nReal brief content here." },
  };
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    if (url.includes("/collections/documents/records") && init?.method === "POST") {
      docPosts.push(JSON.parse(init.body ?? "{}"));
      return { ok: docPostOk, status: docPostOk ? 200 : 500, json: async () => ({ id: "doc_1" }) };
    }
    return { ok: true, json: async () => ({}) };
  }));
});

function briefingRequest() {
  return new Request("https://test.local/api/briefing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "user-1", pbToken: "tok" }),
  });
}

describe("/api/briefing persistence (W49)", () => {
  it("persists successful briefs with the locked shape (Test 1)", async () => {
    const res = await POST(briefingRequest());
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Real brief content here.");

    expect(docPosts).toHaveLength(1);
    const doc = docPosts[0]!;
    expect(doc.user).toBe("user-1");
    expect(doc.department).toBe("ceo");
    expect(doc.agent_name).toBe("Chief of Staff");
    expect(String(doc.prompt)).toMatch(/^Weekly briefing — /);
    expect(doc.output).toContain("Real brief content here.");
  });

  it("does NOT persist degraded fallbacks (Test 2 / Decision 3)", async () => {
    orchestratorMock.response = {
      ok: false,
      degraded: { task: "Working from limited context right now." },
    };
    const res = await POST(briefingRequest());
    const body = await res.text();
    expect(body).toContain("Working from limited context");
    expect(docPosts).toHaveLength(0);
  });

  it("failed PB write logs at error level; brief still streams (Test 6)", async () => {
    docPostOk = false;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(briefingRequest());
    const body = await res.text();
    expect(body).toContain("Real brief content here.");
    expect(errSpy.mock.calls.flat().join("\n")).toContain("[W49] briefing persist failed");
    errSpy.mockRestore();
  });
});
