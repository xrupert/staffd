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

import { getAgent } from "@staffd/agents";
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
        task?: string;
        rationale?: string;
        lockedAlternative?: string;
      };
      if (parsed.department && parsed.task) {
        return {
          decision: {
            department: parsed.department,
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
You are routing a user request to a department. The user has these UNLOCKED departments: ${unlockedDepts.join(", ")}.
LOCKED (do not route here): ${lockedDepts.join(", ") || "(none)"}.

Return exactly ONE line at the end of your response with this shape and no surrounding prose:
ROUTE:{"department":"<unlocked-dept>","task":"<specific task>","rationale":"<one short sentence>","lockedAlternative":"<locked-dept-or-empty>"}

Pick the unlocked department that best fits the request. If a locked department would be a sharper fit, name it in lockedAlternative so the platform can surface the upsell after the unlocked dept runs. Never route to a locked department.`.trim();

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

  return {
    ok: true,
    intent: "route",
    decision: parsed.decision,
    notes: parsed.lockedAlternative ? `lockedAlternative:${parsed.lockedAlternative}` : undefined,
    vaultCostFlag: retrieval.costFlag,
    latencyMs: result.latencyMs,
    attempts: result.attempts,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
