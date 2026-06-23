/**
 * W95.7.3d-h5 — specialist selection for creative marketing tasks.
 *
 * The /api/agent route now calls routeTask (after an explicit agentId, before
 * the generic department default) so a task reaches the RIGHT specialist. Before
 * this, "make a tiktok video" fell straight through to the generic
 * marketing-content-creator. These pins lock the intent so it can't regress.
 */

import { describe, it, expect } from "vitest";
import { routeTask, getDepartmentDefaultAgent } from "../index";

describe("routeTask — creative marketing specialist selection (h5)", () => {
  it("a TikTok video request reaches the TikTok Strategist, not the generic default", () => {
    expect(routeTask("make me a tiktok video for our launch", "marketing")?.id).toBe("marketing-tiktok-strategist");
    expect(routeTask("write a tiktok script with a viral hook", "marketing")?.id).toBe("marketing-tiktok-strategist");
    // and it is NOT the generic department default
    expect(getDepartmentDefaultAgent("marketing")?.id).toBe("marketing-content-creator");
  });

  it("platform-specific requests reach their own specialist", () => {
    expect(routeTask("create a youtube video", "marketing")?.id).toBe("marketing-video-optimization-specialist");
    expect(routeTask("draft an instagram post", "marketing")?.id).toBe("marketing-social-media-strategist");
    expect(routeTask("write a blog article", "marketing")?.id).toBe("marketing-content-creator");
  });

  it("a task with no tag overlap falls through (caller then uses the dept default)", () => {
    expect(routeTask("do the thing we talked about", "marketing")).toBeUndefined();
  });
});
