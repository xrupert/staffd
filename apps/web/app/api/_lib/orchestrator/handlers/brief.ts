/**
 * intent="brief" — CEO weekly briefing synthesis.
 *
 * B3 enrichment: the activity rollup (last-30-days deptMap, samples, vault
 * completeness) now lives inside this handler. /api/briefing is a thin
 * wrapper that just streams what we return.
 *
 * System prompt is the real `ceo-chief-of-staff` agent from packages/agents
 * — not the hand-rolled one-liner that used to live in the briefing route.
 *
 * Latency policy (locked): max_tokens 4096, deadline 25 s, retries 1.
 * On `deadline_exceeded` / `llm_budget_exceeded` / `upstream_error`, the
 * degraded fallback returns an extractive snapshot — never an empty body.
 */

import { getAgent } from "@staffd/agents";
import { fetchVault, renderVaultBlock, retrieve } from "../../vault";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../pb";
import { callLLM } from "../llm";
import { policyFor } from "../policies";
import { degradedFor } from "../fallbacks";
import { getVoiceBlock } from "../../vault/voice";
import { fetchRecentDecisions } from "../../vault/outcomes";
import type { OrchestratorRequest, OrchestratorResponse } from "../types";

type BriefContext = {
  /** Optional override for the retrieval seed; defaults to a sensible string. */
  query?: string;
};

const CORE_VAULT_FIELDS = ["business_name", "industry", "description", "target_audience"];

const DEPT_NAMES: Record<string, string> = {
  marketing: "Marketing",
  sales: "Sales",
  legal: "Legal",
  hr: "HR",
  finance: "Finance",
  operations: "Operations",
  ceo: "Strategy",
  "paid-media": "Paid Media",
  design: "Design",
  reputation: "Reputation",
};

type ActivitySample = {
  department: string;
  count: number;
  samples: string[];
};

function formatImpact(impact: Record<string, unknown>): string {
  const metric = impact.metric as string | undefined;
  const value = impact.value;
  if (metric === "revenue" && typeof value === "number") {
    const currency = (impact.currency as string | undefined) ?? "usd";
    return currency.toLowerCase() === "usd"
      ? ` ($${value.toLocaleString()})`
      : ` (${value.toLocaleString()} ${currency.toUpperCase()})`;
  }
  if (metric && value !== undefined) return ` (${metric}: ${String(value)})`;
  return "";
}

async function fetchActivity(userId: string): Promise<{
  totalDocs: number;
  samples: ActivitySample[];
}> {
  if (!userId) return { totalDocs: 0, samples: [] };
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);
    const filter = `(user='${pbEscape(userId)}' && created>='${since}')`;
    const res = await fetch(
      `${url}/api/collections/documents/records?filter=${encodeURIComponent(filter)}&sort=-created&perPage=200&fields=department,prompt,created`,
      { headers: { Authorization: token } }
    );
    if (!res.ok) return { totalDocs: 0, samples: [] };
    const data = (await res.json()) as {
      items?: Array<{ department: string; prompt: string; created: string }>;
    };
    const docs = data.items ?? [];

    const deptMap = new Map<string, { count: number; samples: string[] }>();
    for (const doc of docs) {
      const entry = deptMap.get(doc.department) ?? { count: 0, samples: [] };
      entry.count++;
      if (entry.samples.length < 2) entry.samples.push(doc.prompt.slice(0, 90));
      deptMap.set(doc.department, entry);
    }
    const samples: ActivitySample[] = Array.from(deptMap.entries()).map(([dept, e]) => ({
      department: dept,
      count: e.count,
      samples: e.samples,
    }));
    return { totalDocs: docs.length, samples };
  } catch {
    return { totalDocs: 0, samples: [] };
  }
}

