/**
 * intent="synthesize" — cross-department synthesis for the CEO surface.
 *
 * B4 enrichment: the handler now self-fetches the cross-department workload
 * (last 3 docs per unlocked dept other than CEO) and the prior CEO
 * continuity excerpts (last 2 CEO docs) that used to live inline in
 * /api/agent. Agent route is now a thin caller — for `department === "ceo"`
 * it delegates here and streams what we return.
 *
 * Agent identity: if the caller passes `context.agentId` and it resolves to
 * a CEO-department agent in `packages/agents`, that agent's systemPrompt is
 * used — preserving the per-specialist perspective (Chief of Staff vs.
 * Growth Strategist vs. Sprint Prioritizer etc.). Otherwise we fall back to
 * `ceo-agents-orchestrator` per `policies.synthesize.systemAgentId`.
 *
 * Latency policy (locked): max_tokens 4096, deadline 30 s, retries 1.
 */

import { getAgent, type Department } from "@staffd/agents";
import { fetchVault, renderVaultBlock, retrieve } from "../../vault";
import { resolveDepartments } from "../../trial";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../pb";
import { callLLM } from "../llm";
import { policyFor } from "../policies";
import { degradedFor } from "../fallbacks";
import { getVoiceBlock } from "../../vault/voice";
import type { OrchestratorRequest, OrchestratorResponse } from "../types";

type SynthesizeContext = {
  query: string;
  /** Optional caller-selected CEO agent; overrides the default systemAgentId. */
  agentId?: string;
};

type DocExcerpt = { prompt: string; output: string; created: string };

const MAX_DOCS_PER_DEPT = 3;
const PRIOR_CEO_LIMIT = 2;
const EXCERPT_CHARS = 350;
const PRIOR_EXCERPT_CHARS = 500;

/**
 * Fetch top-3 most-recent docs for each unlocked non-CEO department.
 * Mirrors the inline logic /api/agent used to carry; preserves the
 * (user='X') filter (no client-scoped variant — Agency client workload is
 * a future enhancement, B4 keeps parity with prior behaviour).
 */
