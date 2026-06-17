/**
 * W95.3 / W95.3.5 — POST /api/upload/documents: stores the binary in
 * documents.file (multipart), marks source=upload, extracts TXT/MD inline and
 * enqueues async extraction for PDF/DOCX. Records a Vault decision. Vendor-free.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const who = vi.hoisted(() => ({ user: { id: "userA", email: "a@x.com" } as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: vi.fn(async () => who.user) }));

const rec = vi.hoisted(() => ({ fn: vi.fn(async (_i: Record<string, unknown>) => ({ ok: true })) }));
vi.mock("../../app/api/_lib/vault/outcomes", () => ({ recordDecision: rec.fn }));

vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "admin-token",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
}));

import { POST } from "../../app/api/upload/documents/route";

type Call = { url: string; method: string; form?: FormData; json?: Record<string, unknown> };
let calls: Call[];
function setFetch() {
  calls = [];
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const c: Call = { url, method };
    if (init?.body instanceof FormData) c.form = init.body;
    else if (typeof init?.body === "string") c.json = JSON.parse(init.body);
    calls.push(c);
    if (url.includes("/documents/records") && method === "POST") return { ok: true, json: async () => ({ id: `d-${++n}` }) };
    return { ok: true, json: async () => ({}) };
  }));
}
function docReq(files: { name: string; content?: string }[]) {
  const fd = new FormData();
  for (const f of files) fd.append("file", new File([f.content ?? "x"], f.name));
  return new Request("https://t/api/upload/documents", { method: "POST", body: fd });
}

beforeEach(() => { who.user = { id: "userA", email: "a@x.com" }; rec.fn.mockClear(); setFetch(); });
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/upload/documents", () => {
  it("stores a TXT file with the binary + source=upload and extracts inline (status extracted)", async () => {
    const res = await POST(docReq([{ name: "notes.txt", content: "hello world" }]));
    expect(res.status).toBe(200); // nothing pending → 200
    const d = await res.json() as { documents: { status: string }[] };
    expect(d.documents[0]!.status).toBe("extracted");

    const write = calls.find((c) => c.url.includes("/documents/records") && c.method === "POST");
    expect(write!.form).toBeInstanceOf(FormData);
    expect(write!.form!.get("user")).toBe("userA");
    expect(write!.form!.get("source")).toBe("upload");
    expect(write!.form!.get("extraction_status")).toBe("extracted");
    expect(write!.form!.get("output")).toBe("hello world");
    expect(write!.form!.get("file")).toBeInstanceOf(File);

    expect(rec.fn).toHaveBeenCalledTimes(1);
    expect(rec.fn.mock.calls[0]![0]).toMatchObject({ decision_kind: "document_uploaded" });
  });

  it("stores a PDF as pending and enqueues an async extraction task (202)", async () => {
    const res = await POST(docReq([{ name: "report.pdf", content: "%PDF-1.4 binary" }]));
    expect(res.status).toBe(202); // extraction pending
    const d = await res.json() as { documents: { status: string; document_id: string }[] };
    expect(d.documents[0]!.status).toBe("extraction_pending");

    const write = calls.find((c) => c.url.includes("/documents/records") && c.method === "POST");
    expect(write!.form!.get("extraction_status")).toBe("pending");

    const task = calls.find((c) => c.url.includes("/workflow_tasks/records") && c.method === "POST");
    expect(task!.json).toMatchObject({ specialist_id: "document_extraction_worker", user: "userA", input_payload: { document_id: "d-1", ext: "pdf" } });
  });

  it("rejects unsupported file types without writing them", async () => {
    const res = await POST(docReq([{ name: "evil.exe" }, { name: "ok.md", content: "# hi" }]));
    const d = await res.json() as { total: number; succeeded: number; failed: number; errors: { reason: string }[] };
    expect(d).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(d.errors[0]!.reason).toMatch(/unsupported/i);
    expect(calls.filter((c) => c.url.includes("/documents/records") && c.method === "POST")).toHaveLength(1);
  });

  it("401 unauth; 400 when no file provided", async () => {
    who.user = null;
    expect((await POST(docReq([{ name: "a.txt" }]))).status).toBe(401);
    who.user = { id: "userA", email: "a@x.com" };
    expect((await POST(new Request("https://t/api/upload/documents", { method: "POST", body: new FormData() }))).status).toBe(400);
  });
});
