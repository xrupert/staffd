/**
 * POST /api/integrations/muapi
 * Body: { userId, kind: "image" | "video", prompt: string, aspectRatio?: string, model?: string }
 *
 * Generates images or video via Muapi.ai's unified API gateway. Smart-routes
 * to the best model for the task based on prompt content, then charges
 * one credit of the matching kind on success.
 *
 * Requires MUAPI_API_KEY env var. Optional MUAPI_URL (defaults to
 * https://api.muapi.ai).
 *
 * PR-Tranche-1.7 (W16 vendor reconnect) — Muapi reworked their API.
 * Changes vs. legacy:
 *   - Auth header: `x-api-key: <key>` (was `Authorization: Bearer <key>`)
 *   - Request body: FLAT JSON (was `{ input: { ... } }` envelope)
 *   - Model catalog: see routeImageModel / routeVideoModel below
 *   - Output URL: try `outputs[0]` → `url` → `output.url` in that order
 */

import Anthropic from "@anthropic-ai/sdk";
import { getCreditState } from "../../_lib/credits";
import { trySuperAdminByUserId } from "../../_lib/auth/super-admin";
import { getAdminToken } from "../../_lib/pb";
import { submitPrediction, tryExtractOutputUrl, buildWebhookUrl } from "../../_lib/integrations/muapi/predictions";
import { createJob, completeJob, fingerprintFor, findInflightByFingerprint, type GenJob } from "../../_lib/generation/jobs";

const anthropic = new Anthropic();

// W91 — muapi is STAFFD's PLATFORM image/video credit gateway (billed in
// credits), NOT a per-customer integration. It deliberately reads the
// operator/platform key from env and is NOT routed through resolveCredentials.
// Do NOT add "muapi" to the IntegrationType enum or move this to per-user creds
// — customers never bring their own muapi key. (The Muapi base URL + HTTP now
// live in _lib/integrations/muapi/predictions.ts.)
const MUAPI_KEY = process.env.MUAPI_API_KEY ?? "";

/**
 * Universal prompt ENRICHMENT — the boundary step in our 3-Layer Briefing Flow.
 *
 * Different specialists produce different artifacts. The Image Prompt Engineer
 * produces a Layer-2 dense prompt directly (100-300 words, all the modifiers,
 * ready to render). But Visual Storyteller produces a full layout brief, Brand
 * Guardian produces a brand spec, etc. None of those go to the model verbatim.
 *
 * This step takes whatever the specialist wrote and ENRICHES it into a
 * Layer-2-quality dense prompt. We never compress, simplify, or "distill" the
 * intent away — we add the dense visual modifiers needed for an extraordinary
 * render while preserving every strategic choice the specialist made.
 *
 * Heuristic skip: if the input is already a Layer-2 dense prompt (looks like
 * one — 80-400 words, no markdown structure, reads as continuous visual
 * description), pass through. Otherwise enrich.
 */
function needsEnrichment(text: string): boolean {
  // Structured artifacts (briefs, specs, layouts) need enrichment
  if (/^#{1,3}\s|##\s|\*\*[A-Z][A-Z\s]+:/m.test(text)) return true;
  if (/LAYOUT SPEC|COLOR DIRECTION|DESIGNER NOTES|VISUAL HIERARCHY|TYPOGRAPHY HIERARCHY|BRAND GUIDELINES|CORE CONCEPT/i.test(text)) return true;
  if (/PROMPT \d|VARIATION \d/i.test(text)) return true;
  // Long structured documents
  if (text.length > 1500) return true;
  if (text.split("\n").filter(l => l.trim()).length > 10) return true;
  // Very short input — barely a prompt, needs enrichment to flesh out
  if (text.length < 120) return true;
  return false;
}

async function enrichToPrompt(rawInput: string, kind: "image" | "video"): Promise<string> {
  if (!needsEnrichment(rawInput)) return rawInput.trim();

  const mediumWord = kind === "image" ? "image" : "video";
  const systemPrompt = `You are STAFFD's prompt enricher. You receive creative briefs, strategy docs, layout specs, or raw user requests and turn them into a single DENSE, SOPHISTICATED ${mediumWord} generation prompt of 100-300 words that produces extraordinary output.

YOU NEVER COMPRESS OR SIMPLIFY. You ENRICH. Every strategic choice in the source must survive into the prompt, plus you add the dense visual modifiers needed for a stunning render.

WHAT TO INCLUDE — ALL AXES, SPECIFIC TO THE SOURCE:
- Subject with specific details (age, expression, clothing, posture, what they're doing)
- Setting with specific details (location, era, time of day, atmosphere)
- Framing and composition (wide / medium / close, angle, depth of field, rule of thirds, etc.)
- Lighting — direction, quality, color temperature, contrast, time of day
- Mood (single specific word — heroic, intimate, foreboding, jubilant, etc.)
- Medium and style (oil painting / photography / 3D render / editorial illustration / propaganda poster, etc.)
- Multiple style references where they unlock fidelity (Norman Rockwell, Wes Anderson palette, Pixar 3D, Annie Leibovitz portraiture, vintage propaganda, etc.)
- Specific palette / color anchors
- Texture and material detail
- Lens and camera notes when photoreal (35mm, shallow depth of field, golden hour, etc.)
- For ${mediumWord} with text: write the actual text in quotes, specify typography style and exact placement (lower-third banner, diagonal sash, top-left, etc.)

WHAT YOU MUST NEVER DO:
- Never strip detail to "make it shorter."
- Never mention any external platform or model name.
- Never include negative prompts or aspect ratio flags (--ar 16:9 etc.).
- Never write "Here's the prompt" or any preamble.
- Never use markdown, bullet lists, or section headers — produce continuous prose suitable to send to an image model.

If the source contains text-on-${mediumWord} (quoted lines, "reading", "saying", overlay text, headlines), include it in your prompt with typography style and placement preserved.

Output ONLY the dense enriched prompt. Nothing else.`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: rawInput }],
    });
    const block = msg.content[0];
    const enriched = block?.type === "text" ? block.text.trim() : "";
    // Only use enriched output if it's substantially dense (not a refusal)
    return (enriched.length > 80) ? enriched : rawInput.trim();
  } catch {
    return rawInput.trim();
  }
}

