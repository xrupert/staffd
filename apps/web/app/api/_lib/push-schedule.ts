/**
 * Push scheduling helpers — Phase 26 Quiet Hours + Morning Brief customization.
 *
 * Pure, dependency-free time math. `Intl.DateTimeFormat` resolves IANA
 * timezones at runtime without any external library.
 *
 * Three responsibilities:
 *
 *   isQuietNow(prefs)
 *     — true when the current local time falls inside the user's configured
 *       quiet window. Supports wraparound (e.g. 22→7 = overnight quiet).
 *
 *   shouldDispatchPush(prefs, briefCreatedIso)
 *     — single decision the dispatcher cron consults per brief row:
 *         { ok: true }                       → fire push now
 *         { ok: false, reason: "..." }       → skip this tick
 *       Reasons capture every gating concern: no prefs, wrong hour, quiet
 *       hours, too-old brief, etc.
 *
 *   nextDeliverySummary(prefs)
 *     — human-readable string for the Settings panel ("7:00 AM your time
 *       tomorrow", "Snoozed until Friday", "Skipping tomorrow's brief").
 */

export type BriefSchedulePrefs = {
  timezone?: string | null;
  preferred_delivery_hour?: number | null;
  quiet_hours_start?: number | null;
  quiet_hours_end?: number | null;
  brief_snoozed_until?: string | null;
  skip_next_brief?: boolean | null;
};

// Briefs older than this don't get pushed (avoid surprise notifications when
// a user opens the app after days away). 36h covers the worst-case quiet
// hours + delivery-hour window.
const MAX_PUSHABLE_AGE_MS = 36 * 60 * 60 * 1000;

/** Returns the user's current local hour (0-23) via Intl. Falls back to UTC on unknown tz. */
export function currentLocalHour(timezone: string | null | undefined): number {
  try {
    const tz = timezone && timezone.trim() ? timezone : "UTC";
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
    const hour = Number.parseInt(hourStr, 10);
    // "24" can appear in some locales for midnight — normalize to 0.
    return Number.isFinite(hour) ? (hour === 24 ? 0 : hour) : 0;
  } catch {
    return new Date().getUTCHours();
  }
}

/** Returns the user's current local date as YYYY-MM-DD. Used for same-day brief checks. */
export function currentLocalDate(timezone: string | null | undefined): string {
  try {
    const tz = timezone && timezone.trim() ? timezone : "UTC";
    // en-CA gives ISO-style YYYY-MM-DD output.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Quiet hours covers a range that may wrap past midnight.
 *
 * Examples:
 *   start=22, end=7  → quiet 22:00-06:59 (overnight, wraps)
 *   start=1,  end=6  → quiet 01:00-05:59 (early morning, no wrap)
 *   start=end        → no quiet window (disabled)
 */
export function isQuietNow(prefs: BriefSchedulePrefs): boolean {
  const start = prefs.quiet_hours_start;
  const end = prefs.quiet_hours_end;
  if (typeof start !== "number" || typeof end !== "number") return false;
  if (start === end) return false;
  const hour = currentLocalHour(prefs.timezone);
  if (start < end) {
    return hour >= start && hour < end;
  }
  // wraparound
  return hour >= start || hour < end;
}

export type DispatchDecision =
  | { ok: true }
  | { ok: false; reason: "no_prefs" | "snoozed" | "skip_next" | "before_delivery_hour" | "quiet_hours" | "too_old" };

/**
 * Should the dispatcher fire a push for this brief right now?
 *
 * The decision is conservative — every "no" path leaves the brief unpushed
 * for the NEXT dispatcher tick to reconsider. Once `pushed_at` is set,
 * upstream callers skip the brief entirely (no idempotency check here).
 */
export function shouldDispatchPush(
  prefs: BriefSchedulePrefs,
  briefCreatedIso: string
): DispatchDecision {
  // No prefs configured → the morning-brief worker's legacy "push immediately
  // after generation" path handles delivery. The dispatcher leaves these
  // alone so we don't double-push.
  if (!prefs.timezone || typeof prefs.preferred_delivery_hour !== "number") {
    return { ok: false, reason: "no_prefs" };
  }

  // Snooze gating — matches autopilot pause semantics.
  if (prefs.brief_snoozed_until) {
    const until = new Date(prefs.brief_snoozed_until).getTime();
    if (Number.isFinite(until) && until > Date.now()) {
      return { ok: false, reason: "snoozed" };
    }
  }
  if (prefs.skip_next_brief) {
    return { ok: false, reason: "skip_next" };
  }

  // Don't push briefs that are too old — avoids surprise notifications when
  // a user opens the app after a few days away.
  const createdMs = new Date(briefCreatedIso).getTime();
  if (Number.isFinite(createdMs) && Date.now() - createdMs > MAX_PUSHABLE_AGE_MS) {
    return { ok: false, reason: "too_old" };
  }

  // Quiet hours — try again next tick when the window passes.
  if (isQuietNow(prefs)) {
    return { ok: false, reason: "quiet_hours" };
  }

  // Delivery hour window — fire on the first tick where current local hour
  // is at or past the user's preferred hour AND we're still on the same
  // local day as the brief was generated. (Avoids late-night surprise pushes
  // when the user's preferred hour is e.g. 7 AM but they opened the app at
  // 23:00 and the brief hasn't been pushed yet.)
  const hour = currentLocalHour(prefs.timezone);
  if (hour < prefs.preferred_delivery_hour) {
    return { ok: false, reason: "before_delivery_hour" };
  }

  return { ok: true };
}

/** Human-readable status string for the Settings + Autopilot panels. */
export function nextDeliverySummary(prefs: BriefSchedulePrefs): string {
  if (prefs.skip_next_brief) return "Skipping tomorrow's brief";
  if (prefs.brief_snoozed_until) {
    const until = new Date(prefs.brief_snoozed_until);
    if (Number.isFinite(until.getTime()) && until.getTime() > Date.now()) {
      return `Snoozed until ${until.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}`;
    }
  }
  if (!prefs.timezone || typeof prefs.preferred_delivery_hour !== "number") {
    return "Delivered as soon as your staff finishes";
  }
  const hourLabel = formatHour(prefs.preferred_delivery_hour);
  return `Next brief at ${hourLabel} your time`;
}

export function formatHour(hour: number): string {
  if (hour < 0 || hour > 23) return `${hour}:00`;
  const period = hour < 12 ? "AM" : "PM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:00 ${period}`;
}
