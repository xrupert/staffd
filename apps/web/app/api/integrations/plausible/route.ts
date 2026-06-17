/**
 * GET /api/integrations/plausible  — operator site analytics.
 *
 * Two shapes, one Plausible auth/cache substrate (single source of truth):
 *
 *  • default (W80.1a) — today's visitors + pageviews + top sources for the
 *    Front Desk card. Super-admin gated, 5-min cached.
 *  • ?view=deep&range=<day|7d|30d> (W80.3) — the Site Analytics surface:
 *    headline (visitors / pageviews / bounce rate / avg visit), source / page
 *    / country breakdowns (top 5), and a visitor timeseries. Two-tier cache
 *    keyed by range: 5-min on headline+timeseries (shift quickly), 15-min on
 *    breakdowns (shift slowly) — keeps us well under Plausible's ~600/hr cap
 *    even as operators flip ranges.
 *
 * 503 if unconfigured; 502 on aggregate upstream error. Breakdown failures
 * degrade to empty lists so the page still renders headline + chart.
 *
 * Env: PLAUSIBLE_API_KEY, PLAUSIBLE_SITE_ID, and the install base URL —
 * NEXT_PUBLIC_PLAUSIBLE_URL (already set; the CE install) or an optional
 * server-only PLAUSIBLE_API_URL override; falls back to https://plausible.io.
 * Read in-handler so config/tests take effect live.
 */

import { requireSuperAdmin, toAuthErrorResponse } from "../../_lib/auth/super-admin";
import type { AnalyticsRange } from "../../../../lib/operations";

type PlausiblePulse = {
  visitors: number;
  pageviews: number;
  sources: { source: string; visitors: number }[];
};

type Headline = { visitors: number; pageviews: number; bounceRate: number; visitDuration: number };
type DeepHeadline = { headline: Headline; timeseries: { date: string; visitors: number }[] };
type DeepBreakdowns = {
  sources: { name: string; visitors: number }[];
  pages: { name: string; pageviews: number }[];
  countries: { name: string; visitors: number }[];
};

const CACHE_TTL_MS = 5 * 60 * 1000;          // pulse + deep headline/timeseries
const BREAKDOWN_TTL_MS = 15 * 60 * 1000;     // deep breakdowns shift slowly

let cache: { data: PlausiblePulse; expiresAt: number } | null = null;
const headlineCache = new Map<string, { data: DeepHeadline; expiresAt: number }>();
const breakdownCache = new Map<string, { data: DeepBreakdowns; expiresAt: number }>();

/** Test hook — reset every module cache between cases. */
export function _clearPlausibleCache(): void {
  cache = null;
  headlineCache.clear();
  breakdownCache.clear();
}

function config() {
  // Operator runs Plausible Community Edition (self-hosted), not Cloud.
  // NEXT_PUBLIC_PLAUSIBLE_URL already points at the CE install; an optional
  // server-only PLAUSIBLE_API_URL can override it. Falls back to Cloud.
  const base = (
    process.env.PLAUSIBLE_API_URL ??
    process.env.NEXT_PUBLIC_PLAUSIBLE_URL ??
    "https://plausible.io"
  ).replace(/\/$/, "");
  return { base, key: process.env.PLAUSIBLE_API_KEY ?? "", site: process.env.PLAUSIBLE_SITE_ID ?? "" };
}

function notConfigured() {
  return Response.json(
    {
      error: "not_configured",
      message: "Analytics isn't connected yet. Add PLAUSIBLE_API_KEY and PLAUSIBLE_SITE_ID to your environment.",
    },
    { status: 503 }
  );
}

const VALID_RANGES: AnalyticsRange[] = ["day", "7d", "30d"];
function parseRange(raw: string | null): AnalyticsRange {
  return (VALID_RANGES as string[]).includes(raw ?? "") ? (raw as AnalyticsRange) : "7d";
}