const VALID_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "4:5", "2:3"]);

/**
 * Smart aspect-ratio auto-selection (PR-T2 / Decision 8).
 *
 * The user shouldn't need to know "what aspect ratio do I pick for TikTok."
 * The application does. Called from the POST handler when the client either
 * omits aspectRatio OR sends a value we want to override based on prompt
 * content (operator-supplied explicit ratios always win — but the empty/
 * default case gets the smart pick instead of always defaulting to 1:1).
 *
 * Heuristic order (first match wins):
 *   1. Vertical platforms — TikTok / Reels / Shorts / Stories       → 9:16
 *   2. Landscape video / YouTube long-form / hero banner / blog hdr → 16:9
 *   3. Pinterest / poster / flyer / portrait                        → 2:3
 *   4. Instagram feed / square / album cover                        → 1:1
 *   5. Cinema / film still / ultrawide                              → 21:9
 *   6. Editorial / magazine layout                                  → 4:5
 *   7. Default — 1:1 for images, 16:9 for videos
 */
export function resolveAspectRatio(
  kind: "image" | "video",
  explicitRatio: string | undefined,
  prompt: string,
): string {
  // Operator-supplied valid ratio always wins
  if (explicitRatio && VALID_RATIOS.has(explicitRatio)) return explicitRatio;

  const p = (prompt ?? "").toLowerCase();

  // 1. Vertical / 9:16 platforms
  // Note: bare "story" is intentionally NOT a trigger ("brand story" etc.
  // are common non-platform phrases). Require platform-prefixed "stories"
  // or "fb/ig story" to capture the platform intent.
  if (/\b(tiktok|tik\s*tok|instagram\s*reel|reels?|instagram\s*stor(?:y|ies)|fb\s*stor(?:y|ies)|stories|youtube\s*shorts?|vertical|portrait\s*video|9:16)\b/.test(p)) {
    return "9:16";
  }
  // 2. Landscape video / wide hero
  if (/\b(youtube|landscape\s*video|hero\s*banner|hero\s*image|blog\s*header|website\s*header|16:9|widescreen|thumbnail)\b/.test(p)) {
    return "16:9";
  }
  // 3. Pinterest / poster / flyer / 2:3 portrait
  if (/\b(pinterest|pin|poster|flyer|book\s*cover|portrait\s*photo|2:3)\b/.test(p)) {
    return "2:3";
  }
  // 4. Instagram feed / square / album
  if (/\b(instagram\s*post|instagram\s*feed|square|album|profile\s*pic|avatar|1:1)\b/.test(p)) {
    return "1:1";
  }
  // 5. Cinema / ultrawide
  if (/\b(cinema|cinematic\s*aspect|film\s*still|ultrawide|panoramic|21:9)\b/.test(p)) {
    return "21:9";
  }
  // 6. Editorial / magazine
  if (/\b(magazine|editorial\s*layout|portrait\s*layout|4:5)\b/.test(p)) {
    return "4:5";
  }

  // 7. Default per medium
  return kind === "video" ? "16:9" : "1:1";
}

