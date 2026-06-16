/**
 * FC-1b — GET /api/integrations/chatwoot?status=open (support read).
 *
 * Gives the Customer Service Responder awareness of open tickets instead of
 * only being able to push replies blind. 503 when unconfigured; maps the
 * Chatwoot conversation payload to a flat list otherwise.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
// GET is super-admin gated (W80.1) — resolve the gate so the read tests run.
vi.mock("../../app/api/_lib/auth/super-admin", () => ({
  requireSuperAdmin: vi.fn(async () => ({ id: "admin", email: "admin@staffd.com" })),
  toAuthErrorResponse: () => Response.json({ error: "forbidden" }, { status: 403 }),
}));

import { GET } from "../../app/api/integrations/chatwoot/route";

function req(qs = "?status=open"): Request {
  return new Request(`https://staffd.test/api/integrations/chatwoot${qs}`);
}

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/integrations/chatwoot (FC-1b)", () => {
  it("returns 503 when Chatwoot is not configured", async () => {
    vi.stubEnv("CHATWOOT_URL", "");
    vi.stubEnv("CHATWOOT_API_KEY", "");
    vi.stubEnv("CHATWOOT_ACCOUNT_ID", "");
    const res = await GET(req());
    expect(res.status).toBe(503);
  });

  it("maps the conversation payload to a flat list", async () => {
    vi.stubEnv("CHATWOOT_URL", "https://cw.example.test");
    vi.stubEnv("CHATWOOT_API_KEY", "key");
    vi.stubEnv("CHATWOOT_ACCOUNT_ID", "1");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          payload: [
            { id: 11, status: "open", last_activity_at: 1700000000, meta: { sender: { name: "Jane", email: "jane@x.com" } } },
            { id: 12, status: "open", last_activity_at: 1700000100, meta: { sender: { name: "Bob", email: "bob@y.com" } } },
          ],
        },
      }),
    })));
    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.conversations).toHaveLength(2);
    expect(data.conversations[0]).toMatchObject({ id: 11, status: "open", contact: "Jane" });
    expect(data.conversations[0].url).toContain("/conversations/11");
  });

  it("returns 502 on an upstream Chatwoot error", async () => {
    vi.stubEnv("CHATWOOT_URL", "https://cw.example.test");
    vi.stubEnv("CHATWOOT_API_KEY", "key");
    vi.stubEnv("CHATWOOT_ACCOUNT_ID", "1");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" })));
    const res = await GET(req());
    expect(res.status).toBe(502);
  });
});
