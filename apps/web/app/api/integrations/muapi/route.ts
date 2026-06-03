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
 */

import Anthropic from "@anthropic-ai/sdk";
import { spendCredits, getCreditState } from "../../_lib/credits";
import { trySuperAdminByUserId } from "../../_lib/auth/super-admin";
import { logSuperAdminUsage } from "../../_lib/auth/super-admin-logging";

const anthropic = new Anthropic();

const MUAPI_URL = (process.env.MUAPI_URL ?? "https://api.muapi.ai").replace(/\/$/, "");
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
- Never mention Midjourney, DALL-E, Stable Diffusion, Flux, Kling, or any platform name.
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

const VALID_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"]);

/** Smart model routing — pick the best model for the prompt's content. */
function routeImageModel(prompt: string, requested?: string): string {
  if (requested) return requested;
  const p = prompt.toLowerCase();

  // ANY readable text in the image → Ideogram (best at rendering legible words)
  // Detects: text in quotes, "reading", "saying", "overlay text", "typography",
  // "poster", "banner", "headline", "title", "caption", "label", etc.
  const hasQuotedText = /"[^"]{2,}"|'[^']{3,}'/.test(prompt); // text in quotes
  const textKeywords = /\b(text|words|quote|saying|reading|overlay|headline|title text|caption text|sign that says|label|propaganda poster|banner|typography|sub.?head)\b/.test(p);
  if (hasQuotedText || textKeywords) {
    return "ideogram-v3";
  }

  // Logos, brand marks, UI mockups → Recraft (best for clean typography and vector-style)
  if (/\b(logo|brand mark|wordmark|app icon|ui mockup|interface|app screen|wireframe)\b/.test(p)) {
    return "recraft-v3";
  }

  // Default — Flux Pro handles most photoreal + illustration excellently
  return "flux-pro-1.1";
}

function routeVideoModel(prompt: string, requested?: string): string {
  if (requested) return requested;
  // Cinematic / dramatic / photoreal → Kling Pro
  const p = prompt.toLowerCase();
  if (/\b(cinematic|dramatic|slow motion|epic|hollywood|trailer)\b/.test(p)) {
    return "kling-pro";
  }
  // Default — Hunyuan handles general motion well at a lower cost
  return "hunyuan-video";
}

interface PredictionResult {
  id?: string;
  request_id?: string;
  status?: string;
  output?: string | string[];
  result?: { url?: string; urls?: string[] };
  url?: string;
  error?: string;
}

async function submitPrediction(
  modelEndpoint: string,
  input: Record<string, unknown>
): Promise<PredictionResult> {
  const url = `${MUAPI_URL}/api/v1/${modelEndpoint}`;
  console.log("[muapi] submitting", { url, model: modelEndpoint });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MUAPI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error("[muapi] submit failed", { status: res.status, url, detail: detail.slice(0, 500) });
    throw new Error(`Muapi ${res.status} on ${modelEndpoint}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as PredictionResult;
}

async function pollResult(predictionId: string, maxAttempts = 30): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${MUAPI_URL}/api/v1/predictions/${predictionId}/result`, {
      headers: { Authorization: `Bearer ${MUAPI_KEY}` },
    });
    if (!res.ok) continue;
    const data = (await res.json()) as PredictionResult;

    if (data.status === "succeeded" || data.status === "completed") {
      // Output shape varies — handle multiple common formats
      if (typeof data.output === "string") return data.output;
      if (Array.isArray(data.output) && data.output[0]) return data.output[0];
      if (data.result?.url) return data.result.url;
      if (data.result?.urls?.[0]) return data.result.urls[0];
      if (data.url) return data.url;
    }
    if (data.status === "failed") {
      throw new Error(data.error ?? "Generation failed");
    }
  }
  return null;
}

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
    const { userId, kind, prompt, aspectRatio = "1:1", model } = (await req.json()) as {
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

    const ratio = VALID_RATIOS.has(aspectRatio) ? aspectRatio : "1:1";

    // Enrich the input into a Layer-2 dense prompt (the 3-Layer Briefing Flow
    // boundary step). Specialists may produce strategic briefs, layout specs,
    // or full prompts — this elevates them all to the sophistication needed
    // for extraordinary renders. Never compresses; only enriches.
    const focusedPrompt = await enrichToPrompt(prompt, kind);

    const modelEndpoint = kind === "image"
      ? routeImageModel(focusedPrompt, model)
      : routeVideoModel(focusedPrompt, model);

    const input: Record<string, unknown> = {
      prompt: focusedPrompt,
      aspect_ratio: ratio,
    };
    if (kind === "video") {
      input.duration = 5;
      input.resolution = "1080p";
    } else {
      input.output_format = "png";
      input.output_quality = 95;
    }

    const submission = await submitPrediction(modelEndpoint, input);
    const predictionId = submission.id ?? submission.request_id;

    // Some Muapi models return synchronously on submit
    let resultUrl: string | null = null;
    if (typeof submission.output === "string") resultUrl = submission.output;
    else if (Array.isArray(submission.output)) resultUrl = submission.output[0] ?? null;
    else if (submission.result?.url) resultUrl = submission.result.url;
    else if (predictionId) resultUrl = await pollResult(predictionId);

    if (!resultUrl) {
      return Response.json({ error: "Generation timed out", predictionId }, { status: 504 });
    }

    // Decision 74 — super-admin bypass at billing tier. Log usage instead
    // of charging credits. Comped users (jrw-solutions) still hit
    // spendCredits normally (they have 100× allowance) — super-admin is a
    // distinct tier above comp.
    let remainingCredits: number | "unlimited" = "unlimited";
    if (superAdmin) {
      void logSuperAdminUsage(superAdmin, "muapi_generation", {
        operation_detail: `${kind} via ${modelEndpoint}`,
        parameters: { kind, prompt_chars: prompt.length, aspectRatio: ratio, model },
      });
    } else {
      // Charge credit only on success
      const spend = await spendCredits(pbUrl, userId, kind, 1);
      if (!spend.ok) {
        // Edge case — credits ran out between pre-check and now. Still
        // return the result since we already produced it, but flag the
        // issue.
        return Response.json({
          success: true,
          url: resultUrl,
          model: modelEndpoint,
          creditWarning: "Credit charge failed — please contact support.",
        });
      }
      remainingCredits = spend.remaining;
    }

    return Response.json({
      success: true,
      url: resultUrl,
      model: modelEndpoint,
      promptUsed: focusedPrompt,
      remaining: remainingCredits,
    });
  } catch (err) {
    console.error("Muapi route error:", err);
    const msg = err instanceof Error ? err.message : "Failed to generate";
    return Response.json({ error: "Generation failed", detail: msg }, { status: 502 });
  }
}
