# STAFFD Activation Runbook

Plain-ASCII, standalone copy of the activation sequence (the full detail lives in
OPERATOR_TEST_QUEUE.md). Run top to bottom. Run all curl commands from Git Bash,
not PowerShell. Replace the SECRET placeholders with your Vercel Sensitive values.

## Phase 0 - Env / secrets

In Vercel: Settings -> Environment Variables, then Redeploy.

- ADMIN_SECRET set or rotated (gates /api/setup/*)
- WORKER_SECRET set (manual worker triggers, e.g. catalog sync)
- CRON_SECRET set (Vercel cron auth: drain, catalog sync, security-audit)
- NEXT_PUBLIC_ADMIN_EMAIL, MUAPI_API_KEY, MUAPI_WEBHOOK_SECRET, ANTHROPIC_API_KEY present
- PB SMTP configured (signup / reset email)
- Google OAuth2 enabled in PB admin

## Phase 1 - Bootstrap the migration log (one-time)

This enables the in-app migration trigger.

    curl -X POST -H "x-setup-secret: YOUR_ADMIN_SECRET" https://urstaffd.com/api/setup/admin-migration-log

Expect: {"ok":true, ...}

## Phase 2 - Run all migrations

1. Log in as super-admin.
2. Open /dashboard/admin/migrations
3. Click "Run all pending".

Every row should show Created or exists. This covers (in safe order): contacts,
templates, workflow-tasks, upload-sessions, user-integrations, documents-v2 then
v3, interactions, followups, tasks, leads, expenses, autopilot-prefs and
autopilot-audit-log, businesses-v2 then v3, workflows-v2, generation-jobs,
generation-models, notifications. It is idempotent, so re-running is safe.

Then open /dashboard/admin/health and confirm: 0 missing collections, 0 pending
migrations, and the underscore-prefixed PB system tables are no longer flagged.

## Phase 3 - One-time trigger: catalog sync

This is what makes generation stop returning "all_models_drifted".

    curl -H "x-worker-secret: YOUR_WORKER_SECRET" https://urstaffd.com/api/worker/muapi-catalog-sync

Expect: ok:true, upserted greater than 100, and routingDrift is an empty array.
If any slug is listed in routingDrift, fix it in routing.ts (see
docs/operator-runbooks/muapi-vendor-drift.md).

## Phase 4 - Per-feature end-to-end tests

Now that the substrate is live, test each feature (full detail per item in
OPERATOR_TEST_QUEUE.md):

1. Generation: tier picker + inline gate; low-credit warning; webhook (items 31, 32, 34).
2. Notifications: the bell gains an unread badge when a generation completes (item 35).
3. L4 workflow (the flagship), item 36:
   a. POST /api/workflow/plan  with {"goal":"Launch our spring promotion"}
      (Authorization: your PB token). Returns a plan; persists nothing.
   b. POST /api/workflow/commit with {"goal":"...","plan": <the plan from step a>}.
      Creates the workflow + tasks; the per-minute drain then runs them; on
      completion you get a workflow.completed notification in the bell.
4. Conversational intents, autopilot, uploads, Google sign-in (items 3-8).

## Current live state (verified, no auth needed)

- All pages return 200.
- Every /api/setup/*, /api/admin/*, and worker route correctly returns 401 or 503.
- The muapi route returns the intended "all_models_drifted" 500 until Phase 3 runs.

So the deploy and gating are healthy. The steps above are what flip features ON.

After your pass, paste back what passed vs. what broke (error bodies, odd LLM
plans, anything) and I will correct from there.
