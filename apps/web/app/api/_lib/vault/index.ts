/**
 * Vault helpers — single source of truth for fetching and rendering the
 * business context that every specialist reads silently.
 *
 * Replaces three duplicate copies of the same PB fetch and the duplicate
 * "build vault block" string composition that previously lived inside
 * agent/orchestrate/briefing routes.
 *
 * Agency mode: when `clientId` is supplied AND the client belongs to this
 * user, the client's profile is loaded instead and field names are mapped
 * to the canonical vault shape.
 */

import { pbUrl, pbEscape } from "../pb";

export type Vault = {
  id?: string;
  business_name?: string;
  industry?: string;
  /** W59 — structured industry category (pack id or "other"). Drives D-19
   *  bridging via resolveBridgingIndustry; free-text `industry` stays the
   *  richer LLM context (prompt renderers unchanged by design). */
  industry_category?: string;
  description?: string;
  target_audience?: string;
  website?: string;
  phone?: string;
  primary_email?: string;
  secondary_email?: string;
  other_email?: string;
  address?: string;
  focus?: string;
  situation?: string;
  superpower?: string;
  bottlenecks?: string[];
  magic_wand?: string;
  // W50 — Vault expansion (D-21 substrate)
  brand_voice?: string;
  brand_tone?: string;
  brand_visuals?: string;
  messaging_pillars?: string;
  hard_nos?: string;
  customer_profile?: string;
  positioning?: string;
  service_area?: string;
  avg_ticket?: string;
  lead_sources?: string;
  seasonality?: string;
  review_count?: number;
  review_rating?: number;
  review_platform?: string;
  // raw PocketBase metadata may also be present
  [k: string]: unknown;
};

const FOCUS_LABELS: Record<string, string> = {
  growth: "Top-line growth — finding leads, closing deals, driving revenue",
  time: "Time recovery — automating repetitive tasks and fixing broken workflows",
  cx: "Customer experience — retention, faster support, client satisfaction",
  intelligence: "Intelligence & scaling — data analysis, market research, strategic planning",
};

const SITUATION_LABELS: Record<string, string> = {
  solo: "Solo operator — doing everything themselves, out of hours",
  skills: "Small team missing key skills",
  scaling: "Growing faster than they can hire",
  cost: "Needs expert-level work without expert-level cost",
  chaos: "Broken processes — things keep slipping through the cracks",
  starting: "Just starting out — building everything from scratch",
};

const SUPERPOWER_LABELS: Record<string, string> = {
  speed: "Speed & efficiency — fastest in their space",
  quality: "Premium quality / expertise — high-end, bespoke solutions",
  value: "Cost-effectiveness — best value for the budget",
  relationships: "Deep relationships — unmatched customer service and personal touch",
};

const BOTTLENECK_LABELS: Record<string, string> = {
  content: "Content creation & marketing",
  leads: "Lead generation & outbound sales",
  support: "Customer support & account management",
  ops: "Data entry, invoicing & ops admin",
  research: "Market research & competitor analysis",
};

/**
 * Fetch the vault for a user (or, in Agency mode, the active client's vault).
 *
 * Uses the user's pbToken so PB row rules apply. The clientId branch verifies
 * `agency_user === userId` before returning to prevent leakage between clients.
 *
 * Returns null on any failure — callers should fall through to a vault-less
 * prompt rather than block on this.
 */
