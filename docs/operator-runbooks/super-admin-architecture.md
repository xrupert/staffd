# Super-Admin Architecture — Operator Runbook

Companion to **Decision 74 (simplified)** — `apps/web/app/api/_lib/auth/super-admin.ts` + `/dashboard/admin/*`.

## Identity model

A user is super-admin if and only if their account email matches `process.env.ADMIN_EMAIL` set on Vercel. Currently:

```
ADMIN_EMAIL=chris.rupert@cybridagency.com
```

Single-admin (Option α). To rotate the super-admin: update `ADMIN_EMAIL` in Vercel, redeploy. The previous email loses super-admin privileges instantly on next request. Multi-admin (Option γ) is documented in ARCHITECTURE.md but not yet implemented.

## What super-admin bypasses

| Layer | Behavior for super-admin |
|---|---|
| Admin dashboard (`/dashboard/admin/*`) | Full access (page view auto-logged) |
| Admin API routes (8 routes) | Full access (each call auto-logged) |
| Image/video generation (`/api/integrations/muapi`) | No credit deduction; usage logged |
| Agent calls (`/api/agent`) | No credit deduction; usage logged |
| Permission gates (`canAccessPack` etc.) | DEFERRED — applied when first such gate is built in Tranche 2+ |

## What super-admin does NOT bypass

- **PocketBase row rules.** Super-admin's records are still subject to `user = @request.auth.id` row-rule scoping. Super-admin content attaches to their own `user_id` like any other user. (Use PB admin UI for cross-tenant data access.)
- **Rate limits at the X2 tier** (per-day 50/agent cap). Hard gate, not credit-based.
- **Brand laws** (Decision 71 — no recommending competitors, etc.). Apply to every agent regardless of caller.
- **External execution gate** (Decision 45 — "STAFFD never executes externally without explicit user authorization"). Super-admin still authorizes.

## Where to view logs

Both log collections are admin-only at the row-rule tier (`ADMIN_ONLY_RULES` — all-null). Access them via PB admin UI:

1. Open your PocketBase admin URL (set as `NEXT_PUBLIC_POCKETBASE_URL`/`_/`)
2. Sign in with `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD`
3. Navigate to **Collections** → either:
   - `super_admin_audit_log` — every admin API call + dashboard view
   - `super_admin_usage_log` — every premium operation (agent calls, image gen, etc.)

The dashboard `/dashboard/admin` index page provides one-click deep links to both collections in PB admin.

**Future:** dedicated viewer pages with sorting/filtering will be added when log volume makes them useful (currently deferred per Decision 74 simplification).

### Audit log schema

```
user           — super-admin user id
action_type    — "api_call" | "dashboard_view" | "pack_access_bypass" | etc.
resource       — route path | pack id | agent id | etc.
parameters     — JSON-stringified sanitized request params (secrets redacted)
result         — "success" | "error" | "denied"
error_detail   — stack/detail when result=="error"
ip_address     — request origin
user_agent     — browser/client info
created        — timestamp (autodate)
```

### Usage log schema

```
user             — super-admin user id
operation_type   — "muapi_generation" | "agent_credit_spend" | etc.
operation_detail — human-readable detail (e.g., "image via mu-imagen-3")
parameters       — JSON-stringified sanitized params
created          — timestamp (autodate)
```

*Cost estimation fields (`estimated_cost_cents`, `cost_basis`) deferred — add when there's real data to estimate against.*

## How to add new privilege checks in future PRs

Whenever you add ANY new permission check, billing call site, or premium-tier feature in future tranches:

### Pattern A — you have the user's PB JWT (`pbToken`)

```ts
import { trySuperAdminFromToken } from "../_lib/auth/super-admin";
import { logSuperAdminUsage } from "../_lib/auth/super-admin-logging";

const admin = await trySuperAdminFromToken(pbToken);
if (admin) {
  await logSuperAdminUsage(admin, "new_operation_type", {
    operation_detail: "human readable",
    parameters: { /* sanitized */ },
  });
} else {
  await normalBillingOrPermissionCheck();
}
```

### Pattern B — you only have `userId` (no JWT)

```ts
import { trySuperAdminByUserId } from "../_lib/auth/super-admin";

const admin = await trySuperAdminByUserId(userId);
// ... same shape
```

### Pattern C — gating an entire route to super-admin only

```ts
import { requireSuperAdmin, toAuthErrorResponse, type SuperAdminUser } from "../_lib/auth/super-admin";
import { logSuperAdminAccess } from "../_lib/auth/super-admin-logging";

export async function GET(req: Request) {
  let me: SuperAdminUser;
  try {
    me = await requireSuperAdmin(req);
  } catch (err) {
    return toAuthErrorResponse(err);
  }
  void logSuperAdminAccess(me, "api_call", "/api/admin/your-new-route", { request: req });

  // ... super-admin-only logic
}
```

**This is non-negotiable.** Partial bypass breaks the operator's ability to use the product end-to-end without billing themselves or being blocked by quotas.

## Auth tier distinctions

These three auth tiers exist and are deliberately separate:

| Tier | Used by | Pattern |
|---|---|---|
| **Super-admin (human)** | `/api/admin/*` (8 refactored routes) + dashboard | `requireSuperAdmin(req)` |
| **Cron worker (automated)** | `/api/worker/*` | `Authorization: Bearer ${CRON_SECRET}` or `x-worker-secret` header |
| **Network-tier admin** | `/api/admin/data` | IP allow-list via `ADMIN_IP` env var |

When building new admin tooling, decide which tier fits — they don't overlap.

## Hiding super-admin from user-facing lists

The `users.hidden_from_user_lists` boolean field exists (added by `/api/setup/users`). Super-admin's user record has it set to `true` automatically by the setup route.

**Today this field has no consumers** — no surface in STAFFD currently lists `users` (agency clients live in `clients`, no leaderboards exist). When such a surface is built, filter `hidden_from_user_lists != true` on its query. The field is future-proofing.

## Rotating super-admin

1. Update `ADMIN_EMAIL` in Vercel env to the new value
2. Redeploy (Vercel does this on env-var change)
3. POST `/api/setup/users` to set `hidden_from_user_lists = true` on the new admin's user record (idempotent)
4. Optionally PATCH the old admin's user record to set `hidden_from_user_lists = false` (via PB admin UI) if they're now a regular user

The old admin loses super-admin privileges instantly on next request after the redeploy.

## Related runbooks

- `pb-row-rules.md` — verifier baseline + repair endpoint (Decisions 68 + 71)
- `orphan-collection-resolution.md` — orphan migration + drop workflow (Decision 73)
- `security-floor-restoration.md` — bulk-repair operator workflow (Decision 69)
