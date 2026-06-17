/**
 * W95.3.5 — document text extraction routing + native text decode.
 *
 * The pdf/docx parsers are dynamic-imported inside extractText (kept out of
 * shared/Edge bundles — the W91.5 node:fs deploy footgun); their happy paths
 * are covered via the worker with a mocked extractor. Here we lock the pure
 * routing + the native text path + graceful failure on an unknown kind.
 */

import { describe, it, expect } from "vitest";
import { extractKindFor, extractText } from "../../app/api/_lib/upload/extract";

describe("extractKindFor", () => {
  it("routes by extension (case-insensitive)", () => {
    expect(extractKindFor("pdf")).toBe("pdf");
    expect(extractKindFor("PDF")).toBe("pdf");
    expect(extractKindFor("docx")).toBe("docx");
    expect(extractKindFor("txt")).toBe("text");
    expect(extractKindFor("md")).toBe("text");
  });
  it("returns null for unsupported extensions", () => {
    expect(extractKindFor("exe")).toBeNull();
    expect(extractKindFor("")).toBeNull();
  });
});

describe("extractText", () => {
  it("decodes a UTF-8 text buffer", async () => {
    const buf = new TextEncoder().encode("hello\nworld");
    const r = await extractText(buf, "text");
    expect(r).toMatchObject({ ok: true, text: "hello\nworld" });
  });

  it("clamps very long text to the PB field ceiling", async () => {
    const big = "x".repeat(300_000);
    const r = await extractText(new TextEncoder().encode(big), "text");
    expect(r.ok).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(200_000);
  });
});
