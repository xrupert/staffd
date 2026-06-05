# Memory Foundation Discovery — PR-Tranche-1.8 ACTION 2

**Purpose.** Same methodology as Discovery PR-T2.0 (the brain) applied to the Vault / memory layer. NO code shipped. Output is this document. Trigger: SA flagged the risk of repeating the Decision 75/76 misread on the memory dimension after PR-T2.0 surfaced that the orchestrator was already built and shipping.

**Major finding up front (read this first).** The Vault / memory layer is **BUILT and live**, mirroring the brain finding. ARCH §17's "missing" list for the Vault was as stale as its orchestrator entry. The 12-file `_lib/vault/` library (3,934 LOC) + Qdrant client (213 LOC) + embeddings provider abstraction (169 LOC) + ingestion worker (cron `*/1 * * * *`) + pattern tracking + retrieval scorer + outcomes feedback are all in production. The PRs labelled V1-V6 in the project's PR history (PR #2, #5, #6, #8, #9, #11, #13 in the task log) correspond to these shipments.

The classification table at §7 maps each ARCH §17 "missing" item to its actual state.

---

## §1 — Vault PB collection state

All 7 vault-namespaced collections are in the Decision 68 baseline + were verified ✅ in PR-Tranche-1 (verify-row-rules smoke test, commit `9c495dc`). Reference: `apps/web/app/api/_lib/security/row-rules.ts:EXPECTED_COLLECTIONS`.

| Collection | Setup route | Rule pattern | Status |
|---|---|---|---|
| `vault_briefs` | `setup/briefs/route.ts` | USER_OWNED_RULES | ✅ |
| `vault_decisions` | (created during prior setup ops) | USER_OWNED_RULES | ✅ |
| `vault_patterns` | (created during prior setup ops) | USER_OWNED_RULES | ✅ |
| `vault_retrieval_metrics` | (created during prior setup ops) | USER_OWNED_RULES | ✅ |
| `vault_voice_profile` | `setup/voice-profile/route.ts` | USER_OWNED_RULES | ✅ |
| `vault_embeddings_index` | `setup/vault/route.ts` | USER_OWNED_RULES | ✅ |
| `vault_ingest_queue` | `setup/vault-queue/route.ts` | ADMIN_ONLY_RULES (Decision 71 — backend queue, no `user` field) | ✅ |

**Live row-count probe:** the operator can hit `/api/admin/vault-metrics` to see current per-collection counts (see §4 of PR-Tranche-1.5 super-admin work — Decision 74). For this Discovery, structural existence is sufficient evidence; the daily security-audit cron continues to confirm row rules.

**Verdict:** ALL 7 COLLECTIONS BUILT, RULES ENFORCED.

---

## §2 — Vault read functions

`apps/web/app/api/_lib/vault/index.ts` is the canonical entry point. The library exports:

| Function | File | Signature (paraphrased) | Behavior |
|---|---|---|---|
| `fetchVault` | `vault/index.ts:76` | `(pbToken, userId, {clientId?}) → Vault \| null` | Loads the businesses (or, in Agency mode, clients) row via the user's PB token (row rules enforced). Returns null on failure so callers fall through to vault-less prompts. |
| `renderVaultBlock` | `vault/index.ts` | `(vault, {detail}) → string` | Composes the standard "BUSINESS CONTEXT" block injected into every specialist system prompt. Two detail levels: `summary` (route/handoff) + full (brief/synthesize). |
| `retrieve` | `vault/retrieve.ts` | `(userId, query, {topK, maxTokens, weights, clientId, intent, preferDept}) → {items, costFlag, tokensReturned, latencyMs}` | Semantic retrieval against Qdrant. Embeds query → cosine search → applies normalization (pattern 2.0×, freshness 1.2×, same-dept 1.3×) + min-score floor (0.35) → trims to maxTokens cap. Writes a `vault_retrieval_metrics` row per call. Fail-safe: returns `[]` + `degraded` flag on any embeddings/Qdrant/PB error. |
| `getVoiceBlock` | `vault/voice.ts` | `(userId) → string` | Returns the user's brand-voice fingerprint block (Phase 2 — PR #16). Continuously extracted from kept work. |
| `fetchRecentDecisions` | `vault/outcomes.ts:272` | `(userId, {limit}) → VaultDecision[]` | Recent outcome-tagged decisions (`outcome_observed`) for the CEO brief. |

### Caller sites

| Function | Callsites in production code |
|---|---|
| `fetchVault` | 5 (`agent/route.ts`, all 4 orchestrator handlers) |
| `retrieve` | 5 (`agent/route.ts`, all 4 orchestrator handlers) |
| `renderVaultBlock` | 5 (same callers — paired with fetchVault) |
| `getVoiceBlock` | 2 (`handlers/brief.ts`, `handlers/synthesize.ts`) |
| `fetchRecentDecisions` | 1 (`handlers/brief.ts`) |

**Verdict:** read surface is fully wired into the orchestrator's 4 handlers and the specialist execution route. Standard #2 (single source of truth) honored — no duplicate vault-fetch logic elsewhere.

---

## §3 — Vault write / ingest pipeline

The write side is split between user-triggered writes (signals captured during normal app usage) and background worker ingest (embeds + Qdrant upserts).

### User-triggered writes

| Source event | Writes to | Code path |
|---|---|---|
| User keeps / shares / publishes / regenerates a doc | `vault_patterns` + bumps `vault_embeddings_index.weight` + Qdrant payload `weight` | `vault/patterns.ts:78` `recordPatternSignal()` |
| Outcome-tagged decision (high engagement / conversion / bounce via webhooks) | `vault_decisions` (always) + pattern bump | `vault/outcomes.ts:201` `recordOutcome()` |
| Voice profile recompute (after a kept work signal) | `vault_voice_profile` | `vault/voice.ts:recomputeVoiceProfile()` |
| Conversation turn (user or assistant message in /api/agent) | `conversations` collection | `agent/route.ts:writeConversationTurnAndEnqueue()` — also enqueues to ingestion queue |
| Document save | `documents` collection | `agent/route.ts` + `documents/[id]/save-edit/route.ts` |
| Morning brief generation | `vault_briefs` (per-day row keyed by user + date) | `vault/morning-brief.ts:380` (writer) — invoked by `/api/worker/morning-brief` cron at `0 6 * * *` |

### Background ingest worker

- **Cron:** `/api/worker/vault` runs every minute (`*/1 * * * *` per `vercel.json`) — the spec source for ingest
- **Queue:** `vault_ingest_queue` PB collection — items enqueued by user-triggered writes
- **Worker behavior:** drains up to `BATCH_SIZE` items per tick; for each, embeds the content (Voyage primary / OpenAI fallback) → upserts to Qdrant `vault_{userId}` collection → writes a `vault_embeddings_index` row with `qdrant_point_id` for fast retrieval without a second hop
- **Fail-safe:** items get retry attempts; failures eventually move to `dead` status (logged per tick: `processed=N completed=N skipped=N rate_limited=N failed=N dead=N`)

### Other vault crons

| Cron | Schedule | Purpose |
|---|---|---|
| `/api/worker/vault` | `*/1 * * * *` (every minute) | Ingestion queue drain |
| `/api/worker/morning-brief` | `0 6 * * *` (6 AM UTC daily) | Generate morning briefs for users |
| `/api/worker/brief-push-dispatcher` | `*/15 * * * *` | Push completed briefs |
| `/api/worker/scheduled` | `0 8 * * *` | Generate scheduled content drafts |
| `/api/worker/security-audit` | `0 2 * * *` | Daily PB row-rule audit (Tranche 1) |

**Verdict:** full ingest pipeline exists, runs on schedule, has retry + dead-letter behavior. Pattern tracking has 7 signal types with locked weight scoring. Outcome feedback loop is wired through webhooks (Listmonk / Plausible / Twenty / Docuseal per `outcomes.ts`).

---

## §4 — Qdrant integration state

**Wired.** `apps/web/app/api/_lib/qdrant.ts` (213 LOC) is a minimal-but-complete Qdrant client implementing exactly the operations the Vault uses.

### Surface

```ts
collectionExists(name) → boolean
ensureCollection(name, dim) → void              // idempotent
upsert(name, points: QdrantPoint[]) → void      // insert/update vectors with payload
search(name, vector, opts) → QdrantSearchHit[]  // top-K cosine
setPayload(name, pointId, payload) → void       // payload-only update (pattern bumps)
deletePoints(name, pointIds) → void             // cleanup on doc delete
```

### Naming + scoping

- Per-user collection: `vault_{userId}`
- Agency mode (client-scoped): `vault_{userId}__{clientId}`
- Point id: deterministic UUID-like string derived from `source_kind + source_id`
- Vector size auto-pre-sized by embedding provider (Voyage = 1024, OpenAI = 3072)
- Distance: Cosine, locked

### Payload shape (verbatim from `qdrant.ts:31`)

```ts
type QdrantPayload = {
  user: string;
  client?: string | null;
  source_kind: "document" | "document_shard" | "conversation" | "pattern";
  source_id: string;
  parent_id?: string;
  dept?: string;
  summary?: string;
  weight?: number;
  created?: string;
  tokens?: number;
};
```

### Production callsites

- `vault/ingest.ts` — upsert from the ingest worker
- `vault/retrieve.ts` — search at retrieval time
- `vault/patterns.ts` — setPayload to bump weight on pattern signals
- `vault/summarize.ts` + `documents/[id]/save-edit/route.ts` — delete + re-upsert on doc edit

**Auth:** `api-key` header from `QDRANT_API_KEY` env var. URL from `QDRANT_URL`. Both expected to be set in production per ARCH §15.

**Verdict:** Qdrant is fully integrated, scoped per-user (and per-user-per-client in Agency mode), with full CRUD coverage for the Vault's needs. Not scaffolding.

---

## §5 — Semantic retrieval at runtime

End-to-end trace from `handlers/route.ts:122` (Command Center routing intent):

```
1. handlers/route.ts:122        retrieve(userId, message, {topK:3, maxTokens:1000, clientId, intent:"route"})
                                      ↓
2. vault/retrieve.ts            embed(query)         // Voyage primary, OpenAI fallback
                                      ↓
3. _lib/embeddings.ts           POST https://api.voyageai.com/v1/embeddings
                                returns {vector, provider, dim}
                                      ↓
4. vault/retrieve.ts            search(userCollection(userId, clientId), vector, {limit: topK*3})
                                      ↓
5. _lib/qdrant.ts               POST {QDRANT_URL}/collections/vault_{userId}/points/search
                                returns hits with raw cosine scores
                                      ↓
6. vault/retrieve.ts            scoring pipeline:
                                  - raw cosine × weight (1.0 doc / 1.5 kept / 2.0 shared / 2.5 published / 1.8 regen)
                                  - × freshness boost (1.2× if <14 days)
                                  - × same-dept boost (1.3× when preferDept matches)
                                  - drop hits below 0.35 floor
                                  - trim by maxTokens
                                      ↓
7. vault/retrieve.ts            write vault_retrieval_metrics row {userId, query_chars, hits_returned, latency_ms, cost_flag}
                                      ↓
8. handlers/route.ts:155        injected into system prompt as "--- LIVING MEMORY ---" block
```

**Returned shape:** `{ items: RetrievedItem[], costFlag: "ok"|"trimmed"|"degraded", tokensReturned: number, latencyMs: number }`

`RetrievedItem`: `{ id, sourceKind, sourceId, parentId?, dept?, summary, text, shard, weight, score, rawScore, createdIso? }`

**Cost flag semantics:**
- `ok` — under maxTokens, no trim needed
- `trimmed` — hit maxTokens cap; some hits dropped to fit budget
- `degraded` — embeddings or Qdrant or PB failed; returned `[]` and proceeded without LIVING MEMORY block (never blocks the response)

**Verdict:** end-to-end semantic retrieval works. Both Qdrant + PocketBase participate (Qdrant for vector search, PB for the `vault_retrieval_metrics` audit log + `vault_embeddings_index` denormalization lookup).

---

## §6 — Embeddings provider state

**Both wired. Voyage is primary; OpenAI is fallback.**

| Provider | Model | Vector dim | Auth | Status |
|---|---|---|---|---|
| Voyage | `voyage-3` | 1024 | `VOYAGE_API_KEY` env | Primary |
| OpenAI | `text-embedding-3-large` | 3072 | `OPENAI_API_KEY` env | Fallback |

From `_lib/vault/ingest.ts:28`:
```ts
const PRIMARY_PROVIDER: EmbeddingProvider = process.env.VOYAGE_API_KEY ? "voyage" : "openai";
```

If Voyage key is set, it's primary; OpenAI is fallback for outages / rate-limits. If only OpenAI key is set, OpenAI is primary (with no fallback). Rate-limit tracking (`vault/ratelimit.ts`) maintains separate token buckets per provider — Voyage gets 60-capacity / 1-per-sec refill.

**Verdict:** correctly wired with provider abstraction at `_lib/embeddings.ts`. Caller learns which provider produced the vector so the Qdrant collection can be pre-sized to the matching dimension.

---

## §7 — Classification of ARCH §17 "missing" items

| ARCH §17 item | Actual state | Evidence | Classification |
|---|---|---|---|
| "Conversation persistence" | Conversations PB collection exists. Every `/api/agent` turn writes a row via `writeConversationTurnAndEnqueue()`. List + thread endpoints exposed at `/api/conversations/list` + `/api/conversations/[threadId]`. Thread metadata via `ensureConversationThreadRow()`. | `agent/route.ts:28-67`, `conversations/list/route.ts`, `conversations/[threadId]/route.ts`, `setup/conversations/route.ts`, `setup/conversation-threads/route.ts` | **DONE** (V5 — PR #11) |
| "Qdrant embeddings" | Qdrant client (213 LOC) + embeddings library (169 LOC) + ingest pipeline (worker cron every minute). Per-user collection naming, Agency client scoping, weight payload, deterministic point ids. | `_lib/qdrant.ts`, `_lib/embeddings.ts`, `_lib/vault/ingest.ts`, `/api/worker/vault` cron in `vercel.json` | **DONE** (V2 — PR #5) |
| "Successful pattern tracking" | `vault_patterns` collection + `recordPatternSignal()` with 7 signal types (kept / shared / published / regenerated + engagement_high / conversion / bounce). Locked weight table (0.5–2.5×). Pattern weight propagates to `vault_embeddings_index` row AND Qdrant payload — retrieval scorer multiplies cosine by weight, so patterns naturally rise above ordinary memory without retrieval-side change. | `_lib/vault/patterns.ts` (216 LOC), `_lib/vault/outcomes.ts` (281 LOC), `_lib/vault/retrieve.ts:scoring` | **DONE** (V6 — PR #13) + outcome loop (Phase 5 — PR #19) |
| "Semantic retrieval into agent context" | `retrieve()` wired into all 4 orchestrator handlers + the specialist execution route. Returns `LIVING MEMORY` block injected into system prompts. Per-intent topK + token budget per `policies.ts`. Cost flag returned to caller. | `handlers/{route,brief,handoff,synthesize}.ts`, `agent/route.ts:192`, `_lib/vault/retrieve.ts` (281 LOC) | **DONE** (V2 + V5) |

**Net:** all 4 historical "missing" Vault items are actually **DONE**. The ARCH §17 list was stale exactly the same way the orchestrator entry was stale — the V1-V6 PRs in the task history shipped the Vault end-to-end alongside B1-B5 shipping the brain.

---

## Closing recommendation

### Is the original Tranche 4 (Intelligence Layer + Agent Loop) still relevant?

**Largely NO. Re-scope required.**

The "Intelligence Layer" framing assumed the brain + memory were greenfield work; both are shipped. The agent loop (specialist execution → vault retrieval → conversation persistence → pattern feedback) closes end-to-end today. What survives from the original Tranche 4 vision:

- **Brain ↔ Memory enrichment polish** — e.g. wiring `fetchPatterns()` into brief + synthesize handlers so the orchestrator can explicitly cite past wins. Cheap (~30 LOC).
- **Multi-turn conversation context lift** — orchestrator currently reads recent vault items; full multi-turn thread context for `brief`/`synthesize` could be richer.
- **Studio Mode (Pro+)** — operator-side controls for the orchestrator: model picker, vault top-K override, see retrieval scores. Pure UI/policy work.
- **Knowledge graph layer (Phase 3 deferred)** — graph relationships over embedded artifacts. Distinct from current Qdrant retrieval; future research-grade addition.
- **Smart Search UI (Pro+)** — user-facing semantic vault search. Reads existing retrieve(); pure UI work.

### Minimum-scope memory completion PR

There is no required memory completion PR. The remaining items above are **enhancements**, not foundations. The Tranche 2.x cycle that ACTION 1 of PR-Tranche-1.8 just absorbed into ARCH alignment is the correct close: no foundation work remains.

### What's the actual remaining product work?

Pulling from ARCH §17's surviving "MISSING" items (post-PR-Tranche-1.8 ACTION 1 corrections):

1. **Stripe top-up SKUs** (image/video credit packs) — revenue gap
2. **CEO add-on SKU ($49/mo)** — revenue gap (also surfaces upgrade math)
3. **Credits widget on dashboard** — UX gap
4. **Smart aspect ratio auto-selection** — UX polish
5. **3-Layer Briefing flow UI** — guided brief modal
6. **Smart Search UI** — reads existing retrieve(); UI work
7. **White-label (Agency)** — per-client branding
8. **Studio Mode (Pro+)** — operator controls

Plus the **W17 reconnect** (direct social publishing through Muapi when their platform-publish layer ships).

Plus the **Standard #9 follow-through** from Decision 79: any future "build the X" PR triggers a Discovery phase before strategic decisions ratify.

### Cross-tranche summary (SA-facing)

The brain is built per PR-T2.0 discovery (commit `a46c515`). The memory is built per this PR-Tranche-1.8 ACTION 2 discovery — same shape, same evidence pattern. **Recommended next tranche:** revenue + UX gaps from the surviving §17 list (Stripe top-up SKUs + Credits widget are the highest-impact pairing — they unlock the user-visible loop "I'm low on credits → I can top up → I keep generating"). Defer Tranche 4 "Intelligence Layer" until a specific product feature justifies new orchestrator surface area.

No code written outside this report.
