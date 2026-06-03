# Security Floor Restoration — Operator Runbook

Companion to PR-Tranche-1-Post-Security-Hardening (Decision 69). Single-click bulk row-rule repair via the security dashboard.

## When to use this

When `/dashboard/admin/security` shows **🔴 N gap(s) detected** instead of **✅ All collections secure**.

The dashboard's diagnostic logic is read-only — it surfaces gaps but never modifies PB. This runbook describes the one-click repair that uses the canonical expected-rules registry in `apps/web/app/api/_lib/security/row-rules.ts` to PATCH every flagged collection back to the expected pattern.

## Primary fix path (automatic, on next deploy)

PR-Tranche-1-Post-Security-Hardening modified every setup route under `apps/web/app/api/setup/*` to call `ensureCollectionRulesWithFreshToken(collectionName)` after its schema work. **Every time a setup route runs (manual trigger or in CI), it auto-enforces row rules.**

The setup routes are idempotent — re-running them on already-correct collections is a no-op (the helper short-circuits when `compareRules` finds no gaps).

## Single-click repair (safety net)

When prior setup routes ran without rule enforcement (i.e., before this PR), the live PB still holds the old wide-open rules. The dashboard's "Run Security Repair" button fixes that without re-running 14 setup routes individually.

### Steps

1. Sign in as super-admin at `urstaffd.com` (account with email matching `ADMIN_EMAIL`)
2. Navigate to `/dashboard/admin/security`
3. Review the status table — note which collections are 🔴
4. Click **"Run Security Repair"** (only visible when overall status is 🔴)
5. Wait ~30–60 seconds for the bulk PATCH to complete
6. The dashboard auto-refreshes and shows the new status
7. Confirm the result banner: `✅ all repaired — N repaired · M already correct · K skipped (system-managed) · 0 failed`

### What gets repaired

The 19-collection baseline (Decision 68) + the templates G0 anomaly:

| Pattern | Collections |
|---|---|
| `user = @request.auth.id` | subscriptions, businesses, documents, vault_briefs, vault_decisions, vault_patterns, vault_retrieval_metrics, vault_voice_profile, vault_embeddings_index, vault_ingest_queue, conversations, conversation_threads, push_subscriptions, scheduled_content, bookings, orchestrator_decisions, **templates** |
| `agency_user = @request.auth.id` | clients |
| `document.user = @request.auth.id` | document_versions |
| **SKIPPED (system-managed)** | users |

### What does NOT get repaired

- `users` — PB system collection. Repair endpoint skips it. If the audit dashboard shows ✅ status, no action needed. If 🔴, surface to engineering — manual investigation only.
- `ℹ️ unexpected_collection` entries — these are NOT in the baseline. See [Orphan Collection Investigation](#orphan-collection-investigation) below.

## Manual repair via curl

For automation / CI / scripted verification:

```bash
# Sign in to get a pbToken
PB_TOKEN=$(curl -sS -X POST \
  -H "Content-Type: application/json" \
  -d '{"identity":"admin@example.com","password":"..."}' \
  https://urstaffd.com/api/collections/users/auth-with-password | jq -r '.token')

# Trigger repair
curl -sS -X POST \
  "https://urstaffd.com/api/admin/repair-row-rules?pbToken=$PB_TOKEN" | jq

# Verify
curl -sS \
  "https://urstaffd.com/api/admin/verify-row-rules?pbToken=$PB_TOKEN" | jq '.overall_status, .gap_count'
```

## Orphan Collection Investigation

The dashboard may show `ℹ️` rows like `Documents`, `Templates`, `vault_queue` — case-variant duplicates from prior schema drift. These are NOT in the 19-collection baseline so the repair endpoint skips them.

To investigate:

```bash
curl -sS "https://urstaffd.com/api/admin/investigate-orphan-collections?pbToken=$PB_TOKEN" | jq
```

The investigation endpoint returns:
- Whether each suspect exists in PB
- Field schema + row count
- Created/updated timestamps
- Current row rules
- **Recommendation** (empty → safe to drop; data-bearing → migrate first)

**No deletions happen automatically.** Operator reviews the recommendations and decides each case in PB admin UI per Decision 69 ("DO NOT delete anything autonomously").

## Verification + ongoing monitoring

| Surface | Frequency | Purpose |
|---|---|---|
| `/dashboard/admin/security` (manual) | After PB schema changes; after migrations; before each Tranche begins | Live status snapshot |
| `/api/worker/security-audit` (daily cron at 2 AM UTC) | Continuous | Drift detection. Logs to Vercel function logs. |
| `/api/admin/verify-row-rules` (programmatic) | As needed | Direct JSON for scripting + Tranche-closure baselines |

## Failure modes

| Symptom | Cause | Resolution |
|---|---|---|
| Repair returns `🔴 N failures` | PB admin token expired mid-batch, or PB rejected a PATCH (e.g., invalid rule syntax) | Re-run repair (idempotent). If failures persist, check the `error` field per collection in the JSON response. |
| `collection_not_found` for a collection that should exist | Collection was renamed or dropped manually in PB admin UI | Re-run its setup route to recreate it: `POST /api/setup/<route-name>`. |
| Dashboard 403 after sign-in | `ADMIN_EMAIL` env var not set OR signed-in email doesn't match | Set `ADMIN_EMAIL` in Vercel env (case-insensitive match). Redeploy. Sign in with that account. |
| Daily cron alert fires but dashboard shows ✅ | Cron snapshot is older than your fix | Re-trigger cron manually: `curl -H "x-worker-secret: $WORKER_SECRET" https://urstaffd.com/api/worker/security-audit` |

## After PR-Tranche-1-Post-Security-Hardening ships

This runbook becomes the **safety net** — the primary fix is automatic via setup routes. Reserve manual repair invocation for:
- Drift detected by daily cron after PB-side modifications (rare)
- Recovery from schema migrations that bypassed setup routes
- Validation in CI before declaring a deployment safe

When `super_admin_signals` ships in Tranche 6 (PR-Super-Admin-Intelligence-A), drift detection will email `ADMIN_EMAIL` proactively — reducing the need for manual dashboard checks.
