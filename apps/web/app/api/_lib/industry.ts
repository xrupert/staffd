/**
 * W59 — Industry bridging single-owner helper (SA Decisions 3'/4').
 *
 * Precedence (resolveBridgingIndustry):
 *   a. `industry_category` set and ≠ "other" → use it directly (the
 *      category ids ARE pack ids; resolveIndustryToPackId exact-matches
 *      them downstream — the structured fast path).
 *   b. `industry_category` === "other" → undefined (explicit opt-out;
 *      the user chose Other deliberately, free-text does not override).
 *   c. No category → fall back to the free-text `industry` (legacy path
 *      through resolveIndustryToPackId keyword matching).
 *
 * Lazy migration (ensureIndustryCategory): first server-side bridging
 * touch of a legacy record writes `industry_category` =
 * resolveIndustryToPackId(industry) ?? "other". Fire-and-forget,
 * idempotent, warn-level logging on failure (never blocks the request).
 *
 * `bridgingIndustryFor` composes both — the one-liner the nine bridging
 * call sites use.
 */

import { resolveIndustryToPackId } from "@staffd/agents";
import { adminHeaders, getAdminToken, pbUrl } from "./pb";

export type BizIndustryFields = {
  id?: string;
  industry?: string | null;
  industry_category?: string | null;
} | null | undefined;

/** Pure precedence — Decision 3'. */
export function resolveBridgingIndustry(biz: BizIndustryFields): string | undefined {
  if (!biz) return undefined;
  const category = (biz.industry_category ?? "").toString().trim();
  if (category === "other") return undefined;
  if (category) return category;
  const freeText = (biz.industry ?? "").toString().trim();
  return freeText || undefined;
}

/** Lazy migration — Decision 4'. Fire-and-forget; safe to `void`. */
export async function ensureIndustryCategory(biz: BizIndustryFields): Promise<void> {
  try {
    if (!biz?.id) return;
    if ((biz.industry_category ?? "").toString().trim()) return; // already migrated
    const resolved = resolveIndustryToPackId(biz.industry ?? undefined) ?? "other";
    const token = await getAdminToken();
    const res = await fetch(`${pbUrl()}/api/collections/businesses/records/${biz.id}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({ industry_category: resolved }),
    });
    if (!res.ok) {
      console.warn(`[W59-migration] industry_category write failed biz=${biz.id} status=${res.status}`);
    } else {
      console.log(`[W59-migration] biz=${biz.id} industry_category=${resolved}`);
    }
  } catch (err) {
    console.warn(`[W59-migration] industry_category write failed:`, err);
  }
}

/**
 * The call-site one-liner: fires the lazy migration (non-blocking) and
 * returns the precedence-resolved bridging industry.
 */
export function bridgingIndustryFor(biz: BizIndustryFields): string | undefined {
  void ensureIndustryCategory(biz);
  return resolveBridgingIndustry(biz);
}
