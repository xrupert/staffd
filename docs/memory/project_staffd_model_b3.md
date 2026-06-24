---
name: project-staffd-model-b3
description: STAFFD Model B3 — customers never connect their own vendor accounts; invisible operator-shared backends + upload + conversational-intent UX
metadata: 
  node_type: memory
  type: project
  originSessionId: 2937f992-0e99-4d3f-ab14-59d1d9a56b02
---

**STAFFD Model B3 (confirmed architecture, governs W95+).** Supersedes the W91 "bring your own creds" direction for customers. [[project-staffd]]

- Customers do **NOT** connect their own Twenty / Listmonk / Chatwoot / Plausible / Docuseal accounts. STAFFD is the single subscription that removes multi-SaaS babysitting.
- Vendor backends stay running but are **invisible operator-shared infrastructure**, partitioned per-customer (tagging / workspace).
- Cold-start: customers populate via **upload** (CSV contacts, doc archives, support history). Day-to-day: **conversational intent** (voice-first). Flow: customer says it → parse intent + structured fields → **confirmation preview** → confirm → write to vendor backend (partitioned) + Vault.
- **Delegation-plus-direct:** trivial ops (add contact, log call) = confirm-to-commit; heavy work routes to specialists.
- **Progressive autopilot:** after N successful confirmations of an action type, offer to skip confirmation (per-action-type opt-in).
- Every confirmed action **enriches the Vault** — the conversational ops layer is also the Vault ingestion layer.

**Per-vendor partition shapes (probed live, W95.1–.2).** staffdCustomerId = PB userId across ALL vendors (locked — never a parallel id). Twenty: `staffdCustomerId` custom-field tag on Person + app-layer filter (probe PASSED, W95.1). Listmonk: list-per-customer `staffd-<userId>` (probe PASSED, W95.2). Docuseal: `staffdCustomerId` metadata tag on submission + client-side filter (probe PARTIAL — live create not run, it emails a real signature request). **Plausible: NO per-customer partition possible** — `POST /api/v1/sites` 404s on this self-hosted CE (no Sites-provisioning API), so `PlausibleClient` was NOT built; W95.6 Plausible needs an SA decision (operator-provisions sites manually, or drop per-customer analytics). Mirror drift is self-healing via the W71 task bus: `/api/intent/commit` enqueues a `mirror_retry_worker` task on vendor-mirror failure, drained by the workflow-drain extension.

What survived W91 (kept in code, operator/future use): AES-256-GCM crypto helper, `resolveCredentials` (operator-env path), `user_integrations` collection + `/api/user-integrations/*` routes. What came down (W91-rollback, commit `25d8751`): customer-facing "Connect Your Tools" Settings UI + the W80 "connect your tools" empty states (now STAFFD-voice: "your specialist can draft one", upload → `/dashboard/upload`).

**Progressive autopilot (W95.5 — the graduation mechanism that delivers "you've been staffed").** Per (user,intent_type) confirm streak in PB `autopilot_prefs`; 3-tier policy in INTENT_FIELDS: trivial(N=3: log_interaction/schedule_followup/create_task), audited(N=5: create_contact/capture_lead/update_contact/add_to_email_list/log_expense — undo toast mandatory), never(draft_campaign/send_for_signature/disable_autopilot). Clean confirm +1, edited confirm = no-op, cancel −1, fire +1, undo→reset+disable+7-day cooldown. At N, the modal offers graduation; once enabled, unambiguous extractions auto-fire (source="autopilot") with a 10-min undo window (`autopilot_audit_log` + UndoToast). Undo reverses native row + vendor mirror (twenty_delete/listmonk_unsubscribe workers). Ambiguity ALWAYS forces the modal. Logic in `_lib/autopilot/policy.ts`; field specs live in `_lib/orchestrator/intent-policy.ts` (split from intent.ts so importing them doesn't pull llm.ts's module-scope `new Anthropic()` — that trips the happy-dom test guard; same class as the [[staffd-vercel-footguns]] dynamic-import rule). Settings "Automation" + /dashboard/admin/activity (operator) manage/observe it.

Tranche queue (dispatch one at a time): **W92.1** (effective-plan: comp users should show Agency tier) → **W95-DISCOVERY** (design spike, no code) → **W95.x** build → **W73+** (L4 planner/recipes/surface against B3). See also [[staffd-vercel-footguns]].
