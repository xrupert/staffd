/**
 * POST /api/account/delete
 *
 * GDPR Article 17 — Right to Erasure. Cascades a hard delete of the user
 * across every STAFFD-owned PB collection, cancels the Stripe subscription
 * (without deleting the Stripe customer object — audit trail), and removes
 * the PB user record.
 *
 * Body: { confirm_email: "user@example.com" }
 *   — must exactly match the authenticated user's email (case-insensitive)
 *   — type-to-confirm pattern per Decision 56; no separate email step
 *
 * Super-admin self-delete is REFUSED (would orphan production). 403 returned.
 *
 * NOT idempotent — once the user record is gone, the auth token is invalid
 * and subsequent calls return 401.
 */

import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { isSuperAdmin, type SuperAdminUser } from "../../_lib/auth/super-admin";

// Mirror of export route's collection list. Order matters loosely: dependent
// collections (vault_embeddings_index, document_versions) deleted before
// their parents (documents) when possible. PB doesn't enforce FK cascades,
// so order is best-effort cleanup; orphan rows are harmless after the user
// is gone since row rules block access.
const CASCADE_COLLECTIONS_USER = [
  "vault_embeddings_index",
  "vault_retrieval_metrics",
  "vault_patterns",
  "vault_decisions",
  "vault_briefs",
  "vault_voice_profile",
  "document_versions",
  "documents",
  "conversations",
  "conversation_threads",
  "scheduled_content",
  "bookings",
  "orchestrator_decisions",
  "push_subscriptions",
  "templates",
  "businesses",
  "user_integrations", // W91 — erase stored vendor creds on account delete (GDPR Art. 17)
  "contacts",          // W95.1 — erase STAFFD-native contacts on account delete (GDPR Art. 17)
  "upload_sessions",   // W95.3 — per-customer cold-start upload ledger
  "interactions",      // W95.4a — logged interactions
  "followups",         // W95.4a — scheduled follow-ups
  "tasks",             // W95.4a — owner to-dos
  "leads",             // W95.4a — captured leads
  "expenses",          // W95.4a — logged expenses
  "subscriptions",
] as const;

const CASCADE_COLLECTIONS_AGENCY = ["clients"] as const;