export async function handleBrief(req: OrchestratorRequest): Promise<OrchestratorResponse> {
  const policy = policyFor("brief");
  const ctx = (req.context ?? {}) as BriefContext;

  // Parallel fetches: vault, recent activity, voice block, decisions/outcomes.
  const [vault, activity, voiceBlock, decisions] = await Promise.all([
    req.pbToken && req.userId
      ? fetchVault(req.pbToken, req.userId, { clientId: req.clientId })
      : Promise.resolve(null),
    fetchActivity(req.userId),
    getVoiceBlock(req.userId, "ceo"),
    fetchRecentDecisions(req.userId, { daysBack: 30, limit: 25 }),
  ]);

  const missingVaultFields = CORE_VAULT_FIELDS.filter(
    (f) => !((vault?.[f] as string | undefined)?.trim())
  );

  const seed = (ctx.query ?? "weekly priorities risks and decisions across the business").trim();
  const retrieval = req.userId
    ? await retrieve(req.userId, seed, {
        topK: policy.vaultTopK,
        maxTokens: policy.vaultMaxTokens,
        clientId: req.clientId ?? null,
        intent: "brief",
      })
    : { items: [], costFlag: "degraded" as const, tokensReturned: 0, latencyMs: 0 };

  // Build system prompt — REAL ceo-chief-of-staff agent from packages/agents.
  const agent = getAgent(policy.systemAgentId);
  const baseSystem = agent?.systemPrompt ?? "You are the Chief of Staff.";

  const memoryBlock = retrieval.items.length > 0
    ? `\n\n--- LIVING MEMORY (semantically relevant past work — synthesize, do not repeat) ---\n${retrieval.items.map((it) => `• [${it.dept ?? "?"}] ${it.text}`).join("\n")}\n--- END LIVING MEMORY ---`
    : "";

  const system = `${baseSystem}${renderVaultBlock(vault, { detail: "full" })}${voiceBlock}${memoryBlock}`;

  // Build the user prompt — same structure the existing briefing route used,
  // so the output format users see is unchanged.
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const activityLines = activity.samples.length > 0
    ? activity.samples
        .map((s) => {
          const name = DEPT_NAMES[s.department] ?? s.department;
          const recent = s.samples.length > 0 ? ` Recent: "${s.samples.join('"; "')}"` : "";
          return `- ${name}: ${s.count} document${s.count !== 1 ? "s" : ""}.${recent}`;
        })
        .join("\n")
    : "Your staff hasn't produced any work in the last 30 days. Recommend where to start.";

  // Phase 5 — recent outcomes + decisions from Listmonk / Docuseal / Twenty
  // feedback. Surfaces real-world signal (deals closed, contracts signed,
  // emails that landed) so the brief is grounded in outcomes, not drafts.
  const outcomeLines = decisions.length > 0
    ? decisions
        .slice(0, 12)
        .map((d) => {
          const when = d.created ? d.created.slice(0, 10) : "";
          const tag = `[${d.decision_kind}]`;
          const impact = d.impact && typeof d.impact === "object"
            ? formatImpact(d.impact as Record<string, unknown>)
            : "";
          return `- ${when} ${tag} ${d.title}${impact}`;
        })
        .join("\n")
    : "No tracked outcomes yet — once Listmonk/Docuseal/Twenty webhooks fire, real-world results show up here.";

  const userPrompt = `Today is ${today}.

${vault ? `BUSINESS CONTEXT: vault has fields populated.` : `NOTE: Business vault is mostly empty. Use the vault gaps section to advise on what to fill in.`}

STAFF ACTIVITY — Last 30 days (${activity.totalDocs} total deliverables):
${activityLines}

REAL-WORLD OUTCOMES & DECISIONS — Last 30 days (use these to inform strategy):
${outcomeLines}

${missingVaultFields.length > 0 ? `VAULT GAPS (missing fields): ${missingVaultFields.join(", ")}\n` : ""}
Generate the weekly briefing using this exact structure:

## Weekly Briefing — ${today}

**Executive Summary**
[2–3 sentences: where the business stands, what's happening, what matters most right now]

**Top Priority This Week**
[One clear, specific action. Not a category — an actual thing to do.]

**Your Staff This Month**
[Summarise what's been happening. If nothing yet, tell them where to start and why.]

**What Would Make Your Team More Effective**
[Specific vault improvements or missing context that would sharpen AI output. Skip this section if vault is complete.]

**Next 30 Days — Focus Areas**
1. [area 1]
2. [area 2]
3. [area 3]

**Immediate Actions**
1. [specific action]
2. [specific action]
3. [specific action]

Be direct. Be specific. Cut everything that doesn't move the needle.`;

  const result = await callLLM({
    intent: "brief",
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  if (!result.ok) {
    return {
      ok: false,
      intent: "brief",
      fallback: result.fallback,
      degraded: degradedFor("brief", { activitySamples: activity.samples }),
      vaultCostFlag: retrieval.costFlag,
      latencyMs: result.latencyMs,
      attempts: result.attempts,
    };
  }

  return {
    ok: true,
    intent: "brief",
    decision: { task: result.text, rationale: "Weekly briefing." },
    vaultCostFlag: retrieval.costFlag,
    latencyMs: result.latencyMs,
    attempts: result.attempts,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}
