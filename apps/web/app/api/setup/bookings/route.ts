/**
 * One-time setup for the in-house scheduler.
 *
 * Creates the `bookings` PocketBase collection and patches the `businesses`
 * collection with availability fields (booking_slug, timezone, availability,
 * default duration, buffer, enabled flag).
 *
 * Idempotent — safe to call any time. Called automatically from the
 * settings page when a user opens scheduling for the first time.
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

  // ─── 1. bookings collection ────────────────────────────────────────────────
  try {
    const checkRes = await fetch(`${pbUrl}/api/collections/bookings`, { headers: { Authorization: token } });
    if (checkRes.ok) {
      results.bookings = "exists";
    } else {
      const createRes = await fetch(`${pbUrl}/api/collections`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "bookings",
          type: "base",
          fields: [
            { name: "user",           type: "text", required: true },     // host user id
            { name: "attendee_name",  type: "text", required: true },
            { name: "attendee_email", type: "email", required: true },
            { name: "attendee_phone", type: "text", required: false },
            { name: "start_time",     type: "text", required: true },     // ISO 8601 UTC
            { name: "duration",       type: "number", required: true },   // minutes
            { name: "timezone",       type: "text", required: false },    // IANA tz of attendee
            { name: "notes",          type: "text", required: false },
            { name: "status",         type: "text", required: false },    // confirmed|cancelled
            { name: "source",         type: "text", required: false },    // public|sales|other
          ],
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.text();
        results.bookings = { error: "create failed", detail: err };
      } else {
        results.bookings = "created";
      }
    }
  } catch (err) {
    results.bookings = { error: String(err) };
  }

  // ─── 2. businesses collection: add scheduling fields ──────────────────────
  try {
    const bizRes = await fetch(`${pbUrl}/api/collections/businesses`, { headers: { Authorization: token } });
    if (!bizRes.ok) {
      results.businesses = "missing businesses collection (run /api/setup/businesses first)";
    } else {
      const col = (await bizRes.json()) as { fields?: Array<{ name: string }> };
      const existingNames = new Set((col.fields ?? []).map((f) => f.name));

      const desired = [
        { name: "booking_slug",             type: "text",   required: false },
        { name: "booking_timezone",         type: "text",   required: false },
        { name: "booking_availability",     type: "json",   required: false }, // { mon: [["09:00","17:00"]], ... }
        { name: "booking_default_duration", type: "number", required: false }, // minutes
        { name: "booking_buffer",           type: "number", required: false }, // minutes between calls
        { name: "booking_enabled",          type: "bool",   required: false },
      ];
      const missing = desired.filter((f) => !existingNames.has(f.name));

      if (missing.length === 0) {
        results.businesses = "up to date";
      } else {
        const existing = col as Record<string, unknown>;
        const fields = (existing.fields as unknown[]) ?? [];
        const patchRes = await fetch(`${pbUrl}/api/collections/businesses`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ fields: [...fields, ...missing] }),
        });
        if (!patchRes.ok) {
          const err = await patchRes.text();
          results.businesses = { error: "patch failed", detail: err };
        } else {
          results.businesses = { patched: missing.map((f) => f.name) };
        }
      }
    }
  } catch (err) {
    results.businesses = { error: String(err) };
  }

  // Decision 69 — enforce row rules on every collection this setup touches.
  results.rules_bookings = (await ensureCollectionRulesWithFreshToken("bookings")).status;
  results.rules_businesses = (await ensureCollectionRulesWithFreshToken("businesses")).status;

  return Response.json({ ok: true, results });
}

// Allow GET for browser-triggered setup
export async function GET() { return POST(); }
