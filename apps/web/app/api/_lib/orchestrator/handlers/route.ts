/**
 * intent="route" — Command Center routing decisions.
 *
 * Picks the unlocked department best matched to the user's message, emits a
 * structured `OrchestratorDecision` with department + task + rationale, and
 * (when relevant) a `lockedAlternative` carried in `notes` so the consumer
 * can surface the upgrade nudge after the unlocked-dept run completes.
 *
 * This handler ships in B1. B2 cuts the legacy `/api/orchestrate` over to it.
 */

import { getAgent, getDepartmentAgents, routeTask, resolveIndustryToPackId, type Department, type IndustryPack } from "@staffd/agents";
import { fetchVault, renderVaultBlock, retrieve } from "../../vault";
import { bridgingIndustryFor, resolveBridgingIndustry } from "../../industry";
import { resolveDepartments } from "../../trial";
import { callLLM } from "../llm";
import { policyFor } from "../policies";
import { degradedFor } from "../fallbacks";
import type { OrchestratorDecision, OrchestratorRequest, OrchestratorResponse } from "../types";

type RouteContext = {
  message?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
};

const ALL_DEPTS = ["marketing","sales","legal","hr","finance","operations","paid-media","design","reputation","ceo"];

function parseDecision(text: string): { decision: OrchestratorDecision; lockedAlternative?: string } | null {
  // Handler accepts either a clean JSON object on a `ROUTE:` line, or a bare
  // JSON object on the last non-empty line. Defensive against minor format drift.
  const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i]!;
    const m = ln.match(/^(?:ROUTE:)?(\{.*\})\s*$/);
    if (!m) continue;
    try {
      const parsed = JSON.parse(m[1]!) as {
        department?: string;
        agentId?: string;
        task?: string;
        rationale?: string;
        lockedAlternative?: string;
      };
      if (parsed.department && parsed.task) {
        return {
          decision: {
            department: parsed.department,
            agentId: parsed.agentId || undefined,
            task: parsed.task,
            rationale: parsed.rationale ?? "",
          },
          lockedAlternative: parsed.lockedAlternative || undefined,
        };
      }
    } catch { /* keep scanning */ }
  }
  return null;
}

/**
 * Hotfix bundle A4 — smart fallback agent picker.
 *
 * When the orchestrator LLM returns a department but no agentId (or an
 * invalid one), score every specialist in that department by keyword overlap
 * between the user's message and the specialist's tags. Pick the highest
 * scorer. Fall back to the department's canonical default only if NOTHING
 * matches — which is rare because tags are intentionally broad.
 */
function pickAgentForDept(
  department: string,
  message: string,
  activePacks: string[],
  userIndustry: IndustryPack | null,
): string | undefined {
  const pool = getDepartmentAgents(department as Department, { activePacks });
  if (pool.length === 0) return undefined;

  // First try tag-keyword scoring against the user's actual message.
  // W58 (D-19) — pass owned packs so packed specialists join the scoring
  // pool (closes W54.1), and the user's industry so matching pack agents
  // get the 1.5× boost and win their domain.
  const matched = routeTask(message, department as Department, { activePacks, userIndustry });
  if (matched && pool.some((a) => a.id === matched.id)) return matched.id;

  return pool[0]?.id;
}

/**
 * Deterministic department hints for unambiguous requests. The Haiku router
 * occasionally mis-routes obvious cases (an NDA → Marketing); a high-precision
 * keyword match injects a STRONG SIGNAL into the routing prompt for the clear
 * cases, while ambiguous requests return null and stay the LLM's call.
 * Exported for tests. High precision over recall — only obvious keywords.
 */
const DEPT_KEYWORD_HINTS: ReadonlyArray<[string, RegExp]> = [
  ["legal", /\b(nda|non[-\s]?disclosure|contract|agreement|terms of service|privacy policy|waiver|indemnif|engagement letter|statement of work|\bsow\b|msa|cease and desist|licensing terms)\b/i],
  ["finance", /\b(invoice|profit and loss|p&l|bookkeep|balance sheet|accounts payable|accounts receivable|cash flow|expense report|quarterly taxes|budget forecast)\b/i],
  ["hr", /\b(job posting|job description|onboarding plan|performance review|employee handbook|offer letter|interview questions|30[-\s]?60[-\s]?90)\b/i],
  ["operations", /\b(sop|standard operating procedure|process documentation|runbook)\b/i],
];

export function suggestDepartmentFromKeywords(message: string): string | null {
  const m = (message ?? "").toLowerCase();
  for (const [dept, re] of DEPT_KEYWORD_HINTS) {
    if (re.test(m)) return dept;
  }
  return null;
}

