# Muapi Vendor Drift — Operator Runbook

Companion to `apps/web/app/api/integrations/muapi/route.ts` and the model
catalog snapshot dated 2026-06-04 (PR-Tranche-1.7).

Muapi has shipped breaking-change events without notice — both the W8
empty-URL config gap (PR-Tranche-1.6) and the W16 vendor reconnect
(PR-Tranche-1.7) trace back to them. This runbook is the playbook for
the next event.

## 1. When a generation returns 4xx

If `/api/integrations/muapi` starts returning 4xx (`404 Not Found`,
`400 Bad Request`, etc.) from production traffic that previously worked,
suspect vendor drift first.

Fast triage:

```bash
# 1. Fetch the current Muapi OpenAPI spec
curl -s https://api.muapi.ai/openapi.json | jq '.paths | keys[]' | sort

# 2. Cross-check against current STAFFD model slugs
grep -E '"(ideogram|midjourney|flux|veo3|sora|runway)' \
  apps/web/app/api/integrations/muapi/route.ts
```

If any slug returned by `routeImageModel` / `routeVideoModel` is NOT in
the OpenAPI `paths` output, the catalog has drifted — proceed to the
refresh recipe below.

If all slugs are present but the request still 4xx, the request **schema**
has likely drifted (body field renames, removed wrappers, header changes).
Capture the failing request's `[muapi] submit failed` log line — the
`detail` field contains Muapi's JSON error message.

## 2. How to refresh the model slug catalog

Three steps:

### Step A — pull the canonical reference

The Open-Generative-AI repo (`https://github.com/xrupert/Open-Generative-AI`)
maintains a canonical `models.js` mapping STAFFD-class capabilities to
current Muapi slugs. Pull the latest version:

```bash
curl -sL https://raw.githubusercontent.com/xrupert/Open-Generative-AI/main/models.js \
  > /tmp/muapi-models.js
```

### Step B — diff against STAFFD's current routing

Compare the slugs returned by `routeImageModel` and `routeVideoModel`
against `/tmp/muapi-models.js`. For each capability tier STAFFD routes to
(text-in-image, cinematic, photoreal default; cinematic video, premium
video, backup video), pick the current slug.

### Step C — update + retest

Edit `apps/web/app/api/integrations/muapi/route.ts`:

- Update the slug strings returned by `routeImageModel` / `routeVideoModel`
- Bump the "Catalog snapshot" date in the docblock above each function
- Run `pnpm --filter web test` — fixtures in
  `apps/web/__tests__/integrations/muapi-route.test.ts` assert the
  current slug shape; update them to match
- Deploy + smoke-test one real generation per category before declaring
  the refresh complete

If the **request schema** also drifted (not just slug names), additional
work in `submitPrediction`:
- Auth header — confirm `x-api-key` vs whatever the new spec mandates
- Body shape — confirm flat vs wrapped envelope
- Field names — `aspect_ratio` vs `aspectRatio` vs `size`

## 3. Documented fallback aggregator

If Muapi has a second breaking-change event of meaningful scope (auth
overhaul, pricing model overhaul, mass-deprecation of premium tier),
**Lumenfall.ai** is the documented Muapi-class alternative — free-for-dev
tier verified, not currently integrated. Would require a ~1-2 day port
via the same routeImageModel/routeVideoModel pattern: copy
`/api/integrations/muapi/route.ts` to `/api/integrations/lumenfall/route.ts`,
port auth header + body shape + slug catalog, introduce a
`GENERATION_VENDOR` toggle in `apps/web/lib/feature-flags.ts`, UI calls
the toggle-selected route. Don't pre-build the abstraction layer — ship
the port if (when) the event happens.

## 4. Billing policy (W95.7.3c)

From Muapi's published OpenAPI spec (NOT a confirmed invoice): **"Costs are
debited from the wallet on completion."** Muapi debits STAFFD when a generation
**completes**, not on submit. Account balance: `GET /api/v1/account/balance`.

