/**
 * Wire-the-loop — follow-on thinking after a workflow completes.
 *
 * When a planner-created workflow (one with a stored `goal`) finishes, the
 * system proposes up to 3 high-value follow-on actions ("email campaign done →
 * A/B variant, load contacts into the CRM, post about it on social"). Each
 * suggestion is a { title, goal } pair the UI can feed straight back into
 * POST /api/workflow/plan — the loop closes through the SAME propose-then-
 * ratify gate; nothing auto-executes.
 *
 * Fail-open by design: suggestions are a courtesy. Any LLM/parse failure
 * returns [] and the workflow completes exactly as before.
 */

// Type-only — the runtime import is lazy (Standard #26): llm.ts constructs
// the Anthropic SDK client at module load, and this module is imported by
// the workflow-drain worker whose module graph must stay SDK-free.
import type { callLLM as CallLLM } from "./llm";

export type FollowOnSuggestion = { title: string; goal: string };

const MAX_SUGGESTIONS = 3;
const MAX_TITLE_CHARS = 80;
const MAX_GOAL_CHARS = 300;

/** Validate untrusted parsed JSON into a bounded suggestion list. */
export function parseFollowOns(raw: unknown): FollowOnSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: FollowOnSuggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const title = String(rec.title ?? "").trim();
    const goal = String(rec.goal ?? "").trim();
    if (!title || !goal) continue;
    out.push({ title: title.slice(0, MAX_TITLE_CHARS), goal: goal.slice(0, MAX_GOAL_CHARS) });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/** Pull the JSON array out of an LLM response (tolerates code fences / prose). */
export function extractJsonArray(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

const SYSTEM = `You are STAFFD's follow-on strategist. A multi-department workflow just completed for a small business. Propose the highest-value follow-on actions the business should take next — the natural next moves a sharp chief of staff would queue up (an A/B variant after a campaign, CRM follow-up after outreach, a social post after a launch asset, a measurement check after shipping).

Rules:
- At most ${MAX_SUGGESTIONS} suggestions. Fewer is fine; zero is fine if nothing genuinely follows.
- Each suggestion must be concrete and self-contained — "goal" is a one-sentence instruction another planner can decompose without any other context.
- Never suggest repeating the completed work.
- Respond with ONLY a JSON array, no prose: [{"title":"<short label, max ${MAX_TITLE_CHARS} chars>","goal":"<one-sentence goal>"}]`;

/**
 * Generate follow-on suggestions for a completed workflow. `llm` is
 * injectable for tests; production uses the orchestrator's guarded callLLM
 * ("handoff" tier — cheap model, no retries, tight deadline).
 */
export async function generateFollowOnSuggestions(
  goal: string,
  stepTasks: string[],
  llm?: typeof CallLLM,
): Promise<FollowOnSuggestion[]> {
  if (!goal.trim()) return [];
  try {
    const call = llm ?? (await import("./llm")).callLLM;
    const steps = stepTasks
      .filter((t) => t.trim())
      .map((t, i) => `${i + 1}. ${t}`)
      .join("\n");
    const res = await call({
      intent: "handoff",
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Completed goal: ${goal}\n\nSteps that were carried out:\n${steps || "(single-step)"}\n\nWhat should this business do next?`,
        },
      ],
    });
    if (!res.ok) return [];
    return parseFollowOns(extractJsonArray(res.text));
  } catch {
    return [];
  }
}
