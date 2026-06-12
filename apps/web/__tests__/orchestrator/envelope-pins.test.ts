/**
 * W61′ — Envelope pins for the EXISTING /api/orchestrator entry point.
 *
 * Zero behavior change intended or allowed: these tests pass against the
 * shipped implementation and exist to freeze its contract — four-intent
 * dispatch, 400s on malformed input, the never-500 guarantee, and the
 * fire-and-forget decision log.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const handlerMocks = vi.hoisted(() => ({
  route: vi.fn(),
  handoff: vi.fn(),
  brief: vi.fn(),
  synthesize: vi.fn(),
  logged: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../app/api/_lib/orchestrator/handlers/route", () => ({
  handleRoute: handlerMocks.route,
}));
vi.mock("../../app/api/_lib/orchestrator/handlers/handoff", () => ({
  handleHandoff: handlerMocks.handoff,
}));
vi.mock("../../app/api/_lib/orchestrator/handlers/brief", () => ({
  handleBrief: handlerMocks.brief,
}));
vi.mock("../../app/api/_lib/orchestrator/handlers/synthesize", () => ({
  handleSynthesize: handlerMocks.synthesize,
}));
vi.mock("../../app/api/_lib/orchestrator/logger", () => ({
  logDecision: async (row: Record<string, unknown>) => {
    handlerMocks.logged.push(row);
  },
}));

import { POST } from "../../app/api/orchestrator/route";

function ok(intent: string) {
  return {
    ok: true,
    intent,
    decision: { task: `${intent}-result` },
    latencyMs: 5,
    attempts: 1,
    tokensIn: 10,
    tokensOut: 20,
  };
}

function orchestratorRequest(body: unknown, raw = false) {
  return new Request("https://test.local/api/orchestrator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  handlerMocks.logged = [];
  handlerMocks.route.mockResolvedValue(ok("route"));
  handlerMocks.handoff.mockResolvedValue(ok("handoff"));
  handlerMocks.brief.mockResolvedValue(ok("brief"));
  handlerMocks.synthesize.mockResolvedValue(ok("synthesize"));
});

describe("/api/orchestrator — envelope pins (W61′)", () => {
  for (const intent of ["route", "handoff", "brief", "synthesize"] as const) {
    it(`dispatches intent:"${intent}" to its handler and returns the envelope`, async () => {
      const res = await POST(orchestratorRequest({ intent, userId: "u1", pbToken: "t", context: {} }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; intent: string; decision: { task: string } };
      expect(body.ok).toBe(true);
      expect(body.intent).toBe(intent);
      expect(body.decision.task).toBe(`${intent}-result`);
      expect(handlerMocks[intent]).toHaveBeenCalledTimes(1);
    });
  }

  it("unknown intent returns 400 with structured error", async () => {
    const res = await POST(orchestratorRequest({ intent: "garbage", userId: "u1" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("unknown_intent");
  });

  it("missing intent returns 400", async () => {
    const res = await POST(orchestratorRequest({ userId: "u1" }));
    expect(res.status).toBe(400);
  });

  it("invalid JSON returns 400 with structured error", async () => {
    const res = await POST(orchestratorRequest("{not json", true));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_json");
  });

  it("handler throw → never-500: structured upstream_error envelope, HTTP 200", async () => {
    handlerMocks.brief.mockRejectedValue(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(orchestratorRequest({ intent: "brief", userId: "u1", pbToken: "t" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; fallback: string; degraded: unknown };
    expect(body.ok).toBe(false);
    expect(body.fallback).toBe("upstream_error");
    expect(body.degraded).toBeTruthy();
    errSpy.mockRestore();
  });

  it("decision log fires on every dispatch (success AND degraded)", async () => {
    await POST(orchestratorRequest({ intent: "route", userId: "u1", pbToken: "t" }));
    handlerMocks.synthesize.mockRejectedValue(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await POST(orchestratorRequest({ intent: "synthesize", userId: "u1", pbToken: "t" }));
    errSpy.mockRestore();

    // logDecision is fire-and-forget — give it a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(handlerMocks.logged).toHaveLength(2);
    expect(handlerMocks.logged[0]).toMatchObject({ intent: "route", user: "u1" });
    expect(handlerMocks.logged[1]).toMatchObject({ intent: "synthesize", fallback: "upstream_error" });
  });
});