Margin implications (codified as Standard #33):
- **Closed tab mid-generation** → the job still completes server-side → Muapi
  debits STAFFD. Mitigated by the completion **webhook** (`POST
  /api/generation/webhook`, W95.7.3c-b1): Muapi pushes completion, STAFFD charges
  the customer even if they left.
- **Multi-press / concurrent submits** → N completions → N debits. Mitigated by
  submit-time dedup (`generation_jobs.fingerprint`, 15-min in-flight window).
- **Failed / cancelled jobs billed?** — NOT IN SPEC. **UNVERIFIED.** Pull a real
  invoice and confirm; if failures/cancels are billed, harden further.

Webhook auth: an HMAC-derived capability token in the `?token=` query param
(`MUAPI_WEBHOOK_SECRET`); the receiver re-derives + timing-safe compares, then
pulls the authoritative result via `checkPrediction` (never trusts the unsigned
body). Set `MUAPI_WEBHOOK_SECRET` in Vercel to enable push delivery; unset →
pure client-poll fallback.

## 6. Three-tier credit weights (W95.7.3d-T1)

Generation is priced in three customer-facing tiers (locked), with credit weight
derived from a model's underlying Muapi USD cost via `_lib/generation/pricing.ts`:

| Tier | Video | Image | Underlying Muapi cost band |
|---|---|---|---|
| Quick | 4 cr | 1 cr | video $0.06–0.15 · image $0.01–0.03 |
| Pro | 8 cr | 2 cr | video $0.15–0.40 · image $0.03–0.08 |
| Premium | 60 cr | 4 cr | video $2.40–3.00 · image $0.10–0.30 |

Gap-cost rule (C3): a cost in an unmapped gap (video $0.40–2.40, image $0.08–0.10)
rounds UP to the next tier (margin-protective).

**Model catalog:** `generation_models` is refreshed hourly by
`/api/worker/muapi-catalog-sync` from `GET /api/v1/models` (no auth). Static-priced
models are classified at sync; dynamic-priced models store `cost_usd=null` and are
priced at request time via `POST /api/v1/models/{name}/estimate-cost`.

**Slug drift (C5):** `_lib/generation/routing.ts` lists the preferred model slugs
per (department, kind, tier). `validateRoutingSlugs` runs inside the hourly sync;
any routing slug absent from the live catalog is logged in the sync response's
`routingDrift` array (and the cron log). When a slug drifts, update routing.ts to
the current catalog slug (same refresh recipe as §2). **Slugs verified against the
live catalog 2026-06-23** — all 12 confirmed present except two that were fixed in
that pass: `flux-1-dev` → `flux-dev` (the real slug; h1 had substituted a
nonexistent one) and the bogus `background-remove` dropped from image-quick. Re-run
this verification whenever Muapi ships a catalog change.

**Submit-schema verification (W95.7.3d-h4, 2026-06-23).** Confirmed against the
live OpenAPI (`https://api.muapi.ai/openapi.json`, public): REST auth is the
`x-api-key` header (✓ matches `predictions.ts`); the completion callback is a
BODY field `webhook_url` (NOT a `?webhook=` query — fixed); the poll endpoint is
`/api/v1/predictions/{id}/result` (✓). **Video MUST route to text-to-video (t2v)
models** — every `*-i2v` / `image-to-video` model `requires` a source image
(`image_url` / `images_list`) the conversational flow never supplies, so those
slugs 400'd on submit. t2v models require only `prompt`. The image tiers are
text-to-image (prompt-only) and are fine. When refreshing slugs, prefer t2v for
video and verify each `required` field against the OpenAPI path schema.

**Catalog drift signal (W95.7.3d-h3).** Beyond slug drift, the hourly sync diffs
the freshly-classified catalog against the cache (`computeCatalogDrift`) and emits
a structured `[catalog-drift]` log line when **risk-bearing** change appears: a
model's price/tier/credit-weight moved (margin risk, Standard #33), a previously
cached model vanished (`removedModels`), or routing-slug drift. New models are
reported in the payload but are not alert-worthy on their own. The full drift
object is also returned in the sync response (`drift`). **V1 alerting = the
structured log** (same pattern as the `security-audit` cron). Operator email + a
persisted signal row are intentionally deferred to the planned shared
`super_admin_signals` mechanism (see `pb-row-rules.md` daily-cron note) so both
the catalog and security crons emit through one path — not a bespoke email here.

**Routing failures fail loudly (W95.7.3d-h1).** The legacy `routeImageModel` /
`routeVideoModel` hardcoded-slug fallback is REMOVED — the muapi route resolves
its model via `routeFor` (the catalog is a PREFERENCE for accurate dynamic
pricing, not a hard gate — W95.7.3d-h4). The only hard failure:

| Error | Meaning | Fix |
|---|---|---|
| `routing_unresolved` | `routeFor(department, kind, tier)` returned no models at all | Add a routing entry for that combination in `routing.ts` |

The body carries `{ error, department, kind, tier, message }`. The specialist
delivery layer consumes the 500 and shows a customer-readable "operator
configuration required" message.

**No manual catalog sync is required for generation (h4 reversal of h1).** The
routing slugs are version-controlled and verified against the live catalog, and
billing uses the LOCKED tier weight (not the catalog cost), so an empty/unsynced
`generation_models` no longer blocks generation — `resolveModel` falls back to the
verified primary slug. If a slug has genuinely drifted, Muapi returns a submit
error (surfaced in the `[muapi] submit failed` log) and the hourly catalog-drift
signal flags it. The hourly sync still runs as a background drift-detector +
dynamic-pricing cache; it is just no longer a precondition.

## 7. Departments without routing entries (W95.7.3d-h1)

Only departments with live generation triggers need `routing.ts` entries. A
(department, kind) with no entry falls back to `DEFAULT_MODELS` (shared best-of-band
list), so all departments resolve today. If a future change removes a department's
fallback, generation for it returns `routing_unresolved` (500) until an entry is
added — by design (fail loud, never a hardcoded-slug 404).

## Related runbooks

- `env-var-discipline.md` — URL env var hardening (PR-Tranche-1.6)
- `super-admin-architecture.md` — operator surface for admin-only routes
