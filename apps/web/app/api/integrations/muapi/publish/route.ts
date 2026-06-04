/**
 * POST /api/integrations/muapi/publish
 * Body: {
 *   userId, platform: "tiktok"|"youtube"|"instagram",
 *   mediaUrl, caption?, hashtags?
 * }
 *
 * Publishes an already-generated image or video to a user's connected
 * social account via Muapi's publish endpoints. The user must have
 * connected the platform in their Muapi account first — STAFFD does not
 * handle the OAuth flow, Muapi does.
 *
 * Returns the platform post URL on success.
 */

// PR-Tranche-1.6 — Decision: URL env vars resolve via centralized helper.
// See apps/web/lib/env.ts. Empty-string env values are caught (the W8 footgun)
// and missing-scheme values throw at module load.
import { MUAPI_BASE_URL } from "../../../../../lib/env";
const MUAPI_URL = MUAPI_BASE_URL;
const MUAPI_KEY = process.env.MUAPI_API_KEY ?? "";

type Platform = "tiktok" | "youtube" | "instagram";

const PUBLISH_ENDPOINTS: Record<Platform, string> = {
  tiktok:    "tiktok-publish",
  youtube:   "youtube-publish",
  instagram: "instagram-publish",
};

interface PublishResponse {
  id?: string;
  request_id?: string;
  status?: string;
  url?: string;
  post_url?: string;
  result?: { url?: string; post_url?: string };
  error?: string;
}

async function pollPublishResult(predictionId: string, maxAttempts = 30): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${MUAPI_URL}/api/v1/predictions/${predictionId}/result`, {
      headers: { Authorization: `Bearer ${MUAPI_KEY}` },
    });
    if (!res.ok) continue;
    const data = (await res.json()) as PublishResponse;
    if (data.status === "succeeded" || data.status === "completed") {
      return data.url ?? data.post_url ?? data.result?.url ?? data.result?.post_url ?? null;
    }
    if (data.status === "failed") {
      throw new Error(data.error ?? "Publish failed");
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
          "Social publishing is not set up yet. Add MUAPI_API_KEY to your environment variables.",
      },
      { status: 503 }
    );
  }

  try {
    const { userId, platform, mediaUrl, caption, hashtags } = (await req.json()) as {
      userId: string;
      platform: Platform;
      mediaUrl: string;
      caption?: string;
      hashtags?: string[];
    };

    if (!userId) return Response.json({ error: "userId required" }, { status: 400 });
    if (!mediaUrl?.trim()) return Response.json({ error: "mediaUrl required" }, { status: 400 });
    const endpoint = PUBLISH_ENDPOINTS[platform];
    if (!endpoint) {
      return Response.json({ error: "platform must be tiktok | youtube | instagram" }, { status: 400 });
    }

    // Muapi publish endpoints — pass the user's identifier so Muapi resolves
    // which connected account to publish on behalf of. The exact field name
    // varies by their schema; we send a few common ones for resilience.
    const input: Record<string, unknown> = {
      media_url: mediaUrl,
      url: mediaUrl,
      caption: caption?.trim() ?? "",
      description: caption?.trim() ?? "",
      hashtags: hashtags ?? [],
      user_id: userId,
      external_user_id: userId,
    };

    const submitRes = await fetch(`${MUAPI_URL}/api/v1/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MUAPI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input }),
    });

    if (!submitRes.ok) {
      const detail = await submitRes.text();
      // Muapi returns a specific error when the user hasn't connected the platform yet
      if (submitRes.status === 400 || submitRes.status === 401 || submitRes.status === 403) {
        return Response.json(
          {
            error: "not_connected",
            message: `Your ${platform} account isn't connected yet. Open Settings → Connected Accounts to link it.`,
            detail: detail.slice(0, 400),
          },
          { status: 400 }
        );
      }
      return Response.json(
        { error: "Publish failed", detail: detail.slice(0, 400) },
        { status: 502 }
      );
    }

    const submitData = (await submitRes.json()) as PublishResponse;
    const predictionId = submitData.id ?? submitData.request_id;

    // If synchronous, we already have the post URL
    let postUrl: string | null =
      submitData.url ?? submitData.post_url ?? submitData.result?.url ?? submitData.result?.post_url ?? null;

    if (!postUrl && predictionId) {
      postUrl = await pollPublishResult(predictionId);
    }

    if (!postUrl) {
      return Response.json(
        { success: true, message: "Submitted — the platform is still processing.", predictionId },
        { status: 202 }
      );
    }

    return Response.json({ success: true, platform, postUrl });
  } catch (err) {
    console.error("Publish route error:", err);
    return Response.json({ error: "Failed to publish" }, { status: 500 });
  }
}