export async function fetchVault(
  pbToken: string,
  userId: string,
  opts?: { clientId?: string }
): Promise<Vault | null> {
  if (!pbToken || !userId) return null;
  const url = pbUrl();
  const headers = { Authorization: pbToken };

  // Agency mode — try the client vault first
  if (opts?.clientId) {
    try {
      const res = await fetch(
        `${url}/api/collections/clients/records/${opts.clientId}`,
        { headers }
      );
      if (res.ok) {
        const client = (await res.json()) as Record<string, unknown>;
        if (client.agency_user === userId) {
          return {
            business_name:   client.name as string | undefined,
            industry:        client.industry as string | undefined,
            description:     client.description as string | undefined,
            target_audience: client.target_audience as string | undefined,
            website:         client.website as string | undefined,
            phone:           client.phone as string | undefined,
            primary_email:   client.primary_email as string | undefined,
            address:         client.address as string | undefined,
            focus:           client.focus as string | undefined,
            situation:       client.situation as string | undefined,
            superpower:      client.superpower as string | undefined,
            magic_wand:      client.magic_wand as string | undefined,
          };
        }
      }
    } catch {
      // fall through to user's own vault
    }
  }

  try {
    const filter = `(user='${pbEscape(userId)}')`;
    const res = await fetch(
      `${url}/api/collections/businesses/records?filter=${encodeURIComponent(filter)}&perPage=1`,
      { headers }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: Vault[] };
    return data.items?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns the vault as a flat list of labelled lines — no wrapper framing.
 * Used by callers that want to embed the lines in their own prompt structure
 * (e.g. the CEO briefing puts them in the USER prompt under a custom heading
 * instead of the canonical `--- BUSINESS VAULT ---` block).
 */
export function vaultLines(vault: Vault | null): string[] {
  if (!vault) return [];
  const lines: string[] = [];
  if (vault.business_name)   lines.push(`Business name: ${vault.business_name}`);
  if (vault.industry)        lines.push(`Industry / What they do: ${vault.industry}`);
  if (vault.description)     lines.push(`Business description: ${vault.description}`);
  if (vault.target_audience) lines.push(`Target audience: ${vault.target_audience}`);
  if (vault.website)         lines.push(`Website: ${vault.website}`);
  if (vault.address)         lines.push(`Business address: ${vault.address}`);
  if (vault.phone)           lines.push(`Phone: ${vault.phone}`);
  if (vault.primary_email)   lines.push(`Primary email: ${vault.primary_email}`);
  if (vault.secondary_email) lines.push(`Secondary email: ${vault.secondary_email}`);
  if (vault.other_email)     lines.push(`Other email: ${vault.other_email}`);
  if (vault.focus)           lines.push(`Primary focus: ${FOCUS_LABELS[vault.focus] ?? vault.focus}`);
  if (vault.situation)       lines.push(`Current situation: ${SITUATION_LABELS[vault.situation] ?? vault.situation}`);
  if (vault.superpower)      lines.push(`Competitive advantage: ${SUPERPOWER_LABELS[vault.superpower] ?? vault.superpower}`);
  if (Array.isArray(vault.bottlenecks) && vault.bottlenecks.length > 0) {
    lines.push(`Key bottlenecks: ${vault.bottlenecks.map((b) => BOTTLENECK_LABELS[b] ?? b).join(", ")}`);
  }
  if (vault.magic_wand) lines.push(`What they most want off their plate: ${vault.magic_wand}`);

  // W50 — expanded business profile. Operator-curated context that makes
  // specialist work sharper; every field optional, surfaced only when set.
  if (vault.brand_voice)       lines.push(`Brand voice: ${vault.brand_voice}`);
  if (vault.brand_tone)        lines.push(`Brand tone: ${vault.brand_tone}`);
  if (vault.brand_visuals)     lines.push(`Brand visuals: ${vault.brand_visuals}`);
  if (vault.messaging_pillars) lines.push(`Messaging pillars: ${vault.messaging_pillars}`);
  if (vault.hard_nos)          lines.push(`Hard nos (never say, do, or claim): ${vault.hard_nos}`);
  if (vault.customer_profile)  lines.push(`Customer profile: ${vault.customer_profile}`);
  if (vault.positioning)       lines.push(`Positioning vs competitors: ${vault.positioning}`);
  if (vault.service_area)      lines.push(`Service area: ${vault.service_area}`);
  if (vault.avg_ticket)        lines.push(`Average ticket / job size: ${vault.avg_ticket}`);
  if (vault.lead_sources)      lines.push(`Lead sources: ${vault.lead_sources}`);
  if (vault.seasonality)       lines.push(`Seasonality / capacity: ${vault.seasonality}`);
  if (typeof vault.review_count === "number" && vault.review_count > 0) {
    const rating = typeof vault.review_rating === "number" ? ` averaging ${vault.review_rating}/5` : "";
    const platform = vault.review_platform ? ` on ${vault.review_platform}` : "";
    lines.push(`Reviews: ${vault.review_count}${rating}${platform}`);
  }
  return lines;
}

/**
 * Render the vault as the canonical `--- BUSINESS VAULT ---` block that the
 * specialist system prompts expect.
 *
 * `detail:"summary"` produces a name+industry+focus one-liner suitable for
 * the orchestrator's lightweight routing context. `detail:"full"` is the
 * complete block specialists read.
 */
export function renderVaultBlock(
  vault: Vault | null,
  opts?: { detail?: "summary" | "full" }
): string {
  if (!vault) return "";
  const detail = opts?.detail ?? "full";

  if (detail === "summary") {
    const parts: string[] = [];
    if (vault.business_name) parts.push(`${vault.business_name}`);
    if (vault.industry) parts.push(vault.industry);
    if (vault.focus) parts.push(FOCUS_LABELS[vault.focus] ?? vault.focus);
    if (!parts.length) return "";
    return `\n\nUSER'S BUSINESS: ${parts.join(" — ")}`;
  }

  const lines = vaultLines(vault);
  if (!lines.length) return "";
  return `\n\n--- BUSINESS VAULT ---\n${lines.join("\n")}\n--- END VAULT ---`;
}

// Re-export retrieval surface so consumers can do `import {...} from "../_lib/vault"`
export { retrieve, recordRetrievalMetric, computeRetrievalP95 } from "./retrieve";
export type { RetrieveOptions, RetrieveResult, RetrievedItem, RetrievalCostFlag } from "./retrieve";
