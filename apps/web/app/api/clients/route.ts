/**
 * GET  /api/clients?userId=xxx          List clients for an agency user
 * POST /api/clients                     Create a new client
 *
 * Restricted to Agency plan users. Returns 403 otherwise.
 */

import { isCompedUser } from "../_lib/comp";
import { pbEscape } from "../_lib/pb";
import { whoAmI } from "../_lib/integrations/identity";

async function getAdminToken(pbUrl: string): Promise<string> {
  const res = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identity: process.env.PB_ADMIN_EMAIL ?? "",
      password: process.env.PB_ADMIN_PASSWORD ?? "",
    }),
  });
  if (!res.ok) throw new Error("Admin auth failed");
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function isAgencyUser(pbUrl: string, token: string, userId: string): Promise<boolean> {
  // Comped accounts (e.g. @jrw-solutions.com) get Agency access automatically
  if (await isCompedUser(pbUrl, token, userId)) return true;

  // Otherwise check the subscription record for an active Agency plan
  const res = await fetch(
    `${pbUrl}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
    { headers: { Authorization: token } }
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { items?: Array<{ plan?: string }> };
  return data.items?.[0]?.plan === "agency";
}

export async function GET(req: Request) {
  // h6d — derive the agency user from the authenticated session; never trust a
  // query `userId` (admin token below bypasses row rules → would be an IDOR).
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = me.id;

  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const token = await getAdminToken(pbUrl);
    if (!(await isAgencyUser(pbUrl, token, userId))) {
      return Response.json({ error: "Agency plan required" }, { status: 403 });
    }

    const res = await fetch(
      `${pbUrl}/api/collections/clients/records?filter=(agency_user='${pbEscape(userId)}')&sort=name&perPage=200`,
      { headers: { Authorization: token } }
    );
    const data = (await res.json()) as { items?: unknown[] };
    return Response.json({ clients: data.items ?? [] });
  } catch (err) {
    console.error("Clients GET error:", err);
    return Response.json({ error: "Failed to load clients" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // h6d — the owning agency user is the authenticated caller, not a body field.
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = me.id;

  const body = (await req.json()) as {
    name: string;
    industry?: string;
    description?: string;
    target_audience?: string;
    website?: string;
    phone?: string;
    primary_email?: string;
    address?: string;
    focus?: string;
    situation?: string;
    superpower?: string;
    magic_wand?: string;
  };

  if (!body.name?.trim()) {
    return Response.json({ error: "name required" }, { status: 400 });
  }

  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const token = await getAdminToken(pbUrl);
    if (!(await isAgencyUser(pbUrl, token, userId))) {
      return Response.json({ error: "Agency plan required" }, { status: 403 });
    }

    const createRes = await fetch(`${pbUrl}/api/collections/clients/records`, {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({
        agency_user:     userId,
        name:            body.name.trim(),
        industry:        body.industry?.trim() ?? "",
        description:     body.description?.trim() ?? "",
        target_audience: body.target_audience?.trim() ?? "",
        website:         body.website?.trim() ?? "",
        phone:           body.phone?.trim() ?? "",
        primary_email:   body.primary_email?.trim() ?? "",
        address:         body.address?.trim() ?? "",
        focus:           body.focus ?? "",
        situation:       body.situation ?? "",
        superpower:      body.superpower ?? "",
        magic_wand:      body.magic_wand?.trim() ?? "",
        status:          "active",
      }),
    });

    if (!createRes.ok) {
      const detail = await createRes.text();
      return Response.json({ error: "Failed to create client", detail }, { status: 500 });
    }

    const client = await createRes.json();
    return Response.json({ ok: true, client });
  } catch (err) {
    console.error("Clients POST error:", err);
    return Response.json({ error: "Failed to create client" }, { status: 500 });
  }
}
