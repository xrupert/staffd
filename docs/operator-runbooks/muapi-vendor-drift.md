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

## Related runbooks

- `env-var-discipline.md` — URL env var hardening (PR-Tranche-1.6)
- `super-admin-architecture.md` — operator surface for admin-only routes
