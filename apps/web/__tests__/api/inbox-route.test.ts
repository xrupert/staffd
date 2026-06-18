/**
 * W95.6 — GET /api/front-desk/inbox: auth-gated, returns this customer's open
 * conversations via ChatwootClient; graceful when Chatwoot isn't configured.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const who = vi.hoisted(() => ({ user: { id: "userA", email: "a@x.com" } as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: vi.fn(async () => who.user) }));

const cw = vi.hoisted(() => ({ configured: true, list: vi.fn(async () => [{ id: 7, sender: "Acme", snippet: "help", status: "open", lastAt: "2026-06-01" }]) }));
vi.mock("../../app/api/_lib/integrations/chatwoot/client", () => ({
  ChatwootClient: { get configured() { return cw.configured; }, forCustomer: () => ({ listConversations: cw.list }) },
}));

import { GET } from "../../app/api/front-desk/inbox/route";
const req = () => new Request("https://t/api/front-desk/inbox", { headers: { authorization: "tok" } });

beforeEach(() => { who.user = { id: "userA", email: "a@x.com" }; cw.configured = true; cw.list.mockClear(); cw.list.mockResolvedValue([{ id: 7, sender: "Acme", snippet: "help", status: "open", lastAt: "2026-06-01" }]); });
afterEach(() => vi.restoreAllMocks());

describe("GET /api/front-desk/inbox", () => {
  it("returns the customer's open conversations", async () => {
    const d = await (await GET(req())).json() as { conversations: { id: number }[]; configured: boolean };
    expect(d.configured).toBe(true);
    expect(d.conversations[0]!.id).toBe(7);
    expect(cw.list).toHaveBeenCalledWith({ status: "open", limit: 10 });
  });
  it("401 when unauthenticated", async () => { who.user = null; expect((await GET(req())).status).toBe(401); });
  it("returns empty + configured:false when Chatwoot isn't set up", async () => {
    cw.configured = false;
    const d = await (await GET(req())).json() as { conversations: unknown[]; configured: boolean };
    expect(d).toMatchObject({ conversations: [], configured: false });
    expect(cw.list).not.toHaveBeenCalled();
  });
});
