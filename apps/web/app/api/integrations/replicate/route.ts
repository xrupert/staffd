/**
 * POST /api/integrations/replicate
 * Body: { prompt: string, aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" }
 *
 * Generates an image from a text prompt via Replicate's Flux Schnell model
 * (fast, ~$0.003 per image). Uses the synchronous wait API so we return when
 * the image is ready instead of having the client poll.
 *
 * Requires REPLICATE_API_TOKEN env var.
 */

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN ?? "";

// Flux Schnell — fast, cheap, high quality. Owner/version pinning keeps results
// deterministic across model updates.
const MODEL = "black-forest-labs/flux-schnell";

const VALID_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"]);

export async function POST(req: Request) {
  if (!REPLICATE_TOKEN) {
    return Response.json(
      {
        error: "not_configured",
        message:
          "Image generation is not set up yet. Sign up at replicate.com, add a payment method (~$0.003 per image), grab an API token, and add REPLICATE_API_TOKEN to your environment.",
      },
      { status: 503 }
    );
  }

  try {
    const { prompt, aspectRatio = "1:1" } = (await req.json()) as {
      prompt: string;
      aspectRatio?: string;
    };

    if (!prompt?.trim()) {
      return Response.json({ error: "prompt is required" }, { status: 400 });
    }

    const ratio = VALID_RATIOS.has(aspectRatio) ? aspectRatio : "1:1";

    // Replicate's wait-mode API: returns when the prediction completes, up to
    // 60 seconds. Flux Schnell typically finishes in 1-3 seconds.
    const res = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait=55",
      },
      body: JSON.stringify({
        input: {
          prompt: prompt.trim(),
          aspect_ratio: ratio,
          num_outputs: 1,
          output_format: "png",
          output_quality: 90,
          go_fast: true,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return Response.json(
        { error: "Replicate error", detail: detail.slice(0, 500) },
        { status: 502 }
      );
    }

    const data = (await res.json()) as {
      id: string;
      status: string;
      output?: string[] | string;
      error?: string;
      urls?: { get?: string };
    };

    // If the model finished within the wait window, output will be set
    if (data.status === "succeeded") {
      const url = Array.isArray(data.output) ? data.output[0] : data.output;
      if (!url) {
        return Response.json({ error: "No image returned" }, { status: 502 });
      }
      return Response.json({ success: true, imageUrl: url, predictionId: data.id });
    }

    // If still processing past the wait window, return the prediction id so
    // the client could poll (rare for Flux Schnell)
    if (data.status === "processing" || data.status === "starting") {
      return Response.json(
        {
          success: false,
          status: "processing",
          predictionId: data.id,
          pollUrl: data.urls?.get ?? null,
          message: "Image is still rendering. Try again in a few seconds.",
        },
        { status: 202 }
      );
    }

    return Response.json(
      { error: "Image generation failed", detail: data.error ?? data.status },
      { status: 502 }
    );
  } catch (err) {
    console.error("Replicate route error:", err);
    return Response.json({ error: "Failed to generate image" }, { status: 500 });
  }
}
