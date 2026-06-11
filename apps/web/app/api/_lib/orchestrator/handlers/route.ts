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

export async function handleRoute(req: OrchestratorRequest): Promise<OrchestratorResponse> {
  const policy = policyFor("route");
  const ctx = (req.context ?? {}) as RouteContext;
  const message = (ctx.message ?? ctx.messages?.[ctx.messages.length - 1]?.content ?? "").trim();

  // Parallel: vault summary, department resolution, and (best-effort) Vault retrieval.
  const [vault, trialState] = await Promise.all([
    req.pbToken && req.userId ? fetchVault(req.pbToken, req.userId, { clientId: req.clientId }) : Promise.resolve(null),
    req.userId ? resolveDepartments(req.userId) : Promise.resolve(null),
  ]);

  const unlockedDepts = trialState?.resolved.length ? trialState.resolved : ["marketing","sales","legal"];
  const lockedDepts = ALL_DEPTS.filter((d) => !unlockedDepts.includes(d));
  const activePacks = trialState?.activePacks ?? [];
  // W58 (D-19) — resolve the free-text business industry to a pack id for
  // routing prioritization. Null (no match / no vault) → no boost, current
  // behavior preserved.
  const userIndustry = resolveIndustryToPackId(vault?.industry);

  // Hotfix bundle A1 — build the full roster of available specialists across
  // unlocked departments so the LLM can pick the right one BY NAME, not just
  // the right department. This is the single biggest fix in this PR: routing
  // to "marketing" alone caused the SEO question to land on the Content
  // Creator who then recommended SEMrush/Ahrefs.
  const rosterByDept: Record<string, Array<{ id: string; name: string; description: string; tags: string[] }>> = {};
  for (const d of unlockedDepts) {
    const agents = getDepartmentAgents(d as Department, { activePacks });
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

  const protocol = `
You are routing a user request to a SPECIFIC SPECIALIST on the user's staff.

UNLOCKED DEPARTMENTS: ${unlockedDepts.join(", ")}
LOCKED (do not route here, but you may name in lockedAlternative): ${lockedDepts.join(", ") || "(none)"}

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
  const dept = parsed.decision.department!;
  let agentId = parsed.decision.agentId;
  if (agentId) {
    const candidate = getAgent(agentId);
    const inDept = candidate && candidate.department === dept &&
      (!candidate.pack || activePacks.includes(candidate.pack));
    if (!inDept) agentId = undefined;
  }
  if (!agentId) {
    agentId = pickAgentForDept(dept, message, activePacks, userIndustry);
  }

  return {
    ok: true,
    intent: "route",
    decision: { ...parsed.decision, agentId },
    notes: parsed.lockedAlternative ? `lockedAlternative:${parsed.lockedAlternative}` : undefined,
    vaultCostFlag: retrieval.costFlag,
    latencyMs: result.latencyMs,
    attempts: result.attempts,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
