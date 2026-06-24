---
name: staffd-vercel-footguns
description: "Two STAFFD/Vercel deploy footguns that 500'd all API routes (passed locally) — node:fs in serverless routes + outputFileTracingRoot"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2937f992-0e99-4d3f-ab14-59d1d9a56b02
---

STAFFD deploys `apps/web` (Next.js 16) to Vercel from a pnpm/Turbo monorepo. Two deployment footguns each caused a **prod-wide /api 500** during W91.5 that **passed `next build` + `next start` locally** — local parity does NOT catch these:

1. **Never `readFileSync` a repo-root file from a serverless route.** Importing `node:fs`/`node:path` into a module that lands in a shared server chunk (e.g. the Vault loader `_lib/vault`) 500'd routes that didn't even import it (shared-chunk poisoning). Fix: embed canonical content as a string constant (e.g. `staffd-self.ts` `SELF_FRONTMATTER`), parse in-memory — no fs. [[project-staffd]]

2. **Never set `outputFileTracingRoot` in `apps/web/next.config.js`.** Pointing it at the monorepo root broke serverless dependency resolution for ALL functions; reverting the config alone did NOT fix the already-deployed bundle. Vercel auto-detects the correct root — leave it unset. If extra files must be bundled, use `outputFileTracingIncludes` only (untested here; prefer embedding).

**How to catch:** after any deploy touching `_lib`, build config, or anything imported widely, curl a cheap gated route live (e.g. `GET /api/user-integrations` → expect 401). A 500 there = bundle/runtime breakage. The git deployment status shows "success" even when functions 500 at runtime — verify with a live request, not the deploy status.

**Recovery pattern:** revert the offending code (not just config) → push → poll `https://urstaffd.com/api/user-integrations` until it returns 401 (new `dpl_` id + 401 = healthy).

**Safe pattern for heavy node deps (W95.3.5 — pdf-parse@2 + mammoth):** to add node:fs/Buffer-heavy parsers without the shared-chunk 500, **dynamic-import them INSIDE the function only** (`await import("pdf-parse")` within `extractText()`), never at module top level. The dep then loads only when that code runs (a Node serverless function like workflow-drain), stays out of shared chunks + the Edge `proxy` bundle, and `next build` + deploy stay green. Confirmed clean via a post-deploy live sweep of 8 routes (all expected gate codes, zero 500s). Use `pdf-parse@2`'s `new PDFParse({data}).getText()` class API — the v1 import-time test-fixture footgun (`./lib/pdf-parse.js`) does not apply to v2 (its exports map has no `./lib` path). After any deploy adding such deps, run the live /api sweep — build success alone never proves runtime safety here.

**Setup routes & sensitive env (W95.3 sidebar):** `/api/setup/*` is gated by `apps/web/proxy.ts` (Next 16 renamed `middleware`→`proxy`; build log shows "ƒ Proxy"), matcher `/api/setup/:path*`, comparing header `x-setup-secret` to env `ADMIN_SECRET` via strict trim-equality, **fail-closed 503** if `ADMIN_SECRET` unset. The setup route handlers themselves have NO secret check — a 401 always means the proxy, a 503 means ADMIN_SECRET missing in that env. **All ~45 real STAFFD secrets are Vercel _Sensitive_ vars** → `vercel env pull` returns them EMPTY (`=""`), and the dashboard masks them — they're injected into the running deployment but unreadable by CLI/dashboard/agent. So the agent canNOT obtain `ADMIN_SECRET`/`PB_ADMIN_PASSWORD` to run setup migrations or hit PB directly; `.env.local` only has `NEXT_PUBLIC_POCKETBASE_URL` (prod Railway PB), no PB admin creds. **Operator setup must run from Git Bash with real curl** (PowerShell `curl` is an `Invoke-WebRequest` alias → header not sent → 401; `$`-chars in the value get expanded): `curl -X POST -H 'x-setup-secret: <SECRET>' https://urstaffd.com/api/setup/contacts` (single quotes, no expansion). Check current collection state with an unauth read: `GET <PB>/api/collections/<name>/records?perPage=1` → 404 = missing, 200 = exists. As of W95.3 sidebar: `contacts` MISSING, `workflows`+`workflow_tasks` EXIST. Standard #17 (keep operator out of PowerShell) argues for a future authenticated in-app setup trigger. See [[project-staffd-model-b3]].
