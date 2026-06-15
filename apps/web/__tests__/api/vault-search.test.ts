/**
 * MX-4 — POST /api/vault/search (Smart Search).
 *
 * Exposes the Living Vault semantic retrieval (`retrieve()`) so users can
 * search across everything their staff has produced — the "Smart Search"
 * feature the pricing page sells but previously had no surface.
 *
 * Security: the userId is resolved from the PB auth token (whoAmI via
 * auth-refresh), NEVER taken from the request body — so a caller can't
 * search another user's vault by passing a different userId.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const retrieveMock = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("../../app/api/_lib/vault/retrieve", () => ({
  retrieve: retrieveMock.fn,
}));
vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.example.test",
}));

import { POST } from "../../app/api/vault/search/route";

function makeReq(body: unknown): Request {
  return new Request("https://staffd.test/api/vault/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  retrieveMock.fn.mockReset();
  // Default: auth-refresh resolves a valid user.
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ record: { id: "u_me" } }),
  })));
});

describe("POST /api/vault/search (MX-4)", () => {
  it("returns 401 when no auth token is provided", async () => {
    const res = await POST(makeReq({ query: "logo brief" }));
    expect(res.status).toBe(401);
    expect(retrieveMock.fn).not.toHaveBeenCalled();
  });

  it("returns 400 when the query is empty", async () => {
    const res = await POST(makeReq({ pbToken: "tok", query: "   " }));
    expect(res.status).toBe(400);
    expect(retrieveMock.fn).not.toHaveBeenCalled();
  });

  it("returns 401 when the token does not resolve to a user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const res = await POST(makeReq({ pbToken: "bad", query: "logo brief" }));
    expect(res.status).toBe(401);
    expect(retrieveMock.fn).not.toHaveBeenCalled();
  });

  it("resolves the user from the token (not the body) and returns mapped results", async () => {
    retrieveMock.fn.mockResolvedValueOnce({
      items: [
        { sourceId: "doc1", sourceKind: "document", dept: "marketing", summary: "Q3 campaign brief", score: 0.92, text: "..." },
        { sourceId: "conv1", sourceKind: "conversation", dept: "sales", summary: "follow-up thread", score: 0.7, text: "..." },
        { sourceId: "pat1", sourceKind: "pattern", dept: "marketing", summary: "kept signal", score: 0.6, text: "..." },
      ],
      costFlag: "ok",
      tokensReturned: 100,
      latencyMs: 5,
    });

    const res = await POST(makeReq({ pbToken: "tok", query: "campaign brief", userId: "u_attacker" }));
    expect(res.status).toBe(200);
    const data = await res.json();

    // retrieve must be called with the token-resolved id, NOT the body userId.
    expect(retrieveMock.fn).toHaveBeenCalledTimes(1);
    const call = retrieveMock.fn.mock.calls[0]!;
    expect(call[0]).toBe("u_me");
    expect(call[1]).toBe("campaign brief");

    // Patterns are filtered out — only document/conversation results surface.
    expect(data.results).toHaveLength(2);
    expect(data.results[0]).toMatchObject({ sourceId: "doc1", sourceKind: "document", dept: "marketing" });
    expect(data.results.some((r: { sourceKind: string }) => r.sourceKind === "pattern")).toBe(false);
  });

  it("flags degraded retrieval so the UI can show a soft warning", async () => {
    retrieveMock.fn.mockResolvedValueOnce({ items: [], costFlag: "degraded", tokensReturned: 0, latencyMs: 0 });
    const res = await POST(makeReq({ pbToken: "tok", query: "anything" }));
    const data = await res.json();
    expect(data.results).toEqual([]);
    expect(data.degraded).toBe(true);
  });
});
