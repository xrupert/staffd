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
/** `jobId` rides along on Studio outcomes so Finishing Touches (S4b) can
 *  key a re-render off the finished job. */
export type GenOutcome = { url?: string; error?: string; jobId?: string };

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
  opts: { userId: string; kind: GenKind; prompt: string; aspectRatio?: string; tier?: string; department?: string; seed?: number },
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
      body: JSON.stringify({ userId: opts.userId, kind: opts.kind, prompt: opts.prompt, aspectRatio: opts.aspectRatio, tier: opts.tier, department: opts.department, seed: opts.seed }),
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

  return pollJob(jobId, shouldCancel);
}

/**
 * Shared polling loop for generation jobs. Used by both runGeneration and
 * runEdit — edit jobs are ordinary generation_jobs rows polled by the same
 * status endpoint.
 */
async function pollJob(jobId: string, shouldCancel?: () => boolean): Promise<GenOutcome> {
  for (let i = 0; i < MAX_POLLS; i++) {
    if (shouldCancel?.()) return { error: "cancelled" };
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (shouldCancel?.()) return { error: "cancelled" };
    let sres: Response;
    try {
      sres = await fetch(`/api/generation/${encodeURIComponent(jobId)}/status`, { headers: { Authorization: pb.authStore.token } });
    } catch { continue; } // transient network — keep polling
    const sdata = (await sres.json().catch(() => ({}))) as StatusResponse;
    if (sdata.status === "completed" && sdata.url) return { url: sdata.url };
    if (sdata.status === "failed") return { error: sdata.error ?? "Generation failed." };
    // pending → keep polling
  }
  return { error: "Generation is taking longer than expected — check back in a moment." };
}

/**
 * runStudioProduction (S3) — submit a scripted video to the Studio
 * (/api/montage/produce) and reuse the SAME status poll: Studio renders are
 * ordinary generation_jobs rows completed by the montage webhook. Returns
 * {error: "studio_unavailable"} specifically when the caller should fall
 * back to the single-clip path (service unconfigured/down/unparseable).
 */
export async function runStudioProduction(
  input: { script: string; title: string; tier: string },
  shouldCancel?: () => boolean,
): Promise<GenOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/montage/produce", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
      body: JSON.stringify(input),
    });
  } catch {
    return { error: "studio_unavailable" };
  }
  if (!res.ok) return { error: "studio_unavailable" };
  const data = (await res.json().catch(() => ({}))) as { jobId?: string };
  if (!data.jobId) return { error: "studio_unavailable" };
  return { ...(await pollJob(data.jobId, shouldCancel)), jobId: data.jobId };
}

/**
 * runFinishingTouches (S4b) — re-render a finished Studio video with the
 * user's edits (per-scene text + outro). Same ledger + poll as every other
 * generation; the returned jobId keys the NEXT round of touches.
 */
export async function runFinishingTouches(
  input: { jobId: string; outroText?: string; textOverrides?: Record<number, string> },
  shouldCancel?: () => boolean,
): Promise<GenOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/montage/touches", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
      body: JSON.stringify(input),
    });
  } catch {
    return { error: "studio_unavailable" };
  }
  const data = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
  if (!res.ok || !data.jobId) return { error: data.error ?? "studio_unavailable" };
  return { ...(await pollJob(data.jobId, shouldCancel)), jobId: data.jobId };
}

/**
 * runEdit — submit an edit-as-intent op against an existing artifact, then reuse
 * the shared status poll (edit jobs are ordinary generation_jobs rows). The
 * server classifies the instruction → op → model; the client only declares the
 * source artifact + instruction (+ tier for video edits).
 */
export async function runEdit(
  opts: { kind: GenKind; sourceUrl: string; instruction: string; tier?: string; department?: string },
  shouldCancel?: () => boolean,
): Promise<GenOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/generation/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
      body: JSON.stringify(opts),
    });
  } catch (e) {
    return { error: `Couldn't reach the edit service: ${e instanceof Error ? e.message : String(e)}` };
  }
  const data = (await res.json().catch(() => ({}))) as SubmitResponse & { error?: string };
  if (res.status === 422) return { error: "not_an_edit" };
  if (!res.ok && res.status !== 202 && !data.jobId) {
    return { error: data.message ?? data.detail ?? data.error ?? "Couldn't apply that edit — try again." };
  }
  if (data.status === "completed" && data.url) return { url: data.url };
  const jobId = data.jobId;
  if (!jobId) return { error: "Couldn't start the edit — try again." };
  return pollJob(jobId, shouldCancel);
}