/**
 * Smart image model routing — pick the best Muapi endpoint for the prompt.
 *
 * Catalog snapshot: 2026-06-04 from Muapi reference (Open-Generative-AI
 * models.js). Refresh via docs/operator-runbooks/muapi-vendor-drift.md when
 * generation starts returning 4xx.
 *
 * Premium-only per Decision 3 — no *-fast-*, no *-lite-* variants.
 *
 *   1. ideogram-v3-t2i           — best for legible text-in-image (quoted
 *                                  strings, headlines, lettering, logo
 *                                  lockups, typography callouts)
 *   2. midjourney-v7-text-to-image — cinematic/editorial/magazine aesthetic
 *   3. flux-dev-image            — default premium photoreal + illustration
 */
function routeImageModel(prompt: string, requested?: string): string {
  if (requested) return requested;
  const p = prompt.toLowerCase();

  // Heavy text-in-image — text in quotes OR lettering/typography vocabulary
  const hasQuotedText = /"[^"]{2,}"|'[^']{3,}'/.test(prompt);
  const textKeywords = /\b(text|words|quote|saying|reading|overlay|headline|title text|caption text|sign that says|label|propaganda poster|banner|typography|sub.?head|lettering|logo lockup)\b/.test(p);
  if (hasQuotedText || textKeywords) {
    return "ideogram-v3-t2i";
  }

  // Cinematic / editorial / magazine — Midjourney aesthetic
  if (/\b(cinematic|editorial|magazine|fashion shoot|film still|moody|atmospheric|noir)\b/.test(p)) {
    return "midjourney-v7-text-to-image";
  }

  // Default premium photoreal + illustration
  return "flux-dev-image";
}

/**
 * Smart video model routing — premium-only catalog.
 *
 * Catalog snapshot: 2026-06-04 from Muapi reference. Decision 3 (premium-only)
 * applies: no *-fast-* variants.
 *
 *   1. veo3-text-to-video                — default premium cinematic
 *   2. openai-sora-2-pro-text-to-video   — explicit Sora preference / "best"
 *   3. runway-text-to-video              — named backup per Decision 3
 *                                          ("graceful degradation")
 */
function routeVideoModel(prompt: string, requested?: string): string {
  if (requested) return requested;
  const p = prompt.toLowerCase();

  // Explicit Sora preference or "best"/"premium"/"highest quality"
  if (/\b(sora|best quality|premium quality|highest quality|highest fidelity)\b/.test(p)) {
    return "openai-sora-2-pro-text-to-video";
  }

  // Default premium cinematic
  return "veo3-text-to-video";
}

// W95.7.3b — PredictionResult / tryExtractOutputUrl / submitPrediction moved to
// _lib/integrations/muapi/predictions.ts (llm-free, shared with the status poll).
// The 60s server-side pollResult loop is DELETED — generation is now async:
// POST submits + returns a jobId, the client polls /api/generation/[id]/status.

