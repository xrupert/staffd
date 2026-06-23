/**
 * Setup-route authorization gate (T1-8).
 *
 * /api/setup/* routes run idempotent schema migrations against production
 * PocketBase. They must NOT be publicly invocable. `middleware.ts` calls
 * this on every /api/setup/* request, passing the `x-setup-secret` header
 * and the configured `ADMIN_SECRET`.
 *
 * Fail-closed contract: when ADMIN_SECRET is not configured, every setup
 * request is denied with 503 — setup is LOCKED until the operator sets the
 * secret. We never fall open to the pre-T1-8 "anyone can POST" behavior.
 */

export const SETUP_SECRET_HEADER = "x-setup-secret";

export type SetupAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/**
 * W95.3.4 — verify a PB session JWT belongs to the super-admin (email matches
 * ADMIN_EMAIL). Self-contained (fetch + env only) so it stays usable from the
 * Edge `proxy`. Mirrors the requireSuperAdmin logic (auth-refresh → email check)
 * without importing the Node-coupled super-admin module. Standard #24.
 */
export async function isSuperAdminSession(
  pbToken: string | null | undefined,
  opts: { pbUrl?: string; adminEmail?: string } = {},
): Promise<boolean> {
  const token = (pbToken ?? "").trim();
  if (!token) return false;
  const adminEmail = (opts.adminEmail ?? process.env.ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!adminEmail) return false;
  const base = (opts.pbUrl ?? process.env.NEXT_PUBLIC_POCKETBASE_URL ?? "").replace(/\/$/, "");
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: token },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { record?: { email?: string } };
    return (data.record?.email ?? "").trim().toLowerCase() === adminEmail;
  } catch {
    return false;
  }
}

/**
 * W95.3.4 — dual-auth for /api/setup/*: authorize if EITHER the shared secret
 * matches (existing scripted/emergency path) OR a super-admin session JWT is
 * presented (the in-app migration trigger). When neither passes, preserve the
 * secret path's status (401 normally; 503 fail-closed when ADMIN_SECRET unset).
 */
export async function authorizeSetup(input: {
  secretHeader: string | null | undefined;
  authHeader: string | null | undefined;
  expectedSecret: string | null | undefined;
  pbUrl?: string;
  adminEmail?: string;
}): Promise<SetupAuthResult> {
  const secret = checkSetupAuth({ provided: input.secretHeader, expected: input.expectedSecret });
  if (secret.ok) return { ok: true };
  if (input.authHeader && (await isSuperAdminSession(input.authHeader, { pbUrl: input.pbUrl, adminEmail: input.adminEmail }))) {
    return { ok: true };
  }
  return secret; // {ok:false, status, error} — 401 normal, 503 fail-closed
}

export function checkSetupAuth(input: {
  provided: string | null | undefined;
  expected: string | null | undefined;
}): SetupAuthResult {
  const expected = (input.expected ?? "").trim();
  // Fail closed — no configured secret means setup stays locked.
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error:
        "Setup routes are locked: ADMIN_SECRET is not configured. Set it in the environment to enable setup.",
    };
  }
  const provided = (input.provided ?? "").trim();
  if (!provided || provided !== expected) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}
