/**
 * GET /api/autopilot/prefs (W95.5) — the Settings "Automation" list: every
 * autopilot-eligible intent (policy != never) with its current state. Merges
 * the static policy with the user's autopilot_prefs rows. USER-scoped.
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { getAutopilotPrefs } from "../../_lib/autopilot/policy";
import { INTENT_FIELDS, autopilotThreshold, type IntentType } from "../../_lib/orchestrator/intent-policy";

const LABELS: Record<string, string> = {
  create_contact: "Add contacts", capture_lead: "Capture leads", update_contact: "Update contacts",
  add_to_email_list: "Add to email list", log_expense: "Log expenses",
  log_interaction: "Log interactions", schedule_followup: "Schedule follow-ups", create_task: "Create tasks",
};

export async function GET(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  const eligible = (Object.keys(INTENT_FIELDS) as IntentType[]).filter((t) => INTENT_FIELDS[t].autopilotPolicy !== "never");
  const items = await Promise.all(eligible.map(async (t) => {
    const p = await getAutopilotPrefs(me.id, t);
    return {
      intent_type: t, label: LABELS[t] ?? t, policy: INTENT_FIELDS[t].autopilotPolicy,
      threshold: autopilotThreshold(t), streak: p.confirm_streak, enabled: p.enabled, enabled_at: p.enabled_at,
    };
  }));
  return Response.json({ items });
}