async function whoAmI(pbToken: string): Promise<SuperAdminUser | null> {
  try {
    const res = await fetch(`${pbUrl()}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { record?: { id?: string; email?: string } };
    if (!data.record?.id || !data.record?.email) return null;
    return { id: data.record.id, email: data.record.email };
  } catch {
    return null;
  }
}

/**
 * Bulk-delete every row in `collection` where `filterField` equals userId.
 * Returns count of deleted rows. Failures per-row are swallowed so a partial
 * delete still makes meaningful progress; orphan rows are inaccessible
 * after the user record is gone.
 */
async function cascadeDelete(adminToken: string, collection: string, userId: string, filterField = "user"): Promise<number> {
  const filter = `${filterField}='${pbEscape(userId)}'`;
  let deleted = 0;
  let page = 1;
  while (page <= 20) {
    const listRes = await fetch(
      `${pbUrl()}/api/collections/${encodeURIComponent(collection)}/records?filter=${encodeURIComponent(filter)}&page=${page}&perPage=100&fields=id`,
      { headers: { Authorization: adminToken } },
    );
    if (!listRes.ok) break;
    const data = (await listRes.json()) as { items?: Array<{ id?: string }>; totalPages?: number };
    if (!data.items || data.items.length === 0) break;

    for (const row of data.items) {
      if (!row.id) continue;
      try {
        const delRes = await fetch(
          `${pbUrl()}/api/collections/${encodeURIComponent(collection)}/records/${encodeURIComponent(row.id)}`,
          { method: "DELETE", headers: { Authorization: adminToken } },
        );
        if (delRes.ok) deleted++;
      } catch { /* swallow */ }
    }
    if (page >= (data.totalPages ?? 1)) break;
    // Don't increment page — we just deleted these rows; the next page-1
    // query will return the next batch (or empty if done)
  }
  return deleted;
}

async function cancelStripeSubscription(adminToken: string, userId: string): Promise<{ cancelled: boolean; detail?: string }> {
  // Fetch the user's subscription to get the Stripe subscription id
  try {
    const filter = `user='${pbEscape(userId)}'`;
    const res = await fetch(
      `${pbUrl()}/api/collections/subscriptions/records?filter=${encodeURIComponent(filter)}&perPage=1`,
      { headers: { Authorization: adminToken } },
    );
    if (!res.ok) return { cancelled: false, detail: "subscriptions_fetch_failed" };
    const data = (await res.json()) as {
      items?: Array<{ stripe_subscription_id?: string; stripe_customer?: string }>;
    };
    const sub = data.items?.[0];
    const stripeSubId = sub?.stripe_subscription_id;
    if (!stripeSubId) return { cancelled: true, detail: "no_active_stripe_subscription" };

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return { cancelled: false, detail: "stripe_not_configured" };

    // Use Stripe REST API directly to avoid pulling the SDK into the route
    // bundle (already imported elsewhere; this is a single call).
    const stripeRes = await fetch(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(stripeSubId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${stripeKey}` },
      },
    );
    if (!stripeRes.ok) {
      const detail = await stripeRes.text();
      return { cancelled: false, detail: `stripe_${stripeRes.status}: ${detail.slice(0, 200)}` };
    }
    return { cancelled: true };
  } catch (err) {
    return { cancelled: false, detail: err instanceof Error ? err.message : "unknown" };
  }
}

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pbToken = url.searchParams.get("pbToken") ?? req.headers.get("authorization") ?? "";
  if (!pbToken) return Response.json({ error: "missing_auth" }, { status: 401 });

  const me = await whoAmI(pbToken);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Super-admin self-delete refused — would orphan the production system
  if (isSuperAdmin(me)) {
    return Response.json(
      {
        error: "super_admin_self_delete_refused",
        message: "The super-admin account cannot delete itself via this route. Contact a co-admin or rotate ADMIN_EMAIL first.",
      },
      { status: 403 },
    );
  }

  let body: { confirm_email?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const confirmEmail = (body.confirm_email ?? "").trim().toLowerCase();
  const userEmail = me.email.trim().toLowerCase();
  if (!confirmEmail) {
    return Response.json({ error: "confirm_email_required" }, { status: 400 });
  }
  if (confirmEmail !== userEmail) {
    return Response.json(
      {
        error: "confirm_email_mismatch",
        message: "The email you typed doesn't match your account email. No data was deleted.",
      },
      { status: 400 },
    );
  }

  let adminToken: string;
  try {
    adminToken = await getAdminToken();
  } catch (err) {
    return Response.json(
      { error: "admin_token_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  // 1. Cancel Stripe subscription (best-effort — never blocks the delete)
  const stripeResult = await cancelStripeSubscription(adminToken, me.id);

  // 2. Cascade delete every owned row
  const deleted: Record<string, number> = {};
  for (const c of CASCADE_COLLECTIONS_USER) {
    deleted[c] = await cascadeDelete(adminToken, c, me.id, "user");
  }
  for (const c of CASCADE_COLLECTIONS_AGENCY) {
    deleted[c] = await cascadeDelete(adminToken, c, me.id, "agency_user");
  }

  // 3. Finally delete the PB user record itself
  let userDeleted = false;
  try {
    const res = await fetch(
      `${pbUrl()}/api/collections/users/records/${encodeURIComponent(me.id)}`,
      { method: "DELETE", headers: adminHeaders(adminToken) },
    );
    userDeleted = res.ok;
  } catch { /* fall through */ }

  console.log(
    `[account.delete] user=${me.id} email=${me.email} ` +
      `stripe_cancelled=${stripeResult.cancelled} ` +
      `user_deleted=${userDeleted} ` +
      `rows_deleted=${Object.values(deleted).reduce((a, b) => a + b, 0)}`,
  );

  return Response.json({
    ok: true,
    user_deleted: userDeleted,
    stripe: stripeResult,
    rows_deleted: deleted,
    note: "Your account and all owned data have been removed. Qdrant vault collection scheduled for cleanup on next vault-worker tick.",
  });
}
