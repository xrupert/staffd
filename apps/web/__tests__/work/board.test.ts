/**
 * Staff Work Board — pure column mapping.
 */

import { describe, it, expect } from "vitest";
import { bucketize } from "../../app/api/_lib/work/board";

const NOW = new Date("2026-08-03T12:00:00Z").getTime();
const recent = "2026-08-01 10:00:00";
const ancient = "2026-06-01 10:00:00";

describe("bucketize", () => {
  it("maps each source's statuses to the right columns", () => {
    const b = bucketize({
      scheduled: [
        { id: "1", task: "Post about the launch", status: "planned", scheduled_date: "2026-08-05", kind: "content" },
        { id: "2", task: "Video for Friday", status: "working", scheduled_date: "2026-08-03", kind: "video_production" },
        { id: "3", task: "Review this draft", status: "review", scheduled_date: "2026-08-03" },
        { id: "4", task: "Old done", status: "completed", scheduled_date: "2026-08-02" },
      ],
      workflows: [
        { id: "w1", goal: "Launch campaign", status: "running", created: recent },
        { id: "w2", goal: "Reply to ticket", status: "awaiting_review", created: recent },
        { id: "w3", goal: "Finished plan", status: "completed", created: recent },
      ],
      jobs: [
        { id: "g1", kind: "video", prompt: "Bakery TikTok", status: "pending", created: recent },
        { id: "g2", kind: "image", prompt: "Menu visual", status: "completed", created: recent, output_url: "/api/x" },
      ],
    }, NOW);

    expect(b.planned.map((c) => c.id)).toEqual(["sc-1"]);
    expect(b.in_progress.map((c) => c.id).sort()).toEqual(["gj-g1", "sc-2", "wf-w1"]);
    expect(b.review.map((c) => c.id).sort()).toEqual(["sc-3", "wf-w2"]);
    expect(b.done.map((c) => c.id).sort()).toEqual(["gj-g2", "sc-4", "wf-w3"]);
  });

  it("failed work lands in Done flagged failed; old done drops off (14-day window)", () => {
    const b = bucketize({
      scheduled: [{ id: "f", task: "x", status: "failed", scheduled_date: "2026-08-02" }],
      workflows: [{ id: "old", goal: "ancient", status: "completed", created: ancient }],
      jobs: [],
    }, NOW);
    expect(b.done.length).toBe(1);
    expect(b.done[0]).toMatchObject({ id: "sc-f", failed: true });
  });

  it("completed generations carry their output link; video_production labels as such", () => {
    const b = bucketize({
      scheduled: [{ id: "v", task: "Friday video", status: "planned", scheduled_date: "2026-08-05", kind: "video_production" }],
      workflows: [],
      jobs: [{ id: "g", kind: "video", prompt: "p", status: "completed", created: recent, output_url: "/api/montage/output/x?t=abc" }],
    }, NOW);
    expect(b.planned[0]?.subtitle).toContain("Video production");
    expect(b.done[0]?.href).toBe("/api/montage/output/x?t=abc");
  });

  it("markdown noise is stripped from titles and long titles ellipsized", () => {
    const b = bucketize({
      scheduled: [{ id: "m", task: `## **Big header** ${"x".repeat(200)}`, status: "planned", scheduled_date: "2026-08-05" }],
      workflows: [], jobs: [],
    }, NOW);
    expect(b.planned[0]?.title.startsWith("Big header")).toBe(true);
    expect(b.planned[0]?.title.length).toBeLessThanOrEqual(91);
  });
});