async function fetchCrossDeptWorkload(
  userId: string,
  resolvedDepts: string[]
): Promise<Array<{ department: string; tasks: Array<{ prompt: string; outputExcerpt: string }> }>> {
  if (!userId) return [];
  const otherDepts = resolvedDepts.filter((d) => d !== "ceo");
  if (otherDepts.length === 0) return [];

  let token: string;
  let url: string;
  try {
    token = await getAdminToken();
    url = pbUrl();
  } catch {
    return [];
  }

  const escapedUser = pbEscape(userId);
  const results = await Promise.all(
    otherDepts.map(async (dept) => {
      try {
        const filter = `(user='${escapedUser}' && department='${pbEscape(dept)}')`;
        const res = await fetch(
          `${url}/api/collections/documents/records?filter=${encodeURIComponent(filter)}&sort=-created&perPage=${MAX_DOCS_PER_DEPT}&fields=prompt,output,department,created`,
          { headers: { Authorization: token } }
        );
        if (!res.ok) return null;
        const data = (await res.json()) as { items?: DocExcerpt[] };
        const items = data.items ?? [];
        if (items.length === 0) return null;
        return {
          department: dept,
          tasks: items.map((d) => ({
            prompt: d.prompt,
            outputExcerpt: d.output.length > EXCERPT_CHARS
              ? d.output.slice(0, EXCERPT_CHARS) + "…"
              : d.output,
          })),
        };
      } catch {
        return null;
      }
    })
  );

  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

/** Fetch last-2 CEO-dept docs for continuity (admin token; no PB row rules apply). */
async function fetchPriorCeoDocs(userId: string): Promise<DocExcerpt[]> {
  if (!userId) return [];
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const filter = `(user='${pbEscape(userId)}' && department='ceo')`;
    const res = await fetch(
      `${url}/api/collections/documents/records?filter=${encodeURIComponent(filter)}&sort=-created&perPage=${PRIOR_CEO_LIMIT}&fields=prompt,output,created`,
      { headers: { Authorization: token } }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: DocExcerpt[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

export async function handleSynthesize(req: OrchestratorRequest): Promise<OrchestratorResponse> {
  const policy = policyFor("synthesize");
  const ctx = (req.context ?? {}) as SynthesizeContext;

  if (!ctx.query?.trim()) {
    return {
      ok: false,
      intent: "synthesize",
      fallback: "upstream_error",
      degraded: degradedFor("synthesize", {}),
      latencyMs: 0,
      attempts: 0,
    };
  }

  // Resolve the operating agent. Caller may pick a specific CEO sub-agent
  // (Chief of Staff, Growth Strategist, Sprint Prioritizer, etc.); we only
  // honor it when it's actually a CEO-department agent.
  const callerAgent = ctx.agentId ? getAgent(ctx.agentId) : null;
  const ceoAgent = callerAgent?.department === ("ceo" as Department) ? callerAgent : null;
  const operatingAgent = ceoAgent ?? getAgent(policy.systemAgentId);
  const baseSystem = operatingAgent?.systemPrompt ?? "";

  // W58.2 (D-19 bridging) — vault loads first so its industry can drive
  // pack auto-activation in resolveDepartments. Then departments resolve,
  // then the remaining fetches fan out as before.
  const vault = req.pbToken && req.userId
    ? await fetchVault(req.pbToken, req.userId, { clientId: req.clientId })
    : null;
  const trialState = req.userId
    ? await resolveDepartments(req.userId, { vaultIndustry: vault?.industry })
    : null;
  const resolvedDepts = trialState?.resolved ?? [];

  const [workload, priorCeo, retrieval, voiceBlock] = await Promise.all([
    fetchCrossDeptWorkload(req.userId, resolvedDepts),
    fetchPriorCeoDocs(req.userId),
    req.userId
      ? retrieve(req.userId, ctx.query, {
          topK: policy.vaultTopK,
          maxTokens: policy.vaultMaxTokens,
          clientId: req.clientId ?? null,
          intent: "synthesize",
        })
      : Promise.resolve({ items: [], costFlag: "degraded" as const, tokensReturned: 0, latencyMs: 0 }),
    getVoiceBlock(req.userId, "ceo"),
  ]);

  // Build the cross-department workload block. Always present — when empty,
  // we emit the explicit "no recent work" coaching note that the inline
  // /api/agent CEO branch used to surface.
  const workloadBlock = workload.length > 0
    ? `\n\n--- CROSS-DEPARTMENT WORKLOAD (recent activity across the business — synthesize, don't repeat) ---\n${workload
        .map((d) => {
          const items = d.tasks
            .map((t) => `  • Task: ${t.prompt}\n    Output excerpt: ${t.outputExcerpt}`)
            .join("\n\n");
          return `[${d.department.toUpperCase()}]\n${items}`;
        })
        .join("\n\n")}\n--- END CROSS-DEPARTMENT WORKLOAD ---`
    : `\n\n--- CROSS-DEPARTMENT WORKLOAD ---\nNo recent work in other departments yet. Base advice on the Vault and the task at hand. Encourage the owner to start generating in their unlocked departments so future briefings can synthesize real activity.\n--- END CROSS-DEPARTMENT WORKLOAD ---`;

  const priorCeoBlock = priorCeo.length > 0
    ? `\n\n--- PRIOR CEO CONVERSATIONS (context only — do not repeat) ---\n${priorCeo
        .map((d, i) => {
          const summary = d.output.length > PRIOR_EXCERPT_CHARS
            ? d.output.slice(0, PRIOR_EXCERPT_CHARS) + "…"
            : d.output;
          return `[Prior CEO conversation ${i + 1}]\nTask: ${d.prompt}\nOutput: ${summary}`;
        })
        .join("\n\n")}\n--- END PRIOR CONVERSATIONS ---`
    : "";

  const memoryBlock = retrieval.items.length > 0
    ? `\n\n--- LIVING MEMORY (semantically relevant past work — synthesize, do not repeat) ---\n${retrieval.items
        .map((it) => `• [${it.dept ?? "?"}] ${it.text}`)
        .join("\n")}\n--- END LIVING MEMORY ---`
    : "";

  const system = `${baseSystem}${renderVaultBlock(vault, { detail: "full" })}${voiceBlock}${workloadBlock}${priorCeoBlock}${memoryBlock}`;

  const result = await callLLM({
    intent: "synthesize",
    system,
    messages: [{ role: "user", content: ctx.query }],
  });

  if (!result.ok) {
    const activitySamples = workload.map((d) => ({
      department: d.department,
      count: d.tasks.length,
      samples: d.tasks.map((t) => t.prompt),
    }));
    return {
      ok: false,
      intent: "synthesize",
      fallback: result.fallback,
      degraded: degradedFor("synthesize", { activitySamples }),
      vaultCostFlag: retrieval.costFlag,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
    };
  }

  return {
    ok: true,
    intent: "synthesize",
    decision: { task: result.text, rationale: "Cross-department synthesis." },
    vaultCostFlag: retrieval.costFlag,
    latencyMs: result.latencyMs,
    attempts: result.attempts,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
