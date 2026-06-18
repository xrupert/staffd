/**
 * Migration registry (W95.3.4) — the single source of truth for the in-app
 * migration trigger at /dashboard/admin/migrations.
 *
 * Standard #16 — a registry constant (matching EXPECTED_COLLECTIONS), NOT a
 * build-time filesystem scan of app/api/setup/* (that would drag node:fs into
 * a serverless route — the W91.5 deploy footgun). Adding a new operator-runnable
 * migration = append one entry here.
 *
 * Scope: the app collections an operator actually provisions for Model B3 /
 * cold-start. PB system, Stripe, and vault internal collections are managed by
 * their own bootstrap paths and intentionally omitted.
 */

export type MigrationEntry = {
  /** Route segment under /api/setup/<route>. */
  route: string;
  /** Human label for the UI. */
  label: string;
  /** Representative PB collection used for exists/missing status detection. */
  collection: string;
  /** For schema-extension migrations on an existing collection: status is
   *  "exists" only when this field is present (not merely the collection). */
  detectField?: string;
  /** When true, this collection backs the audit log itself and CANNOT be run
   *  via the in-app trigger — it must be bootstrapped once via x-setup-secret. */
  bootstrap?: boolean;
  note?: string;
};

export const MIGRATION_REGISTRY: MigrationEntry[] = [
  { route: "contacts",           label: "Contacts",            collection: "contacts" },
  { route: "workflow-tasks",     label: "Workflows & tasks",   collection: "workflow_tasks", note: "creates both `workflows` and `workflow_tasks`" },
  { route: "upload-sessions",    label: "Upload sessions",     collection: "upload_sessions" },
  { route: "user-integrations",  label: "User integrations",   collection: "user_integrations" },
  {
    route: "documents-v2",
    label: "Documents — file & extraction",
    collection: "documents",
    detectField: "file",
    note: "adds file (25MB) + source + extraction_status to the existing documents collection",
  },
  // W95.4a — conversational confirm-to-commit collections.
  { route: "interactions",  label: "Interactions",  collection: "interactions" },
  { route: "followups",     label: "Follow-ups",    collection: "followups" },
  { route: "tasks",         label: "Tasks",         collection: "tasks" },
  { route: "leads",         label: "Leads",         collection: "leads" },
  { route: "expenses",      label: "Expenses",      collection: "expenses" },
  {
    route: "admin-migration-log",
    label: "Migration audit log",
    collection: "admin_migration_log",
    bootstrap: true,
    note: "self-bootstrap: create once via x-setup-secret; cannot run through the trigger it logs to",
  },
];

export function getMigration(route: string): MigrationEntry | undefined {
  return MIGRATION_REGISTRY.find((m) => m.route === route);
}
