/**
 * Document text extraction (W95.3.5).
 *
 * The heavy parsers (pdf-parse, mammoth) are **dynamic-imported inside the
 * functions only** — never at module top level — so they stay out of any
 * shared server chunk and the Edge `proxy` bundle. This is the W91.5 deploy
 * footgun guard: a node:fs-heavy dep imported into a shared chunk 500'd ALL
 * /api routes in prod while passing locally. Here the deps load only when an
 * extraction task actually runs in the worker (a Node serverless function).
 *
 * pdf-parse is v2 (the `PDFParse` class API). The v1 import-time test-fixture
 * footgun does not apply to v2 — its exports map has no `./lib` path.
 */

export type ExtractKind = "pdf" | "docx" | "text";
export type ExtractResult = { ok: boolean; text: string; reason?: string };

/** PB `output` is a text field — keep extracted text within a safe ceiling. */
const MAX_TEXT = 200_000;

export function extractKindFor(ext: string): ExtractKind | null {
  const e = (ext || "").toLowerCase();
  if (e === "pdf") return "pdf";
  if (e === "docx") return "docx";
  if (e === "txt" || e === "md") return "text";
  return null;
}

function clamp(text: string): string {
  const t = (text ?? "").trim();
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) : t;
}

export async function extractText(buffer: Uint8Array, kind: ExtractKind): Promise<ExtractResult> {
  try {
    if (kind === "text") {
      return { ok: true, text: clamp(new TextDecoder("utf-8").decode(buffer)) };
    }
    if (kind === "pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: Buffer.from(buffer) });
      try {
        const result = await parser.getText();
        return { ok: true, text: clamp(result.text ?? "") };
      } finally {
        await parser.destroy?.();
      }
    }
    if (kind === "docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
      return { ok: true, text: clamp(result.value ?? "") };
    }
    return { ok: false, text: "", reason: `unsupported kind: ${kind as string}` };
  } catch (err) {
    return { ok: false, text: "", reason: err instanceof Error ? err.message : "extraction failed" };
  }
}
