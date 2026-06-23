/**
 * Idempotent setup for the `users` PocketBase auth collection (Decision 74).
 *
 * The `users` collection itself is PB-native (system-managed). This route
 * only PATCHes missing STAFFD-defined fields onto it. Does NOT redefine
 * PB auth fields (email, password, verified, etc.) — those are managed
 * by PocketBase.
 *
 * Fields added by STAFFD over time:
 *   - industry_packs       (json, optional)   — array of pack ids the user owns
 *   - hidden_from_user_lists (bool, optional) — Decision 74; future-proof
 *                                               filter consumers (none yet)
 *
 * After ensuring the field exists, this route sets the super-admin's
 * `hidden_from_user_lists = true` flag (one-time idempotent operation;
 * subsequent runs no-op if already true).
 *
 * Row rules: NOT touched by this route. `users` is systemManaged in
 * EXPECTED_COLLECTIONS — Decision 71 USERS_AUTH_RULES pattern applies via
 * verify-row-rules tier; never auto-modified.
 */

import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";

const COLLECTION_NAME = "users";

// STAFFD-managed fields added to PB's native users collection over time.
// Patch-missing-fields pattern: existing PB-native fields preserved.
const STAFFD_FIELDS = [
  { name: "industry_packs",         type: "json", required: false },
  { name: "hidden_from_user_lists", type: "bool", required: false },
];

async function ensureFields(token: string): Promise<{ action: "noop" | "patched"; added?: string[] }> {
  const url = pbUrl();
  const colRes = await fetch(`${url}/api/collections/${COLLECTION_NAME}`, {
    headers: { Authorization: token },
  });
  if (!colRes.ok) {
    throw new Error(
      `users collection not found in PB — this is PB-native. Cannot create from this route. Detail: ${await colRes.text()}`,
    );
  }

  const col = (await colRes.json()) as { id: string; fields?: Array<{ name: string }> };
  const existing = new Set((col.fields ?? []).map((f) => f.name));
  const missing = STAFFD_FIELDS.filter((f) => !existing.has(f.name));
  if (missing.length === 0) return { action: "noop" };

  const allFields = [...(col.fields ?? []), ...missing];
  const patchRes = await fetch(`${url}/api/collections/${col.id}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify({ fields: allFields }),
  });
  if (!patchRes.ok) {
    throw new Error(`Failed to patch ${COLLECTION_NAME}: ${await patchRes.text()}`);
  }
  return { action: "patched", added: missing.map((f) => f.name) };
}

/**
 * Idempotent: PATCH super-admin's user record to set
 * `hidden_from_user_lists = true`. No-op if already true. Returns the
 * resulting state so the caller can verify.
 */
async function flagSuperAdminHidden(token: string): Promise<{
  status: "no_admin_email" | "no_admin_user" | "already_hidden" | "flagged";
  user_id?: string;
}> {
  const adminEmail = (process.env.ADMIN_EMAIL ?? process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!adminEmail) return { status: "no_admin_email" };

  const url = pbUrl();
  const filter = `email = '${pbEscape(adminEmail)}'`;
  const findRes = await fetch(
    `${url}/api/collections/${COLLECTION_NAME}/records?filter=${encodeURIComponent(filter)}&perPage=1&fields=id,email,hidden_from_user_lists`,
    { headers: { Authorization: token } },
  );
  if (!findRes.ok) return { status: "no_admin_user" };
  const data = (await findRes.json()) as {
    items?: Array<{ id?: string; hidden_from_user_lists?: boolean }>;
  };
  const admin = data.items?.[0];
  if (!admin?.id) return { status: "no_admin_user" };

  if (admin.hidden_from_user_lists === true) {
    return { status: "already_hidden", user_id: admin.id };
  }
  const patchRes = await fetch(`${url}/api/collections/${COLLECTION_NAME}/records/${admin.id}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify({ hidden_from_user_lists: true }),
  });
  if (!patchRes.ok) {
    throw new Error(`Failed to flag admin hidden: ${await patchRes.text()}`);
  }
  return { status: "flagged", user_id: admin.id };
}

export async function POST() {
  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  try {
    const token = await getAdminToken();
    const fieldsResult = await ensureFields(token);
    const flagResult = await flagSuperAdminHidden(token);
    return Response.json({
      ok: true,
      fields: fieldsResult,
      flag_super_admin: flagResult,
      note: "users collection is PB-native; row rules untouched (systemManaged via Decision 71 USERS_AUTH_RULES).",
    });
  } catch (err) {
    console.error("users setup error:", err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
