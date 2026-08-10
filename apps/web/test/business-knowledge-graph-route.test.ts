import { beforeEach, describe, expect, it, vi } from "vitest";

const whoAmI = vi.fn();
vi.mock("../app/api/_lib/integrations/identity", () => ({ whoAmI: (...args: unknown[]) => whoAmI(...args) }));
vi.mock("../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin-token",
  pbUrl: () => "http://pb",
  pbEscape: (value: string) => value.replaceAll("'", "\\'"),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  whoAmI.mockResolvedValue({ id: "owner-1", email: "owner@example.com" });
  global.fetch = fetchMock as unknown as typeof fetch;
});

const missionNode = {
  graph_id: "mission:mission-1",
  user: "owner-1",
  node_type: "mission",
  label: "Launch campaign",
  properties: {},
  provenance: [{ sourceType: "system", sourceId: "mission-1", observedAt: "2026-08-09T12:00:00Z" }],
  confidence: 1,
  effective_at: null,
  expires_at: null,
};

const outcomeNode = {
  graph_id: "outcome:outcome-1",
  user: "owner-1",
  node_type: "outcome",
  label: "Qualified leads improved",
  properties: {},
  provenance: [{ sourceType: "mission_memory", sourceId: "outcome-1", observedAt: "2026-08-09T13:00:00Z" }],
  confidence: 0.9,
  effective_at: null,
  expires_at: null,
};

const edge = {
  graph_id: "edge:mission-1:produced:outcome-1",
  user: "owner-1",
  edge_type: "produced",
  from_node_id: "mission:mission-1",
  to_node_id: "outcome:outcome-1",
  properties: {},
  provenance: [{ sourceType: "mission_memory", sourceId: "outcome-1", observedAt: "2026-08-09T13:00:00Z" }],
  confidence: 0.9,
  effective_at: null,
  expires_at: null,
};

describe("Business Knowledge Graph query API", () => {
  it("requires an authenticated owner", async () => {
    whoAmI.mockResolvedValue(null);
    const { GET } = await import("../app/api/business-knowledge-graph/route");
    const response = await GET(new Request("http://localhost/api/business-knowledge-graph"));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hydrates opposite endpoints for a neighbor query", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [missionNode] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [edge] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [outcomeNode] }) });

    const { GET } = await import("../app/api/business-knowledge-graph/route");
    const response = await GET(new Request("http://localhost/api/business-knowledge-graph?nodeId=mission%3Amission-1"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.nodes).toHaveLength(2);
    expect(payload.edges).toHaveLength(1);
    expect(payload.edges[0]).toMatchObject({ fromNodeId: "mission:mission-1", toNodeId: "outcome:outcome-1" });
    expect(fetchMock.mock.calls.every((call) => decodeURIComponent(String(call[0])).includes("owner-1"))).toBe(true);
  });

  it("rejects invalid limits before querying PocketBase", async () => {
    const { GET } = await import("../app/api/business-knowledge-graph/route");
    const response = await GET(new Request("http://localhost/api/business-knowledge-graph?limit=0"));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when an edge endpoint cannot be hydrated", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [missionNode] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [edge] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) });

    const { GET } = await import("../app/api/business-knowledge-graph/route");
    const response = await GET(new Request("http://localhost/api/business-knowledge-graph?nodeId=mission%3Amission-1"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "business_graph_query_failed" });
  });
});
