# PocketBase Row Rules — Operator Runbook

Companion to `/api/admin/verify-row-rules` + `/dashboard/admin/security` (PR-Bundle-10-Security-Audit). When the security dashboard surfaces a 🔴 row, follow the steps in this runbook to fix the gap in the PB admin UI.

## Scope

Covers the 19-collection baseline (Decision 68) + the `templates` Bundle-6-G0 anomaly. All STAFFD user-scoped data lives in PocketBase, hosted on Railway. Multi-tenant isolation is enforced via PB row rules at the database tier — without correct rules a malicious caller could read or modify another user's data via direct PB API calls.

## Prerequisites

1. PB admin URL: see Vercel env `NEXT_PUBLIC_POCKETBASE_URL` → `https://<host>/_/`
2. Admin credentials: `PB_ADMIN_EMAIL` + `PB_ADMIN_PASSWORD` (same env vars STAFFD uses programmatically)
3. STAFFD super-admin signed into `/dashboard/admin/security` to confirm the fix

## General fix procedure (any collection)

1. Open `<NEXT_PUBLIC_POCKETBASE_URL>/_/` in a browser
2. Sign in with the `PB_ADMIN_EMAIL` credentials
3. Click **Collections** in the left sidebar
4. Click the **collection name** flagged in the dashboard
5. Click the **API Rules** tab (top of the collection edit panel)
6. Set the relevant rule field (List / View / Create / Update / Delete) to the expected pattern below
7. Click **Save**
8. Return to `/dashboard/admin/security` and click **Refresh Status** — the row should turn ✅

> **Idempotent:** running this runbook on a correctly-configured collection produces no change.

---

## Per-collection expected rules

### Standard user-owned collections — 16 entries

All five rules (List / View / Create / Update / Delete) should be set to:

```
user = @request.auth.id
```

Apply to each of:

| # | Collection | Notes |
|---|---|---|
| 1 | `subscriptions` | Stripe-managed via webhook; user must read own plan state |
| 2 | `businesses` | The Vault — single row per user |
| 3 | `documents` | Generated work; cascade-deletion cleanup covers this |
| 4 | `vault_briefs` | Morning Brief outputs |
| 5 | `vault_decisions` | Phase 5 outcomes feedback |
| 6 | `vault_patterns` | Phase 6 pattern signals |
| 7 | `vault_retrieval_metrics` | V2 retrieval cost telemetry |
| 8 | `vault_voice_profile` | Phase 2 brand voice fingerprint |
| 9 | `vault_embeddings_index` | V2 per-user Qdrant point manifest |
| 10 | ~~`vault_ingest_queue`~~ | **Moved to ADMIN_ONLY pattern — see below (Decision 71)** |
| 11 | `conversations` | V5 conversation persistence |
| 12 | `conversation_threads` | PR 25 Thread Picker metadata |
| 13 | `push_subscriptions` | Phase 7 web push tokens |
| 14 | `scheduled_content` | Phase 0 scheduling backlog |
| 15 | `bookings` | Booking page submissions |
| 16 | `orchestrator_decisions` | Phase 3 model-routing telemetry |

### Special-pattern collections — 3 entries

#### 17. `clients` (Agency tier)

All five rules:

```
agency_user = @request.auth.id
```

Only Agency-tier users (and comped accounts) ever see this collection. The `agency_user` field replaces `user` to make the agency-vs-client distinction explicit in the schema.

#### 18. `document_versions` (PR 27 history) — Decision 71

All five rules (uses the **denormalized `user` field**, NOT relational):

```
user = @request.auth.id
```

> **Decision 71 update:** Earlier versions of this runbook called for `document.user = @request.auth.id`. That relational pattern requires `document` to be a PB relation-type field, but `document_versions.document` is a plain text id. PR-27 deliberately denormalized `user` at insert-time precisely so this standard pattern works without relation traversal. Use `user = @request.auth.id`.

#### 19. `vault_ingest_queue` (backend infrastructure) — Decision 71

All five rules:

```
(null — empty / admin-only)
```

