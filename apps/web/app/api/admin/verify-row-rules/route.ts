/**
 * GET /api/admin/verify-row-rules
 *
 * Decision 59 + 68 + 64 — Multi-tenant security verification.
 *
 * Programmatically validates PocketBase row rules across every user-scoped
 * collection in STAFFD. Read-only — never mutates rules. Operator fixes
 * any gaps via PB admin UI using docs/operator-runbooks/pb-row-rules.md.
 *
 * Auth: caller must be authenticated via pbToken AND the user's email must
 * match ADMIN_EMAIL (env). Mirrors /api/admin/vault-metrics canonical
 * pattern.
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";

// ─── Expected rule patterns (19-collection baseline + templates G0) ───────

type RuleSet = {
  list: string | null;
  view: string | null;
  create: string | null;
  update: string | null;
  delete: string | null;
};

const USER_OWNED: RuleSet = {
  list: "user = @request.auth.id",
  view: "user = @request.auth.id",
  create: "user = @request.auth.id",
  update: "user = @request.auth.id",
  delete: "user = @request.auth.id",
};

const AGENCY_OWNED: RuleSet = {
  list: "agency_user = @request.auth.id",
  view: "agency_user = @request.auth.id",
  create: "agency_user = @request.auth.id",
  update: "agency_user = @request.auth.id",
  delete: "agency_user = @request.auth.id",
};

const DOCUMENT_VERSIONS_RELATIONAL: RuleSet = {
  list: "document.user = @request.auth.id",
  view: "document.user = @request.auth.id",
  // Writes typically gated through /api/documents/[id]/* routes using admin
  // token — create/update/delete can legitimately be null. Surfaced for
  // operator review either way.
  create: "document.user = @request.auth.id",
  update: "document.user = @request.auth.id",
  delete: "document.user = @request.auth.id",
};

// PB system "users" collection — list/create are typically restricted
// (managed by PB); view/update/delete should be self-scoped.
const USERS_SYSTEM: RuleSet = {
  list: null, // PB default — admin-only
  view: "id = @request.auth.id",
  create: null, // signup goes through PB's auth-create endpoint
  update: "id = @request.auth.id",
  delete: "id = @request.auth.id",
};

type ExpectedEntry = {
  name: string;
  expected: RuleSet;
  note?: string;
};

const EXPECTED_COLLECTIONS: ExpectedEntry[] = [
  // Standard user-owned (16)
  { name: "subscriptions", expected: USER_OWNED },
  { name: "businesses", expected: USER_OWNED },
  { name: "documents", expected: USER_OWNED },
  { name: "vault_briefs", expected: USER_OWNED },
  { name: "vault_decisions", expected: USER_OWNED },
  { name: "vault_patterns", expected: USER_OWNED },
  { name: "vault_retrieval_metrics", expected: USER_OWNED },
  { name: "vault_voice_profile", expected: USER_OWNED },
  { name: "vault_embeddings_index", expected: USER_OWNED },
  { name: "vault_ingest_queue", expected: USER_OWNED },
  { name: "conversations", expected: USER_OWNED },
  { name: "conversation_threads", expected: USER_OWNED },
  { name: "push_subscriptions", expected: USER_OWNED },
  { name: "scheduled_content", expected: USER_OWNED },
  { name: "bookings", expected: USER_OWNED },
  { name: "orchestrator_decisions", expected: USER_OWNED },
  // Special-pattern (2)
  { name: "clients", expected: AGENCY_OWNED },
  { name: "document_versions", expected: DOCUMENT_VERSIONS_RELATIONAL },
  // System-managed (1)
  { name: "users", expected: USERS_SYSTEM },
  // Bundle 6 G0 anomaly — exists in PB but no setup route (PR-Templates-A
  // will ship that). Rules currently must be set manually in PB admin UI.
  { name: "templates", expected: USER_OWNED, note: "no_setup_route_yet" },
];

type CollectionStatus = "✅" | "🔴" | "ℹ️";

type CollectionReport = {
  name: string;
  status: CollectionStatus;
  expected_rules: RuleSet;
  actual_rules: RuleSet | null;
  gaps: string[];
  note?: string;
};

type VerifyReport = {
  timestamp: string;
  collections: CollectionReport[];
  overall_status: CollectionStatus;
  gap_count: number;
  collections_checked: number;
};

// ─── Auth helpers (mirror vault-metrics pattern) ─────────────────────────

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

// ─── PB fetch ────────────────────────────────────────────────────────────

type PbCollection = {
  id: string;
  name: string;
  listRule?: string | null;
  viewRule?: string | null;
  createRule?: string | null;
  updateRule?: string | null;
  deleteRule?: string | null;
};

async function fetchCollectionRules(adminToken: string, name: string): Promise<RuleSet | null> {
  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/${encodeURIComponent(name)}`, {
      headers: { Authorization: adminToken },
    });
    if (!res.ok) return null;
    const col = (await res.json()) as PbCollection;
    return {
      list: col.listRule ?? null,
      view: col.viewRule ?? null,
      create: col.createRule ?? null,
      update: col.updateRule ?? null,
      delete: col.deleteRule ?? null,
    };
  } catch {
    return null;
  }
}

async function listAllCollections(adminToken: string): Promise<string[]> {
  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections?perPage=200`, {
      headers: { Authorization: adminToken },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: PbCollection[] };
    return (data.items ?? []).map((c) => c.name);
  } catch {
    return [];
  }
}

// ─── Rule comparison ─────────────────────────────────────────────────────

function compareRules(expected: RuleSet, actual: RuleSet): string[] {
  const gaps: string[] = [];
  const fields: (keyof RuleSet)[] = ["list", "view", "create", "update", "delete"];
  for (const field of fields) {
    const exp = expected[field];
    const act = actual[field];
    if (exp === act) continue;
    // Normalise whitespace for human-error tolerance ("user = @..." vs "user=@...")
    const norm = (s: string | null) => (s ?? "").replace(/\s+/g, "").trim();
    if (norm(exp) === norm(act)) continue;
    if (exp === null && act !== null) {
      gaps.push(`${field} rule should be null (admin-only) but is: ${act}`);
    } else if (exp !== null && act === null) {
      gaps.push(`${field} rule missing (expected: ${exp})`);
    } else {
      gaps.push(`${field} rule mismatch — expected: ${exp} | actual: ${act}`);
    }
  }
  return gaps;
}

// ─── Route handler ───────────────────────────────────────────────────────

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

  // Live PB collection listing — drives the runtime-drift detection branch.
  const liveCollectionNames = await listAllCollections(adminToken);
  const expectedNames = new Set(EXPECTED_COLLECTIONS.map((e) => e.name));

  // Build report for each expected collection.
  const reports: CollectionReport[] = [];
  for (const entry of EXPECTED_COLLECTIONS) {
    const actual = await fetchCollectionRules(adminToken, entry.name);
    if (!actual) {
      reports.push({
        name: entry.name,
        status: "🔴",
        expected_rules: entry.expected,
        actual_rules: null,
        gaps: ["collection_not_found"],
        note: entry.note,
      });
      continue;
    }
    const gaps = compareRules(entry.expected, actual);
    reports.push({
      name: entry.name,
      status: gaps.length === 0 ? "✅" : "🔴",
      expected_rules: entry.expected,
      actual_rules: actual,
      gaps,
      note: entry.note,
    });
  }

  // Surface unexpected (informational — not failure, just visibility).
  for (const name of liveCollectionNames) {
    if (expectedNames.has(name)) continue;
    if (name.startsWith("_")) continue; // PB system collections
    const actual = await fetchCollectionRules(adminToken, name);
    reports.push({
      name,
      status: "ℹ️",
      expected_rules: {
        list: "(no expectation)",
        view: "(no expectation)",
        create: "(no expectation)",
        update: "(no expectation)",
        delete: "(no expectation)",
      } as unknown as RuleSet,
      actual_rules: actual,
      gaps: ["unexpected_collection — not in 19-collection baseline; review expected pattern"],
    });
  }

  const gapCount = reports.filter((r) => r.status === "🔴").reduce((sum, r) => sum + r.gaps.length, 0);
  const hasRed = reports.some((r) => r.status === "🔴");
  const overall: CollectionStatus = hasRed ? "🔴" : "✅";

  const report: VerifyReport = {
    timestamp: new Date().toISOString(),
    collections: reports,
    overall_status: overall,
    gap_count: gapCount,
    collections_checked: reports.length,
  };

  return Response.json(report);
}
