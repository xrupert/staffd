/**
 * Trial usage API.
 *
 * GET  /api/trial?userId=xxx  → returns the user's subscription record (plan + trial_runs)
 * POST /api/trial             → records a trial run for a department
 *
 * Starter pack departments — always allowed regardless of plan:
 * content-creator, seo-specialist, social-media-strategist,
 * outreach, document-generator, document-drafter
 *
 * Locked departments get 3 trial runs. After that, an upgrade is required.
 */

const TRIAL_LIMIT = 3;

// Departments unlocked on every plan (the 6 starter-pack agents live here)
const STARTER_DEPARTMENTS = new Set(["marketing", "sales", "legal"]);

// Plan → which full departments are unlocked
const PLAN_DEPARTMENTS: Record<string, Set<string>> = {
  starter: STARTER_DEPARTMENTS,
  growth: new Set([...STARTER_DEPARTMENTS, "hr"]),                          // +1 dept
  pro: new Set([...STARTER_DEPARTMENTS, "hr", "finance", "operations", "ceo"]), // +3 depts + CEO
  agency: new Set(["marketing", "sales", "legal", "hr", "finance", "operations", "ceo", "paid-media", "design"]), // all
};

async function getAdminToken(pbUrl: string): Promise<string> {
  const adminEmail = process.env.PB_ADMIN_EMAIL ?? "";
  const adminPassword = process.env.PB_ADMIN_PASSWORD ?? "";
  const res = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
  });
  if (!res.ok) throw new Error("Admin auth failed");
  const { token } = (await res.json()) as { token: string };
  return token;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const token = await getAdminToken(pbUrl);
    const res = await fetch(
      `${pbUrl}/api/collections/subscriptions/records?filter=(user='${userId}')&perPage=1`,
      { headers: { Authorization: token } }
    );
    const data = (await res.json()) as { items?: unknown[] };
    const sub = (data.items?.[0] ?? null) as {
      id: string;
      plan: string;
      trial_runs: Record<string, number> | null;
    } | null;

    return Response.json({
      plan: sub?.plan ?? "starter",
      trial_runs: sub?.trial_runs ?? {},
      sub_id: sub?.id ?? null,
    });
  } catch (err) {
    console.error("Trial GET error:", err);
    return Response.json({ plan: "starter", trial_runs: {}, sub_id: null });
  }
}

export async function POST(req: Request) {
  const { userId, department } = (await req.json()) as {
    userId: string;
    department: string;
  };

  if (!userId || !department) {
    return Response.json({ error: "userId and department required" }, { status: 400 });
  }

  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const token = await getAdminToken(pbUrl);
    const headers = { Authorization: token, "Content-Type": "application/json" };

    // Fetch existing record
    const res = await fetch(
      `${pbUrl}/api/collections/subscriptions/records?filter=(user='${userId}')&perPage=1`,
      { headers: { Authorization: token } }
    );
    const data = (await res.json()) as { items?: unknown[] };
    const sub = (data.items?.[0] ?? null) as {
      id: string;
      plan: string;
      trial_runs: Record<string, number> | null;
    } | null;

    const plan = sub?.plan ?? "starter";
    const planDepts = PLAN_DEPARTMENTS[plan] ?? STARTER_DEPARTMENTS;

    // If department is already fully unlocked on their plan, no trial tracking needed
    if (planDepts.has(department)) {
      return Response.json({ allowed: true, plan, trial_runs: sub?.trial_runs ?? {} });
    }

    // Update trial run count
    const trialRuns = { ...(sub?.trial_runs ?? {}) };
    const current = trialRuns[department] ?? 0;

    // Check limit BEFORE incrementing
    if (current >= TRIAL_LIMIT) {
      return Response.json({
        allowed: false,
        reason: "trial_exhausted",
        plan,
        trial_runs: trialRuns,
        remaining: 0,
      }, { status: 402 });
    }

    trialRuns[department] = current + 1;
    const remaining = TRIAL_LIMIT - trialRuns[department];

    // Upsert subscription record
    if (sub?.id) {
      await fetch(`${pbUrl}/api/collections/subscriptions/records/${sub.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ trial_runs: trialRuns }),
      });
    } else {
      await fetch(`${pbUrl}/api/collections/subscriptions/records`, {
        method: "POST",
        headers,
        body: JSON.stringify({ user: userId, plan: "starter", trial_runs: trialRuns }),
      });
    }

    return Response.json({ allowed: true, plan, trial_runs: trialRuns, remaining });
  } catch (err) {
    console.error("Trial POST error:", err);
    // Fail open — don't block users if trial tracking fails
    return Response.json({ allowed: true, plan: "starter", trial_runs: {} });
  }
}
