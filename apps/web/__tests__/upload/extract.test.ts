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

  // Coverage gap that HID the production bug: the real pdf/docx parser paths were
  // never exercised (the worker test mocks the extractor). This runs the REAL
  // pdf-parse on a real PDF so a broken parser can't pass CI silently again.
  it("extracts text from a real PDF (real pdf-parse, not mocked)", async () => {
    const objs = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    ];
    const stream = "BT /F1 24 Tf 72 700 Td (Hello STAFFD) Tj ET";
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [];
    objs.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach((o) => { pdf += String(o).padStart(10, "0") + " 00000 n \n"; });
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    const r = await extractText(new Uint8Array(Buffer.from(pdf, "latin1")), "pdf");
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/Hello STAFFD/);
  });
});