/**
 * Make the keyword hint authoritative. The router occasionally ignores the
 * prompt-level hint (an NDA still landed on Marketing), so for an unambiguous
 * match we OVERRIDE the LLM's department — but only when the hinted dept is
 * unlocked (never grant entitlement). No hint / locked hint → keep the LLM's
 * pick. High precision (only obvious keywords) keeps this from fighting a
 * correct nuanced choice. Exported for tests.
 */
export function resolveRoutedDept(
  llmDept: string,
  deptHint: string | null,
  unlockedDepts: ReadonlyArray<string>,
): string {
  if (deptHint && unlockedDepts.includes(deptHint)) return deptHint;
  return llmDept;
}

/**
 * Auto-route vertical gate. Comped/super-admin accounts have EVERY pack
 * active (trial.ts); without this, every vertical specialist competes in the
 * auto-router and an unrelated one can win an out-of-vertical task (a
 * real-estate "Listing Promoter" answering a junk-removal proposal). Only the
 * user's RESOLVED industry pack (when active) is offered to the auto-router;
 * otherwise generic specialists only. Explicit pack access via dept pages is
 * unaffected — this narrows AUTO-routing alone. Exported for tests.
 */
export function routablePacksFor(
  userIndustry: IndustryPack | null | undefined,
  activePacks: ReadonlyArray<string>,
): string[] {
  if (userIndustry && activePacks.includes(userIndustry)) return [userIndustry];
  return [];
}

