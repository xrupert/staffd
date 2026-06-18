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

---

## ✅ DONE
_(move completed items here with a date)_
