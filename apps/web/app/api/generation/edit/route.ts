/**
 * POST /api/generation/edit — edit-as-intent submit route.
 * Body: { kind: "image"|"video", sourceUrl, instruction, tier?, department? }
 *
 * Sibling of /api/integrations/muapi (text-to-X). Same spine: whoAmI auth
 * (Standard #39), credit gate (video metered, image weight 0), generation_jobs
 * ledger (polled by /api/generation/[id]/status), webhook + fast path. Differs
 * only in resolution: classify the instruction → an edit OP → a model slug +
 * per-op body (no prompt enrichment; the source artifact carries the content).
 *
 * Standard #38: registered in trigger-surfaces.ts; the UI surface gates video
 * edits through GenerationTierInline before calling this.
 */

import { getCreditState } from "../../_lib/credits";
import { trySuperAdminByUserId } from "../../_lib/auth/super-admin";
import { getAdminToken } from "../../_lib/pb";
import { submitPrediction, tryExtractOutputUrl, buildWebhookUrl } from "../../_lib/integrations/muapi/predictions";
import { createJob, completeJob, fingerprintFor, findInflightByFingerprint, type GenJob } from "../../_lib/generation/jobs";
import { defaultTierFor, tierWeight, type Tier } from "../../_lib/generation/pricing";
import { routeForEdit } from "../../_lib/generation/routing";
import { classifyEditKeyword, EDIT_OP_SPECS, OP_KIND, ROUTE_OPS, type EditClassification } from "../../_lib/generation/edit-ops";
import { classifyEditLLM } from "../../_lib/generation/edit-ops-llm";
import { whoAmI } from "../../_lib/integrations/identity";

const ROUTE_SET = new Set<string>(ROUTE_OPS);

export async function POST(req: Request) {
  if (!process.env.MUAPI_API_KEY) {
    return Response.json({ error: "not_configured", message: "Image / video editing is not set up yet." }, { status: 503 });
  }
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const { kind, sourceUrl, instruction, tier: reqTier, department } = (await req.json()) as {
      kind: "image" | "video"; sourceUrl?: string; instruction?: string; tier?: string; department?: string;
    };

    const me = await whoAmI(req);
    if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
    const userId = me.id;

    if (kind !== "image" && kind !== "video") return Response.json({ error: "kind must be 'image' or 'video'" }, { status: 400 });
    if (!sourceUrl?.trim()) return Response.json({ error: "source_required" }, { status: 400 });
    if (!instruction?.trim()) return Response.json({ error: "instruction is required" }, { status: 400 });

    let cls: EditClassification = classifyEditKeyword(instruction, kind);
    if (!cls) cls = await classifyEditLLM(instruction, kind);
    if (!cls || !ROUTE_SET.has(cls.op) || OP_KIND[cls.op] !== kind) {
      return Response.json({ error: "not_an_edit" }, { status: 422 });
    }
    const { op, editPrompt } = cls;

    const dept = department ?? "";
    const tier: Tier = (["quick", "pro", "premium"].includes(reqTier ?? "") ? reqTier : defaultTierFor(dept, kind)) as Tier;
    const creditWeight = kind === "image" ? 0 : tierWeight(kind, tier);

    const superAdmin = await trySuperAdminByUserId(userId);
    const preState = superAdmin ? null : await getCreditState(pbUrl, userId);
    if (preState && preState.totalRemaining[kind] < creditWeight) {
      return Response.json(
        { error: "out_of_credits", message: `This ${kind} edit costs ${creditWeight} credits — you have ${preState.totalRemaining[kind]}.`, remaining: preState.totalRemaining[kind], required: creditWeight, plan: preState.plan },
        { status: 402 },
      );
    }

    const slug = routeForEdit(op)[0];
    if (!slug) return Response.json({ error: "routing_unresolved", op }, { status: 500 });

    let adminToken: string;
    try { adminToken = await getAdminToken(); } catch { return Response.json({ error: "Service unavailable" }, { status: 503 }); }

    const fingerprint = fingerprintFor(userId, kind, `edit:${op}:${sourceUrl}:${editPrompt}`, "", "");
    const dupId = await findInflightByFingerprint(pbUrl, adminToken, fingerprint);
    if (dupId) return Response.json({ success: true, jobId: dupId, status: "pending", deduped: true }, { status: 202 });

    const body = EDIT_OP_SPECS[op].buildBody(sourceUrl, editPrompt);

    const appBase = process.env.NEXT_PUBLIC_APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    const webhookUrl = buildWebhookUrl(appBase);

    const submission = await submitPrediction(slug, body, webhookUrl);
    const predictionId = submission.id ?? submission.request_id ?? "";

    const jobId = await createJob(pbUrl, adminToken, {
      user: userId, kind, model: slug, prompt: editPrompt, aspect_ratio: "", prediction_id: predictionId,
      fingerprint, tier, credit_weight: creditWeight, muapi_model: slug,
    });
    if (!jobId) return Response.json({ error: "Could not start the edit" }, { status: 502 });

    const immediateUrl = tryExtractOutputUrl(submission);
    if (immediateUrl) {
      const job: GenJob = { id: jobId, user: userId, kind, status: "pending", model: slug, prediction_id: predictionId, tier, credit_weight: creditWeight, muapi_model: slug };
      const done = await completeJob(pbUrl, adminToken, job, immediateUrl, superAdmin);
      return Response.json({ success: true, jobId, status: "completed", url: done.url, op, remaining: done.remaining, ...(done.creditWarning ? { creditWarning: done.creditWarning } : {}) });
    }

    return Response.json({ success: true, jobId, status: "pending", op }, { status: 202 });
  } catch (err) {
    console.error("Edit route error:", err);
    const msg = err instanceof Error ? err.message : "Failed to edit";
    return Response.json({ error: "Edit failed", detail: msg }, { status: 502 });
  }
}