export async function POST(req: Request) {
  if (!MUAPI_KEY) {
    return Response.json(
      {
        error: "not_configured",
        message:
          "Image / video generation is not set up yet. Add MUAPI_API_KEY to your environment variables.",
      },
      { status: 503 }
    );
  }

  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const { userId, kind, prompt, aspectRatio, model } = (await req.json()) as {
      userId: string;
      kind: "image" | "video";
      prompt: string;
      aspectRatio?: string;
      model?: string;
    };

    if (!userId)           return Response.json({ error: "userId required" }, { status: 400 });
    if (kind !== "image" && kind !== "video") return Response.json({ error: "kind must be 'image' or 'video'" }, { status: 400 });
    if (!prompt?.trim())   return Response.json({ error: "prompt is required" }, { status: 400 });

    // Decision 74 — super-admin bypass. If caller is super-admin: skip the
    // credit pre-flight gate entirely (they have no quota). The actual
    // bypass + logging happens at the spend site below.
    const superAdmin = await trySuperAdminByUserId(userId);

    // Pre-flight credit check — fast reject before we hit Muapi.
    // Super-admin skips this gate.
    const preState = superAdmin ? null : await getCreditState(pbUrl, userId);
    if (preState && preState.totalRemaining[kind] < 1) {
      return Response.json(
        {
          error: "out_of_credits",
          message: `You're out of ${kind} credits for the month. Top up or promote your plan to keep going.`,
          remaining: preState.totalRemaining[kind],
          monthly: preState.monthlyAllowance[kind],
          plan: preState.plan,
        },
        { status: 402 }
      );
    }

    // PR-T2 / Decision 8 — smart aspect-ratio auto-selection. The user
    // shouldn't need to know what ratio fits TikTok vs YouTube. Explicit
    // operator-supplied value (when valid) still wins.
    const ratio = resolveAspectRatio(kind, aspectRatio, prompt);

    let adminToken: string;
    try { adminToken = await getAdminToken(); } catch { return Response.json({ error: "Service unavailable" }, { status: 503 }); }

    // W95.7.3c-b1 — submit-time dedup (margin protection: Muapi debits on
    // completion, so duplicate submits = duplicate spend). A matching PENDING
    // job within the in-flight window is reused — BEFORE the enrich (Anthropic)
    // and the Muapi submit, saving both. Succeeded jobs never dedupe (a repeat
    // prompt is a legitimate re-generation). Fingerprint omits model (it's
    // deterministic from kind+prompt) so it can be computed pre-enrich.
    const fingerprint = fingerprintFor(userId, kind, prompt, ratio);
    const dupId = await findInflightByFingerprint(pbUrl, adminToken, fingerprint);
    if (dupId) {
      return Response.json({ success: true, jobId: dupId, status: "pending", deduped: true }, { status: 202 });
    }

    // Enrich the input into a Layer-2 dense prompt (the 3-Layer Briefing Flow
    // boundary step). Specialists may produce strategic briefs, layout specs,
    // or full prompts — this elevates them all to the sophistication needed
    // for extraordinary renders. Never compresses; only enriches.
    const focusedPrompt = await enrichToPrompt(prompt, kind);

    const modelEndpoint = kind === "image"
      ? routeImageModel(focusedPrompt, model)
      : routeVideoModel(focusedPrompt, model);

    // PR-Tranche-1.7 — flat body. Fields at root, no { input: {...} } wrapper.
    const body: Record<string, unknown> = {
      prompt: focusedPrompt,
      aspect_ratio: ratio,
    };
    if (kind === "video") {
      body.duration = 5;
      body.resolution = "1080p";
    } else {
      body.output_format = "png";
      body.output_quality = 95;
    }

    // W95.7.3c-b1 — register a completion webhook (push delivery) when a
    // MUAPI_WEBHOOK_SECRET is configured; closes the closed-tab leak by
    // charging on completion even if the client is gone. Null (no secret) →
    // pure client-poll fallback (W95.7.3b behaviour).
    const appBase = process.env.NEXT_PUBLIC_APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    const webhookUrl = buildWebhookUrl(appBase);

    const submission = await submitPrediction(modelEndpoint, body, webhookUrl);
    const predictionId = submission.id ?? submission.request_id ?? "";

    // W95.7.3b — ASYNC. Persist a generation_jobs row, then return immediately:
    // the client polls GET /api/generation/[id]/status (webhook is primary). The
    // `prediction_id` lets any later poll/webhook resolve; `fingerprint` dedupes.
    const jobId = await createJob(pbUrl, adminToken, {
      user: userId, kind, model: modelEndpoint, prompt: focusedPrompt, aspect_ratio: ratio, prediction_id: predictionId, fingerprint,
    });
    if (!jobId) return Response.json({ error: "Could not start generation" }, { status: 502 });

    // FAST PATH — some models (typically images) return the URL on submit.
    // Charge + complete now (claim-first idempotent) and deliver immediately.
    const immediateUrl = tryExtractOutputUrl(submission);
    if (immediateUrl) {
      const job: GenJob = { id: jobId, user: userId, kind, status: "pending", model: modelEndpoint, prediction_id: predictionId };
      const done = await completeJob(pbUrl, adminToken, job, immediateUrl, superAdmin);
      return Response.json({
        success: true, jobId, status: "completed",
        url: done.url, model: modelEndpoint, promptUsed: focusedPrompt,
        remaining: done.remaining, ...(done.creditWarning ? { creditWarning: done.creditWarning } : {}),
      });
    }

    // PENDING — the client polls /api/generation/[jobId]/status (no charge yet).
    return Response.json(
      { success: true, jobId, status: "pending", model: modelEndpoint, promptUsed: focusedPrompt },
      { status: 202 },
    );
  } catch (err) {
    console.error("Muapi route error:", err);
    const msg = err instanceof Error ? err.message : "Failed to generate";
    return Response.json({ error: "Generation failed", detail: msg }, { status: 502 });
  }
}

// Exported for tests in apps/web/__tests__/integrations/muapi-route.test.ts.
// tryExtractOutputUrl + submitPrediction now live in
// _lib/integrations/muapi/predictions.ts; re-exported here so existing tests
// that reach them via __test keep working.
export const __test = {
  routeImageModel,
  routeVideoModel,
  tryExtractOutputUrl,
  submitPrediction,
};
