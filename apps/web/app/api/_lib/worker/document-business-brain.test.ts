import { beforeEach, describe, expect, it, vi } from "vitest";

const extractDocumentKnowledgeCandidates = vi.fn();
vi.mock("../orchestrator/handlers/document-knowledge", () => ({
  extractDocumentKnowledgeCandidates: (...args: unknown[]) => extractDocumentKnowledgeCandidates(...args),
}));

import { runDocumentBusinessBrainWorker } from "./document-business-brain";

const fetchMock = vi.fn();
const ctx = {
  pb: "http://pb",
  adminToken: "admin",
  authHeaders: { Authorization: "admin", "Content-Type": "application/json" },
};
const task = {
  id: "task-1",
  user: "owner-1",
  specialist_id: "business_brain_document_worker",
  workflow_id: "",
  input_payload: { document_id: "doc-1" },
  output_payload: null,
  status: "pending",
  depends_on: [],
  retry_count: 0,
  error: "",
  started_at: "",
  completed_at: "",
  cost_estimate_tokens: 0,
  cost_actual_tokens: 0,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("Business Brain document worker", () => {
  it("persists extracted candidates only as observed owner knowledge", async () => {
    extractDocumentKnowledgeCandidates.mockResolvedValue({
      candidates: [{ kind: "policy", subject: "Refund approval", statement: "Refunds above $500 require owner approval.", confidence: 0.9, usageScopes: ["finance"] }],
      costUsd: 0.01, latencyMs: 100, tokensIn: 50, tokensOut: 20, truncated: false,
    });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const value = String(url);
      if (value.includes("documents/records/doc-1")) return new Response(JSON.stringify({ id: "doc-1", user: "owner-1", file: "policy.pdf", output: "Refunds above $500 require owner approval.", extraction_status: "extracted", created: "2026-08-10T12:00:00Z" }), { status: 200 });
      if (value.includes("business_knowledge/records?") && !init?.method) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (value.endsWith("business_knowledge/records") && init?.method === "POST") return new Response(JSON.stringify({ id: "knowledge-1" }), { status: 201 });
      throw new Error(`Unexpected fetch ${value}`);
    });

    const result = await runDocumentBusinessBrainWorker(task, ctx);
    expect(result).toMatchObject({ text: "business-brain:created=1:existing=0:truncated=false", tokensActual: 70 });
    const createCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("business_knowledge/records") && call[1]?.method === "POST");
    const payload = JSON.parse(String((createCall?.[1] as RequestInit).body));
    expect(payload).toMatchObject({ user: "owner-1", stage: "observed", approved_by: null, approved_at: null });
  });

  it("rejects cross-tenant documents", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "doc-1", user: "owner-2", output: "secret", extraction_status: "extracted" }), { status: 200 }));
    await expect(runDocumentBusinessBrainWorker(task, ctx)).rejects.toThrow("tenant mismatch");
    expect(extractDocumentKnowledgeCandidates).not.toHaveBeenCalled();
  });

  it("refuses to run before raw text extraction completes", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "doc-1", user: "owner-1", output: "", extraction_status: "pending" }), { status: 200 }));
    await expect(runDocumentBusinessBrainWorker(task, ctx)).rejects.toThrow("document text is not ready");
  });

  it("is idempotent for an existing document and subject", async () => {
    extractDocumentKnowledgeCandidates.mockResolvedValue({
      candidates: [{ kind: "rule", subject: "Approval limit", statement: "Owner approval is required.", confidence: 0.8, usageScopes: ["operations"] }],
      costUsd: 0, latencyMs: 1, tokensIn: 10, tokensOut: 5, truncated: false,
    });
    fetchMock.mockImplementation(async (url: string) => {
      const value = String(url);
      if (value.includes("documents/records/doc-1")) return new Response(JSON.stringify({ id: "doc-1", user: "owner-1", output: "Owner approval is required.", extraction_status: "extracted" }), { status: 200 });
      if (value.includes("business_knowledge/records?")) return new Response(JSON.stringify({ items: [{ id: "existing" }] }), { status: 200 });
      throw new Error(`Unexpected fetch ${value}`);
    });
    expect(await runDocumentBusinessBrainWorker(task, ctx)).toMatchObject({ text: "business-brain:created=0:existing=1:truncated=false" });
  });
});
