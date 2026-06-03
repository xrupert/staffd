/**
 * Single source of truth for PocketBase row-rule expectations + helpers
 * to enforce them.
 *
 * Per Decision 68 (19-collection baseline) + Decision 69 (Security Floor
 * Restoration via Code). Consumed by:
 *   • /api/admin/verify-row-rules — READ-ONLY status report
 *   • /api/admin/repair-row-rules — WRITE: PATCH rules to expected
 *   • /api/worker/security-audit — daily cron drift detection
 *   • setup/* routes — automatic enforcement at collection creation/update
 *
 * Per Standard #1 (Setup Route Discipline) — every user-scoped collection
 * setup route imports `ensureCollectionRules` and calls it after schema
 * operations. Per Standard #2 (Single Source of Truth) — only this file
 * defines expected rules.
 *
 * READ-ONLY default: `ensureCollectionRules` is the only mutating helper.
 * Verification helpers return reports; the dashboard renders them.
 */

import { getAdminToken, pbUrl } from "../pb";

export type RuleSet = {
  list: string | null;
  view: string | null;
  create: string | null;
  update: string | null;
  delete: string | null;
};

export const USER_OWNED_RULES: RuleSet = {
  list: "user = @request.auth.id",
  view: "user = @request.auth.id",
  create: "user = @request.auth.id",
  update: "user = @request.auth.id",
  delete: "user = @request.auth.id",
};

export const AGENCY_OWNED_RULES: RuleSet = {
  list: "agency_user = @request.auth.id",
  view: "agency_user = @request.auth.id",
  create: "agency_user = @request.auth.id",
  update: "agency_user = @request.auth.id",
  delete: "agency_user = @request.auth.id",
};

export const DOCUMENT_VERSIONS_RULES: RuleSet = {
  list: "document.user = @request.auth.id",
  view: "document.user = @request.auth.id",
  create: "document.user = @request.auth.id",
  update: "document.user = @request.auth.id",
  delete: "document.user = @request.auth.id",
};

export const USERS_SYSTEM_RULES: RuleSet = {
  list: null,
  view: "id = @request.auth.id",
  create: null,
  update: "id = @request.auth.id",
  delete: "id = @request.auth.id",
};

export type ExpectedEntry = {
  name: string;
  rules: RuleSet;
  note?: string;
  /** When true, repair skips this collection (verify still reports status). */
  systemManaged?: boolean;
};

/**
 * The 19-collection baseline + templates G0 anomaly. Decision 68.
 *
 * `systemManaged: true` means repair skips it — operator must not modify
 * PB system collections (e.g., `users`) autonomously.
 */
export const EXPECTED_COLLECTIONS: ExpectedEntry[] = [
  // Standard user-owned (16)
  { name: "subscriptions", rules: USER_OWNED_RULES },
  { name: "businesses", rules: USER_OWNED_RULES },
  { name: "documents", rules: USER_OWNED_RULES },
  { name: "vault_briefs", rules: USER_OWNED_RULES },
  { name: "vault_decisions", rules: USER_OWNED_RULES },
  { name: "vault_patterns", rules: USER_OWNED_RULES },
  { name: "vault_retrieval_metrics", rules: USER_OWNED_RULES },
  { name: "vault_voice_profile", rules: USER_OWNED_RULES },
  { name: "vault_embeddings_index", rules: USER_OWNED_RULES },
  { name: "vault_ingest_queue", rules: USER_OWNED_RULES },
  { name: "conversations", rules: USER_OWNED_RULES },
  { name: "conversation_threads", rules: USER_OWNED_RULES },
  { name: "push_subscriptions", rules: USER_OWNED_RULES },
  { name: "scheduled_content", rules: USER_OWNED_RULES },
  { name: "bookings", rules: USER_OWNED_RULES },
  { name: "orchestrator_decisions", rules: USER_OWNED_RULES },
  // Special-pattern (2)
  { name: "clients", rules: AGENCY_OWNED_RULES },
  { name: "document_versions", rules: DOCUMENT_VERSIONS_RULES },
  // System-managed (1) — verify only; repair skips
  { name: "users", rules: USERS_SYSTEM_RULES, systemManaged: true },
  // Bundle 6 G0 anomaly — setup route lands in this same PR
  { name: "templates", rules: USER_OWNED_RULES },
];

/** Quick lookup helper. */
export function getExpected(name: string): ExpectedEntry | undefined {
  return EXPECTED_COLLECTIONS.find((e) => e.name === name);
}

// ─── PB fetch helpers ────────────────────────────────────────────────────

type PbCollection = {
  id: string;
  name: string;
  listRule?: string | null;
  viewRule?: string | null;
  createRule?: string | null;
  updateRule?: string | null;
  deleteRule?: string | null;
};

