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
| 10 | `vault_ingest_queue` | V4 ingestion worker queue |
| 11 | `conversations` | V5 conversation persistence |
| 12 | `conversation_threads` | PR 25 Thread Picker metadata |
| 13 | `push_subscriptions` | Phase 7 web push tokens |
| 14 | `scheduled_content` | Phase 0 scheduling backlog |
| 15 | `bookings` | Booking page submissions |
| 16 | `orchestrator_decisions` | Phase 3 model-routing telemetry |

### Special-pattern collections — 2 entries

#### 17. `clients` (Agency tier)

All five rules:

```
agency_user = @request.auth.id
```

Only Agency-tier users (and comped accounts) ever see this collection. The `agency_user` field replaces `user` to make the agency-vs-client distinction explicit in the schema.

#### 18. `document_versions` (PR 27 history)

All five rules (relational pattern — gates by the parent document's owner):

```
document.user = @request.auth.id
```

This pattern asserts that the **parent `documents` row's** owner must match the authenticated user — ensuring you can only see version history for documents you own.

### System-managed collection — 1 entry

#### 19. `users` (PocketBase default)

Mixed rules:

| Rule | Expected value |
|---|---|
| List | `null` (PB default — admin-only) |
| View | `id = @request.auth.id` |
| Create | `null` (signup goes through PB's `auth-create` endpoint) |
| Update | `id = @request.auth.id` |
| Delete | `id = @request.auth.id` |

`null` means "no API access — admin only." For `users`, that's the correct default for List and Create.

### Bundle 6 G0 anomaly

#### `templates`

All five rules:

```
user = @request.auth.id
```

**⚠️ This collection has no setup route yet** (Bundle 6 G0 — fixed in Tranche 7 by PR-Templates-A). Until that PR ships:

1. Verify the collection exists in PB (`Collections` sidebar)
2. If missing: create it manually with these fields — `user (text, required)`, `name (text, required)`, `department (text)`, `content (text)`. Use this until PR-Templates-A standardizes.
3. Set all five rules per pattern above.

Once PR-Templates-A ships, the setup route will own the schema; this runbook entry can be retired.

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
