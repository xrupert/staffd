/**
 * Wake-gates for cron workers (Auto-Company borrow).
 *
 * Two failure modes these close:
 *  1. Overlapping cron fires (Vercel retry, manual + scheduled) double-
 *     processing the same scheduled_content rows — each runner now CLAIMS
 *     a row (status → "working") before doing expensive work, and the
 *     due-filter only matches "planned", so a second fire sees nothing.
 *  2. A crashed runner orphaning rows in "working" forever — the due-filter
 *     also reclaims "working" rows untouched for STALE_HOURS.
 *
 * PocketBase has no compare-and-swap, so the claim is optimistic:
 * re-read, verify still claimable, then PATCH. The race window is
 * milliseconds against cron cadences of minutes/days.
 */

export const STALE_HOURS = 2;

/** PB filter matching rows a runner may claim: due planned rows, plus
 *  stale "working" rows (crashed runner reclaim). */
export function buildDueFilter(todayKey: string, nowMs: number): string {
  const staleIso = new Date(nowMs - STALE_HOURS * 3600_000)
    .toISOString()
    .replace("T", " "); // PB datetime literal format
  return `((status='planned'&&scheduled_date<='${todayKey}')||(status='working'&&updated<'${staleIso}'))`;
}

/**
 * Optimistically claim one row. Returns true when this runner owns it.
 * Fail-closed: any fetch error means "not claimed" so the row is retried
 * on the next fire rather than double-processed on this one.
 */
export async function claimScheduledItem(
  pb: string,
  headers: Record<string, string>,
  itemId: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  try {
    const res = await fetch(`${pb}/api/collections/scheduled_content/records/${itemId}`, {
      headers: { Authorization: headers.Authorization ?? "" },
    });
    if (!res.ok) return false;
    const row = (await res.json()) as { status?: string; updated?: string };
    const stale =
      row.status === "working" &&
      nowMs - new Date(row.updated ?? 0).getTime() > STALE_HOURS * 3600_000;
    if (row.status !== "planned" && !stale) return false;

    const patch = await fetch(`${pb}/api/collections/scheduled_content/records/${itemId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "working" }),
    });
    return patch.ok;
  } catch {
    return false;
  }
}
