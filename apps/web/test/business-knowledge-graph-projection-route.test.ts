import { beforeEach, describe, expect, it, vi } from "vitest";

const whoAmI = vi.fn();
vi.mock("../app/api/_lib/integrations/identity", () => ({ whoAmI: (...args: unknown[]) => whoAmI(...args) }));
vi.mock("../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin-token",
  pbUrl: () => "http://pb",
  pbEscape: (value: string) => value.replaceAll("'", "\\'"),
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  whoAmI.mockResolvedValue({ id: "owner-1", email: "owner@example.com" });
  global.fetch = fetchMock as unknown as typeof fetch;
});

function request(body: unknown) {
  return new Request("http://localhost/api/business-knowledge-graph/project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const approvedKnowledge = {
  id: "knowledge-1",
  user: "owner-1",
  kind: "rule",
  stage: "approved",
  subject: "Refund approval",
  statement: "Refunds over $500 require owner approval.",
  confidence: 0.95,
  sources: [{ sourceId: "policy.pdf", sourceType: "business_document", title: "Policy", verifiedAt: "2026-08-09T12:00:00Z" }],
  usage_scopes: ["finance"],
  effective_at: "2026-08-01T00:00:00Z",
  expires_at: null,
  approved_by: "owner-1",
  approved_at: "2026-08-09T13:00:00Z",
  supersedes_id: null,
  superseded_by_id: null,
};

const approvedOutcome = {
  outcome_id: "outcome-1",
  user: "owner-1",
  mission_id: "mission-1",
  hypothesis: "Shorter onboarding improves completion.",
  expected_outcome: "Completion reaches 70%.",
  actual_outcome: "Completion reached 76%.",
  outcome_status: "success",
  metrics: [{ name: "Completion", expected: 70, actual: 76, unit: "%" }],
  evidence: ["analytics:experiment-1"],
  lesson: "Shorter onboarding improved completion.",
  confidence_before: 0.5,
  confidence_after: 0.8,
  observed_at: "2026-08-09T12:00:00Z",
  approved_for_learning: true,
  approved_by: "owner-1",
  approved_at: "2026-08-09T13:00:00Z",
};

describe("Business Knowledge Graph projection API", () => {
  it("requires authentication before reading source or graph records", async () => {
    whoAmI.mockResolvedValue(null);
    const { POST } = await import("../app/api/business-knowledge-graph/project/route");
    const response = await POST(request({ action: "project_business_knowledge", knowledgeId: "knowledge-1" }));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads approved Business Brain knowledge through an owner-scoped source lookup and persists its derived node", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [approvedKnowledge] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "pb-node-1" }) });

    const { POST } = await import("../app/api/business-knowledge-graph/project/route");
    const response = await POST(request({ action: "project_business_knowledge", knowledgeId: "knowledge-1" }));
    expect(response.status).toBe(201);
    expect(decodeURIComponent(String(fetchMock.mock.calls[0]![0]))).toContain("user = 'owner-1'");
    const created = JSON.parse(String((fetchMock.mock.calls[2]![1] as RequestInit).body));
    expect(created).toMatchObject({ graph_id: "knowledge:knowledge-1", user: "owner-1", node_type: "rule" });
  });

  it("does not project observed knowledge even when a caller knows its id", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ ...approvedKnowledge, stage: "observed", approved_by: null, approved_at: null }] }) });
    const { POST } = await import("../app/api/business-knowledge-graph/project/route");
    const response = await POST(request({ action: "project_business_knowledge", knowledgeId: "knowledge-1" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "source_not_projectable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("derives and persists mission, outcome, and produced-edge records from approved Mission Memory", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [approvedOutcome] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "pb-mission" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "pb-outcome" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "pb-edge" }) });

    const { POST } = await import("../app/api/business-knowledge-graph/project/route");
    const response = await POST(request({ action: "project_mission_outcome", outcomeId: "outcome-1" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ created: 3, existing: 0 });
    const createBodies = fetchMock.mock.calls
      .filter((call) => (call[1] as RequestInit | undefined)?.method === "POST")
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)));
    expect(createBodies).toEqual(expect.arrayContaining([
      expect.objectContaining({ graph_id: "mission:mission-1", node_type: "mission" }),
      expect.objectContaining({ graph_id: "outcome:outcome-1", node_type: "outcome" }),
      expect.objectContaining({ graph_id: "edge:mission-1:produced:outcome-1", edge_type: "produced" }),
    ]));
  });

  it("fails closed when an immutable graph identity already contains different content", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [approvedKnowledge] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{
        graph_id: "knowledge:knowledge-1",
        user: "owner-1",
        node_type: "rule",
        label: "Tampered label",
        properties: {},
        provenance: [],
        confidence: 0.1,
        effective_at: null,
        expires_at: null,
      }] }) });

    const { POST } = await import("../app/api/business-knowledge-graph/project/route");
    const response = await POST(request({ action: "project_business_knowledge", knowledgeId: "knowledge-1" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "graph_identity_conflict" });
  });
});