export async function handleRoute(req: OrchestratorRequest): Promise<OrchestratorResponse> {
  const policy = policyFor("route");
  const ctx = (req.context ?? {}) as RouteContext;
  const message = (ctx.message ?? ctx.messages?.[ctx.messages.length - 1]?.content ?? "").trim();

  // W58.0.1 (D-19 bridging) — vault loads FIRST so its industry value can
  // drive pack auto-activation inside resolveDepartments. This serializes
  // two PB reads that previously ran in parallel (~one extra roundtrip,
  // well inside the 8s route deadline from W37).
  const vault = req.pbToken && req.userId
    ? await fetchVault(req.pbToken, req.userId, { clientId: req.clientId })
    : null;
  const trialState = req.userId
    ? await resolveDepartments(req.userId, { vaultIndustry: bridgingIndustryFor(vault) })
    : null;

  const unlockedDepts = trialState?.resolved.length ? trialState.resolved : ["marketing","sales","legal"];
  const lockedDepts = ALL_DEPTS.filter((d) => !unlockedDepts.includes(d));
  const activePacks = trialState?.activePacks ?? [];
  // W58 (D-19) — resolve the free-text business industry to a pack id for
  // routing prioritization. Null (no match / no vault) → no boost, current
  // behavior preserved.
  // W59 (Decision 8) — boost resolution honors the structured category too.
  const userIndustry = resolveIndustryToPackId(resolveBridgingIndustry(vault));
  // Only the user's industry pack (when active) joins the AUTO-route pool —
  // see routablePacksFor. Keeps unrelated verticals out of auto-routing for
  // comped/all-packs accounts.
  const routablePacks = routablePacksFor(userIndustry, activePacks);

  // Hotfix bundle A1 — build the full roster of available specialists across
  // unlocked departments so the LLM can pick the right one BY NAME, not just
  // the right department. This is the single biggest fix in this PR: routing
  // to "marketing" alone caused the SEO question to land on the Content
  // Creator who then recommended SEMrush/Ahrefs.
  const rosterByDept: Record<string, Array<{ id: string; name: string; description: string; tags: string[] }>> = {};
  for (const d of unlockedDepts) {
    const agents = getDepartmentAgents(d as Department, { activePacks: routablePacks });
    rosterByDept[d] = agents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      tags: a.tags,
    }));
  }
  const rosterText = Object.entries(rosterByDept)
    .map(([dept, agents]) =>
      `${dept}:\n` +
      agents.map((a) => `  - ${a.id} (${a.name}) — ${a.description} [tags: ${a.tags.join(", ")}]`).join("\n")
    )
    .join("\n\n");

  // Retrieval is opportunistic for route — small cap, may degrade silently.
  const retrieval = message && req.userId
    ? await retrieve(req.userId, message, {
        topK: policy.vaultTopK,
        maxTokens: policy.vaultMaxTokens,
        clientId: req.clientId ?? null,
        intent: "route",
      })
    : { items: [], costFlag: "degraded" as const, tokensReturned: 0, latencyMs: 0 };

  // Build system prompt — load the ceo-agents-orchestrator agent from packages/agents.
  const agent = getAgent(policy.systemAgentId);
  const baseSystem = agent?.systemPrompt ?? "You are the STAFFD Command Center coordinator.";

  // Deterministic department hint for unambiguous requests (NDA → legal,
  // invoice → finance, …). Injected as a strong signal only when the hinted
  // dept is unlocked; ambiguous requests carry no hint and stay the LLM's call.
  const deptHint = suggestDepartmentFromKeywords(message);
  const hintLine = deptHint && unlockedDepts.includes(deptHint)
    ? `\n\nSTRONG SIGNAL: this request clearly matches the ${deptHint.toUpperCase()} department — route to ${deptHint} and pick that department's best-fit specialist, unless the text plainly points elsewhere.`
    : "";

  const protocol = `
You are routing a user request to a SPECIFIC SPECIALIST on the user's staff.

UNLOCKED DEPARTMENTS: ${unlockedDepts.join(", ")}
LOCKED (do not route here, but you may name in lockedAlternative): ${lockedDepts.join(", ") || "(none)"}${hintLine}

AVAILABLE SPECIALISTS (you MUST pick one of these agentId values):
${rosterText}

Return exactly ONE line at the end of your response with this shape and no surrounding prose:
ROUTE:{"department":"<unlocked-dept>","agentId":"<exact-id-from-list-above>","task":"<specific task>","rationale":"<one short sentence naming the specialist>","lockedAlternative":"<locked-dept-or-empty>"}

CRITICAL routing rules:
1. agentId MUST be one of the ids in AVAILABLE SPECIALISTS above. Copy-paste exactly. No invented ids.
2. Match the user's intent to the specialist whose tags + description fit best — NOT the first agent in the department. Example: "help with SEO" → marketing-seo-specialist, NOT marketing-content-creator. "AEO / answer engine optimization" → marketing-agentic-search-optimizer.
3. Department must be the one that owns the chosen specialist.
4. rationale should name the specialist by their human name (e.g. "Your SEO Specialist on the Marketing team is the right fit").
5. Never route to a locked department.

Reminder (already enforced by brand laws downstream, but informing your choice): the user does not want external tools recommended. Pick the specialist who can actually do the work; that specialist will deliver it.`.trim();

  const memoryBlock = retrieval.items.length > 0
    ? `\n\n--- LIVING MEMORY (recent relevant work) ---\n${retrieval.items.map((it) => `• [${it.dept ?? "?"}] ${it.text}`).join("\n")}\n--- END LIVING MEMORY ---`
    : "";

  const system = `${baseSystem}\n\n${protocol}${renderVaultBlock(vault, { detail: "summary" })}${memoryBlock}`;

  // Cap conversation history per policy.
  const incoming = ctx.messages ?? (message ? [{ role: "user" as const, content: message }] : []);
  const messages = incoming.slice(-policy.messageCap);
  if (messages.length === 0) {
    // No message? Degrade immediately — nothing to route on.
    return {
      ok: false,
      intent: "route",
      fallback: "upstream_error",
      degraded: degradedFor("route", { message: "", unlockedDepts }),
      vaultCostFlag: retrieval.costFlag,
      latencyMs: 0,
      attempts: 0,
    };
  }

  const result = await callLLM({ intent: "route", system, messages });

  if (!result.ok) {
    return {
      ok: false,
      intent: "route",
      fallback: result.fallback,
      degraded: degradedFor("route", { message, unlockedDepts }),
      vaultCostFlag: retrieval.costFlag,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
    };
  }

  const parsed = parseDecision(result.text);
  if (!parsed || !unlockedDepts.includes(parsed.decision.department ?? "")) {
    // Model returned something we can't act on (or routed to a locked dept).
    // Treat as upstream_error → degraded fallback.
    return {
      ok: false,
      intent: "route",
      fallback: "upstream_error",
      degraded: degradedFor("route", { message, unlockedDepts }),
      vaultCostFlag: retrieval.costFlag,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
    };
  }

  // Hotfix bundle A4 — validate the LLM-picked agentId. If invalid or
  // missing, fall back to the smart keyword picker (NOT the first-in-list
  // default — that's what caused the SEMrush bug).
  // Authoritative dept override for unambiguous keyword matches. When this
  // changes the dept, the LLM's agentId (from the wrong dept) fails the
  // inDept check below and pickAgentForDept re-picks within the right dept.
  const dept = resolveRoutedDept(parsed.decision.department!, deptHint, unlockedDepts);
  let agentId = parsed.decision.agentId;
  if (agentId) {
    const candidate = getAgent(agentId);
    const inDept = candidate && candidate.department === dept &&
      (!candidate.pack || routablePacks.includes(candidate.pack));
    if (!inDept) agentId = undefined;
  }
  if (!agentId) {
    agentId = pickAgentForDept(dept, message, routablePacks, userIndustry);
  }

  return {
    ok: true,
    intent: "route",
    decision: { ...parsed.decision, department: dept, agentId },
    notes: parsed.lockedAlternative ? `lockedAlternative:${parsed.lockedAlternative}` : undefined,
    vaultCostFlag: retrieval.costFlag,
    latencyMs: result.latencyMs,
    attempts: result.attempts,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
