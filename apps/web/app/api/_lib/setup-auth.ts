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
