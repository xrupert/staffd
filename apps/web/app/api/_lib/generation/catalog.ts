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

export type SyncResult = { ok: boolean; fetched: number; upserted: number; skipped?: string; routingDrift?: string[] };

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

  // Existing rows → name→id map (one read; upsert in place).
  const existing = new Map<string, string>();
  try {
    const r = await fetch(`${pb}/api/collections/generation_models/records?perPage=500&fields=id,name`, { headers: { Authorization: token } });
    if (r.ok) for (const it of (((await r.json()) as { items?: { id: string; name: string }[] }).items ?? [])) existing.set(it.name, it.id);
  } catch { /* first run / collection missing → treated as empty */ }

  let upserted = 0;
  for (const m of raw) {
    if (!m.name) continue;
    const kind = kindOf(m.category);
    const dynamic = !!m.dynamic_pricing;
    const cost = typeof m.cost === "number" ? m.cost : null;
    const tier = !dynamic && cost != null ? computeTier(cost, kind) : "";
    const weight = !dynamic && cost != null ? computeCreditWeight(cost, kind) : 0;
    const fields = {
      name: m.name, category: m.category ?? "", cost_usd: dynamic ? null : cost, cost_strategy: m.cost_strategy ?? "",
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

  return { ok: true, fetched: raw.length, upserted, ...(routingDrift ? { routingDrift } : {}) };
}
