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

> Swept from earlier-session reports (W91, FC-4) on request — these two were
> surfaced before this queue file existed. PLAUSIBLE_API_KEY/SITE_ID and the
> W71 workflow-tasks migration were also flagged historically but are already
> DONE (verified live), so they're not listed.

---

## ✅ DONE
_(move completed items here with a date)_
