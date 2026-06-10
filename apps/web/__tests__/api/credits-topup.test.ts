/**
 * W47 — credits lib contract tests (Tests 8–9 + addTopupCredits unit).
 *
 * Covers:
 *   - addTopupCredits writes ONLY image_credits_topup / video_credits_topup
 *     (agent_credits_topup never appears in any write body).
 *   - addTopupCredits creates the subscription record when missing
 *     (ported from the retired addAgentTopupCredits).
 *   - CreditState response no longer carries agentCreditsTopup.
 *   - Lazy migration: a legacy agent_credits_topup balance folds into
 *     image_credits_topup exactly once on credit-state read; second read
 *     does not double-migrate.
 *
 * PocketBase is a stateful in-memory fetch mock; comp check stubbed false.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../app/api/_lib/comp", () => ({
  isCompedUser: async () => false,
}));

import { addTopupCredits, getCreditState } from "../../app/api/_lib/credits";

const PB_URL = "https://pb.example.test";
process.env.PB_ADMIN_EMAIL = "admin@test";
process.env.PB_ADMIN_PASSWORD = "pw";

function currentMonthIso(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

type SubRecord = Record<string, unknown> & { id: string };

let subRecord: SubRecord | null;
let patchBodies: Array<Record<string, unknown>>;
let createBodies: Array<Record<string, unknown>>;

function installPbFetchMock() {
  patchBodies = [];
  createBodies = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.includes("/auth-with-password")) {
      return { ok: true, json: async () => ({ token: "admin_tok" }) };
    }
    if (url.includes("/collections/subscriptions/records?") && method === "GET") {
      return { ok: true, json: async () => ({ items: subRecord ? [subRecord] : [] }) };
    }
    if (url.includes("/collections/subscriptions/records/") && method === "PATCH") {
      const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
      patchBodies.push(body);
      if (subRecord) subRecord = { ...subRecord, ...body };
      return { ok: true, json: async () => subRecord ?? {} };
    }
    if (url.endsWith("/collections/subscriptions/records") && method === "POST") {
      const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
      createBodies.push(body);
      subRecord = { id: "sub_new", ...body };
      return { ok: true, json: async () => subRecord };
    }
    return { ok: true, json: async () => ({ items: [] }) };
  }));
}

beforeEach(() => {
  vi.unstubAllGlobals();
  subRecord = null;
  installPbFetchMock();
});

describe("addTopupCredits (W47 typed buckets)", () => {
  it("increments image_credits_topup only — video and agent untouched", async () => {
    subRecord = { id: "sub_1", plan: "growth", image_credits_topup: 10, video_credits_topup: 3, credits_reset_at: currentMonthIso() };
    const ok = await addTopupCredits(PB_URL, "uid", "image", 150);
    expect(ok).toBe(true);
    expect(patchBodies).toHaveLength(1);
    expect(patchBodies[0]).toEqual({ image_credits_topup: 160 });
    expect(JSON.stringify(patchBodies)).not.toContain("agent_credits_topup");
    expect(JSON.stringify(patchBodies)).not.toContain("video_credits_topup");
  });

  it("increments video_credits_topup only — image and agent untouched", async () => {
    subRecord = { id: "sub_1", plan: "growth", image_credits_topup: 10, video_credits_topup: 3, credits_reset_at: currentMonthIso() };
    const ok = await addTopupCredits(PB_URL, "uid", "video", 25);
    expect(ok).toBe(true);
    expect(patchBodies).toHaveLength(1);
    expect(patchBodies[0]).toEqual({ video_credits_topup: 28 });
    expect(JSON.stringify(patchBodies)).not.toContain("agent_credits_topup");
  });

  it("creates the subscription record when missing (create-if-missing port)", async () => {
    subRecord = null;
    const ok = await addTopupCredits(PB_URL, "uid", "image", 50);
    expect(ok).toBe(true);
    expect(createBodies).toHaveLength(1);
    expect(createBodies[0]).toMatchObject({ user: "uid", plan: "starter", image_credits_topup: 50 });
    expect(JSON.stringify(createBodies)).not.toContain("agent_credits_topup");
  });
});

describe("getCreditState (W47 shape + lazy migration)", () => {
  it("response carries no agentCreditsTopup key (Test 8)", async () => {
    subRecord = {
      id: "sub_1", plan: "growth",
      image_credits_used: 50, video_credits_used: 2,
      image_credits_topup: 0, video_credits_topup: 0,
      agent_credits_topup: 0,
      credits_reset_at: currentMonthIso(),
    };
    const state = await getCreditState(PB_URL, "uid");
    expect("agentCreditsTopup" in state).toBe(false);
    expect(state.totalRemaining.image).toBe(250);
    expect(state.totalRemaining.video).toBe(8);
  });

  it("no-subscription default state also carries no agentCreditsTopup key", async () => {
    subRecord = null;
    const state = await getCreditState(PB_URL, "uid");
    expect("agentCreditsTopup" in state).toBe(false);
  });

  it("lazily migrates legacy agent credits into image_credits_topup exactly once (Test 9)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    subRecord = {
      id: "sub_1", plan: "starter",
      image_credits_used: 0, video_credits_used: 0,
      image_credits_topup: 0, video_credits_topup: 0,
      agent_credits_topup: 42,
      credits_reset_at: currentMonthIso(),
    };

    const first = await getCreditState(PB_URL, "uid");
    // Migration PATCH fired: balance moved, source zeroed.
    const migration = patchBodies.find((b) => "agent_credits_topup" in b);
    expect(migration).toEqual({ image_credits_topup: 42, agent_credits_topup: 0 });
    expect(subRecord.agent_credits_topup).toBe(0);
    expect(subRecord.image_credits_topup).toBe(42);
    expect(first.topupBalance.image).toBe(42);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("[W47-migration] user=uid migrated 42");

    // Second read — no further migration writes.
    const patchCountAfterFirst = patchBodies.length;
    const second = await getCreditState(PB_URL, "uid");
    expect(patchBodies.length).toBe(patchCountAfterFirst);
    expect(second.topupBalance.image).toBe(42);
    logSpy.mockRestore();
  });
});
