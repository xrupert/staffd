/**
 * intent="handoff" — cross-functional next-step suggestions.
 *
 * Minimal B1 implementation. B5 enriches with locked-dept upsell flags and
 * source-document grounding.
 */

import { getAgent } from "@staffd/agents";
import { fetchVault, renderVaultBlock, retrieve } from "../../vault";
import { resolveDepartments } from "../../trial";
import { bridgingIndustryFor } from "../../industry";
import { callLLM } from "../llm";
import { policyFor } from "../policies";
import { degradedFor } from "../fallbacks";
import { getVoiceBlock } from "../../vault/voice";
import type { FollowUp, OrchestratorRequest, OrchestratorResponse } from "../types";

type HandoffContext = {
  sourceDoc?: { department?: string; prompt?: string; outputExcerpt?: string };
  query?: string;
};

function parseFollowUps(text: string, unlocked: string[]): FollowUp[] | null {
  const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i]!.match(/^(?:HANDOFFS:)?(\[.*\])\s*$/);
    if (!m) continue;
    try {
      const arr = JSON.parse(m[1]!) as Array<{
        department?: string;
        task?: string;
        rationale?: string;
      }>;
      const out: FollowUp[] = [];
      for (const f of arr) {
        if (!f.department || !f.task) continue;
        out.push({
          department: f.department,
          task: f.task,
          rationale: f.rationale ?? "",
          locked: !unlocked.includes(f.department),
        });
      }
      return out.length ? out : null;
    } catch { /* keep scanning */ }
  }
  return null;
}

export async function handleHandoff(req: OrchestratorRequest): Promise<OrchestratorResponse> {
  const policy = policyFor("handoff");
  const ctx = (req.context ?? {}) as HandoffContext;

  // Handoff suggestions feel more personal when the user's voice is on —
  // we use ctx.sourceDoc.department to decide voice applicability so a
  // legal-doc handoff stays neutral while a marketing handoff is in-voice.
  // W58.2 (D-19 bridging) — vault loads first so its industry can drive
  // pack auto-activation in resolveDepartments (same pattern as the route
  // handler, W58.0.1). One serialized PB read.
  const vault = req.pbToken && req.userId
    ? await fetchVault(req.pbToken, req.userId, { clientId: req.clientId })
    : null;
  const [trialState, voiceBlock] = await Promise.all([
    req.userId ? resolveDepartments(req.userId, { vaultIndustry: bridgingIndustryFor(vault) }) : Promise.resolve(null),
    getVoiceBlock(req.userId, ctx.sourceDoc?.department),
  ]);
  const unlockedDepts = trialState?.resolved.length ? trialState.resolved : ["marketing","sales","legal"];

  const seed = [
    ctx.sourceDoc?.prompt ?? "",
    ctx.sourceDoc?.outputExcerpt ?? "",
    ctx.query ?? "",
  ].filter(Boolean).join("\n").trim();

  const retrieval = seed && req.userId
    ? await retrieve(req.userId, seed, {
        topK: policy.vaultTopK,
        maxTokens: policy.vaultMaxTokens,
        clientId: req.clientId ?? null,
        intent: "handoff",
        preferDept: ctx.sourceDoc?.department,
      })
    : { items: [], costFlag: "degraded" as const, tokensReturned: 0, latencyMs: 0 };

  const agent = getAgent(policy.systemAgentId);
  const baseSystem = agent?.systemPrompt ?? "";

  const protocol = `
You are suggesting 2–3 cross-functional follow-ups for the user. The source artifact came from the "${ctx.sourceDoc?.department ?? "unknown"}" department. The user has these UNLOCKED departments: ${unlockedDepts.join(", ")}. Locked departments are valid candidates — surface them when they're genuinely a sharper fit, the platform will tag them as upsells.

Return exactly ONE line at the end of your response with no surrounding prose:
HANDOFFS:[{"department":"<dept>","task":"<specific next-step task>","rationale":"<one short sentence>"}, ...]`.trim();

  const memoryBlock = retrieval.items.length > 0
    ? `\n\n--- RELATED PAST WORK ---\n${retrieval.items.map((it) => `• [${it.dept ?? "?"}] ${it.text}`).join("\n")}\n--- END RELATED PAST WORK ---`
    : "";

  const userMsg = [
    ctx.sourceDoc?.prompt ? `Source task: ${ctx.sourceDoc.prompt}` : "",
    ctx.sourceDoc?.outputExcerpt ? `Output excerpt:\n${ctx.sourceDoc.outputExcerpt.slice(0, 1200)}` : "",
    ctx.query ? `User question: ${ctx.query}` : "",
  ].filter(Boolean).join("\n\n");

  if (!userMsg) {
    return {
      ok: false,
      intent: "handoff",
      fallback: "upstream_error",
      degraded: degradedFor("handoff", { sourceDoc: ctx.sourceDoc, unlockedDepts }),
      vaultCostFlag: retrieval.costFlag,
      latencyMs: 0,
      attempts: 0,
    };
  }

  const system = `${baseSystem}\n\n${protocol}${renderVaultBlock(vault, { detail: "full" })}${voiceBlock}${memoryBlock}`;
  const result = await callLLM({
    intent: "handoff",
    system,
    messages: [{ role: "user", content: userMsg }],
  });

  if (!result.ok) {
    return {
      ok: false,
      intent: "handoff",
      fallback: result.fallback,
      degraded: degradedFor("handoff", { sourceDoc: ctx.sourceDoc, unlockedDepts }),
      vaultCostFlag: retrieval.costFlag,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
    };
  }

  const followUps = parseFollowUps(result.text, unlockedDepts);
  if (!followUps) {
    return {
      ok: false,
      intent: "handoff",
      fallback: "upstream_error",
      degraded: degradedFor("handoff", { sourceDoc: ctx.sourceDoc, unlockedDepts }),
      vaultCostFlag: retrieval.costFlag,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
    };
  }

  return {
    ok: true,
    intent: "handoff",
    decision: { rationale: "Cross-functional next steps." },
    followUps,
    vaultCostFlag: retrieval.costFlag,
    latencyMs: result.latencyMs,
    attempts: result.attempts,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
