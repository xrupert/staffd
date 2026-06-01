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

const anthropic = new Anthropic();

const MUAPI_URL = (process.env.MUAPI_URL ?? "https://api.muapi.ai").replace(/\/$/, "");
const MUAPI_KEY = process.env.MUAPI_API_KEY ?? "";

/**
 * Universal prompt distillation. Specialists across STAFFD produce all sorts of
 * outputs — focused image prompts, multi-section creative briefs, layout specs,
 * brand guidelines, marketing concepts. Image models can only handle dense
 * 2-4 sentence visual descriptions. This step extracts a clean, focused prompt
 * from whatever the specialist wrote so the model always gets exactly what it
 * needs to render well.
 *
 * Heuristic: if the input is already short (< 400 chars) and reads like a prompt
 * (no markdown headers, no bulleted lists, no LAYOUT SPEC / COLOR DIRECTION
 * sections), skip distillation to save the call.
 */
function needsDistillation(text: string, kind: "image" | "video"): boolean {
  if (text.length > 600) return true;
  // Detect structured doc markers — these signal a brief, not a prompt
  if (/^#{1,3}\s|##\s|\*\*[A-Z]/m.test(text)) return true;
  if (/LAYOUT SPEC|COLOR DIRECTION|DESIGNER NOTES|VISUAL HIERARCHY|TYPOGRAPHY|BRAND GUIDELINES/i.test(text)) return true;
  if (/PROMPT \d|VARIATION \d/i.test(text)) return true;
  if (text.split("\n").length > 8) return true;
  return false;
}

async function distillToPrompt(rawInput: string, kind: "image" | "video"): Promise<string> {
  if (!needsDistillation(rawInput, kind)) return rawInput.trim();

  const mediumWord = kind === "image" ? "image" : "video";
  const systemPrompt = `You convert creative briefs, strategy docs, and visual specifications into a single dense ${mediumWord} generation prompt suitable for an AI ${mediumWord} model.

OUTPUT RULES:
- ONE prompt only. 2-5 sentences. No more.
- Visually specific: subject, setting, lighting, mood, style, medium.
- If the source mentions text-on-${mediumWord}, include the text in quotes with typography and placement specs.
- If source describes a layout (infographic, poster, slide), describe it as a visual composition with concrete visual elements.
- Never mention Midjourney, DALL-E, Stable Diffusion, Flux, Kling, or any platform name.
- Never include negative prompts or aspect ratio flags.
- Never write "Here's the prompt" or any preamble.
- Just the prompt itself. Nothing else.`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: rawInput }],
    });
    const block = msg.content[0];
    const distilled = block?.type === "text" ? block.text.trim() : "";
    return distilled || rawInput.trim();
  } catch {
    // Fall back to the raw input if distillation fails — better to try
    // generating with imperfect input than to fail entirely
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

    // Pre-flight credit check — fast reject before we hit Muapi
    const preState = await getCreditState(pbUrl, userId);
    if (preState.totalRemaining[kind] < 1) {
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

    // Distill the input down to a focused prompt the model can render well.
    // Specialists may produce strategic briefs, layout specs, or full prompts —
    // this normalizes them all into something the image/video model handles.
    const focusedPrompt = await distillToPrompt(prompt, kind);

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

    // Charge credit only on success
    const spend = await spendCredits(pbUrl, userId, kind, 1);
    if (!spend.ok) {
      // Edge case — credits ran out between pre-check and now. Still return
      // the result since we already produced it, but flag the issue.
      return Response.json({
        success: true,
        url: resultUrl,
        model: modelEndpoint,
        creditWarning: "Credit charge failed — please contact support.",
      });
    }

    return Response.json({
      success: true,
      url: resultUrl,
      model: modelEndpoint,
      promptUsed: focusedPrompt,
      remaining: spend.remaining,
    });
  } catch (err) {
    console.error("Muapi route error:", err);
    const msg = err instanceof Error ? err.message : "Failed to generate";
    return Response.json({ error: "Generation failed", detail: msg }, { status: 502 });
  }
}
