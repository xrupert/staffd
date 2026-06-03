/**
 * GET /api/admin/orphan-details
 *
 * Decision 71 — supersedes /api/admin/investigate-orphan-collections with
 * a richer recommendation enum and canonical-equivalent comparison.
 *
 * READ-ONLY. Returns full investigation data + structured recommendation
 * for each ℹ️ unexpected collection. Dashboard feeds this to render the
 * Investigation Panel with per-orphan action buttons.
 *
 * Per Decision 69: NO deletions. Recommendations are advisory; operator
 * records intent via POST /api/admin/orphan-decisions; Senior Architect
 * authorizes a follow-up cleanup PR for any "drop" decisions.
 *
 * Auth: super-admin (ADMIN_EMAIL match via whoAmI).
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";
import { requireSuperAdmin, toAuthErrorResponse, type SuperAdminUser } from "../../_lib/auth/super-admin";
import { logSuperAdminAccess } from "../../_lib/auth/super-admin-logging";

// Suspect orphans surfaced by verify-row-rules ℹ️ output. If new ones
// appear, add them here and the panel auto-includes them.
const SUSPECT_COLLECTIONS: Array<{ name: string; canonical: string | null }> = [
  { name: "Documents", canonical: "documents" },
  { name: "Templates", canonical: "templates" },
  { name: "vault_queue", canonical: "vault_ingest_queue" },
];

type Recommendation =
  | "drop_safe"                  // empty + canonical exists; safe to drop
  | "drop_after_migration"       // has rows but canonical exists; migrate first
  | "investigate_active_usage"   // unknown — read code references, then decide
  | "keep_with_setup_route";     // active collection that should be in baseline

type OrphanDetail = {
  name: string;
  exists: boolean;
  collection_id?: string;
  collection_type?: string;
  field_count?: number;
  fields?: Array<{ name: string; type: string; required: boolean }>;
  row_count?: number;
  last_modified?: string;
  created_at?: string;
  current_rules?: {
    list: string | null;
    view: string | null;
    create: string | null;
    update: string | null;
    delete: string | null;
  };
  canonical_equivalent: string | null;
  canonical_field_count?: number;
  schema_overlap_with_canonical?: number; // 0..1
  recommendation: Recommendation;
  recommendation_reason: string;
};

async function fetchCollection(
  adminToken: string,
  name: string,
): Promise<{
  id: string;
  type?: string;
  fields?: Array<{ name: string; type: string; required?: boolean }>;
  created?: string;
  updated?: string;
  listRule?: string | null;
  viewRule?: string | null;
  createRule?: string | null;
  updateRule?: string | null;
  deleteRule?: string | null;
} | null> {
  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/${encodeURIComponent(name)}`, {
      headers: { Authorization: adminToken },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchRowCount(adminToken: string, name: string): Promise<number> {
  try {
    const url = pbUrl();
    const res = await fetch(
      `${url}/api/collections/${encodeURIComponent(name)}/records?page=1&perPage=1&fields=id`,
      { headers: { Authorization: adminToken } },
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as { totalItems?: number };
    return data.totalItems ?? 0;
  } catch {
    return 0;
  }
}

async function fetchLastModified(adminToken: string, name: string): Promise<string | undefined> {
  try {
    const url = pbUrl();
    const res = await fetch(
      `${url}/api/collections/${encodeURIComponent(name)}/records?page=1&perPage=1&sort=-updated&fields=updated`,
      { headers: { Authorization: adminToken } },
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { items?: Array<{ updated?: string }> };
    return data.items?.[0]?.updated;
  } catch {
    return undefined;
  }
}

function computeRecommendation(
  rowCount: number,
  canonical: string | null,
  canonicalExists: boolean,
): { recommendation: Recommendation; reason: string } {
  if (rowCount === 0 && canonical && canonicalExists) {
    return {
      recommendation: "drop_safe",
      reason: `Empty collection. Canonical equivalent \`${canonical}\` exists and is the active one. Safe to drop after Senior Architect approval.`,
    };
  }
  if (rowCount === 0 && !canonical) {
    return {
      recommendation: "investigate_active_usage",
      reason: "Empty collection, no canonical equivalent. Confirm intent before drop — could be a one-off operator collection.",
    };
  }
  if (rowCount > 0 && canonical && canonicalExists) {
    return {
      recommendation: "drop_after_migration",
      reason: `Holds ${rowCount} row(s). Canonical \`${canonical}\` exists. Requires data migration before drop: (1) backup, (2) migrate references, (3) verify no /api/* route reads from this old name, (4) then drop.`,
    };
  }
  if (rowCount > 0 && !canonical) {
    return {
      recommendation: "keep_with_setup_route",
      reason: `Holds ${rowCount} row(s) and has no canonical equivalent. Likely an active collection that should be added to the 19-collection baseline with a setup route.`,
    };
  }
  // canonical specified but canonical doesn't exist in PB — rare edge case
  return {
    recommendation: "investigate_active_usage",
    reason: `Holds ${rowCount} row(s). Canonical \`${canonical}\` expected but not found in PB. Investigate before any action.`,
  };
}

export async function GET(req: Request): Promise<Response> {
  let me: SuperAdminUser;
  try {
    me = await requireSuperAdmin(req);
  } catch (err) {
    return toAuthErrorResponse(err);
  }
  void logSuperAdminAccess(me, "api_call", "/api/admin/orphan-details", { request: req });

  let adminToken: string;
  try {
    adminToken = await getAdminToken();
  } catch (err) {
    return Response.json(
      { error: "admin_token_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  const details: OrphanDetail[] = [];
  for (const suspect of SUSPECT_COLLECTIONS) {
    const col = await fetchCollection(adminToken, suspect.name);
    if (!col) {
      details.push({
        name: suspect.name,
        exists: false,
        canonical_equivalent: suspect.canonical,
        recommendation: "drop_safe",
        recommendation_reason: "Collection does not exist in PB. No action needed.",
      });
      continue;
    }

    const rowCount = await fetchRowCount(adminToken, suspect.name);
    const lastModified = await fetchLastModified(adminToken, suspect.name);

    let canonicalFieldCount = 0;
    let canonicalExists = false;
    let overlap = 0;
    if (suspect.canonical) {
      const canonical = await fetchCollection(adminToken, suspect.canonical);
      if (canonical) {
        canonicalExists = true;
        canonicalFieldCount = canonical.fields?.length ?? 0;
        const orphanFields = new Set((col.fields ?? []).map((f) => f.name));
        const canonicalFields = new Set((canonical.fields ?? []).map((f) => f.name));
        const shared = [...orphanFields].filter((f) => canonicalFields.has(f)).length;
        const union = new Set([...orphanFields, ...canonicalFields]).size;
        overlap = union > 0 ? shared / union : 0;
      }
    }

    const { recommendation, reason } = computeRecommendation(rowCount, suspect.canonical, canonicalExists);

    details.push({
      name: suspect.name,
      exists: true,
      collection_id: col.id,
      collection_type: col.type,
      field_count: col.fields?.length ?? 0,
      fields: (col.fields ?? []).map((f) => ({
        name: f.name,
        type: f.type,
        required: f.required ?? false,
      })),
      row_count: rowCount,
      last_modified: lastModified,
      created_at: col.created,
      current_rules: {
        list: col.listRule ?? null,
        view: col.viewRule ?? null,
        create: col.createRule ?? null,
        update: col.updateRule ?? null,
        delete: col.deleteRule ?? null,
      },
      canonical_equivalent: suspect.canonical,
      canonical_field_count: canonicalFieldCount,
      schema_overlap_with_canonical: Math.round(overlap * 100) / 100,
      recommendation,
      recommendation_reason: reason,
    });
  }

  return Response.json({
    timestamp: new Date().toISOString(),
    collections: details,
    note:
      "READ-ONLY investigation. No deletions performed. " +
      "Per Decision 69: record decisions via POST /api/admin/orphan-decisions; " +
      "Senior Architect authorizes a follow-up cleanup PR for any drop decisions.",
  });
}
