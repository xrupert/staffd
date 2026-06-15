import { NextResponse, type NextRequest } from "next/server";
import { checkSetupAuth, SETUP_SECRET_HEADER } from "./app/api/_lib/setup-auth";

/**
 * Edge middleware (T1-8) — gates all /api/setup/* routes behind ADMIN_SECRET.
 *
 * Setup routes run idempotent schema migrations against production
 * PocketBase. A single enforcement point here means the gate can never be
 * forgotten on a new setup route. Fail-closed: if ADMIN_SECRET is unset,
 * every setup request is denied (503) — see checkSetupAuth.
 *
 * Operators run setup with:  curl -X POST -H "x-setup-secret: $ADMIN_SECRET" .../api/setup/<name>
 */
export function middleware(req: NextRequest) {
  const result = checkSetupAuth({
    provided: req.headers.get(SETUP_SECRET_HEADER),
    expected: process.env.ADMIN_SECRET,
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
