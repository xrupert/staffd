# W80 Spike — Direct-Service Capability Audit

> Per-vendor read/write capability characterization to scope Phase 2 (native CRM + Inbox) against reality.
> **Evidence basis:** (a) the live FC-1 integration code in this repo (exact endpoints/shapes), (b) each tool's public API (all four are documented open-source products), (c) one live probe of the connected Twenty instance. **Live token-probes of all four were not possible** (API tokens live in Vercel, not local) — rows marked ⚠️ need a token-probe to confirm exact limits. ~2h-equivalent per vendor; none hit the "needs deeper investigation" wall except Twenty multi-tenant (noted).
> Date: 2026-06-16 · No UI, no user-facing code, not deployed.

## Capability matrix

| Dimension | **Twenty** (CRM, GraphQL) | **Chatwoot** (Support, REST v1) | **Listmonk** (Email, REST) | **Plausible** (Analytics, Stats API) |
|---|---|---|---|---|
| **List read** | Connection: `first`/`after` **cursor** pagination, `edges/node/pageInfo` | `page` param = **offset**, ~25/page | `page`/`per_page` = **offset** | `breakdown` w/ `limit`/`page` |
| **Detail read** | Full record + nested relations via selection set | Full conversation + messages | Full campaign + **stats** (sent/views/clicks/bounces) | Aggregate only — **no record concept** |
| **Filter/search** | `filter` arg (eq/gt/in…), `orderBy` | status, assignee, inbox, labels | query, list_id, status | metric + `filters` (event/visit dims) |
| **Webhooks/push** | ✅ object create/update/delete | ✅ conversation/message events | ❌ **poll only** | ❌ poll only |
| **Create/Update/Delete** | ✅ mutations on Person/Company/Opportunity/Note/Task | ✅ conversation, message, contact, assign, resolve | ✅ campaign, subscriber, list, send/schedule | ❌ **read-only API** |
| **Bulk** | ✅ `createMany` | mostly single-record | ✅ subscriber import | n/a |
| **Idempotency** | ❌ none | ⚠️ `source_id` dedups conversations (we use it) | ❌ none | n/a |
| **Validation** | GraphQL type + field constraints, `errors[]` | 422 + errors | 400/422 | 400 |
| **Auth** | API key (Bearer), **workspace-scoped** | `api_access_token`, **account-scoped** | **Basic** (API user+token, v3+), instance-wide | API key (Bearer), account/site-scoped |
| **Multi-tenant** | 1 key ↔ 1 **workspace** | 1 token ↔ 1 **account** | **single instance** (segment by list) | 1 key ↔ account's **sites** |
| **Rate limit** | ⚠️ self-host = instance-bound (no vendor cap) | ⚠️ self-host configurable | ⚠️ none hard (self-host) | 🚩 **Cloud ~600/hr**; self-host none |

## Per-vendor notes

**Twenty.** Probe confirmed: data objects (`opportunities`, `people`) **only exist on the authenticated, per-workspace schema** — STAFFD must introspect per workspace/key. Richest write surface of the four (full CRUD + bulk). FC-1 already reads opportunities. Specialist fit: Sales (closing-strategist, outbound-strategist, pipeline-analyst, sales-account-strategist). Phase-1 card = pipeline summary (built). Phase-2 native = contacts + pipeline board (real build: mutation + cursor pagination + detail views).

**Chatwoot.** Cleanest webhook story (real-time inbox feasible). Strong write (reply/assign/resolve). `source_id` gives partial idempotency. Specialist fit: Reputation (customer-service-responder, crisis-communicator, community-manager). Phase-1 card = open-ticket count + recent (built). **Open question:** native inbox is high-cost, and a specialist *drafting* replies may beat the user manually triaging — value of native CRUD is debatable.

**Listmonk.** Simplest read, **write already shipped** (we create draft campaigns). No webhooks → poll stats (fine; stats aren't real-time-critical). Specialist fit: Marketing (email-strategist/email-marketer, content-syndication). Phase-1 card = recent campaign stats (built). **Best Phase-2 ROI:** campaign list + draft-create (exists) + stats = low marginal cost, high value.

**Plausible.** **Not yet integrated** — no FC-1 read exists; must be built first. Read-only API (no write complexity → clean native surface). 🚩 Cloud Stats API ~600 req/hr → **must cache aggressively** (one fetch/page-load × many users exhausts it). Specialist fit: Analytics/Marketing (analytics-analyst, data-analyst, trend-researcher). Phase-1 card = visitors/pageviews 7d aggregate (needs the new read).

## The cross-cutting finding (most important)

**All four are single-tenant by auth: one credential ↔ one workspace/account/instance/site.** None natively models "one STAFFD ↔ many customers' separate CRMs." So multi-customer direct-service has exactly two shapes, and SA must pick before Phase 2:
- **(a) Per-customer provisioning** — each STAFFD customer gets their own Twenty workspace / Chatwoot account / Listmonk segment / Plausible site + stored creds. Clean isolation, heavy ops (provisioning + secrets per customer).
- **(b) Operator-only surfaces** — these surfaces serve *the operator's* business (one set of creds), exactly like the MS-A pulse. Demo-ready now; not per-customer.

For a **demo / single-operator** build, (b) is trivially viable today. For **per-customer SaaS**, (a) is a real provisioning project — and Twenty's per-workspace dynamic schema + everyone's single-account auth make it the gating unknown. ⚠️ This is the one item I'd flag "needs deeper investigation" before committing Phase 2 to multi-tenant.

## Red-flag summary
- 🚩 **Plausible Cloud rate limit (~600/hr)** — caps native analytics at low user counts without caching.
- 🚩 **Listmonk + Plausible: no webhooks** — live surfaces must poll (acceptable; not real-time domains).
- 🚩 **Multi-tenant auth (all four)** — single-credential model; per-customer SaaS needs provisioning (a).
- ⚠️ **Plausible not yet integrated** — needs a read route before any surface.
- ⚠️ **No idempotency** on Twenty/Listmonk writes — re-submits can duplicate (mitigate client-side).

## One-line recommendation per vendor (single-operator V1)
| Vendor | Verdict |
|---|---|
| **Listmonk** | **Native Phase 2 viable** — best ROI (write exists, read simple, high value). Start here. |
| **Plausible** | **Native Phase 2 viable (read-only)** — but build the read route first + cache for rate limit. |
| **Twenty** | **Native Phase 2 viable (single-tenant)**; **multi-tenant = needs deeper investigation** (per-workspace provisioning). |
| **Chatwoot** | **Summary card only for V1** — native inbox high-cost + debatable value vs specialist drafting; revisit post-demo. |

## Recommended Phase 1 / Phase 2 ordering for SA ratification
- **Phase 1 (Operations Home cards, all read, mostly built):** Listmonk stats · Twenty pipeline · Chatwoot open tickets · **+ new** Plausible aggregate.
- **Phase 2 native (in order):** **1. Email Campaigns (Listmonk)** → **2. Analytics (Plausible, read-only)** → **3. CRM (Twenty, single-tenant)**. **Defer Inbox (Chatwoot)** to summary-card.
- **Blocking decision for SA:** multi-tenant shape (a) vs (b) — gates whether Phase 2 is operator-only or per-customer.
