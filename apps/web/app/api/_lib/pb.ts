/**
 * PocketBase admin helpers.
 *
 * Single source of truth for admin authentication and ergonomic CRUD against
 * the PB REST API. Every server route that needs admin scope (credit ledger,
 * setup migrations, trial state, rate-limit counters) should go through here
 * so we never duplicate the auth dance or filter-encoding logic again.
 */

const PB_URL_RAW = process.env.NEXT_PUBLIC_POCKETBASE_URL ?? "";

/** Returns the configured PB URL with no trailing slash. Throws if unset. */
export function pbUrl(): string {
  if (!PB_URL_RAW) throw new Error("NEXT_PUBLIC_POCKETBASE_URL is not configured");
  return PB_URL_RAW.replace(/\/$/, "");
}

let cachedAdminToken: { token: string; expiresAt: number } | null = null;

/**
 * Authenticates against `_superusers` and returns an admin token.
 * Cached in-process for 50 minutes (PB tokens are valid ~1h).
 */
export async function getAdminToken(): Promise<string> {
  const now = Date.now();
  if (cachedAdminToken && cachedAdminToken.expiresAt > now) {
    return cachedAdminToken.token;
  }

  const url = pbUrl();
  const res = await fetch(`${url}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identity: process.env.PB_ADMIN_EMAIL ?? "",
      password: process.env.PB_ADMIN_PASSWORD ?? "",
    }),
  });
  if (!res.ok) throw new Error(`PocketBase admin auth failed (${res.status})`);
  const { token } = (await res.json()) as { token: string };
  cachedAdminToken = { token, expiresAt: now + 50 * 60 * 1000 };
  return token;
}

/**
 * Encodes a PocketBase filter expression. PB does not parameterise filters,
 * so values that may contain quotes must be escaped before interpolation.
 * This is the single place we do that — every other route should call it.
 */
export function pbEscape(value: string): string {
  return value.replace(/'/g, "\\'");
}

/** Convenience: build the standard admin auth headers for JSON requests. */
export function adminHeaders(token: string): Record<string, string> {
  return { Authorization: token, "Content-Type": "application/json" };
}

/**
 * Fetch the first record matching a filter. Returns null if none.
 * Caller supplies the collection name and a (pre-escaped) filter expression.
 */
export async function pbFirst<T>(
  collection: string,
  filter: string,
  token: string,
  opts?: { fields?: string }
): Promise<T | null> {
  const url = pbUrl();
  const params = new URLSearchParams({ filter, perPage: "1" });
  if (opts?.fields) params.set("fields", opts.fields);
  const res = await fetch(
    `${url}/api/collections/${collection}/records?${params.toString()}`,
    { headers: { Authorization: token } }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: T[] };
  return data.items?.[0] ?? null;
}
