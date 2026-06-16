/**
 * GET /api/integrations/plausible  — operator site analytics (W80.1a).
 *
 * Today's unique visitors + pageviews + top traffic sources for the
 * operator's Plausible site. Super-admin gated (operator-private data, like
 * the Stripe pulse).
 *
 * Aggressively cached: Plausible Cloud caps the Stats API at ~600 req/hr, so
 * a per-page-load fetch across many viewers would exhaust it. One short
 * in-memory window (operator-scoped, single site) collapses repeat loads to
 * one upstream pair. 503 if unconfigured; 502 on upstream error (the card
 * degrades to an empty state).
 *
 * Env: PLAUSIBLE_API_KEY, PLAUSIBLE_SITE_ID, PLAUSIBLE_URL (default
 * https://plausible.io). Read in-handler so config/tests take effect live.
 */

import { requireSuperAdmin, toAuthErrorResponse } from "../../_lib/auth/super-admin";

type PlausiblePulse = {
  visitors: number;
  pageviews: number;
  sources: { source: string; visitors: number }[];
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — well under the ~600/hr cap
let cache: { data: PlausiblePulse; expiresAt: number } | null = null;

/** Test hook — reset the module cache between cases. */
export function _clearPlausibleCache(): void {
  cache = null;
}

export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
  } catch (err) {
    return toAuthErrorResponse(err);
  }

  const base = (process.env.PLAUSIBLE_URL ?? "https://plausible.io").replace(/\/$/, "");
  const key = process.env.PLAUSIBLE_API_KEY ?? "";
  const site = process.env.PLAUSIBLE_SITE_ID ?? "";
  if (!key || !site) {
    return Response.json(
      {
        error: "not_configured",
        message: "Analytics isn't connected yet. Add PLAUSIBLE_API_KEY and PLAUSIBLE_SITE_ID to your environment.",
      },
      { status: 503 }
    );
  }

  if (cache && cache.expiresAt > Date.now()) {
    return Response.json({ ...cache.data, cached: true });
  }

  const headers = { Authorization: `Bearer ${key}` };
  const q = `site_id=${encodeURIComponent(site)}&period=day`;

  try {
    const [aggRes, brkRes] = await Promise.all([
      fetch(`${base}/api/v1/stats/aggregate?${q}&metrics=visitors,pageviews`, { headers }),
      fetch(`${base}/api/v1/stats/breakdown?${q}&property=visit:source&metrics=visitors&limit=5`, { headers }),
    ]);
    if (!aggRes.ok) {
      return Response.json({ error: "Plausible error", detail: (await aggRes.text()).slice(0, 200) }, { status: 502 });
    }

    const agg = (await aggRes.json()) as { results?: { visitors?: { value?: number }; pageviews?: { value?: number } } };
    const brk = brkRes.ok
      ? ((await brkRes.json()) as { results?: { source?: string; visitors?: number }[] })
      : { results: [] };

    const data: PlausiblePulse = {
      visitors: agg.results?.visitors?.value ?? 0,
      pageviews: agg.results?.pageviews?.value ?? 0,
      sources: (brk.results ?? []).map((r) => ({ source: r.source ?? "Unknown", visitors: r.visitors ?? 0 })),
    };

    cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return Response.json({ ...data, cached: false });
  } catch (err) {
    console.error("[plausible] read error:", err);
    return Response.json({ error: "Failed to read analytics" }, { status: 502 });
  }
}
