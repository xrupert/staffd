# OPERATOR TEST QUEUE

Operator-only actions that the agent cannot perform itself — live verifications
gated on Sensitive secrets, super-admin login, or one-time bootstraps. Each item
has: what to do, the exact command/click, and the expected result. Check items
off as you complete them; the agent reads this file to know what's still pending.

> Why this exists (Standard #25): all ~45 STAFFD secrets are Vercel **Sensitive**
> vars — the agent can't read `ADMIN_SECRET`/`PB_ADMIN_PASSWORD`, so it can't run
> migrations or log in as super-admin. These steps close that gap.

---

## 🔴 PENDING

### 1. Rotate `ADMIN_SECRET` (W95.3) — security
`ADMIN_SECRET` was shared in plaintext during the W95.3 setup debugging.
- In Vercel → Project → Settings → Environment Variables, **regenerate** `ADMIN_SECRET` for **Production** (record the value at creation — Sensitive vars can't be read back later; avoid `$`, backtick, `;` to dodge shell-escaping).
- **Redeploy** so the new value goes live.
- ✅ Done when: a no-auth `POST /api/setup/contacts` still returns 401 (gate intact) and you have the new secret saved.

### 2. Bootstrap `admin_migration_log` (W95.3.4) — one-time, enables the in-app trigger
Run once from **Git Bash** (not PowerShell — `curl` there is an `Invoke-WebRequest` alias):
```bash
curl -X POST -H 'x-setup-secret: <CURRENT_OR_ROTATED_SECRET>' \
  https://urstaffd.com/api/setup/admin-migration-log
```
- ✅ Expected: `{"ok":true,"action":"created","rules":...}`

### 3. Run the cold-start migrations via the in-app trigger (W95.3.4 / W95.3.5)
- Log in as super-admin → visit **`/dashboard/admin/migrations`**.
- Click **Run all pending**. Then run **Documents — file & extraction** (`documents-v2`).
- ✅ Expected: every row shows **Created** (contacts, upload-sessions, documents-v2; workflows/workflow_tasks already "Created"). Re-running is safe ("exists"/"already-migrated").

### 4. Smoke: contacts CSV upload (W95.3)
- `/dashboard/upload` → "Upload your contacts" → pick a 3-row CSV (`name,email,phone`).
- ✅ Expected: "✓ 3 contacts added"; the 3 contacts appear in the Sales Pipeline; the operator-shared CRM shows them tagged with the customer's `staffdCustomerId`.

### 5. Smoke: document upload + extraction (W95.3.5)
- `/dashboard/upload` → "Upload your documents" → upload one PDF and one `.txt`.
- ✅ Expected: `.txt` → **Ready** instantly with a text preview; PDF → **Processing…** then **Ready** within ~30s (the workflow-drain cron extracts it). A corrupt/scanned PDF → **"Couldn't read"** with the honest fallback message.

### 6. Run the W95.4a migrations via the in-app trigger
- `/dashboard/admin/migrations` → **Run all pending**.
- ✅ Expected: interactions, followups, tasks, leads, expenses all show **Created**.

### 7. Smoke: the 7 new conversational intents (W95.4a)
In the Command Center, say each and confirm the modal → check the result:
- "I just called Jane Doe about pricing" → **Log this interaction?** → logs an interaction.
- "Remind me to follow up with Jane next Tuesday" → **Schedule this follow-up?** → Front Desk "Follow-ups" count rises.
- "Add jane@x.com to my newsletter list" → **Add to your email list?** → contact + email-list subscribe (the customer's list gets the subscriber).
- "Add a task to call my accountant tomorrow" → **Add this task?** → Front Desk "Tasks" count rises.
- "Got a lead — John at Acme, john@acme.com, wants consulting" → **Capture this lead?** → Front Desk "Leads" count rises; contact mirrored to the CRM.
- "Jane Doe's new email is jane@new.com" → **Update this contact?** → contact updated; CRM mirror updated.
- "Log $45 for office supplies" → **Log this expense?** → expense recorded.
- ✅ Expected: each modal shows STAFFD-voice copy (no vendor names), confirm writes the row, and the Front Desk "Your work" cards reflect the counts.

### 8. Enable Google sign-in (FC-4, earlier session — was never added here)
The "Continue with Google" button ships but shows "not enabled yet" until the
PB OAuth2 provider is configured.
- In the PocketBase admin console → Settings → Auth providers → **Google** → enable + paste the Google Cloud OAuth Client ID/Secret.
- ✅ Expected: "Continue with Google" on login/signup completes → new user lands on onboarding, returning user on dashboard.
- (May already be done — there's no way for me to detect PB-console state; confirm or tick off.)

### 9. Set `INTEGRATION_ENCRYPTION_KEY` (W91, earlier session — was never added here)
Confirmed **not set in Production**. The W91 per-user credential substrate
(AES-256-GCM) throws without it. Currently **dormant** (the customer connect
flow was rolled back in W91-rollback / Model B3), so nothing breaks today — but
set it so the substrate + any future "connect your tools" path works and the
`user_integrations` crypto tests reflect prod.
- `openssl rand -base64 32` → set `INTEGRATION_ENCRYPTION_KEY` in Vercel (Production + Preview), redeploy.
- ✅ Expected: a 32-byte base64 value present in prod env.

### 10. Set `DOCUSEAL_TEMPLATE_ID` + run documents-v3 migration (W95.4b prereqs)
`send_for_signature` needs a Docuseal template to create submissions from.
- Create a minimal test template in Docuseal; set its numeric id as `DOCUSEAL_TEMPLATE_ID` in Vercel (Production), redeploy.
- `/dashboard/admin/migrations` → run **Documents — signature id** (`documents-v3`).
- ✅ Done when: `DOCUSEAL_TEMPLATE_ID` set + documents-v3 shows **Created**.

### 11. W95.4b — Docuseal live round-trip (GATING — I could not run the probe)
The standalone metadata probe needs a super-admin token I don't hold + Sensitive
`DOCUSEAL_*` creds, so this smoke IS the live verification (deferred from W95.2).
- After #10, in Command Center: "Send the test contract to chris.rupert@cybridagency.com for signature".
- Confirm modal → Legal workflow created; after the Legal task drains, `docuseal_send_worker` fires.
- ✅ Verify: a real Docuseal email arrives; the `documents` row has `docuseal_submission_id`; in the Docuseal admin the submission carries the `staffdCustomerId` metadata tag; a different customer's filter returns zero (tenant isolation). **If the metadata tag is absent/leaky, STOP and tell SA.**

### 12. W95.4b — draft_campaign smoke
- Command Center: "Draft a launch email for my newsletter" → confirm modal → "Marketing is drafting…".
- ✅ Verify: a workflow appears (W92 Workflows tab); after Marketing drains, drafted content lands in `documents`.

### 13. W95.4b — disambiguation smoke
- Command Center: "John at Acme wants consulting, add him" → **two-option modal** ("Capture as lead" / "Just add contact").
- ✅ Pick "Capture as lead" → a `leads` row; repeat + pick "Just add contact" → a `contacts` row.

### 14. W95.4b — list views + drawer actions
- Front Desk → tap the **Tasks** card (whole card is the link) → top-10 list, overdue first.
- Tap a row → drawer opens (Esc/backdrop closes) → "Mark done" flips status, list refetches.
- Repeat on **Follow-ups** (test "Reschedule" → opens the date modal) and **Leads** (status changes).

### 15. Run the W95.5 migrations (autopilot)
- `/dashboard/admin/migrations` → **Run all pending** → `autopilot_prefs` + `autopilot_audit_log` show **Created**.

### 16. W95.5 — graduation + autopilot fire + undo (trivial tier, N=3)
- In Command Center, do a trivial action 3× cleanly (no edits), e.g. "Add a task to call the bank" three times (vary the task).
- ✅ On the 3rd confirm modal, the **"Want STAFFD to handle this automatically?"** block appears → click **Yes, automate it**.
- Do it a 4th time → it should **auto-fire** (no modal) and show a bottom **"Added … · Undo"** toast.
- Click **Undo** within 10s → toast shows **Reverted**; the task is gone.
- ✅ Verify an `autopilot_audit_log` row exists (for audited intents) and `autopilot_prefs.enabled` flipped back off after undo.

### 17. W95.5 — audited tier undo reverses the vendor mirror
- Graduate `create_contact` (audited, N=5): confirm 5× cleanly → Yes.
- Next time, it auto-fires + toast. **Undo** → the STAFFD contact is deleted AND a `twenty_delete_worker` task is enqueued (CRM person removed on next drain).

### 18. W95.5 — disable via conversation + Settings
- "turn off autopilot for tasks" → confirm modal → autopilot for tasks is off.
- `/dashboard/settings` → **Automation** section → toggle any graduated action on/off; state persists on reload.

### 19. W95.5 — super-admin activity log
- `/dashboard/admin/activity` (super-admin) → recent autopilot fires listed with status; **Undo** works on rows still in-window.

### 20. W95.6 — Chatwoot read live smoke
- Run **Businesses — support inbox id** (`businesses-v2`) via `/dashboard/admin/migrations`.
- Front Desk → click the **Support Inbox** card → `/dashboard/front-desk/inbox`.
- ✅ At least one conversation renders (if none, create one in the Chatwoot admin against the `staffd-<userId>` inbox first). Click a row → drawer shows the thread oldest-first. **Reply** is disabled with a "coming in next update" tooltip. **Zero "Chatwoot" branding** anywhere.

### 21. W95.6 — Chatwoot live probe (GATING W95.6.1 — I could not run it)
Same blocker as Docuseal: no super-admin token + Sensitive `CHATWOOT_*` creds, so this is the live verification.
- Manually exercise `ChatwootClient` against the operator instance: `findOrCreateInbox()` creates an inbox named **`staffd-<userId>`**; `listConversations()` filtered by that inbox returns **ONLY this customer's** conversations.
- ✅ Tenant isolation: a different `staffdCustomerId` (different user) sees a different/empty inbox. **If isolation fails, STOP before W95.6.1 ships reply/resolve.**

### 22. W95.6.x — review step + Chatwoot writes
- Run **Workflows — review step** (`workflows-v2`) via `/dashboard/admin/migrations`.
- **Reply end-to-end:** Front Desk inbox → open a conversation → **Reply** → "Thanks, I'll get back to you Friday" → after Reputation drains (~1–2 min), the **Drafts** card shows it → open → tweak → **Approve & Send** → the reply appears in Chatwoot and reaches the customer. (Cancel instead → workflow cancelled, nothing sends.)
- **Resolve / tag (direct):** "resolve John's ticket" + "tag the latest ticket urgent" → confirm modals → verify status/label changed in the Chatwoot admin.
- **send_for_signature retroactive review:** re-run a signature request → Legal's draft now pauses at **Drafts** → Approve before Docuseal sends.
- ✅ Confirm tombstone-on-cancel: cancel a draft, then confirm the send never fires.

### 23. W95.6.y — per-customer Site Analytics + operator provisioning
- Run **Businesses — analytics site id** (`businesses-v3`) via `/dashboard/admin/migrations`.
- **Provision a site (operator):** in the real Plausible admin, create a site for a test customer's domain. Then `/dashboard/admin/usage` → **Users** tab → click the **●** dot on that customer's row → paste the Plausible site id → **Save**. The dot turns green.
- **Customer view:** as that customer, Front Desk → the **Site Analytics** card shows a real visitors/pageviews summary → click **Open analytics →** → `/dashboard/front-desk/analytics` renders 4 metric cards + visitor sparkline + Top pages / Top sources, with a 7d/30d toggle. **Zero "Plausible" branding** anywhere customer-facing.
- **Empty state:** a customer with NO provisioned site sees "Site tracking isn't set up yet — your specialist can help connect your site" + an **Ask your specialist →** link (no error, no vendor name).
- **Clear:** back in admin Users, open the dot → **Clear** → dot greys out → customer reverts to the empty state.

### 24. W95.6.y — Plausible CE live probe (could not run — same creds blocker)
No super-admin token + Sensitive `PLAUSIBLE_*` creds, so the live read is yours to verify.
- ✅ Confirm the CE Stats API shape matches what `PlausibleClient` expects: `/api/v1/stats/aggregate` returns `{results:{visitors:{value},pageviews:{value},bounce_rate:{value},visit_duration:{value}}}`; `/timeseries` returns `{results:[{date,visitors,pageviews}]}`; `/breakdown?property=event:page|visit:source` returns `{results:[{page|source,visitors}]}`. If the CE version differs (e.g. v2 Stats API), tell me and I'll repoint the mapping.
- ✅ Tenant isolation: a customer's analytics page shows ONLY their own `site_id`'s stats; a different customer with a different `site_id` sees different data; an unprovisioned customer never sees another tenant's numbers.

### 25. W95.7 — Substrate health check smoke
- Run any remaining pending migrations via `/dashboard/admin/migrations`.
- Navigate `/dashboard/admin/health`.
- ✅ Confirm all-green: every expected collection present, every intent wired, every worker registered, every migration applied, recipes in sync. (`GET /api/admin/health` returns the same JSON for external monitoring.)
- If any red: report and resolve before declaring V1 substrate ready. (Vendor backends showing "off" is OK — it just means that env isn't set in this environment; not a failure.)

### 26. W95.7 — Front Desk full smoke (verify substrate complete)
- Log in as operator (or a comp test user) and open `/dashboard/front-desk`.
- ✅ Each card renders real **per-customer** data (or an honest empty state): Tasks / Follow-ups / Leads · Drafts pending review · **Email Campaigns** · Sales Pipeline · Support Inbox · Site Analytics.
- ✅ **Email Campaigns is now per-customer** (W95.7 repoint): the card + `/dashboard/front-desk/campaigns` show ONLY this customer's campaigns; composing sends to "your subscribers" (the customer's own list) — there is no list-picker exposing other tenants' audiences. Draft → Send → confirm the campaign appears for this customer only.
- ✅ Every card is clickable to its drill-in where one exists; zero "Twenty" / "Chatwoot" / "Plausible" / "Listmonk" / "Docuseal" visible anywhere customer-facing.

### 27. W95.7.1 — Action buttons fire the intent path
- In the Command Center, generate a deliverable (e.g. a Marketing campaign or Sales outreach).
- ✅ Action chips appear (Add to CRM / Send as campaign / Send for signature). Click each.
- ✅ The **ConfirmActionModal** opens pre-filled (e.g. "Have Marketing draft this?" / "Add this contact?" / "Send this for signature?") — it does NOT silently write. Edit a field, then Confirm.
- ✅ Commit fires (modal closes, STAFFD-voice success copy). In PB: the intent committed to the STAFFD-native collection (contacts/workflows) and a vendor-mirror task was enqueued (workflow_tasks). No 403 — works as a non-super-admin customer.
- Repeat in a DepartmentRoom (Marketing "Send as Campaign", Sales "Add to CRM", Legal/Sales "Send for Signature").
- ✅ "Open support ticket" / reputation "Send as Ticket" no longer appear (retired pending a `create_support_thread` intent).

### 28. W95.7.1 — Clients UI verified hidden
- `/dashboard` (Agency plan) — the **Clients** nav link + the client switcher no longer appear.
- Direct URL `/dashboard/clients` → **404**.
- `/dashboard/admin` — operator surfaces unchanged; the `clients` collection is intact in PB (nothing deleted).

### 29. W95.7.3a — Brand voice regression closure (GATING L4)
Operator verification after deploy:
- Open browser devtools → Application → Local Storage → urstaffd.com.
- Confirm the `staffd_active_client` key is **absent** (the cleanup ran on load).
- In CommandCenter, ask Marketing for any deliverable referencing STAFFD (e.g. "draft a tweet announcing our launch").
- ✅ The specialist responds with STAFFD-voiced content (positioning / messaging pillars / hard-nos honored) — NOT generic onboarding questions ("what's your tone / CTA / handle").
- (Optional, to reproduce the old break first) set `staffd_active_client` to any value in devtools, then **navigate to a dept room directly** (e.g. /dashboard/marketing): the cleanup runs on every route, so the key clears regardless of entry point. Even if it didn't, the vault layer now returns STAFFD self for the operator regardless of clientId.
- Report success or failure to SA **before L4 starts**.

### 30. W95.7.3b — Async image/video generation (run migration FIRST)
- **Operator setup:** run **Generation jobs** (`generation-jobs`) via `/dashboard/admin/migrations` (creates the `generation_jobs` collection). Until then, generation POSTs will 502 "Could not start generation".
- Generate a TikTok video (the original failing scenario): in CommandCenter, ask for/queue a video, then click **Generate the video →**.
- ✅ The thread immediately shows "Generating the video — this can take a minute…"; the request does NOT hang 60s and does NOT 504.
- ✅ Pressing the button again during generation is a **no-op** (no second job; the operator's old 3× multi-press is fixed).
- ✅ When Muapi finishes, the video URL is delivered in the thread ("▶ Watch it here").
- ✅ Credit ledger shows **exactly 1** video credit charged for this generation (operator/super-admin: 0 charged, logged to super_admin_usage_log instead).
- ✅ In PB `generation_jobs`: the row shows `status: completed`, `output_url` populated, `charged: true`.
- Image generation: same flow; typically completes on submit (fast-path) with no polling.
- Closed-tab note (accepted V1 tradeoff, W95.7.3c will revisit): if you close the tab mid-video, the credit is NOT charged and the URL isn't surfaced until a later poll of that job; the video itself still generated at Muapi.

### 31. W95.7.3c-b1 — Margin fixes: dedup + completion webhook
- **Operator setup (one-time):** (a) re-run **Generation jobs** (`generation-jobs`) via `/dashboard/admin/migrations` to add the new `fingerprint` field (idempotent — adds the missing column). (b) Set **`MUAPI_WEBHOOK_SECRET`** in Vercel (any strong random string) to enable webhook push delivery, then redeploy. Without the secret, generation falls back to pure client-poll (W95.7.3b behavior) — still works, just no closed-tab capture.
- **Dedup smoke:** queue the same video twice in quick succession (or two tabs). ✅ Only ONE Muapi job is created; the second submit returns the same `jobId` (`deduped:true`). Asking for the *same* prompt again *after* the first completes is a fresh generation (not deduped) — verify that still works.
- **Webhook smoke (once `MUAPI_WEBHOOK_SECRET` set):** generate a video, then close the tab before it finishes. ✅ When Muapi completes, the webhook fires → the `generation_jobs` row flips to `completed` with `output_url`, and the customer's credit is charged exactly once (verify in PB + ledger). The video is in their library on next visit (closed-tab leak closed).
- **Webhook auth:** a forged `POST /api/generation/webhook?token=wrong` returns **401**; the real Muapi callback (correct token) returns **200**.
- ⚠️ **Invoice action (parallel, per dispatch):** pull one recent Muapi invoice and confirm whether line items are completions-only and whether **failed/cancelled** jobs are billed. Report before W95.7.3c-build-2 (reconciliation) so the cost surface reflects real policy.

### 32. W95.7.3d-T1 — Three-tier credit picker (run migrations + sync FIRST)
- **Operator setup (one-time):** (a) run **Generation jobs** (`generation-jobs`) again via `/dashboard/admin/migrations` to add `tier`/`credit_weight`/`muapi_model` (idempotent patch); (b) run **Generation models (catalog)** (`generation-models`) to create the collection; (c) trigger the catalog sync once — `GET /api/worker/muapi-catalog-sync` with the `x-worker-secret: $WORKER_SECRET` header — and confirm `generation_models` row count > 100. Check the sync response `routingDrift` array: any slug listed there is a routing.ts slug NOT in the live Muapi catalog and must be fixed (C5 validator).
- **Image E2E:** in a department room, click **Generate Image →** → the tier picker opens with **Pro pre-selected ("✓ recommended")** → switch to **Quick** → Confirm — Quick (1 credit) → on completion the `generation_jobs` row shows `tier="quick"`, `credit_weight=1`, `muapi_model` set, and the ledger charges **1** image credit.
- **Video E2E:** same flow, pick **Premium** → Confirm — Premium (60 credits) → on completion charges **60** video credits; the job row shows `tier="premium"`, `credit_weight=60`.
- **Weight gate:** as a customer with < 60 video credits, pick Premium video → **402** ("This premium video costs 60 credits — you have N") BEFORE any Muapi submit.
- **Brand voice:** the picker shows ZERO model/vendor names — only Quick/Pro/Premium + credit costs + descriptions.
- ⚠️ **Slug verification:** the routing.ts model slugs are catalog-pending; after the first sync, fix any `routingDrift` slugs (see muapi-vendor-drift.md §6) before relying on tier routing in production.

### 33. W95.7.3d-h1 — Routing fails loudly (no more legacy 404)
- **Prerequisite:** the catalog MUST be synced once (`GET /api/worker/muapi-catalog-sync` with `x-worker-secret: $WORKER_SECRET`) or EVERY generation returns `all_models_drifted` (500) — the legacy hardcoded-slug fallback is gone.
- ✅ Trigger generation for a (department, kind) with **no routing registry entry** (force `routeFor` empty) → the muapi route returns a structured **500** `{error:"routing_unresolved", department, kind, tier, message}` — NOT a 404 to Muapi. The specialist delivery layer shows a customer-readable "operator configuration required" message.
- ✅ With the catalog synced and valid routing → generation submits with a catalog-present slug (check the `[muapi] submitting` log shows the routed slug).
- ✅ Confirm no `flux-dev`/`veo3`/`flux-dev-image` slug ever reaches Muapi (those legacy slugs are removed from source).

### 34. W95.7.3d-h2 — Inline tier picker (CommandCenter) + enforced gate invariant
- **No new migration.** Generation still requires the **#33 catalog-sync prerequisite** to work live (h2 hardens the gate, it does not restore generation).
- **Inline picker E2E (CommandCenter conversation stream):** ask a specialist for work that yields a deliverable, then click **Generate Image →** / **Generate the video →** in the thread. ✅ The tier picker now appears **inline in the conversation, directly under the chip** (a bordered block in the stream) — NOT as a full-screen overlay that dims the page. ✅ Pro is pre-selected with "✓ recommended" (marketing); switching tier updates the Confirm button's credit cost; Confirm starts the generation in-thread; Cancel dismisses the block and leaves the thread intact.
- **Parity check (DepartmentRoom):** in a department room, **Generate Image/Video →** still opens the **overlay** picker (unchanged) — same tiers, weights, and recommended default as the inline one (both render from `buildTierOptions`).
- ✅ ZERO model/vendor names in either picker (Quick/Pro/Premium + credits + descriptions only).
- **Invariant (informational — already CI-enforced):** `__tests__/generation/trigger-surfaces.test.ts` fails the build if any future code adds a `runGeneration` call site that isn't registered + tier-gated (Standard #38). No operator action; noted so the next dispatch knows new generation triggers must register in `_lib/generation/trigger-surfaces.ts`.

### 35. W95.8 — Notifications (run migration to light up the bell)
- **Operator setup:** run **Notifications** (`notifications`) via `/dashboard/admin/migrations` (creates the USER_OWNED `notifications` collection + enforces row rules). Until then the bell renders empty/silent (degrades gracefully — no errors).
- **E2E:** complete an image/video generation (needs the #32/#33 catalog prerequisites). ✅ A 🔔 in the dashboard header gains an unread badge; opening it shows "Your video/visual is ready"; clicking the row marks it read and opens the media. The in-thread "ready" message still appears too (the notification is the persistent copy).
- **Isolation:** ✅ a second account never sees the first account's notifications (USER_OWNED row rules — verify in PB or by logging in as another user).
- ✅ Brand voice: notification copy is STAFFD-voiced, zero vendor/model names.

### 36. W73 / L4 — Workflow planner end-to-end (the "automated team")
- **Prerequisite:** the `workflows` + `workflow_tasks` collections must exist (the **Workflows & tasks** migration — already run per your earlier pass) and the per-minute `workflow-drain` cron must be live (it is, in vercel.json). The planner LLM uses the same ANTHROPIC_KEY as the rest of the app.
- **Plan E2E:** as a signed-in user, `POST /api/workflow/plan` with `{ "goal": "Launch our spring promotion" }` (Authorization: your PB token). ✅ Returns `{ ok, workflowId, steps: [...], taskCount }` — a sensible 2–5 step plan across real departments, each step's `dependsOn` referencing only earlier steps.
- **Validation guard:** confirm a deliberately-bad goal that yields an unroutable department or a cyclic plan returns **422 `plan_invalid`** (the planner refuses to persist an unsound workflow) — not a half-created workflow.
- **Execution E2E:** in PB, the new `workflows` row is `pending`; `workflow_tasks` rows are `pending` with `depends_on` wired to real task ids. Within ~1–2 min the **workflow-drain** cron runs them in dependency order (each calls `/api/agent` for its department); when all succeed the workflow reconciles to `completed` and the aggregate doc is produced. ✅ Verify the task statuses advance pending→running→succeeded and the parent reaches `completed`.
- **Quality check (subjective):** read the produced step tasks — are they a coherent decomposition of the goal, routed to the right departments? Note any weak decompositions; that tunes the planner prompt/model in Tranche 2 (dedicated `plan` intent + stronger model).
- ⚠️ **Not yet surfaced in the UI** — this is the API + execution layer. A CommandCenter "turn this into a workflow" trigger + plan preview/approve is Tranche 2.

> Swept from earlier-session reports (W91, FC-4) on request — these two were
> surfaced before this queue file existed. PLAUSIBLE_API_KEY/SITE_ID and the
> W71 workflow-tasks migration were also flagged historically but are already
> DONE (verified live), so they're not listed.

---

## ✅ DONE
_(move completed items here with a date)_
