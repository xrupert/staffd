/**
 * V1 substrate health report (W95.7) — the operator's single source of truth
 * for "is the substrate healthy?".
 *
 * `buildHealthReport` is a PURE function over the canonical registries + a
 * collection-presence probe, so the route stays thin and the logic is unit-
 * testable (mock a missing handler / pending migration → the report flags it).
 *
 * The EXPECTED_* constants below are the V1 substrate CONTRACT. They are
 * deliberately explicit (not derived from the same maps they validate) so a
 * registry losing an entry surfaces as a `missing` — the registry is the
 * implementation, this is the spec it must satisfy.
 */

/** The 11 V1 worker handlers (workflow-drain dispatch targets). */
export const EXPECTED_WORKERS = [
  "mirror_retry_worker",
  "document_extraction_worker",
  "listmonk_subscribe_worker",
  "twenty_update_worker",
  "twenty_delete_worker",
  "listmonk_unsubscribe_worker",
  "docuseal_send_worker",
  "docuseal_void_worker",
  "chatwoot_resolve_worker",
  "chatwoot_tag_worker",
  "chatwoot_send_worker",
] as const;

/** The 13 V1 conversational intents (business writes/delegates; meta-controls excluded). */
export const EXPECTED_INTENTS = [
  "create_contact",
  "log_interaction",
  "schedule_followup",
  "add_to_email_list",
  "create_task",
  "capture_lead",
  "update_contact",
  "log_expense",
  "draft_campaign",
  "send_for_signature",
  "reply_to_ticket",
  "resolve_ticket",
  "tag_conversation",
] as const;

/** The V1 recipes (recipe_id → second worker on review-approve). */
export const EXPECTED_RECIPES = ["reply_to_ticket", "send_for_signature"] as const;

export const VENDOR_KEYS = ["twenty", "listmonk", "chatwoot", "docuseal", "plausible"] as const;

export type HealthReport = {
  ok: boolean;
  collections: { expected_count: number; found_count: number; missing: string[]; extra: string[] };
  intents: { expected: string[]; handlers_registered: string[]; missing_handlers: string[] };
  workers: { expected: string[]; registered: string[]; missing: string[] };
  vendor_clients: Record<string, { client_present: boolean; env_configured: boolean }>;
  migrations: { total: number; applied: number; pending: string[] };
  recipes: { expected: string[]; registered: string[]; missing: string[]; paradigm_doc_in_sync: boolean };
};

export type HealthInputs = {
  /** Expected collection names (EXPECTED_COLLECTIONS). */
  expectedCollections: string[];
  /** Collection names actually present in PB. */
  foundCollections: string[];
  /** COMMIT_HANDLERS keys. */
  commitHandlers: string[];
  /** WORKER_HANDLERS keys. */
  workerHandlers: string[];
  /** SECOND_WORKER keys (recipe ids). */
  recipeIds: string[];
  /** Per-vendor configured flags (Client.configured). */
  vendorConfigured: Record<string, boolean>;
  /** MIGRATION_REGISTRY entries with their applied status. */
  migrations: { route: string; applied: boolean }[];
};

const missingFrom = (expected: readonly string[], have: string[]): string[] =>
  expected.filter((x) => !have.includes(x));

export function buildHealthReport(i: HealthInputs): HealthReport {
  // PocketBase system collections are `_`-prefixed (e.g. _mfas, _otps,
  // _externalAuths, _authOrigins, _superusers in PB v0.23+) — framework
  // infrastructure, never app schema. Exclude them so they're not flagged as
  // drift (mirrors the `_` skip in /api/admin/verify-row-rules).
  const appFound = i.foundCollections.filter((c) => !c.startsWith("_"));
  const collMissing = missingFrom(i.expectedCollections, appFound);
  const collExtra = appFound.filter((c) => !i.expectedCollections.includes(c));

  const missingHandlers = missingFrom(EXPECTED_INTENTS, i.commitHandlers);
  const missingWorkers = missingFrom(EXPECTED_WORKERS, i.workerHandlers);
  const missingRecipes = missingFrom(EXPECTED_RECIPES, i.recipeIds);
  // In sync = the recipe registry is exactly the V1 contract (no missing, no
  // extra). The authoritative doc↔code drift guard is paradigm-recipes.test.ts
  // (Standard #29); this runtime flag mirrors it without reading the doc.
  const recipesInSync = missingRecipes.length === 0 && i.recipeIds.every((r) => (EXPECTED_RECIPES as readonly string[]).includes(r));

  const pending = i.migrations.filter((m) => !m.applied).map((m) => m.route);

  const vendor_clients: HealthReport["vendor_clients"] = {};
  for (const v of VENDOR_KEYS) {
    vendor_clients[v] = { client_present: true, env_configured: !!i.vendorConfigured[v] };
  }

  const ok =
    collMissing.length === 0 &&
    missingHandlers.length === 0 &&
    missingWorkers.length === 0 &&
    missingRecipes.length === 0 &&
    recipesInSync &&
    pending.length === 0;

  return {
    ok,
    collections: { expected_count: i.expectedCollections.length, found_count: appFound.length, missing: collMissing, extra: collExtra },
    intents: { expected: [...EXPECTED_INTENTS], handlers_registered: i.commitHandlers, missing_handlers: missingHandlers },
    workers: { expected: [...EXPECTED_WORKERS], registered: i.workerHandlers, missing: missingWorkers },
    vendor_clients,
    migrations: { total: i.migrations.length, applied: i.migrations.filter((m) => m.applied).length, pending },
    recipes: { expected: [...EXPECTED_RECIPES], registered: i.recipeIds, missing: missingRecipes, paradigm_doc_in_sync: recipesInSync },
  };
}
