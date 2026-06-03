/**
 * GET /api/admin/investigate-orphan-collections
 *
 * Decision 69 — surface schema + row-count for the 3 ℹ️ collections
 * flagged by verify-row-rules (case-variant duplicates suggesting prior
 * schema drift: `Documents`, `Templates`, `vault_queue`).
 *
 * READ-ONLY. Surfaces data for operator decision — no deletions. Per
 * Decision 69 spec: "DO NOT delete anything autonomously — surface
 * findings to Senior Architect for explicit decision."
 *
 * Auth: super-admin (ADMIN_EMAIL match), same as other admin routes.
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";

// Hardcoded list — these are the known suspects from the dashboard ℹ️
// findings. If the dashboard surfaces additional unexpected_collection
// entries, the operator can request a new investigation endpoint for them.
const SUSPECT_COLLECTIONS = ["Documents", "Templates", "vault_queue"];

type CollectionDetail = {
  name: string;
  exists: boolean;
  collection_id?: string;
  collection_type?: string;
  field_count?: number;
  fields?: Array<{ name: string; type: string; required: boolean }>;
  row_count?: number;
  created_at?: string;
  updated_at?: string;
  rules?: {
    list: string | null;
    view: string | null;
    create: string | null;
    update: string | null;
    delete: string | null;
  };
  recommendation: string;
};

async function whoAmI(pbToken: string): Promise<{ id: string; email: string } | null> {
  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { record?: { id?: string; email?: string } };
    if (!data.record?.id || !data.record?.email) return null;
    return { id: data.record.id, email: data.record.email };
  } catch {
    return null;
  }
}

async function investigate(adminToken: string, name: string): Promise<CollectionDetail> {
  const url = pbUrl();

  // Fetch schema
  let col: {
    id?: string;
    type?: string;
    fields?: Array<{ name: string; type: string; required?: boolean }>;
    created?: string;
    updated?: string;
    listRule?: string | null;
    viewRule?: string | null;
    createRule?: string | null;
    updateRule?: string | null;
    deleteRule?: string | null;
  } | null = null;
  try {
    const res = await fetch(`${url}/api/collections/${encodeURIComponent(name)}`, {
      headers: { Authorization: adminToken },
    });
    if (res.ok) {
      col = await res.json();
    }
  } catch {
    /* silent */
  }

  if (!col?.id) {
    return {
      name,
      exists: false,
      recommendation: "Collection does not exist in PB. No action needed.",
    };
  }

  // Fetch row count (single-page list with perPage=1 to read `totalItems`)
  let rowCount = 0;
  try {
    const res = await fetch(
      `${url}/api/collections/${encodeURIComponent(name)}/records?page=1&perPage=1&fields=id`,
      { headers: { Authorization: adminToken } },
    );
    if (res.ok) {
      const data = (await res.json()) as { totalItems?: number };
      rowCount = data.totalItems ?? 0;
    }
  } catch {
    /* silent */
  }

  // Generate recommendation based on row count + presence of canonical equivalent
  let recommendation: string;
  const lower = name.toLowerCase();
  const canonicalEquivalent: Record<string, string> = {
    documents: "documents (lowercase) is the canonical collection",
    templates: "templates (lowercase) is the canonical collection",
    vault_queue: "vault_ingest_queue is the canonical collection",
  };
  const canonical = canonicalEquivalent[lower] ?? null;

  if (rowCount === 0) {
    recommendation = canonical
      ? `EMPTY orphan. Safe to drop in PB admin UI. ${canonical}.`
      : `EMPTY collection. Confirm intent — if unused, safe to drop.`;
  } else {
    recommendation = canonical
      ? `Holds ${rowCount} row(s). ${canonical}. ` +
        `REQUIRES DATA MIGRATION before drop: (1) backup the rows; ` +
        `(2) migrate any active references into the canonical collection; ` +
        `(3) verify no /api/* route reads from this old name; ` +
        `(4) then drop. Operator decision required.`
      : `Holds ${rowCount} row(s). Not in 19-collection baseline. ` +
        `Determine purpose: (a) active collection that should be added to ` +
        `EXPECTED_COLLECTIONS, (b) one-off operator collection to leave alone, ` +
        `(c) legacy data to migrate.`;
  }

  return {
    name,
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
    created_at: col.created,
    updated_at: col.updated,
    rules: {
      list: col.listRule ?? null,
      view: col.viewRule ?? null,
      create: col.createRule ?? null,
      update: col.updateRule ?? null,
      delete: col.deleteRule ?? null,
    },
    recommendation,
  };
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pbToken = url.searchParams.get("pbToken") ?? req.headers.get("authorization") ?? "";
  if (!pbToken) return Response.json({ error: "missing_auth" }, { status: 401 });

  const me = await whoAmI(pbToken);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!adminEmail) {
    return Response.json({ error: "admin_not_configured" }, { status: 503 });
  }
  if (me.email.trim().toLowerCase() !== adminEmail) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let adminToken: string;
  try {
    adminToken = await getAdminToken();
  } catch (err) {
    return Response.json(
      { error: "admin_token_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  const details = await Promise.all(
    SUSPECT_COLLECTIONS.map((name) => investigate(adminToken, name)),
  );

  return Response.json({
    timestamp: new Date().toISOString(),
    suspect_collections: details,
    note:
      "READ-ONLY investigation. No deletions performed. " +
      "Per Decision 69 — operator reviews recommendations and decides on each collection. " +
      "Recommendations are heuristic; verify by checking /api/* routes for references.",
  });
}
