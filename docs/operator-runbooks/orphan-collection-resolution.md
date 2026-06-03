# Orphan Collection Resolution — Operator Runbook

Companion to `/dashboard/admin/security` **Investigation Panel** (Decision 71 — PR-Tranche-1-Security-Cleanup).

## What "orphan" means here

The security verifier scans PB for collections that:
- Are **not** in the 19-collection baseline (Decision 68) or the `templates` G0 anomaly
- **Are** present in PB

These show in the dashboard as `ℹ️` rows. They are not security gaps per se — they're schema drift artifacts that need an operator decision before they can be safely cleaned up.

As of this writing the suspected orphans are:

| Orphan name | Canonical equivalent | Origin (best guess) |
|---|---|---|
| `Documents` | `documents` | Case-variant artifact from an early migration draft |
| `Templates` | `templates` | Case-variant artifact from Bundle 6 G0 |
| `vault_queue` | `vault_ingest_queue` | Pre-rename artifact from V4 ingestion worker |

## Why we don't auto-drop them

Per **Decision 69** (security floor restoration via code) and the broader **Operator-Task Minimization principle** balanced against `STAFFD never executes externally without explicit user authorization`:

- A collection drop is destructive and irreversible from STAFFD's side.
- A row count of 0 today doesn't prove no future job will write into it.
- The verifier may surface false positives (e.g., a collection the operator is in the middle of creating).

So: STAFFD **investigates and recommends**; the operator **records a decision**; a Senior-Architect-authorized follow-up PR **executes** the drop (if approved).

## Workflow

### 1. Sign in to the security dashboard

Open `/dashboard/admin/security` as the super-admin (the account whose email matches `ADMIN_EMAIL` in Vercel).

### 2. Run the orphan investigation

The Investigation Panel auto-loads whenever the main status report includes `ℹ️` rows. Click **Refresh Investigation** to re-fetch.

Each orphan card shows:

- **Name** + whether it exists in PB
- **Row count** + last-modified timestamp
- **Schema preview** (expandable)
- **Canonical equivalent** + schema-overlap percentage with that canonical
- **STAFFD recommendation** + reasoning (one of: `drop_safe`, `drop_after_migration`, `investigate_active_usage`, `keep_with_setup_route`)

### 3. Compare orphan vs. canonical

For a `drop_safe` recommendation to be trustworthy:
- Orphan row count = 0
- Canonical exists and is the active collection (`documents`, `templates`, `vault_ingest_queue`)
- Schema overlap should be ≥50% (otherwise the orphan might be tracking something different)

If the recommendation is `drop_after_migration` (orphan has rows):
- Read the row count and last-modified timestamp
- Decide whether the data is recoverable from elsewhere or needs migration to the canonical

### 4. Record the decision

Optionally enter notes in the "Reason / notes" field, then click the appropriate decision button:

| Decision | Meaning |
|---|---|
| **Mark Drop-Safe** | Empty + canonical exists — Senior Architect will authorize the drop |
| **Mark Drop-After-Migration** | Has rows + canonical exists — migration must precede drop |
| **Mark for Investigation** | Unclear — code references need a deeper look before deciding |
| **Mark Keep + Add Setup Route** | Active collection that belongs in the 19-collection baseline |

Decisions persist to the `orphan_decisions` PocketBase collection with `status: "pending"`. Setup the collection first via `POST /api/setup/orphan-decisions` if you see "collection_not_created" — this is a one-time bootstrap.

### 5. Hand off to Senior Architect

Paste the panel's contents (or query `GET /api/admin/orphan-decisions` directly) to your Senior Architect for review. They will:

1. Audit the recorded decisions
2. Open a follow-up PR (e.g., `PR-Tranche-1-Post-Orphan-Cleanup`) that performs any approved drops
3. Mark the rows `status: "executed"` once the drop ships

## What if STAFFD's recommendation is wrong?

You can record any decision regardless of what STAFFD recommends. The recommended button is highlighted but all four are clickable. The recorded decision is what the Senior Architect acts on.

## What if the orphan list grows?

`SUSPECT_COLLECTIONS` in `apps/web/app/api/admin/orphan-details/route.ts` is the canonical list of orphans the panel investigates. To add a new one:

1. Add `{ name: "FooBar", canonical: "foo_bar" }` to the array
2. Ship a tiny PR; the panel auto-includes it the next time the verifier surfaces it as `ℹ️`

## Read-only guarantee (investigation surfaces)

The investigation surfaces are strictly read-only:
- `GET /api/admin/orphan-details` — reads collection metadata + row counts only
- `POST /api/admin/orphan-decisions` — writes to `orphan_decisions` ONLY (records the decision; does not touch the orphan)
- `GET /api/admin/orphan-decisions` — lists prior decisions
- `POST /api/admin/migrate-orphans-preflight` — schema diff + sample rows + can_migrate verdict; **NO data movement**

## Destructive operations (Decision 73 — gated)

Two endpoints perform destructive PB operations. Both are super-admin-gated AND require explicit literal confirm tokens in the request body. Both enforce programmatic safety checks server-side — operator clicks alone are not sufficient.

### Migrate orphan data to canonical

`POST /api/admin/migrate-orphans-execute`

```json
{
  "source": "Documents",
  "canonical": "documents",
  "confirm": "MIGRATE-Documents",
  "dry_run": false
}
```

**Contract:**
- Iterates every row in source
- Strips PB-managed fields (`collectionId`, `collectionName`, `expand`)
- POSTs to canonical with the **same id preserved** (so any external URLs/references stay valid)
- Idempotent: if canonical already has that id, reports `already_migrated` and skips
- `dry_run: true` reports intended actions without writing
- **Does NOT delete source rows** — that's a separate step

**Dashboard:** "Migrate to {canonical} ({row_count})" button per orphan card.

### Drop orphan collection

`POST /api/admin/drop-orphan-collection`

```json
{
  "collection_name": "Documents",
  "confirm": "DROP-Documents",
  "verified_migrated_to": "documents"
}
```

**Allow-list:** Only `vault_queue`, `Documents`, `Templates` can be dropped via this endpoint. The endpoint refuses any other collection name with `400 collection_not_in_allowlist`.

**Programmatic safety gate (cannot be overridden from client):**
- If `row_count == 0` → allowed
- If `row_count > 0` → requires `verified_migrated_to` AND every source id must exist in that canonical collection. If any source id is missing → returns `409 migration_incomplete` with the missing ids; **drop refused**.

**Dashboard:** "Drop {name}" button per orphan; native browser `confirm()` dialog as final friction. Server-side safety check still authoritative.

**Logged:** every successful drop emits a `console.log` line with `dropped_by` (operator email), collection id, row count, safety reason.

## Related runbooks

- `pb-row-rules.md` — fixing the 19-collection baseline gaps
- `security-floor-restoration.md` — the bulk repair endpoint (`POST /api/admin/repair-row-rules`)
