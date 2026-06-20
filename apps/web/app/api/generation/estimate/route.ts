/**
 * POST /api/generation/estimate (W95.7.3d-T1) — cost/weight for a (department,
 * kind, tier) selection. For a DYNAMIC-priced model it calls Muapi
 * /estimate-cost with the request params; for a STATIC-priced model it reads the
 * cached catalog (no estimate call). Returns {costUsd, tier, creditWeight}.
 *
 * Sub-second; no worker (Standard #26). Vendor model slugs stay server-side —
 * the client sends department/kind/tier, never a slug.
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { routeFor } from "../../_lib/generation/routing";
import { modelTierWeight } from "../../_lib/generation/catalog";
import { estimateCost } from "../../_lib/integrations/muapi/predictions";
import { computeTier, computeCreditWeight, tierWeight, type GenKind, type Tier } from "../../_lib/generation/pricing";

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { kind?: string; tier?: string; department?: string; prompt?: string; aspectRatio?: string };
  const kind: GenKind = body.kind === "video" ? "video" : "image";
  const tier = (["quick", "pro", "premium"].includes(body.tier ?? "") ? body.tier : "pro") as Tier;
  const department = body.department ?? "";

  // Resolve the preferred model for this tier (server-side; slug never returned).
  const model = routeFor(department, kind, tier)[0];
  const cat = model ? await modelTierWeight(model) : null;

  // Static-priced (or uncatalogued / no model) → locked tier weight, no estimate.
  if (!model || !cat || !cat.dynamic_pricing) {
    return Response.json({ costUsd: cat?.cost_usd ?? null, tier, creditWeight: cat?.credit_weight || tierWeight(kind, tier) });
  }

  // Dynamic-priced → estimate the USD cost, derive tier + weight from it.
  const estBody: Record<string, unknown> = { prompt: body.prompt ?? "", aspect_ratio: body.aspectRatio ?? (kind === "video" ? "16:9" : "1:1") };
  if (kind === "video") { estBody.duration = 5; estBody.resolution = "1080p"; }
  const costUsd = await estimateCost(model, estBody);
  if (costUsd == null) {
    return Response.json({ costUsd: null, tier, creditWeight: tierWeight(kind, tier) }); // fall back to locked weight
  }
  return Response.json({ costUsd, tier: computeTier(costUsd, kind), creditWeight: computeCreditWeight(costUsd, kind) });
}
