/**
 * Muapi catalog sync + reader (W95.7.3d-T1). Caches the ~230-model Muapi
 * catalog into `generation_models` (ADMIN_ONLY), classifying each static-priced
 * model into a tier + credit weight via pricing.ts. Dynamic-priced models store
 * cost_usd=null and are priced at request time via the estimate endpoint.
 *
 * Graceful degradation: if Muapi is unreachable the sync logs and exits without
 * touching existing cached rows (never crashes, never invalidates the cache).
 */

import { MUAPI_BASE_URL } from "../../../../lib/env";
import { adminHeaders, getAdminToken, pbUrl, pbEscape } from "../pb";
import { computeTier, computeCreditWeight, type GenKind } from "./pricing";
import { allRoutingSlugs } from "./routing";

const MUAPI_KEY = process.env.MUAPI_API_KEY ?? "";

type RawModel = {
  name?: string;
  category?: string;
  cost?: number;
  cost_currency?: string;
  cost_strategy?: string;
  dynamic_pricing?: boolean;
  endpoint?: string;
  estimate_endpoint?: string;
};

/** A model's generation kind, from its Muapi category ("…-to-Video" → video). */
function kindOf(category: string | undefined): GenKind {
  return /video/i.test(category ?? "") ? "video" : "image";
}

export type CatalogModel = { tier: string; credit_weight: number; dynamic_pricing: boolean; estimate_endpoint: string; kind: GenKind; cost_usd: number | null };

/** Read one cached model's tier/weight (request-time lookup). */
export async function modelTierWeight(name: string): Promise<CatalogModel | null> {
  try {
    const token = await getAdminToken();
    const filter = encodeURIComponent(`name = "${pbEscape(name)}"`);
    const res = await fetch(`${pbUrl()}/api/collections/generation_models/records?filter=${filter}&perPage=1`, { headers: { Authorization: token } });
    if (!res.ok) return null;
    const row = (((await res.json()) as { items?: Record<string, unknown>[] }).items ?? [])[0];
    if (!row) return null;
    return {
      tier: String(row.tier ?? ""),
      credit_weight: Number(row.credit_weight ?? 0),
      dynamic_pricing: !!row.dynamic_pricing,
      estimate_endpoint: String(row.estimate_endpoint ?? ""),
      kind: (row.kind as GenKind) ?? "image",
      cost_usd: row.cost_usd == null ? null : Number(row.cost_usd),
    };
  } catch {
    return null;
  }
}

/** The cache fields that matter for margin/availability drift detection. */
export type CachedModel = { name: string; cost_usd: number | null; tier: string; credit_weight: number };

export type PriceChange = {
  name: string;
  from: { cost_usd: number | null; tier: string; credit_weight: number };
  to: { cost_usd: number | null; tier: string; credit_weight: number };
};

export type CatalogDrift = { priceChanges: PriceChange[]; newModels: string[]; removedModels: string[] };

/**
 * Pure diff of the previous cache vs the freshly-classified catalog (W95.7.3d-h3).
 * `priceChanges` = a model present in both whose cost_usd / tier / credit_weight
 * moved (margin-relevant, Standard #33). `newModels` / `removedModels` =
 * catalog membership changes. First sync (empty prev) → everything is new, no
 * false price changes. Routing-slug drift is computed separately in the sync.
 */
export function computeCatalogDrift(prev: CachedModel[], next: CachedModel[]): CatalogDrift {
  const prevByName = new Map(prev.map((m) => [m.name, m]));
  const nextNames = new Set(next.map((m) => m.name));
  const priceChanges: PriceChange[] = [];
  const newModels: string[] = [];
  for (const m of next) {
    const before = prevByName.get(m.name);
    if (!before) { newModels.push(m.name); continue; }
    if (before.cost_usd !== m.cost_usd || before.tier !== m.tier || before.credit_weight !== m.credit_weight) {
      priceChanges.push({
        name: m.name,
        from: { cost_usd: before.cost_usd, tier: before.tier, credit_weight: before.credit_weight },
        to: { cost_usd: m.cost_usd, tier: m.tier, credit_weight: m.credit_weight },
      });
    }
  }
  const removedModels = prev.filter((m) => !nextNames.has(m.name)).map((m) => m.name);
  return { priceChanges, newModels, removedModels };
}

