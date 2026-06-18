/**
 * W95.5 — autopilot streak + graduation engine. In-memory PB stub for
 * autopilot_prefs (find-or-create + patch), covering streak math, graduation
 * thresholds per tier, enable/suppress/revoke, and the autopilot gate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "tok",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
}));

import {
  getAutopilotPrefs, incrementStreak, decrementStreak, resetStreak,
  setEnabled, recordSuppression, recordRevocation, shouldAutopilot, shouldOfferGraduation,
} from "../../app/api/_lib/autopilot/policy";

// In-memory autopilot_prefs store keyed by intent_type (single user in tests).
let store: Record<string, Record<string, unknown>>;
let seq: number;
function setFetch() {
  store = {}; seq = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (url.includes("/autopilot_prefs/records?") && method === "GET") {
      const m = decodeURIComponent(url).match(/intent_type = "([^"]+)"/);
      const it = m?.[1] ?? "";
      const row = store[it];
      return { ok: true, json: async () => ({ items: row ? [row] : [] }) };
    }
    if (url.includes("/autopilot_prefs/records") && method === "POST") {
      const id = `ap-${++seq}`;
      store[body.intent_type] = { ...body, id };
      return { ok: true, json: async () => ({ id }) };
    }
    const patch = url.match(/\/autopilot_prefs\/records\/(ap-\d+)/);
    if (patch && method === "PATCH") {
      const it = Object.keys(store).find((k) => (store[k] as { id: string }).id === patch[1]);
      if (it) store[it] = { ...store[it], ...body };
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  }));
}
const U = "userA";
beforeEach(setFetch);
afterEach(() => vi.unstubAllGlobals());

describe("streak math", () => {
  it("defaults to streak 0 / disabled when no row exists", async () => {
    const p = await getAutopilotPrefs(U, "create_contact");
    expect(p).toMatchObject({ confirm_streak: 0, enabled: false });
  });
  it("incrementStreak +1 on a clean confirm", async () => {
    await incrementStreak(U, "create_task", { edited: false });
    expect((await getAutopilotPrefs(U, "create_task")).confirm_streak).toBe(1);
  });
  it("incrementStreak is a NO-OP when the user edited the parse", async () => {
    await incrementStreak(U, "create_task", { edited: false });
    await incrementStreak(U, "create_task", { edited: true });
    expect((await getAutopilotPrefs(U, "create_task")).confirm_streak).toBe(1);
  });
  it("decrementStreak floors at 0", async () => {
    await decrementStreak(U, "create_task");
    expect((await getAutopilotPrefs(U, "create_task")).confirm_streak).toBe(0);
    await incrementStreak(U, "create_task", { edited: false });
    await incrementStreak(U, "create_task", { edited: false });
    await decrementStreak(U, "create_task");
    expect((await getAutopilotPrefs(U, "create_task")).confirm_streak).toBe(1);
  });
  it("resetStreak zeroes it", async () => {
    await incrementStreak(U, "create_task", { edited: false });
    await resetStreak(U, "create_task");
    expect((await getAutopilotPrefs(U, "create_task")).confirm_streak).toBe(0);
  });
});

describe("graduation offer", () => {
  it("offers a trivial intent at streak 3, not before", async () => {
    for (let i = 0; i < 2; i++) await incrementStreak(U, "create_task", { edited: false });
    expect(await shouldOfferGraduation(U, "create_task")).toBe(false); // streak 2 < 3
    await incrementStreak(U, "create_task", { edited: false });
    expect(await shouldOfferGraduation(U, "create_task")).toBe(true); // streak 3
  });
  it("offers an audited intent at streak 5, not at 4", async () => {
    for (let i = 0; i < 4; i++) await incrementStreak(U, "create_contact", { edited: false });
    expect(await shouldOfferGraduation(U, "create_contact")).toBe(false);
    await incrementStreak(U, "create_contact", { edited: false });
    expect(await shouldOfferGraduation(U, "create_contact")).toBe(true);
  });
  it("never offers a 'never'-policy intent", async () => {
    for (let i = 0; i < 9; i++) await incrementStreak(U, "draft_campaign", { edited: false });
    expect(await shouldOfferGraduation(U, "draft_campaign")).toBe(false);
  });
  it("does not offer once enabled, and 'Not yet' suppresses for 30 days (streak reset)", async () => {
    for (let i = 0; i < 3; i++) await incrementStreak(U, "create_task", { edited: false });
    await recordSuppression(U, "create_task", 30);
    const p = await getAutopilotPrefs(U, "create_task");
    expect(p.confirm_streak).toBe(0);
    expect(await shouldOfferGraduation(U, "create_task")).toBe(false);
  });
});

describe("autopilot gate", () => {
  it("fires only when enabled, unambiguous, eligible policy", async () => {
    expect(await shouldAutopilot(U, "create_contact", false)).toBe(false); // not enabled
    await setEnabled(U, "create_contact", true);
    expect(await shouldAutopilot(U, "create_contact", false)).toBe(true);
    expect(await shouldAutopilot(U, "create_contact", true)).toBe(false); // ambiguity blocks
  });
  it("never fires a 'never'-policy intent even if somehow enabled", async () => {
    await setEnabled(U, "send_for_signature", true);
    expect(await shouldAutopilot(U, "send_for_signature", false)).toBe(false);
  });
  it("undo revocation disables + blocks re-fire during the 7-day cooldown", async () => {
    await setEnabled(U, "capture_lead", true);
    await recordRevocation(U, "capture_lead");
    const p = await getAutopilotPrefs(U, "capture_lead");
    expect(p.enabled).toBe(false);
    expect(p.confirm_streak).toBe(0);
    expect(await shouldAutopilot(U, "capture_lead", false)).toBe(false);
    expect(await shouldOfferGraduation(U, "capture_lead")).toBe(false); // cooldown
  });
});
