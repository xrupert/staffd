/**
 * W62 — Output analyzer (D-21 intelligence layer, data only).
 *
 * Classifies a finished specialist artifact against the locked action
 * vocabulary and returns validated, threshold-gated ActionCandidates.
 *
 * Own SDK callsite — the 9th audited entry on the W61′ allowlist
 * (SA ruling H5). Deliberately NOT routed through callLLM: the guardrail
 * wrapper is typed to the four orchestrator intents and is W61′-frozen.
 * This module carries its own summarize.ts-style discipline instead:
 * Haiku, 4s deadline, 1 retry, empty-result fallback, warn-level logging.
 * Analysis is post-hoc and non-blocking — a failure here never disturbs
 * the generation or the handoff FollowUps it runs alongside.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  ACTION_VOCABULARY,
  CONFIDENCE_THRESHOLD,
  validateCandidates,
  type ActionCandidate,
} from "./action-vocabulary";

// Lazy singleton — constructed on first use, not at import, so transitive
// importers (handlers/index chains, tests) never pay SDK construction cost
// or environment checks unless analysis actually runs.
let client: Anthropic | null = null;
function anthropicClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const ANALYZER_MODEL = "claude-haiku-4-5-20251001";
// W70.1 — production logs showed the analyzer hitting analyzer_deadline on
// longer deliverables (e.g. a full NDA) at the old 4s cap, returning no
// candidates → no action buttons. Bumped 4s→7s (big headroom for Haiku on a
// 4k-char artifact) while keeping the 1 retry for transient errors. Worst
// case ~14s stays under the platform's 15s function limit.
const ANALYZER_DEADLINE_MS = 7_000;
const ANALYZER_RETRIES = 1;
const ANALYZER_MAX_TOKENS = 512;
const OUTPUT_CHAR_CAP = 4_000;

export type AnalyzeInput = {
  /** The finished artifact (or its excerpt). */
  output: string;
  /** The task that produced it. */
  prompt: string;
  department: string;
  /** D-19 slim context (Decision 7) — pack id + 3 business-profile lines. */
  industryContext?: {
    pack: string | null;
    positioning?: string;
    hardNos?: string;
    serviceArea?: string;
  };
};

function buildSystem(input: AnalyzeInput): string {
  const vocab = ACTION_VOCABULARY
    .map((a) => `- "${a.id}": ${a.definition}`)
    .join("\n");

  const ctx: string[] = [];
  if (input.industryContext?.pack) ctx.push(`Industry: ${input.industryContext.pack}`);
  if (input.industryContext?.positioning) ctx.push(`Positioning: ${input.industryContext.positioning}`);
  if (input.industryContext?.hardNos) ctx.push(`Hard nos: ${input.industryContext.hardNos}`);
  if (input.industryContext?.serviceArea) ctx.push(`Service area: ${input.industryContext.serviceArea}`);
  const contextBlock = ctx.length > 0 ? `\n\nBUSINESS CONTEXT (use to sharpen reasons and params):\n${ctx.join("\n")}` : "";

  return `You classify a specialist's finished work and select the platform actions that clearly apply, from this FIXED vocabulary (no other ids exist):

${vocab}

Rules:
- Return ONLY a JSON array: [{"id": "...", "confidence": 0.0-1.0, "reason": "...", "params": {...}}]
- Omit actions that don't clearly apply. An empty array [] is a good answer for plain informational work.
- confidence is your honest applicability estimate, not enthusiasm.
- reason is one short specific sentence grounded in the work itself.
- params are optional short hints (e.g. {"platform": "instagram"} when the copy is platform-tagged).${contextBlock}`;
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("analyzer_deadline")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Analyze an artifact. Never throws — returns [] on any failure
 * (deadline, parse, upstream) with a warn-level log.
 */
export async function analyzeOutput(input: AnalyzeInput): Promise<ActionCandidate[]> {
  const output = (input.output ?? "").slice(0, OUTPUT_CHAR_CAP).trim();
  if (!output) return [];

  const system = buildSystem(input);
  const user = `Department: ${input.department}\nTask: ${input.prompt.slice(0, 500)}\n\nFinished work:\n${output}`;

  for (let attempt = 0; attempt <= ANALYZER_RETRIES; attempt++) {
    try {
      const msg = await withDeadline(
        anthropicClient().messages.create({
          model: ANALYZER_MODEL,
          max_tokens: ANALYZER_MAX_TOKENS,
          system,
          messages: [{ role: "user", content: user }],
        }),
        ANALYZER_DEADLINE_MS
      );
      const block = msg.content[0];
      const text = block?.type === "text" ? block.text : "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.warn(`[W62-analyzer] no JSON array in response dept=${input.department} text="${text.slice(0, 200)}"`);
        return [];
      }
      const rawParsed = JSON.parse(jsonMatch[0]) as unknown;
      const candidates = validateCandidates(rawParsed);
      // W70.1 observability — make "no buttons" diagnosable from the logs:
      // the model's raw output (incl. confidences) vs what survived the
      // threshold. An empty `kept` with a non-empty `raw` means the work
      // mapped weakly (below threshold); an empty `raw` means the model
      // judged it non-actionable; a parse miss is logged above.
      console.log(
        `[W62-analyzer] dept=${input.department} kept=${candidates.length}/${Array.isArray(rawParsed) ? rawParsed.length : 0} threshold=${CONFIDENCE_THRESHOLD} raw=${JSON.stringify(rawParsed).slice(0, 400)}`
      );
      return candidates;
    } catch (err) {
      if (attempt === ANALYZER_RETRIES) {
        console.warn("[W62-analyzer] classification failed (returning no candidates):", err);
        return [];
      }
    }
  }
  return [];
}
