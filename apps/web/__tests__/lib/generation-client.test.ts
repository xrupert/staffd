/**
 * W95.7.3b — runGeneration client: fast-path (URL on submit), submit→poll to
 * completion, failure surfacing, and the cancel hook.
 *
 * Task 6 additions: runEdit — 422→not_an_edit, fast-path completed-on-submit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../lib/pb", () => ({ default: { authStore: { token: "tok" } } }));
import { runGeneration, runEdit } from "../../lib/generation-client";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("runGeneration (W95.7.3b)", () => {
  it("fast path — completed on submit returns the url with no polling", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ jobId: "j1", status: "completed", url: "https://cdn/i.png" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await runGeneration({ userId: "u1", kind: "image", prompt: "a cat" });
    expect(r).toEqual({ url: "https://cdn/i.png" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // submit only, no status poll
  });

  it("surfaces an out-of-credits / not-configured error from submit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 402, json: async () => ({ message: "Out of video credits this month." }) })));
    const r = await runGeneration({ userId: "u1", kind: "video", prompt: "x" });
    expect(r.error).toMatch(/out of video credits/i);
  });

  it("pending → polls status until completed", async () => {
    vi.useFakeTimers();
    let statusCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/api/integrations/muapi")) return { ok: false, status: 202, json: async () => ({ jobId: "j1", status: "pending" }) };
      // status endpoint: pending once, then completed
      statusCalls++;
      return statusCalls < 2
        ? { ok: true, json: async () => ({ status: "pending" }) }
        : { ok: true, json: async () => ({ status: "completed", url: "https://cdn/v.mp4" }) };
    }));
    const p = runGeneration({ userId: "u1", kind: "video", prompt: "x" });
    await vi.advanceTimersByTimeAsync(5000); // first poll → pending
    await vi.advanceTimersByTimeAsync(5000); // second poll → completed
    expect(await p).toEqual({ url: "https://cdn/v.mp4" });
  });

  it("pending → polls until failed", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/api/integrations/muapi")
        ? { ok: false, status: 202, json: async () => ({ jobId: "j1", status: "pending" }) }
        : { ok: true, json: async () => ({ status: "failed", error: "model error" }) },
    ));
    const p = runGeneration({ userId: "u1", kind: "video", prompt: "x" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ error: "model error" });
  });
});

describe("runEdit (Task 6)", () => {
  it("422 response maps to { error: 'not_an_edit' }", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({ error: "cannot classify as edit" }),
    })));
    const r = await runEdit({ kind: "image", sourceUrl: "https://cdn/i.png", instruction: "make it blue" });
    expect(r).toEqual({ error: "not_an_edit" });
  });

  it("fast path — completed on submit returns { url } without polling", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ jobId: "e1", status: "completed", url: "https://cdn/edited.png" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await runEdit({ kind: "image", sourceUrl: "https://cdn/i.png", instruction: "make it blue" });
    expect(r).toEqual({ url: "https://cdn/edited.png" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // submit only, no status poll
  });
});
