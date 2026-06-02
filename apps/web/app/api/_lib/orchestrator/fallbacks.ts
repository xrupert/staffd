/**
 * Deterministic degraded outputs — what the orchestrator returns when the
 * LLM wrapper trips `deadline_exceeded`, `llm_budget_exceeded`, or
 * `upstream_error`. Spec §B1: "never a 500."
 *
 * The shape of each fallback matches what a successful run would have
 * produced so consumers don't need a separate code path — they just read
 * `degraded` instead of `decision`.
 */

import type { FollowUp, OrchestratorDecision, OrchestratorIntent } from "./types";

const DEFAULT_DEPT = "marketing";

export type FallbackContext = {
  message?: string;          // route: the user's message
  lastUsedDept?: string;     // route: dept the user used most recently
  unlockedDepts?: string[];  // route/handoff: which depts the user can access
  sourceDoc?: { department?: string; prompt?: string; outputExcerpt?: string }; // handoff
  activitySamples?: Array<{ department: string; count: number; samples: string[] }>; // brief/synthesize
};

/** Deterministic, no-LLM picks for each intent. */
export function degradedFor(
  intent: OrchestratorIntent,
  ctx: FallbackContext
): OrchestratorDecision & { followUps?: FollowUp[]; notes?: string } {
  switch (intent) {
    case "route":
      return routeFallback(ctx);
    case "handoff":
      return handoffFallback(ctx);
    case "brief":
      return briefFallback(ctx);
    case "synthesize":
      return synthesizeFallback(ctx);
  }
}

function routeFallback(ctx: FallbackContext): OrchestratorDecision {
  const unlocked = ctx.unlockedDepts ?? ["marketing", "sales", "legal"];
  const lastUsed = ctx.lastUsedDept && unlocked.includes(ctx.lastUsedDept)
    ? ctx.lastUsedDept
    : null;
  const dept = lastUsed ?? (unlocked.includes(DEFAULT_DEPT) ? DEFAULT_DEPT : unlocked[0] ?? DEFAULT_DEPT);
  const task = (ctx.message ?? "").trim() || "Continue the conversation.";
  return {
    department: dept,
    task,
    rationale: lastUsed
      ? `Routing to your most recently used department while the coordinator is unavailable.`
      : `Routing to a sensible default while the coordinator is unavailable.`,
  };
}

function handoffFallback(ctx: FallbackContext): OrchestratorDecision & { followUps: FollowUp[]; notes: string } {
  const src = ctx.sourceDoc?.department;
  const map: Record<string, FollowUp[]> = {
    marketing: [
      { department: "sales",   task: "Use this to draft a sales follow-up.",      rationale: "Marketing output is often the first half of a sales sequence." },
      { department: "design",  task: "Generate a visual to pair with this copy.", rationale: "Strong copy lands harder with a strong visual." },
    ],
    sales: [
      { department: "legal",   task: "Draft an NDA / agreement for this lead.",   rationale: "Closed-won leads need paperwork." },
      { department: "marketing", task: "Spin a case study from this win.",        rationale: "Sales wins are the best raw material for marketing." },
    ],
    design: [
      { department: "marketing", task: "Write the caption / copy for this asset.", rationale: "Visuals need words to publish." },
    ],
    legal: [
      { department: "operations", task: "Add a workflow step to capture this signed doc.", rationale: "Signed docs benefit from a process record." },
    ],
  };
  const followUps: FollowUp[] = src ? (map[src] ?? []) : [];
  return {
    rationale: "Degraded handoff suggestions — the coordinator is unavailable; surfacing default cross-functional next steps.",
    followUps,
    notes: "degraded",
  };
}

function briefFallback(ctx: FallbackContext): OrchestratorDecision & { notes: string } {
  const samples = ctx.activitySamples ?? [];
  const lines = samples.length
    ? samples.map((s) => `- ${cap(s.department)}: ${s.count} doc${s.count === 1 ? "" : "s"}${s.samples[0] ? ` — "${s.samples[0]}"` : ""}`).join("\n")
    : "- Your staff hasn't produced any work in the last 30 days.";
  const task = `## Weekly Briefing (degraded — coordinator unavailable)\n\n**Activity snapshot:**\n${lines}\n\n_The full briefing will resume on the next run._`;
  return {
    task,
    rationale: "Extractive briefing — the coordinator is unavailable; returning a deterministic snapshot.",
    notes: "degraded",
  };
}

function synthesizeFallback(ctx: FallbackContext): OrchestratorDecision & { notes: string } {
  const samples = ctx.activitySamples ?? [];
  const lines = samples
    .flatMap((s) =>
      s.samples.slice(0, 1).map((q) => `• [${cap(s.department)}] ${q}`)
    )
    .slice(0, 3);
  const task = lines.length
    ? `Cross-department snapshot:\n\n${lines.join("\n")}`
    : "No recent cross-department work to synthesize.";
  return {
    task,
    rationale: "Extractive synthesis — the coordinator is unavailable; concatenating the most recent items from each department.",
    notes: "degraded",
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
