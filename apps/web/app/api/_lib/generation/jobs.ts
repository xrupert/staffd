/**
 * generation_jobs helpers (W95.7.3b) — create / read / complete / fail the
 * async image-video job ledger, shared by the submit route (fast-path) and the
 * status poll. The charge-at-completion is CLAIM-FIRST idempotent: the `charged`
 * flag is set before spending, so a job is charged at most once even under
 * duplicate / concurrent polls. Charge-on-success-only is preserved — a job
 * that never completes is never charged.
 */

import { adminHeaders } from "../pb";
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
};

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
  input: { user: string; kind: GenKind; model: string; prompt: string; aspect_ratio: string; prediction_id: string },
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
