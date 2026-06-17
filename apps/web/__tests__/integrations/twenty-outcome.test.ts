/**
 * FC-3 — the Twenty write route records a vault outcome on success.
 *
 * Closes the action→memory loop: adding a lead/opportunity is a real event
 * the CEO brief should reflect. Recording is fire-and-forget and gated on a
 * userId being supplied (the integration route stays usable without one).
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

// Module-level env is captured at import → set it before the dynamic import.
process.env.TWENTY_API_URL = "https://crm.example.test";
process.env.TWENTY_API_KEY = "key";

const recordMock = vi.hoisted(() => ({ fn: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true, id: "dec_1" })) }));
vi.mock("../../app/api/_lib/vault/outcomes", () => ({ recordDecision: recordMock.fn }));
// W91 — POST resolves creds via the resolver; mock it to operator env so the
// write proceeds (this test is about outcome recording, not cred resolution).
vi.mock("../../app/api/_lib/integrations/resolve", () => ({
  resolveCredentials: async () => {
    const url = process.env.TWENTY_API_URL, key = process.env.TWENTY_API_KEY;
    return url && key ? { source: "operator", url, key, config: {} } : null;
  },
}));

let POST: (req: Request) => Promise<Response>;
beforeAll(async () => {
  ({ POST } = await import("../../app/api/integrations/twenty/route"));
});

function makeReq(body: unknown): Request {
  return new Request("https://t/api/integrations/twenty", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  recordMock.fn.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: { createOpportunity: { id: "opp_1", name: "Acme" } } }),
  })));
});

describe("Twenty write → vault outcome (FC-3)", () => {
  it("records a lead_added decision when userId is provided", async () => {
    const res = await POST(makeReq({ type: "opportunity", name: "Acme deal", notes: "x", userId: "u1" }));
    expect(res.status).toBe(200);
    expect(recordMock.fn).toHaveBeenCalledTimes(1);
    const call = recordMock.fn.mock.calls[0]!;
    expect(call[0]).toMatchObject({ userId: "u1", decision_kind: "lead_added", source_kind: "twenty" });
  });

  it("does NOT record when userId is absent (route still succeeds)", async () => {
    const res = await POST(makeReq({ type: "opportunity", name: "Acme deal" }));
    expect(res.status).toBe(200);
    expect(recordMock.fn).not.toHaveBeenCalled();
  });
});
