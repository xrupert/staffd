/**
 * POST /api/admin/migrate-orphans-preflight
 *
 * Decision 73 — Phase 1 verification before any data movement.
 * READ-ONLY. Returns:
 *   - per-collection field-by-field schema compatibility
 *   - row counts (source vs. canonical)
 *   - sample row from each side (id + first-3-fields preview)
 *   - block reasons if migration would fail (required-canonical-field
 *     missing from source, type mismatch, etc.)
 *
 * Operator runs this before clicking "Migrate to canonical" in the
 * dashboard. If `can_migrate: false` for any pair, surfaces specific
 * fixes needed.
 *
 * Auth: super-admin (ADMIN_EMAIL match via whoAmI).
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";

type MigrationPair = { source: string; canonical: string };

const PAIRS: MigrationPair[] = [
  { source: "Documents", canonical: "documents" },
  { source: "Templates", canonical: "templates" },
];

type PbField = { name: string; type: string; required?: boolean };
type PbCollection = { id: string; fields?: PbField[] };

type FieldDiff = {
  name: string;
  source_type?: string;
  canonical_type?: string;
  status: "ok" | "missing_in_source" | "missing_in_canonical" | "type_mismatch";
  blocks_migration: boolean;
};

type PairReport = {
  source: string;
  canonical: string;
  source_exists: boolean;
  canonical_exists: boolean;
  source_row_count: number;
  canonical_row_count: number;
  field_diffs: FieldDiff[];
  sample_source_row?: Record<string, unknown>;
  sample_canonical_row?: Record<string, unknown>;
  can_migrate: boolean;
  block_reasons: string[];
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

async function fetchCollection(token: string, name: string): Promise<PbCollection | null> {
  try {
    const res = await fetch(`${pbUrl()}/api/collections/${encodeURIComponent(name)}`, {
      headers: { Authorization: token },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchRowCount(token: string, name: string): Promise<number> {
  try {
    const res = await fetch(
      `${pbUrl()}/api/collections/${encodeURIComponent(name)}/records?page=1&perPage=1&fields=id`,
      { headers: { Authorization: token } },
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as { totalItems?: number };
    return data.totalItems ?? 0;
  } catch {
    return 0;
  }
}

async function fetchSampleRow(token: string, name: string): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(
      `${pbUrl()}/api/collections/${encodeURIComponent(name)}/records?page=1&perPage=1&sort=-created`,
      { headers: { Authorization: token } },
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { items?: Record<string, unknown>[] };
    return data.items?.[0];
  } catch {
    return undefined;
  }
}

function diffFields(sourceFields: PbField[], canonicalFields: PbField[]): FieldDiff[] {
  // PB autodate fields (`created`, `updated`) are managed by PB itself — we don't
  // need to migrate them; PB will set them on insert. Exclude from blocking.
  // `id` is also handled separately via ID preservation.
  const PB_MANAGED = new Set(["id", "created", "updated"]);

  const sourceMap = new Map(sourceFields.map((f) => [f.name, f]));
  const canonicalMap = new Map(canonicalFields.map((f) => [f.name, f]));
  const allNames = new Set([...sourceMap.keys(), ...canonicalMap.keys()]);

  const diffs: FieldDiff[] = [];
  for (const name of allNames) {
    if (PB_MANAGED.has(name)) continue;
    const s = sourceMap.get(name);
    const c = canonicalMap.get(name);
    if (s && c) {
      if (s.type !== c.type) {
        diffs.push({
          name,
          source_type: s.type,
          canonical_type: c.type,
          status: "type_mismatch",
          blocks_migration: true,
        });
      } else {
        diffs.push({
          name,
          source_type: s.type,
          canonical_type: c.type,
          status: "ok",
          blocks_migration: false,
        });
      }
    } else if (s && !c) {
      // Source has a field canonical doesn't — data on this field would be dropped
      // unless added to canonical. Not a hard block; warn only.
      diffs.push({
        name,
        source_type: s.type,
        status: "missing_in_canonical",
        blocks_migration: false,
      });
    } else if (!s && c) {
      // Canonical requires this field; source doesn't have it. If required → block.
      diffs.push({
        name,
        canonical_type: c.type,
        status: "missing_in_source",
        blocks_migration: c.required === true,
      });
    }
  }
  return diffs.sort((a, b) => a.name.localeCompare(b.name));
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

  let adminToken: string;
  try {
    adminToken = await getAdminToken();
  } catch (err) {
    return Response.json(
      { error: "admin_token_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  const pairs: PairReport[] = [];
  for (const pair of PAIRS) {
    const [source, canonical] = await Promise.all([
      fetchCollection(adminToken, pair.source),
      fetchCollection(adminToken, pair.canonical),
    ]);

    if (!source) {
      pairs.push({
        source: pair.source,
        canonical: pair.canonical,
        source_exists: false,
        canonical_exists: !!canonical,
        source_row_count: 0,
        canonical_row_count: canonical ? await fetchRowCount(adminToken, pair.canonical) : 0,
        field_diffs: [],
        can_migrate: false,
        block_reasons: ["source collection does not exist — nothing to migrate"],
      });
      continue;
    }
    if (!canonical) {
      pairs.push({
        source: pair.source,
        canonical: pair.canonical,
        source_exists: true,
        canonical_exists: false,
        source_row_count: await fetchRowCount(adminToken, pair.source),
        canonical_row_count: 0,
        field_diffs: [],
        can_migrate: false,
        block_reasons: [
          `canonical collection '${pair.canonical}' does not exist — create it first via its setup route`,
        ],
      });
      continue;
    }

    const [sourceCount, canonicalCount, sourceSample, canonicalSample] = await Promise.all([
      fetchRowCount(adminToken, pair.source),
      fetchRowCount(adminToken, pair.canonical),
      fetchSampleRow(adminToken, pair.source),
      fetchSampleRow(adminToken, pair.canonical),
    ]);

    const diffs = diffFields(source.fields ?? [], canonical.fields ?? []);
    const blockingDiffs = diffs.filter((d) => d.blocks_migration);
    const blockReasons = blockingDiffs.map((d) => {
      if (d.status === "missing_in_source") {
        return `canonical requires field '${d.name}' (${d.canonical_type}) which source does not have`;
      }
      if (d.status === "type_mismatch") {
        return `field '${d.name}' has incompatible types: source=${d.source_type}, canonical=${d.canonical_type}`;
      }
      return `field '${d.name}': ${d.status}`;
    });

    pairs.push({
      source: pair.source,
      canonical: pair.canonical,
      source_exists: true,
      canonical_exists: true,
      source_row_count: sourceCount,
      canonical_row_count: canonicalCount,
      field_diffs: diffs,
      sample_source_row: sourceSample,
      sample_canonical_row: canonicalSample,
      can_migrate: blockingDiffs.length === 0 && sourceCount > 0,
      block_reasons:
        sourceCount === 0
          ? ["source has zero rows — nothing to migrate; can drop directly"]
          : blockReasons,
    });
  }

  return Response.json({
    timestamp: new Date().toISOString(),
    pairs,
    note: "READ-ONLY preflight. No data written. To execute migration: POST /api/admin/migrate-orphans-execute with confirm token.",
  });
}
