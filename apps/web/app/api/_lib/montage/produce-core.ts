/**
 * P3 — shared Studio production core, extracted so the interactive route
 * (/api/montage/produce) and the scheduled worker (campaign runner) start
 * renders through ONE identical path: vault outro → spec → project →
 * render job → generation_jobs ledger row (webhook + grader + bell all
 * downstream, unchanged).
 */

import { getAdminToken, pbUrl, pbEscape } from "../pb";
import { createProject, startRenderProps } from "../integrations/montage/client";
import { buildEditDecisions } from "./spec";
import { createJob, fingerprintFor } from "../generation/jobs";

export type ProduceResult =
  | { ok: true; ledgerId: string; montageJob: string; projectId: string }
  | { ok: false; error: "script_unparseable" | "ledger_write_failed" | "studio_unavailable" };

export async function produceStudioVideo(input: {
  userId: string;
  script: string;
  title: string;
  tier: string;
}): Promise<ProduceResult> {
  const token = await getAdminToken();
  const pb = pbUrl();

  // The owner's mark: branded outro from the vault (best-effort).
  let outroText = "";
  try {
    const bizRes = await fetch(
      `${pb}/api/collections/businesses/records?filter=${encodeURIComponent(`(user='${pbEscape(input.userId)}')`)}&perPage=1&fields=business_name`,
      { headers: { Authorization: token } },
    );
    if (bizRes.ok) {
      const biz = (await bizRes.json()) as { items?: Array<{ business_name?: string }> };
      outroText = (biz.items?.[0]?.business_name ?? "").trim();
    }
  } catch { /* outro is optional */ }

  const spec = buildEditDecisions(input.script, input.title, { outroText });
  if (!spec) return { ok: false, error: "script_unparseable" };

  try {
    const projectId = await createProject(input.title);
    const montageJob = await startRenderProps(projectId, spec);
    const ledgerId = await createJob(pb, token, {
      user: input.userId,
      kind: "video",
      model: "staffd-studio",
      prompt: `${input.title}\n\n${input.script.slice(0, 1500)}`,
      aspect_ratio: "9:16",
      prediction_id: montageJob,
      fingerprint: fingerprintFor(input.userId, "video", input.script, "9:16", montageJob),
      tier: input.tier,
      credit_weight: 0, // S5 cost accounting
    });
    if (!ledgerId) return { ok: false, error: "ledger_write_failed" };
    return { ok: true, ledgerId, montageJob, projectId };
  } catch (err) {
    console.error("[produce-core]", err);
    return { ok: false, error: "studio_unavailable" };
  }
}
