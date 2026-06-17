/**
 * W95.3.5 — document_extraction_worker branch in workflow-drain.
 *
 * Loads the uploaded file, extracts text, writes documents.output +
 * extraction_status. On failure: retries (W71) until the final attempt, which
 * records an honest "error" state instead of throwing. The real pdf/docx
 * parsers are mocked here (the extractor's own tests + production cover them).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ex = vi.hoisted(() => ({
  kind: "pdf" as string | null,
  result: { ok: true, text: "parsed document text" } as { ok: boolean; text: string; reason?: string },
}));
vi.mock("../../app/api/_lib/upload/extract", () => ({
  extractKindFor: () => ex.kind,
  extractText: async () => ex.result,
}));

vi.mock("../../app/api/_lib/integrations/twenty/client", () => ({ TwentyClient: { forCustomer: () => ({ createPerson: async () => "x" }) } }));
vi.mock("../../app/api/_lib/auth/super-admin-logging", () => ({ logWorkflowTransition: vi.fn() }));
vi.mock("../../app/api/_lib/pb", () => ({ pbUrl: () => "https://pb.test", getAdminToken: async () => "admin-token" }));

import { GET } from "../../app/api/worker/workflow-drain/route";

type Task = Record<string, unknown>;
function extractionTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "et-1", workflow_id: "", user: "userA",
    specialist_id: "document_extraction_worker", department_id: "system",
    input_payload: { document_id: "d-1", ext: "pdf" },
    output_payload: null, status: "pending", depends_on: [], retry_count: 0,
    error: null, started_at: null, completed_at: null, cost_estimate_tokens: null, cost_actual_tokens: null,
    ...overrides,
  };
}

let calls: { url: string; method: string; body: Record<string, unknown> | null }[];
function setFetch(task: Task) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (url.includes("/workflow_tasks/records?") && method === "GET") return { ok: true, json: async () => ({ items: [task] }) };
    if (url.includes("/documents/records/") && method === "GET") return { ok: true, json: async () => ({ id: "d-1", file: "report.pdf", user: "userA" }) };
    if (url.includes("/api/files/token") && method === "POST") return { ok: true, json: async () => ({ token: "ftok" }) };
    if (url.includes("/api/files/documents/")) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    return { ok: true, json: async () => ({}) };
  }));
}
const req = () => new Request("https://t/api/worker/workflow-drain", { headers: { "x-worker-secret": "ws" } });

beforeEach(() => { vi.stubEnv("WORKER_SECRET", "ws"); vi.stubEnv("CRON_SECRET", ""); ex.kind = "pdf"; ex.result = { ok: true, text: "parsed document text" }; });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("W95.3.5 document_extraction_worker", () => {
  it("extracts text and writes it to documents.output with status extracted", async () => {
    setFetch(extractionTask());
    const res = await GET(req());
    expect((await res.json()).succeeded).toBe(1);
    const patch = calls.find((c) => c.url.includes("/documents/records/d-1") && c.method === "PATCH");
    expect(patch!.body).toMatchObject({ output: "parsed document text", extraction_status: "extracted" });
  });

  it("on a parse failure that is NOT final, retries and does not write an error state", async () => {
    ex.result = { ok: false, text: "", reason: "corrupt pdf" };
    setFetch(extractionTask({ retry_count: 0 }));
    const res = await GET(req());
    expect((await res.json()).failed).toBe(0); // retry, not terminal
    const errPatch = calls.find((c) => c.url.includes("/documents/records/d-1") && c.method === "PATCH" && c.body?.extraction_status === "error");
    expect(errPatch).toBeUndefined();
    const taskPatch = calls.filter((c) => c.url.includes("/workflow_tasks/records/et-1") && c.method === "PATCH");
    expect(taskPatch[taskPatch.length - 1]!.body!.status).toBe("retrying");
  });

  it("on the FINAL attempt, records an honest error state instead of looping forever", async () => {
    ex.result = { ok: false, text: "", reason: "corrupt pdf" };
    setFetch(extractionTask({ retry_count: 2 }));
    const res = await GET(req());
    expect((await res.json()).succeeded).toBe(1); // completes (no throw)
    const patch = calls.find((c) => c.url.includes("/documents/records/d-1") && c.method === "PATCH");
    expect(patch!.body!.extraction_status).toBe("error");
  });
});
