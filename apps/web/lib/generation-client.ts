/**
 * runGeneration (W95.7.3b) — the shared client driver for async image/video
 * generation. Submits to POST /api/integrations/muapi, then polls
 * GET /api/generation/<id>/status every ~5s until the job completes or fails.
 *
 * Replaces the old "POST holds open 60s → 504" flow. Used imperatively by both
 * CommandCenter (thread messages) and DepartmentRoom (button loading state);
 * each caller owns its own in-flight flag, so this stays a plain function
 * rather than a hook. The FAST PATH (Muapi returns the URL on submit, typical
 * for images) resolves on the first response with no polling.
 *
 * NOTE (W95.7.3b): proposed as `useGenerationJob` hook; realized as a plain
 * async function because both call sites are imperative — surfaced to SA.
 */

import pb from "./pb";

export type GenKind = "image" | "video";
export type GenOutcome = { url?: string; error?: string };

const POLL_MS = 5000;
const MAX_POLLS = 180; // ~15 min ceiling before we tell the user to check back

type SubmitResponse = { jobId?: string; status?: string; url?: string; message?: string; error?: string; detail?: string };
type StatusResponse = { status?: string; url?: string; error?: string };

/**
 * Submit + poll a generation to completion. Resolves with `{ url }` on success
 * or `{ error }` on failure/timeout. `shouldCancel` (e.g. an unmount/abort ref)
 * stops polling early and resolves `{ error: "cancelled" }`.
 */
export async function runGeneration(
  opts: { userId: string; kind: GenKind; prompt: string; aspectRatio?: string; tier?: string; department?: string },
  shouldCancel?: () => boolean,
): Promise<GenOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/integrations/muapi", {
      method: "POST",
      // W95.7.3d-h6 — the submit route now authenticates the caller from this
      // token (no more body-userId trust); without it the route 401s.
      headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
      // W95.7.3d-T1 — forward tier + department so the server charges the tier
      // weight and routes to the tier's best model.
      body: JSON.stringify({ userId: opts.userId, kind: opts.kind, prompt: opts.prompt, aspectRatio: opts.aspectRatio, tier: opts.tier, department: opts.department }),
    });
  } catch (e) {
    return { error: `Couldn't reach the generation service: ${e instanceof Error ? e.message : String(e)}` };
  }

  const data = (await res.json().catch(() => ({}))) as SubmitResponse;

  // 503 not-configured / 402 out-of-credits / hard submit failure.
  if (!res.ok && res.status !== 202 && !data.jobId) {
    return { error: data.message ?? data.detail ?? data.error ?? "Couldn't generate — try again." };
  }
  // Fast path — completed on submit (typical for images).
  if (data.status === "completed" && data.url) return { url: data.url };

  const jobId = data.jobId;
  if (!jobId) return { error: "Couldn't start the generation — try again." };

  for (let i = 0; i < MAX_POLLS; i++) {
    if (shouldCancel?.()) return { error: "cancelled" };
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (shouldCancel?.()) return { error: "cancelled" };
    let sres: Response;
    try {
      sres = await fetch(`/api/generation/${encodeURIComponent(jobId)}/status`, { headers: { Authorization: pb.authStore.token } });
    } catch {
      continue; // transient network — keep polling
    }
    const sdata = (await sres.json().catch(() => ({}))) as StatusResponse;
    if (sdata.status === "completed" && sdata.url) return { url: sdata.url };
    if (sdata.status === "failed") return { error: sdata.error ?? "Generation failed." };
    // pending → keep polling
  }
  return { error: "Generation is taking longer than expected — check back in a moment." };
}
