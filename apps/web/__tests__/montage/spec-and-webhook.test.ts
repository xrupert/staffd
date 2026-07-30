/**
 * S3 — Studio connection layer: spec generator parsing + webhook HMAC.
 */

import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseBeats, buildEditDecisions } from "../../app/api/_lib/montage/spec";

const SCRIPT = `Video 3 — "What Directing Actually Looks Like" 📱🔁 | 30 seconds

Hook (0–3s): On-screen (large text, no speaking for 1s): Watch this. Spoken: "This is what it looks like to direct instead of hire."

Beat 1 (3–20s): [Screen record of a STAFFD brief being typed] Spoken: "I brief my Marketing specialist like I'd brief an employee."

Beat 2 (20–28s): "No job post. No interview. No onboarding." On-screen: Staffed. Not hired.

CTA (28–30s): "Try it free — link in bio."`;

describe("parseBeats", () => {
  it("extracts hook, beats, and CTA with timing ranges", () => {
    const beats = parseBeats(SCRIPT);
    expect(beats.map((b) => b.label.toLowerCase())).toEqual(["hook", "beat 1", "beat 2", "cta"]);
    expect(beats[0]).toMatchObject({ startS: 0, endS: 3 });
    expect(beats[3]).toMatchObject({ startS: 28, endS: 30 });
  });

  it("separates on-screen text from spoken copy", () => {
    const beats = parseBeats(SCRIPT);
    expect(beats[2]?.onScreen).toBe("Staffed. Not hired.");
    expect(beats[2]?.text).toContain("No job post");
  });
});

describe("buildEditDecisions", () => {
  it("builds a contiguous typed-scene timeline honoring script timings", () => {
    const spec = buildEditDecisions(SCRIPT, "Directing demo")!;
    const cuts = spec.cuts as Array<Record<string, unknown>>;
    expect(cuts.length).toBe(4);
    expect(cuts[0]).toMatchObject({ type: "hero_title", in_seconds: 0, out_seconds: 3 });
    expect(cuts[1]).toMatchObject({ in_seconds: 3, out_seconds: 20 });
    expect(cuts[3]).toMatchObject({ type: "callout", out_seconds: 30 });
    expect(spec).toMatchObject({ render_runtime: "remotion", composition_mode: "templated" });
  });

  it("returns null for unstructured text (caller falls back to single-clip)", () => {
    expect(buildEditDecisions("Just a paragraph of prose with no beats.", "x")).toBeNull();
  });
});

// ── webhook HMAC ────────────────────────────────────────────────────────────

const jobs = vi.hoisted(() => ({
  byPrediction: null as null | { id: string; user: string; kind: string },
  completed: [] as string[],
  failed: [] as string[],
}));
vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "tok",
}));
vi.mock("../../app/api/_lib/generation/jobs", () => ({
  getJobByPrediction: async () => jobs.byPrediction,
  completeJob: async (_pb: string, _t: string, _j: unknown, url: string) => { jobs.completed.push(url); },
  failJob: async () => { jobs.failed.push("x"); },
}));

import { POST as webhook } from "../../app/api/webhooks/montage/route";

function signed(body: string, secret: string): Request {
  const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return new Request("https://t/api/webhooks/montage", {
    method: "POST",
    headers: { "x-montage-signature": sig, "Content-Type": "application/json" },
    body,
  });
}

describe("POST /api/webhooks/montage", () => {
  beforeEach(() => {
    vi.stubEnv("MONTAGE_WEBHOOK_SECRET", "shhh");
    jobs.byPrediction = { id: "g1", user: "u1", kind: "video" };
    jobs.completed = [];
    jobs.failed = [];
  });
  afterEach(() => vi.unstubAllEnvs());

  it("503 fail-closed without the secret", async () => {
    vi.stubEnv("MONTAGE_WEBHOOK_SECRET", "");
    expect((await webhook(signed("{}", "whatever"))).status).toBe(503);
  });

  it("401 on a bad signature", async () => {
    const req = new Request("https://t/x", { method: "POST", headers: { "x-montage-signature": "bad" }, body: "{}" });
    expect((await webhook(req)).status).toBe(401);
  });

  it("succeeded → completes the ledger job with the STAFFD proxy URL", async () => {
    const res = await webhook(signed(JSON.stringify({ job_id: "mj1", status: "succeeded" }), "shhh"));
    expect(res.status).toBe(200);
    expect(jobs.completed).toEqual(["/api/montage/output/mj1"]);
  });

  it("failed → fails the ledger job (notification fires downstream)", async () => {
    await webhook(signed(JSON.stringify({ job_id: "mj1", status: "failed" }), "shhh"));
    expect(jobs.failed.length).toBe(1);
  });

  it("unknown montage job id → 200 skip (no retry storm)", async () => {
    jobs.byPrediction = null;
    const res = await webhook(signed(JSON.stringify({ job_id: "ghost", status: "succeeded" }), "shhh"));
    expect((await res.json()).skipped).toBe("unknown_job");
  });
});
