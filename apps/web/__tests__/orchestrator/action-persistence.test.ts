/**
 * W62 — Persistence pins (Tests 2, 4, 6 + schema).
 *
 * /api/handoff/suggest writes action_candidates onto the source document
 * when documentId is present — including an explicit empty array
 * ("analyzed, nothing applies"). The inline-sourceDoc path (no id)
 * persists nothing. W49's no-degraded-persistence rule is orthogonal and
 * untouched (briefing pins cover it); here the analysis axis persists on
 * handoff success AND FollowUp-parse-degraded responses, per the W62
 * design (analysis is independent of the FollowUp parse).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const orchMocks = vi.hoisted(() => ({
  response: {} as Record<string, unknown>,
}));

vi.mock("../../app/api/_lib/orchestrator", () => ({
  runOrchestrator: async () => orchMocks.response,
}));

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin_tok",
  pbUrl: () => "https://pb.example.test",
  pbEscape: (s: string) => s,
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbFirst: async () => null,
}));

import { POST } from "../../app/api/handoff/suggest/route";

let patches: Array<{ url: string; body: Record<string, unknown> }>;

function handoffRequest(body: unknown) {
  return new Request("https://t/api/handoff/suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  patches = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    if (init?.method === "PATCH") {
      patches.push({ url: String(input), body: JSON.parse(init.body ?? "{}") });
      return { ok: true, json: async () => ({}) };
    }
    // documentId fetch path (GET document) — return a doc
    return { ok: true, json: async () => ({ department: "marketing", prompt: "p", output: "o" }) };
  }));
});

const CANDIDATES = [
  { id: "generate_image", confidence: 0.92, reason: "visual scene described" },
  { id: "publish_social", confidence: 0.85, reason: "platform-tagged" },
];

describe("/api/handoff/suggest — action_candidates persistence (W62)", () => {
  it("documentId present → candidates PATCHed onto the document (Test 2)", async () => {
    orchMocks.response = {
      ok: true, intent: "handoff",
      decision: { rationale: "x" },
      followUps: [{ department: "design", task: "t", rationale: "r", locked: false }],
      actionCandidates: CANDIDATES,
      latencyMs: 5, attempts: 1,
    };
    const res = await POST(handoffRequest({
      userId: "u1", pbToken: "t", documentId: "doc_1",
      sourceDoc: { department: "marketing", prompt: "ad copy", outputExcerpt: "..." },
    }));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10)); // fire-and-forget tick
    expect(patches).toHaveLength(1);
    expect(patches[0]!.url).toContain("/documents/records/doc_1");
    expect(patches[0]!.body).toEqual({ action_candidates: CANDIDATES });
    // Envelope carries the candidates for the caller too.
    const body = (await res.json()) as { actionCandidates: unknown[] };
    expect(body.actionCandidates).toEqual(CANDIDATES);
  });

  it("empty array persists explicitly — 'analyzed, nothing applies' (Test 4)", async () => {
    orchMocks.response = {
      ok: true, intent: "handoff",
      decision: { rationale: "x" }, followUps: [], actionCandidates: [],
      latencyMs: 5, attempts: 1,
    };
    await POST(handoffRequest({
      userId: "u1", pbToken: "t", documentId: "doc_2",
      sourceDoc: { department: "operations", prompt: "memo", outputExcerpt: "..." },
    }));
    await new Promise((r) => setTimeout(r, 10));
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toEqual({ action_candidates: [] });
  });

  it("FollowUp-parse degraded response still persists the analysis axis", async () => {
    orchMocks.response = {
      ok: false, intent: "handoff", fallback: "upstream_error",
      degraded: { followUps: [], actionCandidates: CANDIDATES },
      latencyMs: 5, attempts: 1,
    };
    await POST(handoffRequest({
      userId: "u1", pbToken: "t", documentId: "doc_3",
      sourceDoc: { department: "marketing", prompt: "p", outputExcerpt: "o" },
    }));
    await new Promise((r) => setTimeout(r, 10));
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toEqual({ action_candidates: CANDIDATES });
  });

  it("no documentId (CommandCenter legacy / inline path) → nothing persisted (Test 6)", async () => {
    orchMocks.response = {
      ok: true, intent: "handoff",
      decision: { rationale: "x" }, followUps: [], actionCandidates: CANDIDATES,
      latencyMs: 5, attempts: 1,
    };
    await POST(handoffRequest({
      userId: "u1", pbToken: "t",
      sourceDoc: { department: "marketing", prompt: "p", outputExcerpt: "o" },
    }));
    await new Promise((r) => setTimeout(r, 10));
    expect(patches).toHaveLength(0);
  });

  it("degraded envelope without candidates (handoff LLM hard-fail) persists nothing", async () => {
    orchMocks.response = {
      ok: false, intent: "handoff", fallback: "deadline_exceeded",
      degraded: { followUps: [] },
      latencyMs: 5, attempts: 1,
    };
    await POST(handoffRequest({
      userId: "u1", pbToken: "t", documentId: "doc_4",
      sourceDoc: { department: "marketing", prompt: "p", outputExcerpt: "o" },
    }));
    await new Promise((r) => setTimeout(r, 10));
    expect(patches).toHaveLength(0);
  });
});

describe("schema + client wiring pins (W62)", () => {
  it("documents schema gains action_candidates via DOCUMENTS_AUGMENT", () => {
    const { readFileSync } = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    const src = readFileSync(join(__dirname, "..", "..", "app", "api", "setup", "vault", "route.ts"), "utf8");
    expect(src).toMatch(/\{ name: "action_candidates", type: "json", required: false \}/);
  });

  it("CommandCenter threads the saved document id into its handoff request (Decision 11)", () => {
    const { readFileSync } = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    const src = readFileSync(join(__dirname, "..", "..", "app", "components", "CommandCenter.tsx"), "utf8");
    expect(src).toContain("documentId: await documentIdPromise?.catch(() => undefined)");
    expect(src).toContain("savedDocIdPromise = saveGeneratedDocument(");
    // T3.0 invariant — still no credit strings in CommandCenter.
    expect(src).not.toMatch(/agent.{0,5}credit|credits remaining/i);
  });
});