export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
  } catch (err) {
    return toAuthErrorResponse(err);
  }

  const { base, key, site } = config();
  if (!key || !site) return notConfigured();

  const url = new URL(req.url);
  if (url.searchParams.get("view") === "deep") {
    return deep(base, key, site, parseRange(url.searchParams.get("range")));
  }

  // ── Default: Front Desk card pulse (today) ──
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

// ── W80.3 deep view ─────────────────────────────────────────────────────────

async function deep(base: string, key: string, site: string, range: AnalyticsRange) {
  const headers = { Authorization: `Bearer ${key}` };
  const q = `site_id=${encodeURIComponent(site)}&period=${range}`;
  const now = Date.now();

  try {
    // Tier 1 — headline + timeseries (5-min cache, keyed by range).
    let head = headlineCache.get(range);
    if (!head || head.expiresAt <= now) {
      const [aggRes, tsRes] = await Promise.all([
        fetch(`${base}/api/v1/stats/aggregate?${q}&metrics=visitors,pageviews,bounce_rate,visit_duration`, { headers }),
        fetch(`${base}/api/v1/stats/timeseries?${q}&metrics=visitors`, { headers }),
      ]);
      if (!aggRes.ok) {
        return Response.json({ error: "Plausible error", detail: (await aggRes.text()).slice(0, 200) }, { status: 502 });
      }
      const agg = (await aggRes.json()) as { results?: Record<string, { value?: number }> };
      const ts = tsRes.ok ? ((await tsRes.json()) as { results?: { date?: string; visitors?: number }[] }) : { results: [] };
      const data: DeepHeadline = {
        headline: {
          visitors: agg.results?.visitors?.value ?? 0,
          pageviews: agg.results?.pageviews?.value ?? 0,
          bounceRate: agg.results?.bounce_rate?.value ?? 0,
          visitDuration: agg.results?.visit_duration?.value ?? 0,
        },
        timeseries: (ts.results ?? []).map((r) => ({ date: r.date ?? "", visitors: r.visitors ?? 0 })),
      };
      head = { data, expiresAt: now + CACHE_TTL_MS };
      headlineCache.set(range, head);
    }

    // Tier 2 — breakdowns (15-min cache, keyed by range). Each degrades to [].
    let brk = breakdownCache.get(range);
    if (!brk || brk.expiresAt <= now) {
      const [srcRes, pageRes, countryRes] = await Promise.all([
        fetch(`${base}/api/v1/stats/breakdown?${q}&property=visit:source&metrics=visitors&limit=5`, { headers }),
        fetch(`${base}/api/v1/stats/breakdown?${q}&property=event:page&metrics=pageviews&limit=5`, { headers }),
        fetch(`${base}/api/v1/stats/breakdown?${q}&property=visit:country&metrics=visitors&limit=5`, { headers }),
      ]);
      const srcJson = srcRes.ok ? ((await srcRes.json()) as { results?: { source?: string; visitors?: number }[] }) : { results: [] };
      const pageJson = pageRes.ok ? ((await pageRes.json()) as { results?: { page?: string; pageviews?: number }[] }) : { results: [] };
      const countryJson = countryRes.ok ? ((await countryRes.json()) as { results?: { country?: string; visitors?: number }[] }) : { results: [] };
      const data: DeepBreakdowns = {
        sources: (srcJson.results ?? []).map((r) => ({ name: r.source ?? "Unknown", visitors: r.visitors ?? 0 })),
        pages: (pageJson.results ?? []).map((r) => ({ name: r.page ?? "Unknown", pageviews: r.pageviews ?? 0 })),
        countries: (countryJson.results ?? []).map((r) => ({ name: r.country ?? "Unknown", visitors: r.visitors ?? 0 })),
      };
      brk = { data, expiresAt: now + BREAKDOWN_TTL_MS };
      breakdownCache.set(range, brk);
    }

    return Response.json({ range, ...head.data, ...brk.data });
  } catch (err) {
    console.error("[plausible] deep read error:", err);
    return Response.json({ error: "Failed to read analytics" }, { status: 502 });
  }
}
