/**
 * generation_jobs helpers (W95.7.3b) — create / read / complete / fail the
 * async image-video job ledger, shared by the submit route (fast-path) and the
 * status poll. The charge-at-completion is CLAIM-FIRST idempotent: the `charged`
 * flag is set before spending, so a job is charged at most once even under
 * duplicate / concurrent polls. Charge-on-success-only is preserved — a job
 * that never completes is never charged.
 */

import { createHash } from "node:crypto";
import { adminHeaders, pbEscape } from "../pb";
import { spendCredits } from "../credits";
import { logSuperAdminUsage } from "../auth/super-admin-logging";

export type GenKind = "image" | "video";

export type GenJob = {
  id: string;
  user: string;
  kind: GenKind;
  status: "pending" | "completed" | "failed" | string;
  model?: string;
  prompt?: string;
  aspect_ratio?: string;
  prediction_id?: string;
  output_url?: string;
  charged?: boolean;
  error?: string;
  fingerprint?: string;
};

/** W95.7.3c-b1 — submit dedup window. A pending job older than this is treated
 *  as stale (orphaned) and a fresh submission is allowed. */
export const INFLIGHT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Stable dedup fingerprint for a generation request. Model is omitted
 * deliberately — it's a deterministic function of (kind, prompt), so two
 * identical (user, kind, prompt, ratio) requests always route to the same
 * model; omitting it lets dedup run BEFORE prompt enrichment (saving the
 * Anthropic enrich call too, not just the Muapi submit).
 */
export function fingerprintFor(userId: string, kind: GenKind, prompt: string, aspectRatio: string): string {
  return createHash("sha256").update(`${userId}|${kind}|${prompt.trim()}|${aspectRatio}`).digest("hex");
}

/** Return the id of a CURRENTLY in-flight (pending, within window) job with this
 *  fingerprint, or null. Only `pending` rows dedupe — a succeeded job means the
 *  customer is asking for a legitimate re-generation. */
export async function findInflightByFingerprint(pb: string, token: string, fingerprint: string): Promise<string | null> {
  const since = new Date(Date.now() - INFLIGHT_WINDOW_MS).toISOString().replace("T", " ").slice(0, 19) + ".000Z";
  const filter = `fingerprint = "${pbEscape(fingerprint)}" && status = "pending" && created >= "${since}"`;
  const res = await fetch(`${pb}/api/collections/generation_jobs/records?filter=${encodeURIComponent(filter)}&perPage=1&sort=-created&fields=id`, { headers: { Authorization: token } });
  if (!res.ok) return null;
  return (((await res.json()) as { items?: { id: string }[] }).items?.[0]?.id) ?? null;
}

/** Look up a job by its Muapi prediction id (webhook match). */
export async function getJobByPrediction(pb: string, token: string, predictionId: string): Promise<GenJob | null> {
  const filter = `prediction_id = "${pbEscape(predictionId)}"`;
  const res = await fetch(`${pb}/api/collections/generation_jobs/records?filter=${encodeURIComponent(filter)}&perPage=1`, { headers: { Authorization: token } });
  if (!res.ok) return null;
  return (((await res.json()) as { items?: GenJob[] }).items?.[0]) ?? null;
}

export type CompleteResult = { status: "completed"; url: string; remaining: number | "unlimited"; creditWarning?: string };

async function patchJob(pb: string, token: string, id: string, patch: Partial<GenJob>): Promise<void> {
  await fetch(`${pb}/api/collections/generation_jobs/records/${id}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify(patch),
  });
}

/** Create a pending job row; returns its id (or null on failure). */
export async function createJob(
  pb: string,
  token: string,
  input: { user: string; kind: GenKind; model: string; prompt: string; aspect_ratio: string; prediction_id: string; fingerprint?: string },
): Promise<string | null> {
  const res = await fetch(`${pb}/api/collections/generation_jobs/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({ ...input, status: "pending", charged: false }),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { id?: string }).id ?? null;
}

export async function getJob(pb: string, token: string, id: string): Promise<GenJob | null> {
  const res = await fetch(`${pb}/api/collections/generation_jobs/records/${id}`, { headers: { Authorization: token } });
  if (!res.ok) return null;
  return (await res.json()) as GenJob;
}

/**
 * Mark a job completed with its URL, charging the credit exactly once.
 * CLAIM-FIRST: set `charged:true` BEFORE spending so concurrent polls can't
 * double-charge (a failed spend after the claim under-charges — favours the
 * customer, and the POST pre-flight already gated out-of-credits at submit).
 * Idempotent: an already-completed job returns its stored URL with no re-charge.
 *
 * `superAdmin` (the resolved super-admin record, or null) bypasses credits and
 * logs usage instead (Decision 74).
 */
export async function completeJob(
  pb: string,
  token: string,
  job: GenJob,
  resultUrl: string,
  superAdmin: { id: string; email: string } | null,
): Promise<CompleteResult> {
  // Idempotent — already terminal.
  if (job.status === "completed" && job.output_url) {
    return { status: "completed", url: job.output_url, remaining: "unlimited" };
  }

  let remaining: number | "unlimited" = "unlimited";
  let creditWarning: string | undefined;

  if (!job.charged) {
    await patchJob(pb, token, job.id, { charged: true }); // claim first
    if (superAdmin) {
      void logSuperAdminUsage(superAdmin, "muapi_generation", {
        operation_detail: `${job.kind} via ${job.model ?? "?"}`,
        parameters: { kind: job.kind, jobId: job.id, model: job.model },
      });
    } else {
      const spend = await spendCredits(pb, job.user, job.kind, 1);
      if (spend.ok) remaining = spend.remaining;
      else creditWarning = "Credit charge failed — please contact support.";
    }
  }

  await patchJob(pb, token, job.id, { status: "completed", output_url: resultUrl });
  return { status: "completed", url: resultUrl, remaining, ...(creditWarning ? { creditWarning } : {}) };
}

export async function failJob(pb: string, token: string, id: string, error: string): Promise<void> {
  await patchJob(pb, token, id, { status: "failed", error: error.slice(0, 500) });
}
