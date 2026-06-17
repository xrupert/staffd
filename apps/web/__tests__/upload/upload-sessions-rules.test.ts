/**
 * W95.3 — upload_sessions is a USER_OWNED collection so one owner cannot list
 * another's upload history. Runtime module import (not source-text check),
 * mirroring the W71 row-rule config test.
 */

import { describe, it, expect } from "vitest";
import { EXPECTED_COLLECTIONS, USER_OWNED_RULES } from "../../app/api/_lib/security/row-rules";

describe("W95.3 upload_sessions row-rule config", () => {
  it("upload_sessions is registered with USER_OWNED_RULES (cross-user isolation)", () => {
    const entry = EXPECTED_COLLECTIONS.find((e) => e.name === "upload_sessions");
    expect(entry).toBeDefined();
    expect(entry!.rules).toEqual(USER_OWNED_RULES);
    expect(entry!.systemManaged).toBeFalsy(); // repair enforces it
  });
});