export type SyncResult = {
  ok: boolean;
  fetched: number;
  upserted: number;
  skipped?: string;
  routingDrift?: string[];
  drift?: CatalogDrift;
};

/** Fetch the live catalog, classify static-priced models, upsert generation_models. */
export async function syncMuapiCatalog(): Promise<SyncResult> {
  let raw: RawModel[];
  try {
    const res = await fetch(`${MUAPI_BASE_URL}/api/v1/models`, { headers: MUAPI_KEY ? { "x-api-key": MUAPI_KEY } : {} });
    if (!res.ok) return { ok: false, fetched: 0, upserted: 0, skipped: `muapi ${res.status}` };
    const body = (await res.json()) as unknown;
    raw = Array.isArray(body) ? body : ((body as { models?: RawModel[]; data?: RawModel[] }).models ?? (body as { data?: RawModel[] }).data ?? []);
  } catch (err) {
    console.warn("[catalog] Muapi unreachable — keeping cached rows:", err instanceof Error ? err.message : err);
    return { ok: false, fetched: 0, upserted: 0, skipped: "unreachable" };
  }

  const token = await getAdminToken();
  const pb = pbUrl();

  // Existing rows → name→id map (one read; upsert in place). Also captures the
  // prior classification (cost/tier/weight) so we can diff for drift (h3).
  const existing = new Map<string, string>();
  const prev: CachedModel[] = [];
  try {
    const r = await fetch(`${pb}/api/collections/generation_models/records?perPage=500&fields=id,name,cost_usd,tier,credit_weight`, { headers: { Authorization: token } });
    if (r.ok) for (const it of (((await r.json()) as { items?: { id: string; name: string; cost_usd?: number | null; tier?: string; credit_weight?: number }[] }).items ?? [])) {
      existing.set(it.name, it.id);
      prev.push({ name: it.name, cost_usd: it.cost_usd == null ? null : Number(it.cost_usd), tier: String(it.tier ?? ""), credit_weight: Number(it.credit_weight ?? 0) });
    }
  } catch { /* first run / collection missing → treated as empty */ }

  let upserted = 0;
  const nextModels: CachedModel[] = [];
  for (const m of raw) {
    if (!m.name) continue;
    const kind = kindOf(m.category);
    const dynamic = !!m.dynamic_pricing;
    const cost = typeof m.cost === "number" ? m.cost : null;
    const tier = !dynamic && cost != null ? computeTier(cost, kind) : "";
    const weight = !dynamic && cost != null ? computeCreditWeight(cost, kind) : 0;
    const cost_usd = dynamic ? null : cost;
    nextModels.push({ name: m.name, cost_usd, tier, credit_weight: weight });
    const fields = {
      name: m.name, category: m.category ?? "", cost_usd, cost_strategy: m.cost_strategy ?? "",
      dynamic_pricing: dynamic, endpoint: m.endpoint ?? "", estimate_endpoint: m.estimate_endpoint ?? "",
      kind, tier, credit_weight: weight, recommended_for: [], last_synced_at: new Date().toISOString(),
    };
    const id = existing.get(m.name);
    try {
      const res = await fetch(
        id ? `${pb}/api/collections/generation_models/records/${id}` : `${pb}/api/collections/generation_models/records`,
        { method: id ? "PATCH" : "POST", headers: adminHeaders(token), body: JSON.stringify(fields) },
      );
      if (res.ok) upserted++;
    } catch { /* skip this row, continue */ }
  }

  // C5 — validate routing slugs against what the catalog actually offers.
  let routingDrift: string[] | undefined;
  const catalogNames = new Set(raw.map((m) => m.name).filter(Boolean) as string[]);
  try {
    const { validateRoutingSlugs } = await import("./routing");
    validateRoutingSlugs(catalogNames);
  } catch (err) {
    routingDrift = allRoutingSlugs().filter((s) => !catalogNames.has(s));
    console.error("[catalog] routing slug drift:", err instanceof Error ? err.message : err);
  }

  const drift = computeCatalogDrift(prev, nextModels);

  return { ok: true, fetched: raw.length, upserted, drift, ...(routingDrift ? { routingDrift } : {}) };
}
