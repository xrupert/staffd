/**
 * T1-6 — pbEscape security contract.
 *
 * pbEscape is the single defense against PocketBase filter injection
 * (PB does not parameterize filters). Every user-controlled value
 * interpolated into a filter string MUST pass through it. This test locks
 * the escaping guarantee so a regression in pbEscape is caught immediately.
 */

import { describe, it, expect } from "vitest";
import { pbEscape } from "../../app/api/_lib/pb";

describe("pbEscape (T1-6 injection defense)", () => {
  it("backslash-escapes single quotes so a value can't break out of its literal", () => {
    // Classic break-out payload: close the literal, inject a clause.
    const payload = "x' || user!='";
    const escaped = pbEscape(payload);
    expect(escaped).toBe("x\\' || user!=\\'");
    // Every quote in the result is backslash-escaped (none stands alone).
    expect(/(^|[^\\])'/.test(escaped)).toBe(false);
  });

  it("leaves a benign value untouched", () => {
    expect(pbEscape("user_abc123")).toBe("user_abc123");
  });

  it("escapes every quote in a multi-quote payload", () => {
    expect(pbEscape("a'b'c")).toBe("a\\'b\\'c");
  });

  it("handles empty string", () => {
    expect(pbEscape("")).toBe("");
  });
});
