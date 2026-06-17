/**
 * W91 — single source of truth for resolving vendor credentials.
 *
 * resolveCredentials(userId, type) returns, in priority order:
 *   1. the user's own stored creds (decrypted)   → source: "user"
 *   2. operator-scoped env vars (dogfood/default) → source: "operator"
 *   3. null  (caller surfaces 503 / "Connect your tools")
 *
 * EVERY /api/integrations/* route resolves creds through this helper — no
 * route reads vendor env vars directly anymore.
 *
 * NOTE: muapi is intentionally NOT an IntegrationType. It is STAFFD's
 * platform-scoped image/video credit gateway (billed in credits), never a
 * per-customer integration. Do NOT add "muapi" to this enum — the muapi
 * route resolves only the operator env path on purpose.
 */

import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../pb";
import { isSuperAdmin, trySuperAdminByUserId } from "../auth/super-admin";
import { decryptSecret } from "./crypto";

export type IntegrationType = "twenty" | "chatwoot" | "listmonk" | "plausible" | "docuseal";

export const INTEGRATION_TYPES: IntegrationType[] = ["twenty", "chatwoot", "listmonk", "plausible", "docuseal"];

export type Resolved = {
  source: "user" | "operator";
  url: string;
  key: string;
  config: Record<string, unknown>;
};

type UserRow = {
  connection_url: string;
  api_key: string;
  additional_config: Record<string, unknown> | null;
  status: string;
};

export type ResolveUser = { id: string; email?: string };

export type ResolveDeps = {
  fetchUserRow: (userId: string, type: IntegrationType) => Promise<UserRow | null>;
  decrypt: (blob: string) => string;
  /** Is this user the operator (super-admin)? Gates the operator env fallback. */
  isOperator: (user: ResolveUser) => Promise<boolean>;
};

/** Operator-scoped fallback from env (the D3 mapping). Returns null if absent. */
export function operatorCredentials(type: IntegrationType): Resolved | null {
  const e = (k: string) => (process.env[k] ?? "").trim();
  let url = "", key = "", config: Record<string, unknown> = {};
  switch (type) {
    case "twenty": url = e("TWENTY_API_URL"); key = e("TWENTY_API_KEY"); break;
    case "chatwoot": url = e("CHATWOOT_URL"); key = e("CHATWOOT_API_KEY"); config = { account_id: e("CHATWOOT_ACCOUNT_ID") }; break;
    case "listmonk": url = e("LISTMONK_URL"); key = e("LISTMONK_PASSWORD"); config = { username: e("LISTMONK_USERNAME") }; break;
    case "plausible": url = e("PLAUSIBLE_API_URL") || e("NEXT_PUBLIC_PLAUSIBLE_URL"); key = e("PLAUSIBLE_API_KEY"); config = { site_id: e("PLAUSIBLE_SITE_ID") }; break;
    case "docuseal": url = e("DOCUSEAL_URL"); key = e("DOCUSEAL_API_KEY"); break;
  }
  if (!url || !key) return null;
  return { source: "operator", url, key, config };
}

/** Default deps — live PB read (admin token) + AES decrypt + operator check. */
function defaultDeps(): ResolveDeps {
  return {
    fetchUserRow: async (userId, type) => {
      try {
        const token = await getAdminToken();
        const filter = `(user = "${pbEscape(userId)}" && integration_type = "${pbEscape(type)}")`;
        const res = await fetch(
          `${pbUrl()}/api/collections/user_integrations/records?filter=${encodeURIComponent(filter)}&perPage=1`,
          { headers: adminHeaders(token) },
        );
        if (!res.ok) return null;
        const data = (await res.json()) as { items?: UserRow[] };
        return data.items?.[0] ?? null;
      } catch {
        return null;
      }
    },
    decrypt: decryptSecret,
    // Email is the cheap path (no PB read); fall back to an id lookup for
    // callers (POST actions) that only have a userId.
    isOperator: async (user) =>
      user.email ? isSuperAdmin({ id: user.id, email: user.email }) : (await trySuperAdminByUserId(user.id)) !== null,
  };
}

/**
 * Resolve creds for `user`. User's own stored creds win. The operator env
 * fallback is SUPER-ADMIN ONLY (dogfooding) — a regular customer with no
 * stored creds gets null, never the operator's data (no cross-tenant leak).
 */
export async function resolveCredentials(
  user: ResolveUser,
  type: IntegrationType,
  deps: ResolveDeps = defaultDeps(),
): Promise<Resolved | null> {
  if (user.id) {
    const row = await deps.fetchUserRow(user.id, type);
    if (row && row.status !== "error" && row.api_key) {
      try {
        return { source: "user", url: row.connection_url, key: deps.decrypt(row.api_key), config: row.additional_config ?? {} };
      } catch {
        // Decryption failed (key rotated / corrupt) → fall through.
      }
    }
  }
  if (await deps.isOperator(user)) return operatorCredentials(type);
  return null;
}
