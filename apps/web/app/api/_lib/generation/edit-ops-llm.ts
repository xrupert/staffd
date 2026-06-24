/**
 * Server-only LLM fallback for ambiguous edit instructions (edit-as-intent).
 * Runs only when classifyEditKeyword returned null but the request reached the
 * edit route with an active artifact. Maps free text → a ROUTE op or null.
 * Fail-safe: any error/ambiguity → null, so the caller falls back to normal
 * routing rather than mis-editing.
 */

import { callLLM } from "../orchestrator/llm";
import { ROUTE_OPS, OP_KIND, type EditClassification, type EditOp } from "./edit-ops";
import type { GenKind } from "./pricing";

const ROUTE_SET = new Set<string>(ROUTE_OPS);

function systemFor(kind: GenKind): string {
  // Derive the op list from ROUTE_OPS + OP_KIND so the prompt can't drift out of
  // sync with the accepted set when an op is added. instruct_edit gets a gloss.
  const ops = ROUTE_OPS.filter((op) => OP_KIND[op] === kind)
    .map((op) => (op === "instruct_edit" ? "instruct_edit (any other change to the image)" : op))
    .join(", ");
  return `You decide whether a message is an instruction to EDIT an existing ${kind} the user is looking at, and which operation it is.
Valid ops for a ${kind}: ${ops}.
Return STRICT JSON only: {"op":"<one of the ops>"} if it is clearly an edit of the current ${kind}, otherwise {"op":null}.
A question, a new request, or small talk is NOT an edit → {"op":null}.`;
}

export async function classifyEditLLM(instruction: string, sourceKind: GenKind): Promise<EditClassification> {
  const text = (instruction ?? "").trim();
  if (!text) return null;

  const res = await callLLM({
    intent: "route",
    system: systemFor(sourceKind),
    messages: [{ role: "user", content: text }],
  });
  if (!res.ok) return null;

  try {
    const json = res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1);
    const op = (JSON.parse(json) as { op?: string | null }).op;
    if (typeof op === "string" && ROUTE_SET.has(op)) return { op: op as EditOp, editPrompt: text };
  } catch {
    return null;
  }
  // op was null ("not an edit"), non-string, or not a ROUTE op → fall through.
  return null;
}
