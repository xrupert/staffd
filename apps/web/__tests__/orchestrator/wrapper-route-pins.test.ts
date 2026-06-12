/**
 * W61′ — Contract pins for the consolidated wrapper routes (ARCH §5
 * "front door" table). Each delegates to runOrchestrator; these pins
 * freeze the public request/response shapes so any future refactor that
 * drifts a contract fails loudly.
 *
 * runOrchestrator is mocked — the wrappers' translation layers are the
 * subject under test, not the handlers (pinned separately).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const orchMocks = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  response: {} as Record<string, unknown>,
}));

vi.mock("../../app/api/_lib/orchestrator", () => ({
  runOrchestrator: async (req: Record<string, unknown>) => {
    orchMocks.calls.push(req);
    return orchMocks.response;
  },
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

import { POST as orchestratePost } from "../../app/api/orchestrate/route";
import { POST as briefingPost } from "../../app/api/briefing/route";
import { POST as handoffPost } from "../../app/api/handoff/suggest/route";

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  orchMocks.calls = [];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id: "doc_x" }) })));
});

describe("/api/orchestrate (intent:'route') — wrapper pins", () => {
  it("streams rationale + READY line with department/agentId/task/lockedAlternative", async () => {
    orchMocks.response = {
      ok: true,
      intent: "route",
      decision: { department: "finance", agentId: "finance-bookkeeper", task: "reconcile the books", rationale: "Your Bookkeeper fits." },
      notes: "lockedAlternative:operations",
      latencyMs: 5, attempts: 1,
    };
    const res = await orchestratePost(jsonRequest("https://t/api/orchestrate", {
      messages: [{ role: "user", content: "reconcile my books" }],
      userId: "u1", pbToken: "t",
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("Your Bookkeeper fits.");
    const ready = text.match(/READY:(\{.+\})/s);
    expect(ready).toBeTruthy();
    expect(JSON.parse(ready![1]!)).toEqual({
      department: "finance",
      agentId: "finance-bookkeeper",
      task: "reconcile the books",
      lockedAlternative: "operations",
    });
    // Wrapper forwarded intent:"route" with the message context.
    expect(orchMocks.calls[0]).toMatchObject({ intent: "route", userId: "u1" });
  });

  it("degraded envelope still streams a usable READY line (never an empty body)", async () => {
    orchMocks.response = {
      ok: false,
      intent: "route",
      fallback: "upstream_error",
      degraded: { department: "marketing", task: "draft content", rationale: "Routing this to Marketing — they'll take it from here." },
      latencyMs: 5, attempts: 1,
    };
    const res = await orchestratePost(jsonRequest("https://t/api/orchestrate", {
      messages: [{ role: "user", content: "draft content" }],
      userId: "u1", pbToken: "t",
    }));
    const text = await res.text();
    expect(text).toContain("READY:");
    expect(text).toContain("Routing this to Marketing");
  });

  it("empty messages → 400", async () => {
    const res = await orchestratePost(jsonRequest("https://t/api/orchestrate", { messages: [], userId: "u1" }));
    expect(res.status).toBe(400);
  });
});

describe("/api/briefing (intent:'brief') — wrapper pins", () => {
  it("streams the brief text and persists on success (W49 baseline)", async () => {
    orchMocks.response = {
      ok: true, intent: "brief",
      decision: { task: "## Weekly Briefing\n\nPinned brief." },
      latencyMs: 5, attempts: 1,
    };
    const res = await briefingPost(jsonRequest("https://t/api/briefing", { userId: "u1", pbToken: "t" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(await res.text()).toContain("Pinned brief.");
    // W49 — documents POST fired (fetch stub captured it).
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    const docWrites = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/collections/documents/records"));
    expect(docWrites).toHaveLength(1);
  });

  it("missing auth → 401", async () => {
    const res = await briefingPost(jsonRequest("https://t/api/briefing", {}));
    expect(res.status).toBe(401);
  });
});

describe("/api/handoff/suggest (intent:'handoff') — wrapper pins", () => {
  it("inline sourceDoc path forwards intent:'handoff' and returns the raw envelope", async () => {
    orchMocks.response = {
      ok: true, intent: "handoff",
      decision: { rationale: "Cross-functional next steps." },
      followUps: [{ department: "sales", task: "draft outreach", rationale: "r", locked: false }],
      latencyMs: 5, attempts: 1,
    };
    const res = await handoffPost(jsonRequest("https://t/api/handoff/suggest", {
      userId: "u1", pbToken: "t",
      sourceDoc: { department: "marketing", prompt: "blog", outputExcerpt: "..." },
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; followUps: Array<{ department: string }> };
    expect(body.ok).toBe(true);
    expect(body.followUps[0]!.department).toBe("sales");
    expect(orchMocks.calls[0]).toMatchObject({ intent: "handoff", userId: "u1" });
  });

  it("missing userId/pbToken → 401; no source at all → 400", async () => {
    expect((await handoffPost(jsonRequest("https://t/x", { sourceDoc: {} }))).status).toBe(401);
    expect((await handoffPost(jsonRequest("https://t/x", { userId: "u1", pbToken: "t" }))).status).toBe(400);
  });
});
