/**
 * POST /api/admin/migrate-orphans-execute
 *
 * Decision 73 — Phase 1 data migration. Idempotent.
 *
 * Body:
 *   {
 *     source: "Documents" | "Templates",    // which orphan to migrate
 *     canonical: "documents" | "templates", // destination
 *     confirm: "MIGRATE-<source>",          // literal confirm token
 *     dry_run?: boolean                     // if true, report intended actions only
 *   }
 *
 * Behavior per source row:
 *   - Strip PB-managed fields from source record (id, collectionId,
 *     collectionName, expand) before copying — keep `created` + `updated`
 *     to attempt timestamp preservation (PB may overwrite these, accepted).
 *   - POST to canonical with the SAME id preserved.
 *   - If canonical already has a row with that id → report "already_migrated"
 *     and skip (idempotent contract).
 *   - On PB error → report per-row with detail; continue with next row.
 *
 * Source rows are NOT deleted by this endpoint. Drop is a separate, gated
 * action via /api/admin/drop-orphan-collection.
 *
 * Auth: super-admin (ADMIN_EMAIL match via whoAmI).
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";

const ALLOWED_PAIRS: Record<string, string> = {
  Documents: "documents",
  Templates: "templates",
};

type RowResult = {
  source_id: string;
  status: "migrated" | "already_migrated" | "failed" | "dry_run";
  destination_id?: string;
  detail?: string;
};

async function whoAmI(pbToken: string): Promise<{ id: string; email: string } | null> {
  try {
    const res = await fetch(`${pbUrl()}/api/collections/users/auth-refresh`, {
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

async function fetchAllRows(
  token: string,
  collection: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let page = 1;
  // Cap at 1000 rows for safety; orphans are expected to have <10
  while (page <= 10) {
    const res = await fetch(
      `${pbUrl()}/api/collections/${encodeURIComponent(collection)}/records?page=${page}&perPage=100&sort=created`,
      { headers: { Authorization: token } },
    );
    if (!res.ok) break;
    const data = (await res.json()) as {
      items?: Record<string, unknown>[];
      totalPages?: number;
    };
    if (!data.items || data.items.length === 0) break;
    rows.push(...data.items);
    if (page >= (data.totalPages ?? 1)) break;
    page++;
  }
  return rows;
}

async function checkExistingId(
  token: string,
  collection: string,
  id: string,
): Promise<boolean> {
  const res = await fetch(
    `${pbUrl()}/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`,
    { headers: { Authorization: token } },
  );
  return res.ok;
}

/** Strip PB-managed/internal fields; keep everything else for the create body. */
function sanitizeForCreate(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const SKIP = new Set(["collectionId", "collectionName", "expand"]);
  for (const [k, v] of Object.entries(row)) {
    if (SKIP.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pbToken = url.searchParams.get("pbToken") ?? req.headers.get("authorization") ?? "";
  if (!pbToken) return Response.json({ error: "missing_auth" }, { status: 401 });
  const me = await whoAmI(pbToken);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!adminEmail) return Response.json({ error: "admin_not_configured" }, { status: 503 });
  if (me.email.trim().toLowerCase() !== adminEmail) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { source?: string; canonical?: string; confirm?: string; dry_run?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const { source, canonical, confirm, dry_run } = body;
  if (!source || !ALLOWED_PAIRS[source]) {
    return Response.json(
      { error: "invalid_source", allowed: Object.keys(ALLOWED_PAIRS) },
      { status: 400 },
    );
  }
  if (canonical !== ALLOWED_PAIRS[source]) {
    return Response.json(
      { error: "invalid_canonical", expected: ALLOWED_PAIRS[source], got: canonical ?? null },
      { status: 400 },
    );
  }
  const expectedConfirm = `MIGRATE-${source}`;
  if (confirm !== expectedConfirm) {
    return Response.json(
      { error: "missing_or_wrong_confirm", expected: expectedConfirm },
      { status: 400 },
    );
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

  let sourceRows: Record<string, unknown>[];
  try {
    sourceRows = await fetchAllRows(adminToken, source);
  } catch (err) {
    return Response.json(
      { error: "fetch_source_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  const results: RowResult[] = [];
  for (const row of sourceRows) {
    const id = String(row.id ?? "");
    if (!id) {
      results.push({ source_id: "<missing>", status: "failed", detail: "row missing id field" });
      continue;
    }

    // Idempotency check — does canonical already have this id?
    let exists = false;
    try {
      exists = await checkExistingId(adminToken, canonical, id);
    } catch {
      // If the check itself fails, fall through to attempt — POST will fail with detail
    }
    if (exists) {
      results.push({ source_id: id, destination_id: id, status: "already_migrated" });
      continue;
    }

    if (dry_run) {
      results.push({ source_id: id, status: "dry_run", detail: "would create with id preserved" });
      continue;
    }

    try {
      const createRes = await fetch(`${pbUrl()}/api/collections/${encodeURIComponent(canonical)}/records`, {
        method: "POST",
        headers: adminHeaders(adminToken),
        body: JSON.stringify(sanitizeForCreate(row)),
      });
      if (!createRes.ok) {
        const detail = await createRes.text();
        results.push({
          source_id: id,
          status: "failed",
          detail: `PB ${createRes.status}: ${detail.slice(0, 200)}`,
        });
        continue;
      }
      const created = (await createRes.json()) as { id?: string };
      results.push({ source_id: id, destination_id: created.id ?? id, status: "migrated" });
    } catch (err) {
      results.push({
        source_id: id,
        status: "failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const counts = {
    total_source_rows: sourceRows.length,
    migrated: results.filter((r) => r.status === "migrated").length,
    already_migrated: results.filter((r) => r.status === "already_migrated").length,
    failed: results.filter((r) => r.status === "failed").length,
    dry_run: results.filter((r) => r.status === "dry_run").length,
  };

  // ID preservation verification — every source id should appear as destination_id
  // (for migrated + already_migrated). Failed/dry_run excluded.
  const ids_preserved = results.every(
    (r) =>
      r.status !== "migrated" && r.status !== "already_migrated"
        ? true
        : r.destination_id === r.source_id,
  );

  return Response.json({
    timestamp: new Date().toISOString(),
    source,
    canonical,
    dry_run: !!dry_run,
    counts,
    ids_preserved,
    results,
    next_step:
      counts.failed > 0
        ? "Some rows failed — review detail; re-run after fixing source data."
        : counts.migrated + counts.already_migrated === counts.total_source_rows
          ? "Migration complete. Verify in STAFFD app as affected users, then call /api/admin/drop-orphan-collection with confirm: DROP-<source>."
          : "Migration partial — re-run or investigate.",
  });
}
