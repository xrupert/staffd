/**
 * postiz_publish_worker — posts the REVIEWED draft via the customer's Postiz
 * org. Pins: reviewed-draft-only (cancelled → tombstone, no draft → throw),
 * platform filtering, image ingestion before posting, and schedule vs now.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkflowTask } from "../../app/api/_lib/workflow";

const pz = vi.hoisted(() => ({
  client: null as null | {
    listChannels: () => Promise<unknown[]>;
    uploadFromUrl: (u: string) => Promise<unknown>;
    createPost: (i: unknown) => Promise<boolean>;
  },
  createPostCalls: [] as unknown[],
}));
vi.mock("../../app/api/_lib/integrations/postiz/client", () => ({
  PostizClient: { forCustomer: async () => pz.client },
}));

import { WORKER_HANDLERS } from "../../app/api/_lib/worker/handlers";

const handler = WORKER_HANDLERS.postiz_publish_worker!;
const ctx = { pb: "https://pb.test", adminToken: "tok", authHeaders: { Authorization: "tok" } };

function task(payload: Record<string, unknown>): WorkflowTask {
  return {
    id: "t1", workflow_id: "wf1", user: "u1", specialist_id: "postiz_publish_worker",
    department_id: "system", input_payload: payload, output_payload: null, status: "pending",
    depends_on: [], retry_count: 0, error: null, started_at: null, completed_at: null,
    cost_estimate_tokens: 0, cost_actual_tokens: 0,
  };
}

const workflowState = vi.hoisted(() => ({ status: "running", draft_output: "Approved post copy" }));

beforeEach(() => {
  workflowState.status = "running";
  workflowState.draft_output = "Approved post copy";
  pz.createPostCalls = [];
  pz.client = {
    listChannels: async () => ([
      { id: "ch1", name: "Acme on X", identifier: "x" },
      { id: "ch2", name: "Acme IG", identifier: "instagram" },
    ]),
    uploadFromUrl: async () => ({ id: "m1", path: "/uploads/a.jpg" }),
    createPost: async (i: unknown) => { pz.createPostCalls.push(i); return true; },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/workflows/records/wf1")) {
      return { ok: true, json: async () => workflowState };
    }
    return { ok: true, json: async () => ({}) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("postiz_publish_worker", () => {
  it("posts the reviewed draft to all channels when no platform filter", async () => {
    const r = await handler(task({}), ctx);
    expect(r.text).toContain("published:x,instagram");
    const call = pz.createPostCalls[0] as { type: string; channelIds: string[]; content: string };
    expect(call.type).toBe("now");
    expect(call.channelIds).toEqual(["ch1", "ch2"]);
    expect(call.content).toBe("Approved post copy");
  });

  it("filters channels by the platforms field (case-insensitive)", async () => {
    const r = await handler(task({ platforms: "Instagram" }), ctx);
    expect(r.text).toBe("published:instagram");
    expect((pz.createPostCalls[0] as { channelIds: string[] }).channelIds).toEqual(["ch2"]);
  });

  it("schedules when schedule_date is set", async () => {
    await handler(task({ schedule_date: "2026-08-01T09:00:00Z" }), ctx);
    const call = pz.createPostCalls[0] as { type: string; date: string };
    expect(call.type).toBe("schedule");
    expect(call.date).toBe("2026-08-01T09:00:00Z");
  });

  it("ingests the image URL into Postiz media before posting", async () => {
    await handler(task({ image_url: "https://muapi.test/x.jpg" }), ctx);
    const call = pz.createPostCalls[0] as { media: unknown[] };
    expect(call.media).toEqual([{ id: "m1", path: "/uploads/a.jpg" }]);
  });

  it("tombstones cleanly when the workflow was cancelled at review", async () => {
    workflowState.status = "cancelled";
    const r = await handler(task({}), ctx);
    expect(r.text).toBe("tombstoned-cancelled");
    expect(pz.createPostCalls).toHaveLength(0);
  });

  it("throws (→ W71 retry) when postiz isn't connected or no channel matches", async () => {
    pz.client = null;
    await expect(handler(task({}), ctx)).rejects.toThrow("postiz not configured");
    pz.client = { listChannels: async () => [], uploadFromUrl: async () => null, createPost: async () => true };
    await expect(handler(task({}), ctx)).rejects.toThrow("no connected social channels");
  });
});
