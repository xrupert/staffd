/**
 * Trial usage HTTP endpoint — thin delegation layer over `_lib/trial`.
 *
 * Client-side callers (onboarding, dashboard gating UI) still hit this URL.
 * Server-side callers (Command Center, agent route) now import the lib
 * directly to skip the self-HTTP hop.
 */

import { resolveDepartments, recordTrialRun } from "../_lib/trial";
import { getAdminToken, pbEscape, pbFirst } from "../_lib/pb";
import { bridgingIndustryFor } from "../_lib/industry";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  try {
    // W58.2 (D-19 bridging) — read the business industry so activePacks
    // reflects bridged state. Same admin-read pattern as /api/packs.
    let vaultIndustry: string | undefined;
    try {
      const token = await getAdminToken();
      const biz = await pbFirst<{ id?: string; industry?: string; industry_category?: string }>(
        "businesses",
        `(user='${pbEscape(userId)}')`,
        token
      );
      vaultIndustry = bridgingIndustryFor(biz);
    } catch {
      /* no industry — bridging silently skipped */
    }
    const state = await resolveDepartments(userId, { vaultIndustry });
    return Response.json({
      plan: state.plan,
      trial_runs: state.trialRuns,
      sub_id: state.subId,
      unlocked_departments: state.unlockedDepartments,
      needs_department_selection: state.needsDepartmentSelection,
      resolved_departments: state.resolved,
      // W58.2 — bridged pack state surfaces here (additive; consumers
      // parse named fields and tolerate extras).
      active_packs: state.activePacks,
      comp: state.comp || undefined,
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

  const result = await recordTrialRun(userId, department);

  if (!result.allowed) {
    return Response.json(
      {
        allowed: false,
        reason: result.reason,
        plan: result.plan,
        trial_runs: result.trialRuns,
        remaining: 0,
      },
      { status: 402 }
    );
  }

  return Response.json({
    allowed: true,
    plan: result.plan,
    trial_runs: result.trialRuns,
    remaining: result.remaining,
  });
}
