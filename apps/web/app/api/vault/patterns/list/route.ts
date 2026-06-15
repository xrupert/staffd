/**
 * GET /api/vault/patterns/list?userId={id}&limit=3
 *
 * Returns the calling user's top-weighted patterns for surfacing as
 * PatternBadge chips in the UI. Read-only complement to the write-side
 * POST /api/vault/patterns route (V6).
 *
 * Auth: user's PB token (rows are read with that token so row rules apply).
 *
 * Aggregation: groups vault_patterns rows by signal type and returns the
 * top N by total weight (sum across all rows of that signal). Each result
 * row includes a human-readable label suitable for tooltip rendering.
 */

import { pbEscape, pbUrl } from "../../../_lib/pb";

type PatternRow = {
  id?: string;
  signal?: string;
  weight?: number;
  source_id?: string;
};

type AggregatedPattern = {
  signal: string;
  weight: number;
  count: number;
  label: string;
};

const SIGNAL_LABELS: Record<string, string> = {
  kept:            "STAFFD has noticed you keep work like this — using it as a reference.",
  shared:          "You've shared this kind of work — it's shaping future outputs.",
  published:       "Work like this went live — it's a strong reference for related tasks.",
  regenerated:     "You've iterated on this kind of work — weighting it for follow-ups.",
  engagement_high: "This kind of work drives engagement — STAFFD is leaning into it.",
  conversion:      "This pattern converted — it's now a high-priority reference.",
  bounce:          "This pattern underperformed — STAFFD is de-emphasizing it.",
};

async function whoAmI(pbToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${pbUrl()}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { record?: { id?: string } };
    return data.record?.id ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pbToken = url.searchParams.get("pbToken") ?? req.headers.get("authorization") ?? "";
  if (!pbToken) return Response.json({ error: "missing_auth" }, { status: 401 });

  const me = await whoAmI(pbToken);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  const limit = Math.max(1, Math.min(10, Number.parseInt(url.searchParams.get("limit") ?? "3", 10) || 3));

  try {
    const filter = `user='${pbEscape(me)}'`;
    const res = await fetch(
      `${pbUrl()}/api/collections/vault_patterns/records?filter=${encodeURIComponent(filter)}&perPage=200&fields=id,signal,weight,source_id&sort=-weight`,
      { headers: { Authorization: pbToken } },
    );
    if (!res.ok) return Response.json({ patterns: [] });
    const data = (await res.json()) as { items?: PatternRow[] };
    const rows = data.items ?? [];

    // Aggregate by signal
    const aggMap = new Map<string, { weight: number; count: number }>();
    for (const r of rows) {
      const s = r.signal;
      if (!s) continue;
      const cur = aggMap.get(s) ?? { weight: 0, count: 0 };
      cur.weight = Math.max(cur.weight, r.weight ?? 1);
      cur.count += 1;
      aggMap.set(s, cur);
    }

    const aggregated: AggregatedPattern[] = [...aggMap.entries()]
      .map(([signal, { weight, count }]) => ({
        signal,
        weight,
        count,
        label: SIGNAL_LABELS[signal] ?? `Pattern signal: ${signal}`,
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, limit);

    return Response.json({ patterns: aggregated });
  } catch {
    return Response.json({ patterns: [] });
  }
}
