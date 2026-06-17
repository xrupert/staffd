import { NextResponse, type NextRequest } from "next/server";
import { authorizeSetup, SETUP_SECRET_HEADER } from "./app/api/_lib/setup-auth";

/**
 * Proxy (T1-8 / W95.3.4) — gates all /api/setup/* routes via DUAL-AUTH.
 *
 * (Next.js 16 renamed the `middleware` file convention to `proxy`; this is
 * the same gate.)
 *
 * Setup routes run idempotent schema migrations against production
 * PocketBase. A single enforcement point here means the gate can never be
 * forgotten on a new setup route. Authorized if EITHER:
 *   • header `x-setup-secret` matches `ADMIN_SECRET` (scripted/emergency), or
 *   • the `Authorization` header carries a super-admin PB session JWT (the
 *     in-app migration trigger at /dashboard/admin/migrations).
 * Fail-closed: if ADMIN_SECRET is unset AND no valid super-admin session is
 * presented, the request is denied (503) — see authorizeSetup. Standard #24.
 *
 * Operators (scripted): curl -X POST -H "x-setup-secret: $ADMIN_SECRET" .../api/setup/<name>
 */
export async function proxy(req: NextRequest) {
  const result = await authorizeSetup({
    secretHeader: req.headers.get(SETUP_SECRET_HEADER),
    authHeader: req.headers.get("authorization"),
    expectedSecret: process.env.ADMIN_SECRET,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.next();
}

export const config = {
  // Only run on setup routes — everything else is untouched.
  matcher: "/api/setup/:path*",
};
