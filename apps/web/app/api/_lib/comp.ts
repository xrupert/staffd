/**
 * Comp logic — internal accounts that get free Agency access regardless of
 * what's in the subscriptions collection. Used for the operator/owner so they
 * can dogfood every tier and run real clients through the platform.
 *
 * Comp is granted by email domain (any user signing up with @jrw-solutions.com
 * is automatically Agency). Extend COMP_DOMAINS or COMP_EMAILS as needed.
 */

const COMP_DOMAINS = new Set<string>([
  "jrw-solutions.com",
]);

// Super-admin dogfooding overrides — see W71.5
export const COMP_EMAILS = new Set<string>([
  "chris.rupert@cybridagency.com",
]);

/** Returns true if this email qualifies for an Agency-tier comp. */
export function isCompedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  if (COMP_EMAILS.has(e)) return true;
  const at = e.lastIndexOf("@");
  if (at < 0) return false;
  return COMP_DOMAINS.has(e.slice(at + 1));
}

/**
 * W92.1 — the EFFECTIVE plan tier a user actually operates at.
 *
 * Comp accounts (and the super-admin) sign up via the normal path, so their
 * stored `subscriptions.plan` stays "starter" — but at runtime they're granted
 * Agency features + 100x credits. Anywhere we DISPLAY a tier (e.g. the W92
 * usage dashboard) must reflect the effective tier, not the stale stored one.
 *
 * Comp is by email (isCompedEmail, which already includes the operator); an
 * explicit `adminEmail` match is also honored for robustness. Everyone else
 * gets their stored plan (or "none" when unset).
 */
export function effectivePlan(
  email: string | null | undefined,
  storedPlan: string | null | undefined,
  adminEmail?: string | null,
): string {
  const e = (email ?? "").trim().toLowerCase();
  const admin = (adminEmail ?? "").trim().toLowerCase();
  if (isCompedEmail(email) || (admin && e === admin)) return "agency";
  return (storedPlan ?? "").trim() || "none";
}

/**
 * Looks up the user's email in PocketBase and returns whether they get the
 * Agency comp. Pass an admin token. Returns false on any error or missing user.
 */
export async function isCompedUser(
  pbUrl: string,
  adminToken: string,
  userId: string
): Promise<boolean> {
  if (!userId) return false;
  try {
    const res = await fetch(`${pbUrl}/api/collections/users/records/${userId}`, {
      headers: { Authorization: adminToken },
    });
    if (!res.ok) return false;
    const user = (await res.json()) as { email?: string };
    return isCompedEmail(user.email);
  } catch {
    return false;
  }
}
