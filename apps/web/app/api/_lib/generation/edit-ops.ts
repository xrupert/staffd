/**
 * Edit-as-intent operation vocabulary + classifier (PURE, client-safe).
 *
 * Imports ONLY the GenKind type — no Anthropic / node deps — so both the client
 * (CommandCenter.send free-text gate) and the server (the edit route) import it.
 * The LLM fallback for ambiguous text lives in the server-only edit-ops-llm.ts,
 * mirroring the intent-policy.ts / intent.ts split.
 *
 * An "operation" is the INTENT (remove the background, refine, add captions),
 * never a model. Model resolution is routing.ts EDIT_MODELS, server-side only.
 */

import type { GenKind } from "./pricing";

export type EditOp =
  | "remove_background"
  | "instruct_edit"
  | "variations"
  | "recombine"
  | "trim"
  | "add_captions";

export type EditClassification = { op: EditOp; editPrompt: string } | null;

/** Source kind each op applies to (guards cross-kind nonsense). */
export const OP_KIND: Record<EditOp, GenKind> = {
  remove_background: "image",
  instruct_edit: "image",
  variations: "image",
  recombine: "video",
  trim: "video",
  add_captions: "video",
};

/**
 * Ops the EDIT ROUTE accepts. `variations` is deliberately excluded: it re-runs
 * the source's text prompt with new seeds (the existing generateImageOptions
 * path) and needs no source image, so the CLIENT handles it. The classifier
 * still emits it so free-text "more options" works.
 */
export const ROUTE_OPS: readonly EditOp[] = [
  "remove_background", "instruct_edit", "recombine", "trim", "add_captions",
];

/** Per-op muapi request body. submitPrediction is body-generic; field names live here only. */
export type EditOpSpec = { buildBody: (sourceUrl: string, editPrompt: string) => Record<string, unknown> };

export const EDIT_OP_SPECS: Record<EditOp, EditOpSpec> = {
  remove_background: { buildBody: (src) => ({ image_url: src }) },
  instruct_edit:     { buildBody: (src, p) => ({ image_url: src, prompt: p }) },
  // variations never reaches buildBody (client-handled) — present for completeness.
  variations:        { buildBody: (_src, p) => ({ prompt: p }) },
  recombine:         { buildBody: (src) => ({ videos_list: [src] }) },
  trim:              { buildBody: (src, p) => ({ video_url: src, prompt: p }) },
  add_captions:      { buildBody: (src, p) => ({ video_url: src, prompt: p }) },
};

const BG_REMOVAL = /\b(no background|without (a |the )?background|remove (the )?background|make it transparent|make (it |the image )?transparent|transparent(ly)?|cut ?out|cutout|knock ?out)\b/;
// "another edit beyond background" cues — presence alongside BG_REMOVAL means COMPOUND → instruct_edit.
const OTHER_IMAGE_EDIT = /\b(outline|border|stroke|shadow|make it|change|recolou?r|add|replace|turn it|brighten|darken|crop|swap|put|color|colour|bigger|smaller|move)\b/;
const VARIATIONS = /\b(variations?|more (options|like this|versions?)|other options|different versions?|another version)\b/;

const CAPTIONS = /\b(captions?|subtitles?|text overlay)\b/;
const TRIM = /\b(trim|shorter|cut (to|down)|first \d+\s?s(econds?)?|\d+\s?seconds?)\b/;
const RECOMBINE = /\b(re-?order|combine|stitch|merge|join|sequence|rearrange)\b/;

/**
 * Synchronous keyword classifier. Returns null when the text is not edit-shaped
 * (caller falls through to normal routing). Used by BOTH the client send-gate
 * and the server route's first pass.
 */
export function classifyEditKeyword(instruction: string, sourceKind: GenKind): EditClassification {
  const text = (instruction ?? "").trim();
  if (!text) return null;
  const t = text.toLowerCase();

  if (sourceKind === "image") {
    if (VARIATIONS.test(t)) return { op: "variations", editPrompt: text };
    const bg = BG_REMOVAL.test(t);
    if (bg) {
      // Strip bg-removal tokens from the text before checking for other edits, so
      // "make it transparent" (where "make it" is an OTHER_IMAGE_EDIT cue but the
      // full intent is pure bg removal) doesn't falsely become a compound.
      const withoutBg = t.replace(BG_REMOVAL, " ").trim();
      const other = OTHER_IMAGE_EDIT.test(withoutBg);
      if (!other) return { op: "remove_background", editPrompt: text }; // pure bg removal
      return { op: "instruct_edit", editPrompt: text };                  // COMPOUND → one pass (decision 3)
    }
    if (OTHER_IMAGE_EDIT.test(t)) return { op: "instruct_edit", editPrompt: text };
    return null;
  }

  if (CAPTIONS.test(t)) return { op: "add_captions", editPrompt: text };
  if (TRIM.test(t)) return { op: "trim", editPrompt: text };
  if (RECOMBINE.test(t)) return { op: "recombine", editPrompt: text };
  return null;
}
