import { describe, it, expect, vi, beforeEach } from "vitest";

const whoAmI = vi.fn();
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: (...a: unknown[]) => whoAmI(...a) }));
vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin-token",
  pbUrl: () => "http://pb",
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
}));
const recordDecision = vi.fn();
vi.mock("../../app/api/_lib/vault/outcomes", () => ({ recordDecision: (...a: unknown[]) => recordDecision(...a) }));
const recordUploadSession = vi.fn();
vi.mock("../../app/api/_lib/upload/session", () => ({ recordUploadSession: (...a: unknown[]) => recordUploadSession(...a) }));

const fetchMock = vi.fn();

function docRecord(id: string, user: string, file: string, status = "pending") {
  return { id, user, file, extraction_status: status };
}

beforeEach(() => {
  vi.clearAllMocks();
  whoAmI.mockResolvedValue({ id: "u1", email: "u@x.com" });
  global.fetch = fetchMock as unknown as typeof fetch;
});

import { POST } from "../../app/api/upload/documents/finalize/route";

function req(body: unknown) {
  return new Request("http://localhost/api/upload/documents/finalize", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "t" }, body: JSON.stringify(body),
  });
}

describe("POST /api/upload/documents/finalize", () => {
  it("401 without a session", async () => {
    whoAmI.mockResolvedValue(null);
    expect((await POST(req({ documentIds: ["d1"] }))).status).toBe(401);
  });

  it("400 with no documentIds", async () => {
    expect((await POST(req({ documentIds: [] }))).status).toBe(400);
  });

  it("text file: fetches bytes, decodes inline, patches extracted, records decision", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/documents/records/d1") && (!init || init.method === "GET" || !init.method)) {
        return { ok: true, json: async () => docRecord("d1", "u1", "notes.txt") };
      }
      if (u.includes("/api/files/token")) return { ok: true, json: async () => ({ token: "ftok" }) };
      if (u.includes("/api/files/documents/d1/")) return { ok: true, arrayBuffer: async () => new TextEncoder().encode("hello world").buffer };
      if (u.includes("/documents/records/d1") && init?.method === "PATCH") return { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    });
    const res = await POST(req({ documentIds: ["d1"] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toContainEqual({ document_id: "d1", name: "notes.txt", status: "extracted" });
    const patchCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("d1") && c[1]?.method === "PATCH");
    expect(JSON.parse(patchCall![1].body)).toMatchObject({ extraction_status: "extracted", output: "hello world" });
    expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", document_id: "d1", decision_kind: "document_uploaded" }));
    expect(recordUploadSession).toHaveBeenCalledWith("u1", "documents", expect.objectContaining({ succeeded: 1, failed: 0 }));
  });

  it("binary file: enqueues the existing extraction worker task, does not patch status itself", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/documents/records/d2") && (!init || !init.method || init.method === "GET")) {
        return { ok: true, json: async () => docRecord("d2", "u1", "report.pdf") };
      }
      if (u.includes("/workflow_tasks/records")) return { ok: true, json: async () => ({ id: "wt1" }) };
      return { ok: true, json: async () => ({}) };
    });
    const res = await POST(req({ documentIds: ["d2"] }));
    const data = await res.json();
    expect(data.results).toContainEqual({ document_id: "d2", name: "report.pdf", status: "extraction_pending" });
    const taskCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/workflow_tasks/records"));
    expect(taskCall).toBeTruthy();
    const taskBody = JSON.parse(taskCall![1].body);
    expect(taskBody).toMatchObject({ specialist_id: "document_extraction_worker", input_payload: { document_id: "d2", ext: "pdf" } });
  });

  it("a document not owned by the caller is reported as an error, other ids in the batch still process", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/documents/records/d3")) return { ok: true, json: async () => docRecord("d3", "OTHER_USER", "x.txt") };
      if (u.includes("/documents/records/d4")) return { ok: true, json: async () => docRecord("d4", "u1", "y.pdf") };
      if (u.includes("/workflow_tasks/records")) return { ok: true, json: async () => ({ id: "wt2" }) };
      return { ok: true, json: async () => ({}) };
    });
    const res = await POST(req({ documentIds: ["d3", "d4"] }));
    const data = await res.json();
    expect(data.errors).toContainEqual({ document_id: "d3", reason: "not_owned" });
    expect(data.results).toContainEqual({ document_id: "d4", name: "y.pdf", status: "extraction_pending" });
    expect(data.succeeded).toBe(1);
    expect(data.failed).toBe(1);
  });

  it("a missing document id is reported as not_found, does not throw", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/documents/records/missing")) return { ok: false, status: 404 };
      return { ok: true, json: async () => ({}) };
    });
    const res = await POST(req({ documentIds: ["missing"] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.errors).toContainEqual({ document_id: "missing", reason: "not_found" });
  });

  it("400 on a malformed (non-JSON) request body, does not throw", async () => {
    const res = await POST(new Request("http://localhost/api/upload/documents/finalize", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "t" }, body: "not json",
    }));
    expect(res.status).toBe(400);
  });
});
