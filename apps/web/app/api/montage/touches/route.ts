/**
 * S4b — Finishing Touches (the participation moment).
 *
 * GET  ?jobId=<ledger id>  → the scene breakdown of a finished Studio render
 *                            (parsed from the job's stored script) so the UI
 *                            can offer per-scene text edits + the outro.
 * POST { jobId, outroText?, textOverrides? }
 *                          → re-render the SAME script with the user's edits
 *                            through the shared produce path. Returns the new
 *                            ledger jobId; the caller polls it like any
 *                            generation (webhook + grader + bell unchanged).
 *
 * The preview is STAFFD-built end to end — no OpenMontage composer imports
 * (AGPL covered-work boundary). The service is only ever spoken to over HTTP.
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { getAdminToken, pbUrl } from "../../_lib/pb";
import { getJob } from "../../_lib/generation/jobs";
import { montageConfigured } from "../../_lib/integrations/montage/client";
import { parseBeats } from "../../_lib/montage/spec";
import { produceStudioVideo } from "../../_lib/montage/produce-core";

const STUDIO_MODEL = "staffd-studio";

/** The ledger stores `${title}\n\n${script}` — split it back apart. */
export function splitPrompt(prompt: string): { title: string; script: string } {
  const idx = prompt.indexOf("\n\n");
  if (idx === -1) return { title: "Your video", script: prompt };
  return { title: prompt.slice(0, idx).trim() || "Your video", script: prompt.slice(idx + 2) };
}

export type TouchScene = {
  index: number;
  label: string;
  text: string;
  startS?: number;
  endS?: number;
  type: "hero_title" | "callout" | "text_card";
};

export function scenesFromScript(script: string): TouchScene[] {
  return parseBeats(script).map((b, i) => ({
    index: i,
    label: b.label,
    text: (b.onScreen ?? b.text).slice(0, 140),
    startS: b.startS,
    endS: b.endS,
    type: (/hook/i.test(b.label) && i === 0 ? "hero_title" : /cta|close/i.test(b.label) ? "callout" : "text_card") as TouchScene["type"],
  }));
}

async function loadOwnedStudioJob(req: Request, jobId: string) {
  const me = await whoAmI(req);
  if (!me) return { status: 401 as const };
  const pb = pbUrl();
  const token = await getAdminToken();
  const job = await getJob(pb, token, jobId);
  if (!job || job.user !== me.id) return { status: 404 as const };
  if (job.model !== STUDIO_MODEL) return { status: 422 as const };
  return { status: 200 as const, me, job };
}

export async function GET(req: Request) {
  if (!montageConfigured()) return Response.json({ error: "montage_not_configured" }, { status: 503 });
  const jobId = new URL(req.url).searchParams.get("jobId") ?? "";
  if (!jobId) return Response.json({ error: "job_required" }, { status: 400 });

  const loaded = await loadOwnedStudioJob(req, jobId);
  if (loaded.status !== 200) return Response.json({ error: "not_available" }, { status: loaded.status });

  const { script } = splitPrompt(loaded.job.prompt ?? "");
  const scenes = scenesFromScript(script);
  if (scenes.length === 0) return Response.json({ error: "script_unparseable" }, { status: 422 });

  // Current outro default — the vault's business name (same source the
  // original render used).
  let outroDefault = "";
  try {
    const token = await getAdminToken();
    const res = await fetch(
      `${pbUrl()}/api/collections/businesses/records?filter=${encodeURIComponent(`(user='${loaded.me.id}')`)}&perPage=1&fields=business_name`,
      { headers: { Authorization: token } },
    );
    if (res.ok) outroDefault = ((((await res.json()) as { items?: Array<{ business_name?: string }> }).items?.[0]?.business_name) ?? "").trim();
  } catch { /* optional */ }

  return Response.json({ ok: true, scenes, outroDefault });
}

export async function POST(req: Request) {
  if (!montageConfigured()) return Response.json({ error: "montage_not_configured" }, { status: 503 });

  let body: { jobId?: unknown; outroText?: unknown; textOverrides?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "").trim();
  if (!jobId) return Response.json({ error: "job_required" }, { status: 400 });

  const loaded = await loadOwnedStudioJob(req, jobId);
  if (loaded.status !== 200) return Response.json({ error: "not_available" }, { status: loaded.status });

  // Validate edits defensively — indexes must be ints, copy is length-capped.
  const textOverrides: Record<number, string> = {};
  if (body.textOverrides && typeof body.textOverrides === "object" && !Array.isArray(body.textOverrides)) {
    for (const [k, v] of Object.entries(body.textOverrides as Record<string, unknown>)) {
      const idx = Number.parseInt(k, 10);
      if (Number.isInteger(idx) && idx >= 0 && idx < 60 && typeof v === "string") {
        textOverrides[idx] = v.slice(0, 140);
      }
    }
  }
  const outroText = typeof body.outroText === "string" ? body.outroText.slice(0, 60) : undefined;

  const { title, script } = splitPrompt(loaded.job.prompt ?? "");
  const result = await produceStudioVideo({
    userId: loaded.me.id,
    script,
    title,
    tier: loaded.job.tier ?? "pro",
    touches: { outroText, textOverrides },
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.error === "studio_unavailable" ? 502 : 422 });
  }
  return Response.json({ ok: true, jobId: result.ledgerId, montageJob: result.montageJob });
}
