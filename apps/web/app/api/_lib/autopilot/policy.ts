/**
 * Autopilot policy + streak engine (W95.5).
 *
 * The graduation mechanism: each (user, intent_type) accrues a confirm streak.
 * At the tier threshold STAFFD offers to automate; once enabled, unambiguous
 * extractions fire directly (the "you've been staffed" promise). All state of
 * record lives in PB `autopilot_prefs` (Qdrant intelligence is V2). Every
 * function find-or-creates the (user,intent_type) row (PB has no composite
 * unique) and is defensive about ownership.
 */

import { adminHeaders, getAdminToken, pbUrl, pbEscape } from "../pb";
import { autopilotThreshold, INTENT_FIELDS, type IntentType } from "../orchestrator/intent-policy";

export type AutopilotPrefs = {
  id: string | null;
  user: string;
  intent_type: string;
  confirm_streak: number;
  enabled: boolean;
  enabled_at: string | null;
  last_confirm_at: string | null;
  offer_suppressed_until: string | null;
  revoked_at: string | null;
  threshold_override: number | null;
};

const COLLECTION = "autopilot_prefs";
const REVOKE_COOLDOWN_DAYS = 7;
const now = () => new Date().toISOString();
const plusDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

function defaults(user: string, intent_type: string): AutopilotPrefs {
  return { id: null, user, intent_type, confirm_streak: 0, enabled: false, enabled_at: null, last_confirm_at: null, offer_suppressed_until: null, revoked_at: null, threshold_override: null };
}

/** Find the (user,intent_type) prefs row, or a defaults object if none. */
export async function getAutopilotPrefs(user: string, intent_type: string, token?: string): Promise<AutopilotPrefs> {
  const t = token ?? (await getAdminToken().catch(() => ""));
  if (!t) return defaults(user, intent_type);
  const filter = encodeURIComponent(`user = "${pbEscape(user)}" && intent_type = "${pbEscape(intent_type)}"`);
  const res = await fetch(`${pbUrl()}/api/collections/${COLLECTION}/records?filter=${filter}&perPage=1`, { headers: { Authorization: t } });
  if (!res.ok) return defaults(user, intent_type);
  const row = ((await res.json()) as { items?: Partial<AutopilotPrefs>[] }).items?.[0];
  if (!row) return defaults(user, intent_type);
  return {
    id: (row.id as string) ?? null, user, intent_type,
    confirm_streak: Number(row.confirm_streak ?? 0), enabled: !!row.enabled,
    enabled_at: row.enabled_at ?? null, last_confirm_at: row.last_confirm_at ?? null,
    offer_suppressed_until: row.offer_suppressed_until ?? null, revoked_at: row.revoked_at ?? null,
    threshold_override: row.threshold_override != null ? Number(row.threshold_override) : null,
  };
}

/** Find-or-create then PATCH the prefs row with the given patch. Returns merged. */
async function upsert(user: string, intent_type: string, patch: Partial<AutopilotPrefs>, token?: string): Promise<AutopilotPrefs> {
  const t = token ?? (await getAdminToken().catch(() => ""));
  if (!t) return { ...defaults(user, intent_type), ...patch };
  const cur = await getAutopilotPrefs(user, intent_type, t);
  const merged = { ...cur, ...patch };
  const body = JSON.stringify({
    user, intent_type,
    confirm_streak: merged.confirm_streak, enabled: merged.enabled, enabled_at: merged.enabled_at ?? "",
    last_confirm_at: merged.last_confirm_at ?? "", offer_suppressed_until: merged.offer_suppressed_until ?? "",
    revoked_at: merged.revoked_at ?? "", threshold_override: merged.threshold_override ?? null,
  });
  if (cur.id) {
    await fetch(`${pbUrl()}/api/collections/${COLLECTION}/records/${cur.id}`, { method: "PATCH", headers: adminHeaders(t), body });
    return merged;
  }
  const res = await fetch(`${pbUrl()}/api/collections/${COLLECTION}/records`, { method: "POST", headers: adminHeaders(t), body });
  if (res.ok) merged.id = ((await res.json()) as { id: string }).id;
  return merged;
}

/** Within the post-undo cooldown? (autopilot not re-offered for 7 days). */
function inRevokeCooldown(p: AutopilotPrefs): boolean {
  if (!p.revoked_at) return false;
  return Date.now() - new Date(p.revoked_at).getTime() < REVOKE_COOLDOWN_DAYS * 86_400_000;
}

/** Fire autopilot only if enabled, unambiguous, eligible policy, not in cooldown. */
export async function shouldAutopilot(user: string, intent_type: IntentType, isAmbiguous: boolean, token?: string): Promise<boolean> {
  if (isAmbiguous) return false;
  if (INTENT_FIELDS[intent_type].autopilotPolicy === "never") return false;
  const p = await getAutopilotPrefs(user, intent_type, token);
  return p.enabled && !inRevokeCooldown(p);
}

/** Offer graduation when streak met, not yet enabled, and offer not suppressed. */
export async function shouldOfferGraduation(user: string, intent_type: IntentType, token?: string): Promise<boolean> {
  if (INTENT_FIELDS[intent_type].autopilotPolicy === "never") return false;
  const p = await getAutopilotPrefs(user, intent_type, token);
  if (p.enabled) return false;
  if (p.offer_suppressed_until && new Date(p.offer_suppressed_until).getTime() > Date.now()) return false;
  if (inRevokeCooldown(p)) return false;
  return p.confirm_streak >= autopilotThreshold(intent_type);
}

/** +1 on a clean confirm/fire; no change when the user edited what we parsed. */
export async function incrementStreak(user: string, intent_type: string, opts: { edited: boolean }, token?: string): Promise<AutopilotPrefs> {
  if (opts.edited) return getAutopilotPrefs(user, intent_type, token); // imperfect parse — neither reward nor punish
  const cur = await getAutopilotPrefs(user, intent_type, token);
  return upsert(user, intent_type, { confirm_streak: cur.confirm_streak + 1, last_confirm_at: now() }, token);
}

/** Gentle -1 on cancel (floor 0) — not a reset. */
export async function decrementStreak(user: string, intent_type: string, token?: string): Promise<AutopilotPrefs> {
  const cur = await getAutopilotPrefs(user, intent_type, token);
  return upsert(user, intent_type, { confirm_streak: Math.max(0, cur.confirm_streak - 1) }, token);
}

export async function resetStreak(user: string, intent_type: string, token?: string): Promise<AutopilotPrefs> {
  return upsert(user, intent_type, { confirm_streak: 0 }, token);
}

/** Enable/disable autopilot. Disable preserves streak; enable stamps enabled_at. */
export async function setEnabled(user: string, intent_type: string, enabled: boolean, token?: string): Promise<AutopilotPrefs> {
  return upsert(user, intent_type, enabled ? { enabled: true, enabled_at: now() } : { enabled: false }, token);
}

/** Suppress the graduation offer for N days (the "Not yet" choice = 30). */
export async function recordSuppression(user: string, intent_type: string, days: number, token?: string): Promise<AutopilotPrefs> {
  return upsert(user, intent_type, { confirm_streak: 0, offer_suppressed_until: plusDays(days) }, token);
}

/** Undo path: reset streak, disable, stamp revoked_at (starts 7-day cooldown). */
export async function recordRevocation(user: string, intent_type: string, token?: string): Promise<AutopilotPrefs> {
  return upsert(user, intent_type, { confirm_streak: 0, enabled: false, revoked_at: now() }, token);
}
