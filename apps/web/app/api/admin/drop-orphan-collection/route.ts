/**
 * POST /api/admin/drop-orphan-collection
 *
 * Decision 73 — Phase 2 destructive operation. Drops an orphan collection
 * from PocketBase. Gated by:
 *   - super-admin auth (ADMIN_EMAIL match)
 *   - explicit `confirm: "DROP-<name>"` literal token in body
 *   - programmatic safety: row_count==0 OR every source id verified
 *     to exist in canonical
 *
 * Body:
 *   {
 *     collection_name: "vault_queue" | "Documents" | "Templates",
 *     confirm: "DROP-<collection_name>",
 *     verified_migrated_to?: "documents" | "templates",  // required if row_count>0
 *   }
 *
 * Allowed collections (allow-list, not arbitrary input):
 *   - vault_queue (Decision 72a — pre-authorized empty drop)
 *   - Documents (Decision 73 — drops after migration verified)
 *   - Templates (Decision 73 — drops after migration verified)
 *
 * Auth: super-admin (ADMIN_EMAIL match via whoAmI).
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";

const ALLOWED_TO_DROP = new Set(["vault_queue", "Documents", "Templates"]);

// For non-empty source collections, we require knowing where the data went.
const MIGRATION_TARGETS: Record<string, string> = {
  Documents: "documents",
  Templates: "templates",
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

async function fetchAllRowIds(token: string, collection: string): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  while (page <= 10) {
    const res = await fetch(
      `${pbUrl()}/api/collections/${encodeURIComponent(collection)}/records?page=${page}&perPage=100&fields=id`,
      { headers: { Authorization: token } },
    );
    if (!res.ok) break;
    const data = (await res.json()) as {
      items?: Array<{ id?: string }>;
      totalPages?: number;
    };
    if (!data.items || data.items.length === 0) break;
    for (const it of data.items) if (it.id) ids.push(it.id);
    if (page >= (data.totalPages ?? 1)) break;
    page++;
  }
  return ids;
}

async function checkExistingId(token: string, collection: string, id: string): Promise<boolean> {
  const res = await fetch(
    `${pbUrl()}/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(id)}`,
    { headers: { Authorization: token } },
  );
  return res.ok;
}

async function fetchCollectionId(token: string, name: string): Promise<string | null> {
  const res = await fetch(`${pbUrl()}/api/collections/${encodeURIComponent(name)}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id?: string };
  return data.id ?? null;
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

  let body: { collection_name?: string; confirm?: string; verified_migrated_to?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const { collection_name, confirm, verified_migrated_to } = body;
  if (!collection_name || !ALLOWED_TO_DROP.has(collection_name)) {
    return Response.json(
      { error: "collection_not_in_allowlist", allowed: [...ALLOWED_TO_DROP] },
      { status: 400 },
    );
  }
  const expectedConfirm = `DROP-${collection_name}`;
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

  // Programmatic safety check
  const sourceIds = await fetchAllRowIds(adminToken, collection_name);
  const rowCount = sourceIds.length;

  let safetyReason = "";
  if (rowCount === 0) {
    safetyReason = "row_count == 0";
  } else {
    // Non-empty source — require verified_migrated_to AND verify every id exists there
    const expectedTarget = MIGRATION_TARGETS[collection_name];
    if (!expectedTarget) {
      return Response.json(
        {
          error: "non_empty_source_no_migration_target_defined",
          collection_name,
          row_count: rowCount,
        },
        { status: 400 },
      );
    }
    if (verified_migrated_to !== expectedTarget) {
      return Response.json(
        {
          error: "verified_migrated_to_required",
          expected: expectedTarget,
          got: verified_migrated_to ?? null,
          row_count: rowCount,
          detail: `Source has ${rowCount} row(s). Drop requires verified_migrated_to="${expectedTarget}" and every source id must exist in that collection.`,
        },
        { status: 400 },
      );
    }
    // Verify every source id is present in the canonical target
    const missing: string[] = [];
    for (const id of sourceIds) {
      const exists = await checkExistingId(adminToken, expectedTarget, id);
      if (!exists) missing.push(id);
    }
    if (missing.length > 0) {
      return Response.json(
        {
          error: "migration_incomplete",
          missing_in_target: missing,
          target: expectedTarget,
          detail: "Source IDs missing from canonical target — migration is incomplete. Re-run /api/admin/migrate-orphans-execute first.",
        },
        { status: 409 },
      );
    }
    safetyReason = `all ${rowCount} source ids verified in canonical '${expectedTarget}'`;
  }

  // Get collection id for DELETE
  const collectionId = await fetchCollectionId(adminToken, collection_name);
  if (!collectionId) {
    return Response.json(
      { error: "collection_already_gone", collection_name },
      { status: 404 },
    );
  }

  // Execute drop
  const dropRes = await fetch(`${pbUrl()}/api/collections/${collectionId}`, {
    method: "DELETE",
    headers: { Authorization: adminToken },
  });
  if (!dropRes.ok) {
    const detail = await dropRes.text();
    return Response.json(
      { error: "drop_failed", detail: detail.slice(0, 300) },
      { status: 500 },
    );
  }

  console.log(
    `[drop-orphan-collection] dropped ${collection_name} (id=${collectionId}) ` +
      `by ${me.email}; safety=${safetyReason}`,
  );

  return Response.json({
    ok: true,
    dropped: collection_name,
    collection_id: collectionId,
    rows_dropped: rowCount,
    safety_reason: safetyReason,
    dropped_by: me.email,
    timestamp: new Date().toISOString(),
  });
}
