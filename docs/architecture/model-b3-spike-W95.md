# W95 Spike — Model B3 (conversational-intent / invisible-backend) architecture

> Design-only. No code. Date: 2026-06-17.
> Builds on the W80 capability spike (`direct-service-capability-spike-W80.md`) — its
> cross-cutting finding governs everything here: **all four vendors are single-tenant by
> auth (1 credential ↔ 1 workspace/account/instance/site).** Model B3 keeps the W91-rollback
> stance — customers never hold creds — so we run **one operator instance per vendor,
> partitioned internally per customer.** That is W80's shape (a), but the partition key lives
> inside the shared instance, not in per-customer credentials.

Names/paths below are grep-verified non-colliding: `docs/architecture/` (W80 lives here),
`app/components/*Modal.tsx` (existing convention), `_lib/orchestrator/analyzer.ts` (sibling),
`/api/intent/*` (free), `recordDecision`/`vault_decisions` (reused).

## 1. Per-vendor partition

| Vendor | Recommended partition | Provisioning cost | Leak-guard |
|---|---|---|---|
| **Twenty** | One operator workspace + a `staffdCustomerId` custom field on every object; every read filters `filter:{ staffdCustomerId:{ eq } }` | Low (one workspace) | **Single data-access wrapper** is mandatory — a query that forgets the filter leaks. |
| **Listmonk** | **List-per-customer** (1+ lists/customer) | Low (create-list on signup) | Campaigns target lists; subscribers belong to lists → natural boundary. |
| **Chatwoot** | **Inbox-per-customer** inside one operator account | Medium | Conversations scoped by `inbox_id`; filter every read. |
| **Plausible** | **Site-per-customer** (customer's domain = one site) | Low API, **high customer-side** | Each site is its own tenant; clean. |
| **Docuseal** | Operator-owned templates + `staffd_customer_id` metadata on submissions; filtered listing | Low | Submission-scoped tag. |

**Twenty.** Workspace-per-customer is rejected: Twenty's per-workspace *dynamic GraphQL schema* (W80 probe) means each workspace needs introspection + its own key — the W80 gating unknown. Tag-partition on a custom field is far lighter, but shifts the burden to a single enforced data-access layer (every list/detail/mutation passes the customer id). `createMany` makes bulk import scoped-cheap.

**Listmonk.** Cleanest of the five. The list IS the tenant. We already create draft campaigns (FC-1c); add list-create on customer provisioning and scope campaigns/subscribers to that list.

**Chatwoot.** Account-per-customer is the *true* boundary but needs the platform/super-admin API (heavy, poorly documented) — rejected for V1. Inbox-per-customer inside one account is API-feasible (`source_id` already dedups). Inbound-email routing (one operator inbox → per-customer addresses) is an open provisioning question (§9).

**Plausible.** Read-only, site = domain, provision via the Sites API. The catch is **customer-side**: tracking requires the customer to add a JS snippet to *their* website (or STAFFD proxies their traffic). Only customers with a site they control can use it. Honest gap (§2, §9).

**Docuseal.** Limited native multi-tenancy; partition by submission metadata + filtered listing. Templates can be operator-authored and reused across customers.

## 2. Per-vendor upload (cold-start)

| Source | Destination | Fit |
|---|---|---|
| Contacts CSV | Twenty `createMany` (customer-scoped) **+** Listmonk subscriber-import to the customer's list | ✅ clean |
| Email list CSV | Listmonk subscriber import → customer list | ✅ clean |
| Documents (PDF/DOCX) | **Vault** (`documents` + ingestion → `vault_*`); signable ones also become Docuseal templates | ✅ Vault is the home; Docuseal only for things that get signed |
| Support history | **STAFFD-native PB**, surfaced read-only | 🚩 **Chatwoot has no clean historical-conversation import** — do NOT backfill into Chatwoot; keep history STAFFD-side |
| Analytics | — | 🚩 **N/A** — Plausible is forward-only telemetry; nothing to upload. Cold-start = "add the snippet", not "upload data" |

## 3. Confirmation modal primitive

- **Lives at** `app/components/ConfirmActionModal.tsx` (matches `ActionRecipientModal.tsx`, `ScheduleFollowupModal.tsx` — it generalizes those two).
- **Component contract:**
  ```
  ConfirmActionModal({
    intent: IntentType,
    fields: Record<string, FieldValue>,   // editable, pre-filled from extraction
    schema: FieldSchema[],                 // per-intent: label, type, required
    summary: string,                       // human one-liner ("Add John Smith to your contacts")
    busy: boolean,
    onConfirm: (editedFields) => void,     // → POST /api/intent/commit
    onReject: () => void,
  })
  ```
- **Intent envelope (server payload):** `{ intentType, fields, vendorTargets: VendorId[], confirmationText }`.
- **One commit path:** `POST /api/intent/commit { intentType, fields }` → (1) write STAFFD-native PB row, (2) mirror to the partitioned vendor backend if any, (3) `recordDecision(...)` Vault enrichment, (4) `super_admin_audit_log`/decision audit row. Every intent type funnels through this one component and this one endpoint — the reusable-primitive requirement.

## 4. Conversational intent extraction — new layer, not an analyzer extension

The existing `analyzer.ts` classifies a **finished specialist deliverable → action affordances** (post-hoc, the W62 10-action vocabulary). Conversational intent is the inverse: a **raw user message → intent + structured fields** (pre-hoc). Different input, different output, different lifecycle.

**Recommend a new layer** `app/api/_lib/orchestrator/intent.ts` (sibling to `analyzer.ts`) that **reuses the existing LLM plumbing** (`llm.ts`) and runs at the top of the route handler: extract intent + fields; if it maps to a V1 intent → return an intent envelope for the confirmation modal; else fall through to today's specialist routing unchanged. Reusing `llm.ts` (not a new SDK site) respects the W61′ 9-`new Anthropic()` allowlist.

## 5. Top V1 intent types (SMB-owner frequency)

| # | Intent | Path | Vendor mirror | Why |
|---|---|---|---|---|
| 1 | `create_contact` | direct | Twenty + Listmonk | The canonical "I met someone" reflex — highest frequency |
| 2 | `log_interaction` (call/meeting note) | direct | Twenty note/task | Owners log touches constantly |
| 3 | `schedule_followup` | direct | bookings + Twenty task | "Remind me to follow up Friday" |
| 4 | `add_to_email_list` | direct | Listmonk | Grow the list from a conversation |
| 5 | `create_task` / reminder | direct | STAFFD-native | Personal to-do capture |
| 6 | `capture_lead` (opportunity) | direct | Twenty opportunity | Deal worth tracking |
| 7 | `update_contact` | direct | Twenty | Correct/enrich a record |
| 8 | `log_expense_or_invoice` | direct | STAFFD-native (Finance) | SMB money-in/out logging |
| 9 | `draft_email` / `draft_campaign` | **delegate → specialist** | Listmonk | Heavy: routes to Marketing |
| 10 | `send_for_signature` | **delegate → specialist** | Docuseal | Heavy + irreversible: never autopilot |

Defense: 1–8 are the low-complexity, high-frequency "I just did X / add this / remind me" reflexes — ideal confirm-to-commit. 9–10 are heavy/irreversible → **delegation** (route to a specialist; never trivially auto-committed). This is the delegation-plus-direct split made concrete.

## 6. Progressive autopilot

- **Schema (reuse `subscriptions`, no new collection — Standard #20):** add a json field `autopilot_actions` →
  `{ [intentType]: { enabled: boolean, confirmed_count: number, updated_at } }`. (Mirrors the existing `autopilot_mode` precedent on `subscriptions`.)
- **Opt-in moment:** after **N=3** consecutive confirms of the same intent type with no edits, the confirmation modal grows a one-time footer: *"Want your staff to just do this next time? You can undo any time."* Yes → `enabled:true`.
- **Behavior on enable:** that intent type skips the modal — commit fires, then a **toast with an Undo** (so it's never silent). Heavy/irreversible intents (9–10) are **autopilot-ineligible** by policy.
- **Revoke:** per intent type, from Settings or a chat command ("stop auto-adding contacts") → `enabled:false`. Per-action, never global.

## 7. Vault enrichment

Reuse the existing substrate — **no new collection.** Every confirmed commit calls `recordDecision({ decision_kind, title, source_kind, source_id, userId })` into **`vault_decisions`** (the same path FC-3/3b use), with new `decision_kind`s (`contact_added`, `interaction_logged`, `followup_scheduled`, `lead_captured`, …). Recurring intents feed `vault_patterns` (existing) — which doubles as the **autopilot signal source** (count of confirmed same-kind decisions). Specialists already read Vault context via `retrieve()`, so confirmed facts surface in future work automatically; the only possible add is a `vaultLines()` renderer for "recent confirmed facts" (small, deferrable).

## 8. Downstream impact map

| Area | Impact |
|---|---|
| **W71/W72** (task bus + workflow object) | Heavy intents (9–10) `enqueue` a `workflow_task` / spawn a `workflow`; trivial intents bypass the bus via the direct commit path. The commit path is a sibling to `/api/workflow/enqueue`. |
| **W80 surfaces** | Repoint Front Desk / Campaigns / Analytics from operator-env to **partitioned STAFFD-native** reads. The W91-rollback empty states become the cold-start CTA (upload / "ask your specialist"). |
| **W92 dashboard** | Per-customer integration metrics become real once partition writes land — fills the honest note added in W91-rollback. |
| **packages/agents** | Mostly unchanged — confirmed facts reach specialists through existing Vault `retrieve()`. Possible minor: a confirmed-facts context line. No new specialists. |
| **pricing/plan gating** | Candidate gates: autopilot = Pro+; intent volume caps by plan. **Flag for SA** — not assumed. |

## 9. Uncertainties (and what resolves them)

1. **Twenty tag-partition reliability** — can one workspace filter every object type on a custom field, and is `createMany` scoped? → **live token-probe** of the connected Twenty instance (creds in Vercel).
2. **Chatwoot inbound-email routing** — one operator inbox → per-customer addresses, or per-inbox email config? → Chatwoot channel-config probe + a product decision.
3. **Plausible customer-side snippet** — customers without dev resources can't add a `<script>`; do we proxy? → product decision (affects whether Analytics is universal or opt-in).
4. **Intent-extraction precision** — a wrong auto-commit erodes trust; the modal mitigates pre-autopilot, but autopilot needs measured precision → instrument confirm/edit/reject rates in W95.1 before enabling §6.

## 10. Proposed W95 build sequence

| Tranche | Scope (one line) |
|---|---|
| **W95.1** | Intent layer (`intent.ts`) + `ConfirmActionModal` + `/api/intent/commit`, end-to-end for **`create_contact`** (STAFFD-native PB + Vault; vendor mirror stubbed). Proves the loop + instruments precision. |
| **W95.2** | Per-customer **partition substrate** — `staffd_customer_id` stamping + the single enforced data-access wrapper; Twenty tag-partition + Listmonk list-per-customer provisioning. |
| **W95.3** | **Upload paths** — contacts CSV → partitioned Twenty + Listmonk; documents → Vault. |
| **W95.4** | Expand intents (log_interaction, schedule_followup, add_to_email_list, capture_lead, …) + heavy-intent **delegation** into W71/W72. |
| **W95.5** | **Progressive autopilot** (subscriptions json + opt-in prompt + per-action revoke + Undo toast). |
| **W95.6** | Chatwoot inbox-per-customer + Plausible site-per-customer (the flagged, harder vendors). |
| **W95.7** | Repoint W80 surfaces to partitioned data; light up W92 per-customer metrics. |

**Blocking decisions for SA:** (a) ratify the partition shapes (esp. Twenty tag-vs-workspace); (b) Plausible snippet/proxy product call; (c) plan-gating for autopilot/intent volume.