> **Decision 71 update:** `vault_ingest_queue` is a backend infrastructure collection with **no `user` field by design**. The vault ingestion worker uses the PB admin token (bypasses all rules) to dispatch jobs across all users. Users never have a reason to query this queue directly. All rules `null` = admin-only access.
>
> Earlier versions of this runbook listed `vault_ingest_queue` under the user-owned 16. That was incorrect — the `user` field never existed in this schema; the rule could never have worked.

### System-managed collection — 1 entry

#### 20. `users` (PocketBase auth collection) — Decision 71

Mixed rules:

| Rule | Expected value |
|---|---|
| List | `id = @request.auth.id` (PB auth-collection self-listing default) |
| View | `id = @request.auth.id` |
| Create | `""` (empty string — signup goes through PB's `auth-create` endpoint) |
| Update | `id = @request.auth.id` |
| Delete | `id = @request.auth.id` |

> **Decision 71 update:** Earlier versions called for `List: null` (admin-only). Codebase grep confirmed zero callsites depend on a `null` list rule — `users` is only ever accessed via `auth-refresh` or single-record GET-by-id; admin paths use the admin token (bypasses rules regardless). PB's default for auth collections is self-listing (`id = @request.auth.id`), which is safer (operator can find their own account in the PB UI) and matches PB's out-of-the-box state.
>
> `systemManaged: true` — the repair endpoint never modifies `users` autonomously. If PB returns something other than the expected pattern, fix it manually in PB admin UI.

### Bundle 6 G0 anomaly

#### `templates`

All five rules:

```
user = @request.auth.id
```

**Setup route + in-app trigger (G0 closed).** `templates` now has a baseline
setup route (`/api/setup/templates`, creates the collection + enforces
`USER_OWNED` rules via `ensureCollectionRules`) and is registered in
`MIGRATION_REGISTRY` (route `templates`) — so run it from
`/dashboard/admin/migrations` ("Document templates") like any other migration,
not by hand. Baseline schema: `user (text, required)`, `name (text, required)`,
`department (text)`, `content (text)`. The full Model-C schema (scope /
variables / capabilities / tags) is a future Tranche-7 extension on top of this
baseline; the patch-missing-fields pattern preserves any extra fields prod
already has.

---

## Verifying the fix

After each save in PB admin UI:

1. Navigate to `/dashboard/admin/security`
2. Click **Refresh Status**
3. The just-fixed row should now show ✅
4. The overall banner should reflect the new gap count

If a row still shows 🔴 after the fix:
- Confirm you clicked Save (not Cancel) in PB admin UI
- Confirm you edited the correct collection name
- Check the gap details (click the row to expand): the dashboard shows what it expected vs. what it found

## Common pitfalls

| Symptom | Likely cause | Fix |
|---|---|---|
| Rule looks correct but dashboard still flags 🔴 | Whitespace difference (e.g., `user=@request.auth.id` vs `user = @request.auth.id`) | The verifier normalizes whitespace — should already match. If not, paste the rule from this runbook verbatim. |
| `collection_not_found` for a collection that exists | PB rate-limited the admin API request; refresh in 30s | If persists, check Railway PB health |
| `ℹ️ unexpected_collection` row appears | Schema drift — a new collection was added that's not in the 19-collection baseline | Add an expected-pattern entry to `apps/web/app/api/admin/verify-row-rules/route.ts:EXPECTED_COLLECTIONS` in a follow-up PR |
| Cron alert fires but dashboard shows ✅ | Verified after fix landed; cron snapshot was older | Re-trigger cron manually: `curl -H "x-worker-secret: $WORKER_SECRET" https://urstaffd.com/api/worker/security-audit` |

## Daily cron behaviour

`/api/worker/security-audit` runs daily at **2 AM UTC** per `vercel.json`. Console-logs structured findings. When `super_admin_signals` ships (Tranche 6 PR-Super-Admin-Intelligence-A), the cron will also write to that collection and email `ADMIN_EMAIL` on regression.

Manual trigger for verification:

```bash
curl -H "x-worker-secret: <WORKER_SECRET>" \
  https://urstaffd.com/api/worker/security-audit
```

Expected output on a clean system:

```json
{
  "ok": true,
  "timestamp": "2026-06-03T...Z",
  "collections_checked": 20,
  "secure_collections": 20,
  "flagged_collections": 0,
  "total_gaps": 0,
  "findings": [ ... 20 entries with status:"✅" ... ]
}
```
