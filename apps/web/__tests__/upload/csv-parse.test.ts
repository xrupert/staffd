/**
 * W95.3 — contacts CSV parser. RFC-4180-ish: quoted fields with commas,
 * escaped quotes, CRLF/LF, blank rows skipped, case-insensitive headers,
 * missing optional columns default to "", rows missing required `name` error.
 */

import { describe, it, expect } from "vitest";
import { parseContactsCsv } from "../../app/api/_lib/upload/csv";

describe("parseContactsCsv", () => {
  it("parses a simple well-formed CSV with header mapping", () => {
    const r = parseContactsCsv("name,email,phone,context\nJane Doe,jane@x.com,555-1212,met at expo");
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([{ name: "Jane Doe", email: "jane@x.com", phone: "555-1212", context: "met at expo" }]);
  });

  it("maps headers case-insensitively and in any order", () => {
    const r = parseContactsCsv("Email,NAME\njane@x.com,Jane");
    expect(r.rows[0]!).toMatchObject({ name: "Jane", email: "jane@x.com", phone: "", context: "" });
  });

  it("honors quoted fields containing commas", () => {
    const r = parseContactsCsv('name,context\n"Doe, Jane","met at expo, booth 12"');
    expect(r.rows[0]).toEqual({ name: "Doe, Jane", email: "", phone: "", context: "met at expo, booth 12" });
  });

  it("honors escaped double-quotes inside quoted fields", () => {
    const r = parseContactsCsv('name,context\nJane,"she said ""hi"" to me"');
    expect(r.rows[0]!.context).toBe('she said "hi" to me');
  });

  it("skips blank rows and tolerates CRLF line endings", () => {
    const r = parseContactsCsv("name,email\r\n\r\nJane,jane@x.com\r\n\r\n");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.name).toBe("Jane");
  });

  it("defaults missing optional columns to empty string", () => {
    const r = parseContactsCsv("name\nJane\nBob");
    expect(r.rows).toEqual([
      { name: "Jane", email: "", phone: "", context: "" },
      { name: "Bob", email: "", phone: "", context: "" },
    ]);
  });

  it("reports an error (with row number) for a row missing the required name, without dropping good rows", () => {
    const r = parseContactsCsv("name,email\nJane,jane@x.com\n,orphan@x.com\nBob,bob@x.com");
    expect(r.rows.map((x) => x.name)).toEqual(["Jane", "Bob"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 3 }); // 1-based incl. header line
    expect(r.errors[0]!.reason).toMatch(/name/i);
  });

  it("errors cleanly when the header has no recognizable name column", () => {
    const r = parseContactsCsv("foo,bar\n1,2");
    expect(r.rows).toEqual([]);
    expect(r.errors[0]!.reason).toMatch(/name/i);
  });

  it("trims surrounding whitespace on cells", () => {
    const r = parseContactsCsv("name, email \n  Jane  , jane@x.com ");
    expect(r.rows[0]!).toMatchObject({ name: "Jane", email: "jane@x.com" });
  });
});
