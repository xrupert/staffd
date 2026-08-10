import { beforeEach, describe, expect, it, vi } from "vitest";

const extractCandidates = vi.fn();
vi.mock("../../app/api/_lib/worker/document-knowledge-ai", () => ({
  extractDocumentKnowledgeCandidates: (...args: unknown[]) => extractCandidates(...args),
}));
vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin-token",
  pbUrl: () => "http://pb",
  pbEscape: (value: string) => value.replaceAll("'", "\\'"),
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env.WORKER_SECRET = "worker-secret";
  delete process.env.CRON_SECRET;
  extractCandidates.mockResolvedValue({
    candidates: [{
      kind: "policy",
      subject: "Refund approval",
      statement: "Refunds over $500 require owner approval.",
      confidence: 0.9,
      usageScopes: ["finance", "support"],
      sourceLocation: "Refunds",
      effectiveAt: null,
    }],
    tokensActual: 120,
  });
});

function req() {
  return new Request("http://localhost/api/worker/document-knowledge", { headers: { "x-worker-secret": "worker-secret" } });
}

const document = {
  id: "doc-1",
  user: "owner-1",
  file: "policy.pdf",
  created: "2026-08-09T12:00:00Z",
  output: "Refunds over $500 require owner approval.",
  extraction_status: "extracted",
  knowledge_extraction_status: "",
  knowledge_extraction_attempts: 0,
};

describe("document knowledge reconciliation worker", () => {
  it("requires a cron or worker secret", async () => {
    const { GET } = await import("../../app/api/worker/document-knowledge/route");
    const response = await GET(new Request("http://localhost/api/worker/document-knowledge"));
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("claims an extracted owner document and persists canonical observed Business Brain knowledge", async () => {
    let claimId = "";
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const value = String(url);
      const method = init?.method ?? "GET";
      if (value.includes("documents/records?") && method === "GET") {
        return { ok: true, status: 200, json: async () => ({ items: [document] }) };
      }
      if (value.endsWith("documents/records/doc-1") && method === "PATCH") {
        const body = JSON.parse(String(init?.body));
        if (body.knowledge_extraction_status === "processing") claimId = body.knowledge_extraction_claim_id;
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (value.endsWith("documents/records/doc-1") && method === "GET") {
        return { ok: true, status: 200, json: async () => ({ ...document, knowledge_extraction_status: "processing", knowledge_extraction_attempts: 1, knowledge_extraction_claim_id: claimId, knowledge_extraction_claimed_at: "2026-08-09T12:01:00Z" }) };
      }
      if (value.includes("business_knowledge/records?") && method === "GET") {
        return { ok: true, status: 200, json: async () => ({ items: [] }) };
      }
      if (value.endsWith("business_knowledge/records") && method === "POST") {
        return { ok: true, status: 201, json: async () => ({ id: "knowledge-1" }) };
      }
      throw new Error(`Unexpected fetch ${method} ${value}`);
    });

    const { GET } = await import("../../app/api/worker/document-knowledge/route");
    const response = await GET(req());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ processed: 1, observationsCreated: 1, tokensActual: 120, failed: 0 });

    const createCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("business_knowledge/records") && (call[1] as RequestInit | undefined)?.method === "POST");
    expect(createCall).toBeTruthy();
    const payload = JSON.parse(String((createCall![1] as RequestInit).body));
    expect(payload).toMatchObject({ user: "owner-1", stage: "observed", subject: "Refund approval", approved_by: null, approved_at: null });
    expect(payload.sources[0]).toMatchObject({ sourceId: "doc-1", sourceType: "business_document", uri: "document://doc-1" });
  });

  it("does not spend model tokens on a document with a fresh processing lease", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [{ ...document, knowledge_extraction_status: "processing", knowledge_extraction_attempts: 1, knowledge_extraction_claimed_at: new Date().toISOString() }] }),
    });
    const { GET } = await import("../../app/api/worker/document-knowledge/route");
    const response = await GET(req());
    expect(await response.json()).toMatchObject({ skipped: 1, processed: 0 });
    expect(extractCandidates).not.toHaveBeenCalled();
  });

  it("records an empty terminal state so documents with no reusable knowledge are not reprocessed forever", async () => {
    extractCandidates.mockResolvedValue({ candidates: [], tokensActual: 45 });
    let claimId = "";
    const patches: Record<string, unknown>[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const value = String(url);
      const method = init?.method ?? "GET";
      if (value.includes("documents/records?") && method === "GET") return { ok: true, status: 200, json: async () => ({ items: [document] }) };
      if (value.endsWith("documents/records/doc-1") && method === "PATCH") {
        const body = JSON.parse(String(init?.body)); patches.push(body);
        if (body.knowledge_extraction_claim_id) claimId = body.knowledge_extraction_claim_id;
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (value.endsWith("documents/records/doc-1") && method === "GET") return { ok: true, status: 200, json: async () => ({ ...document, knowledge_extraction_claim_id: claimId }) };
      throw new Error(`Unexpected fetch ${method} ${value}`);
    });
    const { GET } = await import("../../app/api/worker/document-knowledge/route");
    const response = await GET(req());
    expect(await response.json()).toMatchObject({ empty: 1, tokensActual: 45 });
    expect(patches.some((patch) => patch.knowledge_extraction_status === "empty")).toBe(true);
  });

  it("records a retryable error instead of changing successful text extraction state", async () => {
    extractCandidates.mockRejectedValue(new Error("provider unavailable"));
    let claimId = "";
    const patches: Record<string, unknown>[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const value = String(url);
      const method = init?.method ?? "GET";
      if (value.includes("documents/records?") && method === "GET") return { ok: true, status: 200, json: async () => ({ items: [document] }) };
      if (value.endsWith("documents/records/doc-1") && method === "PATCH") {
        const body = JSON.parse(String(init?.body)); patches.push(body);
        if (body.knowledge_extraction_claim_id) claimId = body.knowledge_extraction_claim_id;
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (value.endsWith("documents/records/doc-1") && method === "GET") return { ok: true, status: 200, json: async () => ({ ...document, knowledge_extraction_claim_id: claimId }) };
      throw new Error(`Unexpected fetch ${method} ${value}`);
    });
    const { GET } = await import("../../app/api/worker/document-knowledge/route");
    const response = await GET(req());
    expect(await response.json()).toMatchObject({ failed: 1, processed: 0 });
    expect(patches.some((patch) => patch.knowledge_extraction_status === "error" && patch.knowledge_extraction_error === "provider unavailable")).toBe(true);
    expect(patches.every((patch) => !("extraction_status" in patch))).toBe(true);
  });
});
