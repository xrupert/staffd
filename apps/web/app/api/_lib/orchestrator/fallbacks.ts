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
  // PR-Tranche-2.6.2 — brand-voiced fallback copy. Earlier copy said
  // "the coordinator is unavailable" which (a) used out-of-brand vocabulary
  // and (b) misattributed failures: the trigger is often vault retrieve
  // (W26 production case), not the orchestrator LLM. New copy uses the
  // staff/duty vocabulary per ARCH BRAND_VOICE.md and is accurate
  // regardless of which subsystem degraded.
  return {
    department: dept,
    task,
    rationale: lastUsed
      ? `Working from limited context right now — sending this to your ${cap(dept)} desk where you were just working.`
      : `Working from limited context right now — your specialists are still on duty.`,
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
    // PR-Tranche-2.6.2 — brand-voiced + accurate-regardless-of-cause
    rationale: "Surfacing default cross-functional next steps — your staff has the work covered while the coordinator catches up.",
    followUps,
    notes: "degraded",
  };
}

function briefFallback(ctx: FallbackContext): OrchestratorDecision & { notes: string } {
  const samples = ctx.activitySamples ?? [];
  const lines = samples.length
    ? samples.map((s) => `- ${cap(s.department)}: ${s.count} doc${s.count === 1 ? "" : "s"}${s.samples[0] ? ` — "${s.samples[0]}"` : ""}`).join("\n")
    : "- Your staff hasn't produced any work in the last 30 days.";
  // PR-Tranche-2.6.2 — brand-voiced copy; drops the misleading
  // "coordinator unavailable" attribution (cause is often vault, not LLM).
  // PR-Tranche-2.6.3 (W27 follow-up) — discriminate "fresh slate"
  // (no activity to brief on yet — common for new users) from true
  // degradation (LLM failed when activity DID exist). Both reach here
  // via callLLM failure; the activitySamples emptiness is the signal.
  const isFreshSlate = samples.length === 0;
  const task = isFreshSlate
    ? `## Weekly Briefing\n\n**Working with a fresh slate** — your specialists build context from here. Your first task is the start. Once your staff produces work, your weekly brief lights up here with what's moving and what to focus on next.`
    : `## Weekly Briefing\n\n**Activity snapshot:**\n${lines}\n\n_Working from limited context right now — the full briefing returns on the next run._`;
  return {
    task,
    rationale: isFreshSlate
      ? "Welcoming new owner — your staff is ready; the weekly brief lights up as work moves through them."
      : "Activity snapshot — working from limited context; the full briefing returns on the next run.",
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
  // PR-Tranche-2.6.3 (W27 follow-up) — same discriminator as briefFallback.
  // No cross-department work yet → fresh-slate welcoming copy. Work exists
  // but LLM failed → degradation copy.
  const isFreshSlate = lines.length === 0;
  const task = isFreshSlate
    ? "Working with a fresh slate — your CEO Strategist is ready. Run a few specialists across your unlocked departments and ask me again. I'll synthesize across the work."
    : `Cross-department snapshot:\n\n${lines.join("\n")}`;
  return {
    task,
    rationale: isFreshSlate
      ? "Welcoming new owner — no cross-department work to synthesize yet; the CEO synthesis lights up once your staff has produced some output."
      // PR-Tranche-2.6.2 — brand-voiced; accurate regardless of which
      // subsystem (LLM or vault) degraded.
      : "Cross-department snapshot — working from limited context; concatenating the most recent items from each desk.",
    notes: "degraded",
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
