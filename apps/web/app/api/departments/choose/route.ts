/**
 * POST /api/departments/choose
 * Body: { userId, departments: string[] }
 *
 * Saves the user's chosen department(s) to their subscription record.
 * Validates against plan limits:
 *   growth  → 1 choice
 *   pro     → 3 choices (CEO is auto-included separately)
 *   agency  → no choice needed (all unlocked)
 */

const STARTER_DEPARTMENTS = new Set(["marketing", "sales", "legal"]);

// Max extra departments a plan can unlock (beyond starter + auto-includes)
const PLAN_CHOICE_LIMIT: Record<string, number> = {
  starter: 0,
  growth: 1,
  pro: 3,
  agency: 999, // all
};

// Departments available to choose (not auto-included on any plan).
// CEO is intentionally excluded — Pro/Agency get it auto-included, others can't pick it.
const CHOOSABLE = new Set(["hr", "finance", "operations", "paid-media", "design", "reputation"]);

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

export async function POST(req: Request) {
  const { userId, departments } = (await req.json()) as {
    userId: string;
    departments: string[];
  };

  if (!userId || !Array.isArray(departments)) {
    return Response.json({ error: "userId and departments required" }, { status: 400 });
  }

  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const token = await getAdminToken(pbUrl);
    const headers = { Authorization: token, "Content-Type": "application/json" };

    // Get current subscription
    const res = await fetch(
      `${pbUrl}/api/collections/subscriptions/records?filter=(user='${userId}')&perPage=1`,
      { headers: { Authorization: token } }
    );
    const data = (await res.json()) as { items?: Array<{ id: string; plan: string }> };
    const sub = data.items?.[0];

    if (!sub) {
      return Response.json({ error: "No subscription found" }, { status: 404 });
    }

    const plan = sub.plan ?? "starter";
    const limit = PLAN_CHOICE_LIMIT[plan] ?? 0;

    // Strip any starter/invalid departments from choices
    const valid = departments.filter(
      (d) => CHOOSABLE.has(d) && !STARTER_DEPARTMENTS.has(d)
    );

    if (valid.length > limit) {
      return Response.json(
        { error: `${plan} plan allows ${limit} department choice(s)` },
        { status: 400 }
      );
    }

    await fetch(`${pbUrl}/api/collections/subscriptions/records/${sub.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ unlocked_departments: valid }),
    });

    return Response.json({ ok: true, unlocked_departments: valid });
  } catch (err) {
    console.error("Department choose error:", err);
    return Response.json({ error: "Failed to save departments" }, { status: 500 });
  }
}
