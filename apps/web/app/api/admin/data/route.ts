/**
 * Admin data API — IP-gated to ADMIN_IP env var (or localhost in dev).
 * Returns businesses + document usage stats for the admin dashboard.
 */

const ADMIN_IP = process.env.ADMIN_IP ?? ""; // set on Vercel: your public IP
const DEV_ALLOWED = process.env.NODE_ENV === "development";

function isAllowed(req: Request): boolean {
  if (DEV_ALLOWED) return true; // allow all in local dev
  if (!ADMIN_IP) return false;  // if no IP configured, block everything in prod

  const forwarded = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const clientIp = forwarded?.split(",")[0]?.trim() ?? realIp ?? "";

  return ADMIN_IP.split(",").map((s) => s.trim()).includes(clientIp);
}

export async function GET(req: Request) {
  if (!isAllowed(req)) {
    return new Response("Forbidden", { status: 403 });
  }

  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  const adminEmail = process.env.PB_ADMIN_EMAIL;
  const adminPassword = process.env.PB_ADMIN_PASSWORD;

  if (!pbUrl || !adminEmail || !adminPassword) {
    return Response.json({ error: "Admin credentials not configured" }, { status: 500 });
  }

  try {
    // Auth as PocketBase superuser
    const authRes = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
    });

    if (!authRes.ok) {
      return Response.json({ error: "PocketBase admin auth failed" }, { status: 500 });
    }

    const { token } = (await authRes.json()) as { token: string };
    const headers = { Authorization: token };

    // Fetch all businesses (with user expand)
    const bizRes = await fetch(
      `${pbUrl}/api/collections/businesses/records?perPage=500&expand=user&sort=-created`,
      { headers }
    );
    const bizData = (await bizRes.json()) as { items?: unknown[] };
    const businesses = (bizData.items ?? []) as Array<{
      id: string;
      user: string;
      business_name: string;
      industry: string;
      focus: string;
      situation: string;
      website: string;
      created: string;
      updated: string;
      expand?: { user?: { id: string; email: string; name: string } };
    }>;

    // Fetch document stats (aggregate by user)
    const docsRes = await fetch(
      `${pbUrl}/api/collections/documents/records?perPage=2000&sort=-created&fields=user,department,created`,
      { headers }
    );
    const docsData = (await docsRes.json()) as { items?: unknown[] };
    const docs = (docsData.items ?? []) as Array<{
      user: string;
      department: string;
      created: string;
    }>;

    // Build per-user stats
    const statsMap = new Map<string, { count: number; lastActive: string; departments: Set<string> }>();
    for (const doc of docs) {
      const entry = statsMap.get(doc.user) ?? { count: 0, lastActive: doc.created, departments: new Set() };
      entry.count++;
      if (doc.created > entry.lastActive) entry.lastActive = doc.created;
      entry.departments.add(doc.department);
      statsMap.set(doc.user, entry);
    }

    const docStats = Array.from(statsMap.entries()).map(([userId, s]) => ({
      userId,
      count: s.count,
      lastActive: s.lastActive,
      departments: Array.from(s.departments),
    }));

    // V4a — dead-letter visibility for the ingestion queue.
    let vaultQueue = { dead: 0, failed: 0, pending: 0 };
    try {
      const [deadRes, failedRes, pendingRes] = await Promise.all([
        fetch(`${pbUrl}/api/collections/vault_ingest_queue/records?filter=${encodeURIComponent("status='dead'")}&perPage=1&fields=id`, { headers }),
        fetch(`${pbUrl}/api/collections/vault_ingest_queue/records?filter=${encodeURIComponent("status='failed'")}&perPage=1&fields=id`, { headers }),
        fetch(`${pbUrl}/api/collections/vault_ingest_queue/records?filter=${encodeURIComponent("status='pending'")}&perPage=1&fields=id`, { headers }),
      ]);
      const dead = deadRes.ok ? ((await deadRes.json()) as { totalItems?: number }).totalItems ?? 0 : 0;
      const failed = failedRes.ok ? ((await failedRes.json()) as { totalItems?: number }).totalItems ?? 0 : 0;
      const pending = pendingRes.ok ? ((await pendingRes.json()) as { totalItems?: number }).totalItems ?? 0 : 0;
      vaultQueue = { dead, failed, pending };
    } catch {
      /* Collection may not exist yet pre-V4a setup — render zeros. */
    }

    return Response.json({
      businesses,
      docStats,
      totalDocs: docs.length,
      vaultQueue,
    });
  } catch (err) {
    console.error("Admin data error:", err);
    return Response.json({ error: "Failed to load admin data" }, { status: 500 });
  }
}
