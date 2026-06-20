/**
 * W95.7.3c-b1 — submit-time dedup: stable fingerprint, in-flight lookup
 * (pending + within window only), and prediction-id lookup for the webhook.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({ adminHeaders: (t: string) => ({ Authorization: t }), pbEscape: (s: string) => s }));
vi.mock("../../app/api/_lib/credits", () => ({ spendCredits: vi.fn() }));
vi.mock("../../app/api/_lib/auth/super-admin-logging", () => ({ logSuperAdminUsage: vi.fn() }));

import { fingerprintFor, findInflightByFingerprint, getJobByPrediction, INFLIGHT_WINDOW_MS } from "../../app/api/_lib/generation/jobs";

describe("fingerprintFor (W95.7.3c-b1)", () => {
  it("is stable for identical inputs and differs on any change", () => {
    const a = fingerprintFor("u1", "video", "a dog at dawn", "9:16");
    expect(fingerprintFor("u1", "video", "a dog at dawn", "9:16")).toBe(a); // stable
    expect(fingerprintFor("u1", "video", "a dog at dawn ", "9:16")).toBe(a); // trim-insensitive
    expect(fingerprintFor("u2", "video", "a dog at dawn", "9:16")).not.toBe(a); // user
    expect(fingerprintFor("u1", "image", "a dog at dawn", "9:16")).not.toBe(a); // kind
    expect(fingerprintFor("u1", "video", "a cat at dawn", "9:16")).not.toBe(a); // prompt
    expect(fingerprintFor("u1", "video", "a dog at dawn", "16:9")).not.toBe(a); // ratio
  });
  it("is a 64-char hex sha256", () => {
    expect(fingerprintFor("u1", "image", "x", "1:1")).toMatch(/^[0-9a-f]{64}$/);
  });
});

let lastUrl = "";
beforeEach(() => { lastUrl = ""; });
afterEach(() => vi.unstubAllGlobals());

describe("findInflightByFingerprint (W95.7.3c-b1)", () => {
  it("queries pending + same fingerprint + created within the in-flight window, returns the id", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { lastUrl = decodeURIComponent(String(url)); return { ok: true, json: async () => ({ items: [{ id: "job-9" }] }) }; }));
    const id = await findInflightByFingerprint("https://pb.test", "tok", "fp123");
    expect(id).toBe("job-9");
    expect(lastUrl).toContain('fingerprint = "fp123"');
    expect(lastUrl).toContain('status = "pending"'); // succeeded jobs never dedupe
    expect(lastUrl).toContain("created >="); // window guard
  });
  it("returns null when nothing in-flight matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })));
    expect(await findInflightByFingerprint("https://pb.test", "tok", "fp123")).toBeNull();
  });
  it("window is 15 minutes", () => { expect(INFLIGHT_WINDOW_MS).toBe(15 * 60 * 1000); });
});

describe("getJobByPrediction (W95.7.3c-b1 — webhook match)", () => {
  it("looks up by prediction_id and returns the job", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { lastUrl = decodeURIComponent(String(url)); return { ok: true, json: async () => ({ items: [{ id: "job-7", user: "u1", prediction_id: "p1", status: "pending" }] }) }; }));
    const job = await getJobByPrediction("https://pb.test", "tok", "p1");
    expect(job?.id).toBe("job-7");
    expect(lastUrl).toContain('prediction_id = "p1"');
  });
});