/**
 * Reads the live rule state for a collection. Returns null if collection
 * doesn't exist (allowing callers to distinguish "missing" from "wrong").
 */
export async function fetchCollectionRules(
  adminToken: string,
  name: string,
): Promise<{ rules: RuleSet; collectionId: string } | null> {
  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/${encodeURIComponent(name)}`, {
      headers: { Authorization: adminToken },
    });
    if (!res.ok) return null;
    const col = (await res.json()) as PbCollection;
    return {
      collectionId: col.id,
      rules: {
        list: col.listRule ?? null,
        view: col.viewRule ?? null,
        create: col.createRule ?? null,
        update: col.updateRule ?? null,
        delete: col.deleteRule ?? null,
      },
    };
  } catch {
    return null;
  }
}

/** List every collection in PB (for unexpected-collection drift detection). */
export async function listAllCollectionNames(adminToken: string): Promise<string[]> {
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

// ─── Comparison + repair ─────────────────────────────────────────────────

/**
 * Returns the list of gaps between expected and actual rule sets. Empty
 * array = match. Whitespace-tolerant.
 */
export function compareRules(expected: RuleSet, actual: RuleSet): string[] {
  const gaps: string[] = [];
  const fields: (keyof RuleSet)[] = ["list", "view", "create", "update", "delete"];
  const norm = (s: string | null) => (s ?? "").replace(/\s+/g, "").trim();
  for (const f of fields) {
    if (norm(expected[f]) === norm(actual[f])) continue;
    if (expected[f] === null && actual[f] !== null) {
      gaps.push(`${f} rule should be null (admin-only) but is: ${actual[f]}`);
    } else if (expected[f] !== null && actual[f] === null) {
      gaps.push(`${f} rule missing (expected: ${expected[f]})`);
    } else {
      gaps.push(`${f} rule mismatch — expected: ${expected[f]} | actual: ${actual[f]}`);
    }
  }
  return gaps;
}

/**
 * Convert a typed RuleSet to the PB PATCH body shape (camelCase Rule
 * suffix, e.g., listRule). null is sent as null (PB stores admin-only).
 */
function ruleSetToPbBody(rules: RuleSet): Record<string, string | null> {
  return {
    listRule: rules.list,
    viewRule: rules.view,
    createRule: rules.create,
    updateRule: rules.update,
    deleteRule: rules.delete,
  };
}

export type EnsureResult =
  | { status: "already-correct"; before: RuleSet; after: RuleSet }
  | { status: "repaired"; before: RuleSet; after: RuleSet }
  | { status: "skipped-system-managed"; before: RuleSet | null }
  | { status: "skipped-not-found"; reason: string }
  | { status: "failed"; before: RuleSet | null; reason: string };

/**
 * Idempotent rule-enforcement for a single collection.
 *
 *   • Reads current rules
 *   • If collection doesn't exist → status: "skipped-not-found"
 *   • If `entry.systemManaged` → status: "skipped-system-managed"
 *   • If rules already match → status: "already-correct" (no PB write)
 *   • Else → PATCH the rules → status: "repaired"
 *
 * Safe to call on every setup-route invocation. Safe to call from the
 * repair endpoint. Safe to call from a daily cron.
 */
export async function ensureCollectionRules(
  adminToken: string,
  name: string,
): Promise<EnsureResult> {
  const expected = getExpected(name);
  if (!expected) {
    return { status: "skipped-not-found", reason: `no expected rules for ${name}` };
  }

  const current = await fetchCollectionRules(adminToken, name);
  if (!current) {
    return { status: "skipped-not-found", reason: "collection_not_found" };
  }

  if (expected.systemManaged) {
    return { status: "skipped-system-managed", before: current.rules };
  }

  const gaps = compareRules(expected.rules, current.rules);
  if (gaps.length === 0) {
    return { status: "already-correct", before: current.rules, after: current.rules };
  }

  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/${current.collectionId}`, {
      method: "PATCH",
      headers: { Authorization: adminToken, "Content-Type": "application/json" },
      body: JSON.stringify(ruleSetToPbBody(expected.rules)),
    });
    if (!res.ok) {
      const detail = await res.text();
      return {
        status: "failed",
        before: current.rules,
        reason: `PB PATCH failed (${res.status}): ${detail.slice(0, 300)}`,
      };
    }
    return { status: "repaired", before: current.rules, after: expected.rules };
  } catch (err) {
    return {
      status: "failed",
      before: current.rules,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Convenience: ensure rules using a freshly-obtained admin token. Most
 * setup routes already have a token; they can call `ensureCollectionRules`
 * directly. This is for code paths that don't otherwise need the token.
 */
export async function ensureCollectionRulesWithFreshToken(name: string): Promise<EnsureResult> {
  try {
    const token = await getAdminToken();
    return ensureCollectionRules(token, name);
  } catch (err) {
    return {
      status: "failed",
      before: null,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
