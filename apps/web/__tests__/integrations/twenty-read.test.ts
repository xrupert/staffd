/**
 * FC-1a — GET /api/integrations/twenty?type=opportunities (CRM read).
 *
 * Gives Sales specialists (e.g. the Closing Strategist) live pipeline
 * awareness instead of working blind. Returns 503 when Twenty isn't
 * configured, maps the GraphQL connection to a flat list otherwise.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "../../app/api/integrations/twenty/route";

function req(qs = "?type=opportunities"): Request {
  return new Request(`https://staffd.test/api/integrations/twenty${qs}`);
}

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/integrations/twenty (FC-1a)", () => {
  it("returns 503 when Twenty is not configured", async () => {
    vi.stubEnv("TWENTY_API_URL", "");
    vi.stubEnv("TWENTY_API_KEY", "");
    const res = await GET(req());
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe("not_configured");
  });

  it("maps the GraphQL opportunities connection to a flat list", async () => {
    vi.stubEnv("TWENTY_API_URL", "https://crm.example.test");
    vi.stubEnv("TWENTY_API_KEY", "key");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          opportunities: {
            edges: [
              { node: { id: "o1", name: "Acme deal", stage: "PROPOSAL", createdAt: "2026-06-01" } },
              { node: { id: "o2", name: "Globex deal", stage: "NEW", createdAt: "2026-06-02" } },
            ],
          },
        },
      }),
    })));
    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toHaveLength(2);
    expect(data.results[0]).toMatchObject({ id: "o1", name: "Acme deal", stage: "PROPOSAL" });
  });

  it("returns 502 on an upstream Twenty error", async () => {
    vi.stubEnv("TWENTY_API_URL", "https://crm.example.test");
    vi.stubEnv("TWENTY_API_KEY", "key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" })));
    const res = await GET(req());
    expect(res.status).toBe(502);
  });
});
