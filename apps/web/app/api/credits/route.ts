/**
 * GET /api/credits?userId=xxx
 *
 * Returns the user's current image/video credit state — monthly allowance,
 * what's been used, what top-ups they have, what's remaining total.
 * Auto-resets monthly counters when a new calendar month begins.
 */

import { getCreditState } from "../_lib/credits";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const state = await getCreditState(pbUrl, userId);
    return Response.json(state);
  } catch (err) {
    console.error("Credits GET error:", err);
    return Response.json({ error: "Failed to load credits" }, { status: 500 });
  }
}
