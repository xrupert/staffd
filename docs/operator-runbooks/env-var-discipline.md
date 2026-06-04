# Environment Variable Discipline — Operator Runbook

Companion to `apps/web/lib/env.ts` (PR-Tranche-1.6).

## The W8 footgun (real production incident)

On 2026-06-04, image and video generation broke 100% in production. Symptom: every `POST /api/integrations/muapi` failed with `Failed to parse URL from /api/v1/ideogram-v3`. Both super-admin and normal-user paths failed identically.

**Root cause:** `MUAPI_URL` was set in Vercel as an **empty string** (operator had partially configured it then cleared the value). The code read:

```ts
const MUAPI_URL = (process.env.MUAPI_URL ?? "https://api.muapi.ai").replace(/\/$/, "");
```

JavaScript's `??` operator only falls back on `null`/`undefined`. An empty string is a valid (non-nullish) value, so `??` returned `""`. Concatenated:

```
const url = `${MUAPI_URL}/api/v1/${modelEndpoint}`;
//          → `/api/v1/ideogram-v3`  (relative — undici fetch() crashes)
```

Bug had been latent since commit `c7eed37` (the initial Muapi shipment). It only surfaced when `MUAPI_URL` was set to empty rather than left unset.

## The fix — `lib/env.ts` resolvers

Four resolvers, one rule: **empty string → default, missing scheme → throw at module load.**

```ts
import {
  resolveMuapiBase,         // MUAPI_URL → https://api.muapi.ai
  resolveAppUrl,            // origin header || NEXT_PUBLIC_APP_URL || https://urstaffd.com
  resolvePocketbasePublicUrl, // NEXT_PUBLIC_POCKETBASE_URL → http://127.0.0.1:8090
  resolvePlausibleDomain,   // NEXT_PUBLIC_PLAUSIBLE_DOMAIN → urstaffd.com (bare hostname; no throw)
  MUAPI_BASE_URL,           // eagerly resolved at module load
} from "@/lib/env";
```

`MUAPI_BASE_URL` is the constant most callsites want — importing it fires the resolver immediately, so misconfigured deploys crash on import rather than silently producing relative URLs.

## Detection — re-run this grep after every PR

The W8 pattern is:

```
process.env.X ?? "https://...default..."
```

To detect new instances:

```bash
rg -n 'process\.env\.[A-Z_]+\s*\?\?\s*"https?://' apps/web/
```

**Expected output post-PR-Tranche-1.6: zero hits.** If a future PR introduces a new URL env var without going through a resolver, this grep catches it.

Broader audit (catches all `?? "default"` patterns including non-URL):

```bash
rg -n 'process\.env\.[A-Z_]+\s*\?\?' apps/web/
```

Compare against the resolved/safe list below.

## Currently-resolved env vars (status as of PR-Tranche-1.6)

| Env var | Class | Resolver / handling |
|---|---|---|
| `MUAPI_URL` | URL (concat into fetch) | `resolveMuapiBase()` ✅ |
| `NEXT_PUBLIC_APP_URL` | URL (Stripe origin chain) | `resolveAppUrl(originHeader)` ✅ |
| `NEXT_PUBLIC_POCKETBASE_URL` (client) | URL | `resolvePocketbasePublicUrl()` ✅ |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Hostname (not URL) | `resolvePlausibleDomain()` ✅ |
| `NEXT_PUBLIC_POCKETBASE_URL` (server `_lib/pb.ts`) | URL | guarded downstream (`if (!PB_URL_RAW) throw`) — safe pattern, distinct from client lib |
| `LISTMONK_URL`, `DOCUSEAL_URL`, `CHATWOOT_URL`, `TWENTY_API_URL`, `QDRANT_URL` | URL with `?? ""` | guarded downstream (`if (!X) return 503`) — safe pattern |
| `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD`, `*_API_KEY`, `*_SECRET`, `ADMIN_EMAIL`, `ADMIN_IP` | Secret / non-URL | `?? ""` followed by truthy guard — safe pattern |
| `STRIPE_PRICES ?? "{}"` | JSON | parsed via `JSON.parse`; empty-string would throw → latent bug, but operator-set empty is unlikely + handled by surrounding `try/catch` |
| `LISTMONK_USERNAME ?? "listmonk"` | String identifier | sensible default, not a URL — class B, no fix needed |

## The rule (going forward)

**Any new URL env var must use a resolver from `apps/web/lib/env.ts`.** Add a new resolver function rather than inlining `?? "https://..."`.

When adding a new URL-shaped env var:

1. Open `apps/web/lib/env.ts`
2. Add a `resolveYourThingUrl()` function matching the existing pattern:
   - undefined/empty/whitespace → default
   - missing scheme → throw
   - trailing slash → stripped
3. If the callsite reads the URL at module load, also export a `YOUR_THING_BASE_URL` constant (eagerly resolved — crashes on misconfig at import time, which is what you want)
4. Add 4-6 tests to `apps/web/__tests__/lib/env.test.ts` matching the existing pattern
5. Update ARCHITECTURE.md §15 manifest

## How to set URL env vars correctly in Vercel

- **Right:** `https://api.muapi.ai` (full URL with scheme; no trailing slash needed — resolver strips it)
- **Right:** leave the env var **unset entirely** (resolver returns the documented default)
- **Wrong:** set the env var to an **empty string** (the W8 case — resolver now catches it, but don't do this on purpose)
- **Wrong:** `api.muapi.ai` (no scheme — resolver THROWS at module load; deploy will not boot)

## Related runbooks

- `super-admin-architecture.md` — operator surface for admin-only routes
- `pb-row-rules.md` — PocketBase multi-tenant security
- `security-floor-restoration.md` — bulk-repair operator workflow
