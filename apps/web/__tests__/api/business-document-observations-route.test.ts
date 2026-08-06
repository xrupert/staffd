import { beforeEach, describe, expect, it, vi } from "vitest";

const whoAmI = vi.fn();
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: (...args: unknown[]) => whoAmI(...args) }));
vi.mock("../../app/api/_lib/pb", () => ({
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

import { POST } from "../../app/api/business-knowledge/documents/observations/route";

function request(body: unknown) {
  return new Request("http://localhost/api/business-knowledge/documents/observations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const candidate = {
  kind: "policy" as const,
  subject: "Refund approval",
  statement: "Refunds above $500 require owner approval.",
  confidence: 0.9,
  usageScopes: ["finance", "support"],
};

describe("POST document Business Brain observations", () => {
  it("persists owner-scoped extracted content only as observed knowledge", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const value = String(url);
      if (value.includes("/documents/records/doc-1")) {
        return { ok: true, json: async () => ({ id: "doc-1", user: "owner-1", file: "policy.pdf", created: "2026-08-06T12:00:00Z", extraction_status: "extracted" }) };
      }
      if (value.includes("business_knowledge/records?") && !init?.method) {
        return { ok: true, json: async () => ({ items: [] }) };
      }
      if (value.endsWith("business_knowledge/records") && init?.method === "POST") {
        return { ok: true, json: async () => ({ id: "knowledge-1" }) };
      }
      throw new Error(`Unexpected fetch ${value}`);
    });

    const response = await POST(request({ documentId: "doc-1", candidates: [candidate] }));
    expect(response.status).toBe(201);
    const createCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("business_knowledge/records") && call[1]?.method === "POST");
    expect(createCall).toBeTruthy();
    const payload = JSON.parse(createCall![1].body as string);
    expect(payload).toMatchObject({ user: "owner-1", stage: "observed", approved_by: null, approved_at: null });
    expect(payload.sources[0]).toMatchObject({ sourceId: "doc-1", sourceType: "business_document", uri: "document://doc-1" });
  });

  it("uses a stable fallback title when file and prompt names are absent", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const value = String(url);
      if (value.includes("/documents/records/doc-1")) {
        return { ok: true, json: async () => ({ id: "doc-1", user: "owner-1", extraction_status: "extracted" }) };
      }
      if (value.includes("business_knowledge/records?") && !init?.method) {
        return { ok: true, json: async () => ({ items: [] }) };
      }
      if (value.endsWith("business_knowledge/records") && init?.method === "POST") {
        return { ok: true, json: async () => ({ id: "knowledge-1" }) };
      }
      throw new Error(`Unexpected fetch ${value}`);
    });

    const response = await POST(request({ documentId: "doc-1", candidates: [candidate] }));
    expect(response.status).toBe(201);
    const createCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith("business_knowledge/records") && call[1]?.method === "POST");
    const payload = JSON.parse(createCall![1].body as string);
    expect(payload.sources[0].title).toBe("Document doc-1");
  });

  it("rejects a document owned by another customer", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "doc-1", user: "owner-2", file: "policy.pdf", extraction_status: "extracted" }) });
    const response = await POST(request({ documentId: "doc-1", candidates: [candidate] }));
    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not persist observations until document text is ready", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "doc-1", user: "owner-1", file: "policy.pdf", extraction_status: "pending" }) });
    const response = await POST(request({ documentId: "doc-1", candidates: [candidate] }));
    expect(response.status).toBe(409);
  });

  it("is idempotent for the same document and subject", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const value = String(url);
      if (value.includes("/documents/records/doc-1")) {
        return { ok: true, json: async () => ({ id: "doc-1", user: "owner-1", file: "policy.pdf", extraction_status: "extracted" }) };
      }
      if (value.includes("business_knowledge/records?")) {
        return { ok: true, json: async () => ({ items: [{ id: "knowledge-1" }] }) };
      }
      throw new Error(`Unexpected fetch ${value}`);
    });

    const response = await POST(request({ documentId: "doc-1", candidates: [candidate] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "already_observed", created: 0, existing: 1 });
  });
});
