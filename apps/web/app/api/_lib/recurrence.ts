/**
 * PR-Loop-V4 (#8) — recurrence date math for scheduled_content.
 * Pure; YYYY-MM-DD in, YYYY-MM-DD out.
 */

export type Recurrence = "weekly" | "monthly";

export function isRecurrence(v: unknown): v is Recurrence {
  return v === "weekly" || v === "monthly";
}

/** Next occurrence after the given date. Monthly clamps to the last day of
 *  the target month (Jan 31 → Feb 28/29). */
export function nextRecurrenceDate(dateKey: string, recurrence: Recurrence): string {
  const [y, m, d] = dateKey.split("-").map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d) throw new Error(`invalid date key: ${dateKey}`);
  if (recurrence === "weekly") {
    const t = new Date(Date.UTC(y, m - 1, d + 7));
    return t.toISOString().slice(0, 10);
  }
  // monthly: same day next month, clamped to that month's length
  const lastOfNext = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, m, Math.min(d, lastOfNext)));
  return t.toISOString().slice(0, 10);
}
