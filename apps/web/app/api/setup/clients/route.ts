/**
 * One-time setup for the Agency multi-client feature.
 *
 * Creates the `clients` collection — each row is a client managed by an
 * agency user. Stores its own vault data so the staff can produce
 * client-specific work.
 *
 * Also patches `documents` and `bookings` collections to add a `client` field
 * so agency work is segmented by client.
 *
 * Idempotent — safe to call multiple times.
 */

import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

async function getAdminToken(pbUrl: string, email: string, password: string): Promise<string | null> {
  const res = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!res.ok) return null;
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function patchAddFields(
  pbUrl: string,
  token: string,
  collectionName: string,
  fieldsToAdd: Array<{ name: string; type: string; required: boolean }>
): Promise<string> {
  const checkRes = await fetch(`${pbUrl}/api/collections/${collectionName}`, {
    headers: { Authorization: token },
  });
  if (!checkRes.ok) return "missing";

  const col = (await checkRes.json()) as { fields?: Array<{ name: string }> };
  const existing = new Set((col.fields ?? []).map((f) => f.name));
  const missing = fieldsToAdd.filter((f) => !existing.has(f.name));
  if (missing.length === 0) return "up to date";

  const existingRaw = col as Record<string, unknown>;
  const fields = (existingRaw.fields as unknown[]) ?? [];
  const patchRes = await fetch(`${pbUrl}/api/collections/${collectionName}`, {
    method: "PATCH",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: [...fields, ...missing] }),
  });
  if (!patchRes.ok) return `patch failed: ${await patchRes.text()}`;
  return `patched: ${missing.map((f) => f.name).join(", ")}`;
}

export async function POST() {
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  const adminEmail = process.env.PB_ADMIN_EMAIL;
  const adminPassword = process.env.PB_ADMIN_PASSWORD;

  if (!pbUrl || !adminEmail || !adminPassword) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  const token = await getAdminToken(pbUrl, adminEmail, adminPassword);
  if (!token) return Response.json({ error: "Admin auth failed" }, { status: 500 });
  const headers = { Authorization: token, "Content-Type": "application/json" };

  const results: Record<string, unknown> = {};

  // ─── 1. clients collection ────────────────────────────────────────────────
  try {
    const checkRes = await fetch(`${pbUrl}/api/collections/clients`, { headers: { Authorization: token } });
    if (checkRes.ok) {
      results.clients = "exists";
    } else {
      const createRes = await fetch(`${pbUrl}/api/collections`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "clients",
          type: "base",
          fields: [
            { name: "agency_user",      type: "text", required: true },  // owning agency user id
            { name: "name",             type: "text", required: true },  // display name
            { name: "industry",         type: "text", required: false },
            { name: "description",      type: "text", required: false },
            { name: "target_audience",  type: "text", required: false },
            { name: "website",          type: "text", required: false },
            { name: "phone",            type: "text", required: false },
            { name: "primary_email",    type: "text", required: false },
            { name: "address",          type: "text", required: false },
            { name: "focus",            type: "text", required: false },
            { name: "situation",        type: "text", required: false },
            { name: "superpower",       type: "text", required: false },
            { name: "magic_wand",       type: "text", required: false },
            { name: "logo_url",         type: "text", required: false },
            { name: "status",           type: "text", required: false }, // active | archived
            { name: "notes",            type: "text", required: false },
          ],
        }),
      });
      if (!createRes.ok) {
        results.clients = { error: "create failed", detail: await createRes.text() };
      } else {
        results.clients = "created";
      }
    }
  } catch (err) {
    results.clients = { error: String(err) };
  }

  // ─── 2. documents: add optional client field ──────────────────────────────
  results.documents = await patchAddFields(pbUrl, token, "documents", [
    { name: "client", type: "text", required: false },
  ]);

  // ─── 3. bookings: add optional client field ───────────────────────────────
  results.bookings = await patchAddFields(pbUrl, token, "bookings", [
    { name: "client", type: "text", required: false },
  ]);

  // ─── 4. scheduled_content: add optional client field ──────────────────────
  results.scheduled_content = await patchAddFields(pbUrl, token, "scheduled_content", [
    { name: "client", type: "text", required: false },
  ]);

  // Decision 69 — enforce row rules on every collection this setup touches.
  results.rules_clients = (await ensureCollectionRulesWithFreshToken("clients")).status;
  results.rules_documents = (await ensureCollectionRulesWithFreshToken("documents")).status;
  results.rules_bookings = (await ensureCollectionRulesWithFreshToken("bookings")).status;
  results.rules_scheduled_content = (await ensureCollectionRulesWithFreshToken("scheduled_content")).status;

  return Response.json({ ok: true, results });
}

export async function GET() { return POST(); }
