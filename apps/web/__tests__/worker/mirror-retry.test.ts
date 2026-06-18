/**
 * W95.2 — Twenty mirror-retry worker (workflow-drain extension, Standard #20).
 *
 * The drain route grows a NEW branch in runAgent: tasks whose specialist_id is
 * "mirror_retry_worker" are NOT agent work — they re-attempt the vendor mirror
 * via TwentyClient.forCustomer(task.user) and patch the STAFFD-native contacts
 * row on success. Failure throws, so W71's retry/exhaustion machinery owns the
 * lifecycle (retrying → retrying → failed after 3 attempts).
 *
 * These drive the real route GET (with the real drainTasks) through mocked PB +
 * Twenty, asserting: tenant-scoped retry, contacts row patched to synced, and
 * W71 retry semantics on repeated failure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const tw = vi.hoisted(() => ({ createPerson: vi.fn(async () => "tw-9" as string | null), forCustomer: vi.fn() }));
vi.mock("../../app/api/_lib/integrations/twenty/client", () => ({
  TwentyClient: {
    forCustomer: (uid: string) => { tw.forCustomer(uid); return { createPerson: tw.createPerson }; },
  },
}));

vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "admin-token",
  pbEscape: (s: string) => s,
}));

vi.mock("../../app/api/_lib/auth/super-admin-logging", () => ({ logWorkflowTransition: vi.fn() }));

import { GET } from "../../app/api/worker/workflow-drain/route";

type Task = Record<string, unknown>;
function mirrorTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "mt-1", workflow_id: "", user: "userA",
    specialist_id: "mirror_retry_worker", department_id: "system",
    input_payload: { vendor: "twenty", record_id: "c-1", fields: { name: "Jane Doe", email: "j@x.com", phone: "555" } },
    output_payload: null, status: "pending", depends_on: [], retry_count: 0,
    error: null, started_at: null, completed_at: null,
    cost_estimate_tokens: null, cost_actual_tokens: null,
    ...overrides,
  };
}

let calls: { url: string; method: string; body: Record<string, unknown> | null }[];
function setFetch(task: Task) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url, method, body });
    // pending/retrying task list — the only GET the drain issues for this task.
    if (url.includes("/workflow_tasks/records?") && method === "GET") {
      return { ok: true, json: async () => ({ items: [task] }) };
    }
    return { ok: true, json: async () => ({}) };
  }));
}

const req = () => new Request("https://t/api/worker/workflow-drain", { headers: { "x-worker-secret": "ws" } });

beforeEach(() => {
  vi.stubEnv("WORKER_SECRET", "ws");
  vi.stubEnv("CRON_SECRET", "");
  tw.createPerson.mockResolvedValue("tw-9");
  tw.forCustomer.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("W95.2 mirror-retry worker (workflow-drain)", () => {
  it("re-mirrors via Twenty for the task's tenant and patches the contacts row to synced", async () => {
    setFetch(mirrorTask());
    const res = await GET(req());
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.succeeded).toBe(1);

    expect(tw.forCustomer).toHaveBeenCalledWith("userA"); // leak-guard: retry stays tenant-scoped
    expect(tw.createPerson).toHaveBeenCalledWith(expect.objectContaining({ name: "Jane Doe", email: "j@x.com" }));

    const patch = calls.find((c) => c.url.includes("/contacts/records/c-1") && c.method === "PATCH");
    expect(patch).toBeDefined();
    expect(patch!.body).toMatchObject({ twenty_record_id: "tw-9", twenty_mirror_status: "synced" });
  });

  it("on a still-failing mirror, retries (status retrying, retry_count incremented) and does NOT patch the contact", async () => {
    tw.createPerson.mockResolvedValue(null); // mirror still down
    setFetch(mirrorTask({ retry_count: 0 }));
    const res = await GET(req());
    const out = await res.json();
    expect(out.failed).toBe(0); // a retry is NOT terminal failure (W71)

    expect(calls.some((c) => c.url.includes("/contacts/records/c-1") && c.method === "PATCH")).toBe(false);
    const taskPatch = calls.filter((c) => c.url.includes("/workflow_tasks/records/mt-1") && c.method === "PATCH");
    const last = taskPatch[taskPatch.length - 1]!.body!;
    expect(last.status).toBe("retrying");
    expect(last.retry_count).toBe(1);
  });

  it("exhausts to failed after the 3rd attempt (retry_count=2)", async () => {
    tw.createPerson.mockResolvedValue(null);
    setFetch(mirrorTask({ retry_count: 2 }));
    await GET(req());
    const taskPatch = calls.filter((c) => c.url.includes("/workflow_tasks/records/mt-1") && c.method === "PATCH");
    expect(taskPatch[taskPatch.length - 1]!.body!.status).toBe("failed");
  });
});
