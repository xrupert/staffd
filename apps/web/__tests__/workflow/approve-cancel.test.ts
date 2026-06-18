/**
 * W95.6.x — POST /api/workflows/<id>/approve|cancel: the review gate. Approve
 * enqueues the second (send) task built from recipe_id + first task; cancel
 * marks the workflow cancelled. Owner-only; only from awaiting_review.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const who = vi.hoisted(() => ({ user: { id: "userA", email: "a@x.com" } as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: vi.fn(async () => who.user) }));
vi.mock("../../app/api/_lib/vault/outcomes", () => ({ recordDecision: vi.fn(async () => ({ ok: true })) }));
vi.mock("../../app/api/_lib/pb", () => ({ pbUrl: () => "https://pb.test", getAdminToken: async () => "tok", adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }) }));

import { POST } from "../../app/api/workflows/[id]/[action]/route";

let calls: { url: string; method: string; body: Record<string, unknown> | null }[];
let wf: Record<string, unknown>;
let firstTaskPayload: Record<string, unknown>;
function setFetch() {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, method, body });
    if (url.includes("/workflows/records/") && method === "GET") return { ok: true, json: async () => wf };
    if (url.includes("/workflow_tasks/records?") && method === "GET") return { ok: true, json: async () => ({ items: [{ input_payload: firstTaskPayload }] }) };
    if (url.includes("/workflow_tasks/records") && method === "POST") return { ok: true, json: async () => ({ id: "send-task-1" }) };
    return { ok: true, json: async () => ({}) };
  }));
}
const req = (action: string, body?: unknown) => POST(
  new Request(`https://t/api/workflows/wf-1/${action}`, { method: "POST", headers: { authorization: "tok", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }),
  { params: Promise.resolve({ id: "wf-1", action }) },
);

beforeEach(() => {
  who.user = { id: "userA", email: "a@x.com" };
  wf = { id: "wf-1", user: "userA", status: "awaiting_review", recipe_id: "reply_to_ticket" };
  firstTaskPayload = { conversation_identifier: "Acme", message_summary: "hi" };
  setFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe("approve", () => {
  it("enqueues chatwoot_send_worker for a reply workflow + flips to running", async () => {
    const r = await req("approve");
    expect(await r.json()).toMatchObject({ ok: true, next_task_id: "send-task-1" });
    expect(calls.some((c) => c.url.includes("/workflows/records/wf-1") && c.method === "PATCH" && c.body?.status === "running")).toBe(true);
    const send = calls.find((c) => c.url.includes("/workflow_tasks/records") && c.method === "POST");
    expect((send!.body as { specialist_id: string; input_payload: { conversation_identifier: string } }).specialist_id).toBe("chatwoot_send_worker");
    expect((send!.body as { input_payload: { conversation_identifier: string } }).input_payload.conversation_identifier).toBe("Acme");
  });

  it("enqueues docuseal_send_worker for a signature workflow", async () => {
    wf.recipe_id = "send_for_signature";
    firstTaskPayload = { document_identifier: "NDA", signer_email: "j@x.com" };
    await req("approve");
    const send = calls.find((c) => c.url.includes("/workflow_tasks/records") && c.method === "POST");
    expect((send!.body as { specialist_id: string }).specialist_id).toBe("docuseal_send_worker");
  });

  it("applies an edited draft before sending", async () => {
    await req("approve", { edited_draft: "my edited reply" });
    expect(calls.some((c) => c.url.includes("/workflows/records/wf-1") && c.method === "PATCH" && c.body?.draft_output === "my edited reply")).toBe(true);
  });

  it("409 when the workflow isn't awaiting review", async () => {
    wf.status = "running";
    expect((await req("approve")).status).toBe(409);
  });

  it("404 when the workflow belongs to another user", async () => {
    wf.user = "someone_else";
    expect((await req("approve")).status).toBe(404);
  });
});

describe("cancel", () => {
  it("marks the workflow cancelled and enqueues nothing", async () => {
    const r = await req("cancel");
    expect(await r.json()).toMatchObject({ ok: true });
    expect(calls.some((c) => c.url.includes("/workflows/records/wf-1") && c.method === "PATCH" && c.body?.status === "cancelled")).toBe(true);
    expect(calls.some((c) => c.url.includes("/workflow_tasks/records") && c.method === "POST")).toBe(false);
  });
});
