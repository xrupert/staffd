/**
 * PR-Loop-V4 (#8) — recurrence date math.
 */

import { describe, it, expect } from "vitest";
import { nextRecurrenceDate, isRecurrence } from "../../app/api/_lib/recurrence";

describe("nextRecurrenceDate", () => {
  it("weekly adds 7 days", () => {
    expect(nextRecurrenceDate("2026-07-29", "weekly")).toBe("2026-08-05");
    expect(nextRecurrenceDate("2026-12-28", "weekly")).toBe("2027-01-04"); // year wrap
  });

  it("monthly keeps the day-of-month", () => {
    expect(nextRecurrenceDate("2026-07-15", "monthly")).toBe("2026-08-15");
    expect(nextRecurrenceDate("2026-12-10", "monthly")).toBe("2027-01-10"); // year wrap
  });

  it("monthly clamps to the target month's length", () => {
    expect(nextRecurrenceDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextRecurrenceDate("2026-08-31", "monthly")).toBe("2026-09-30");
  });

  it("throws on junk input", () => {
    expect(() => nextRecurrenceDate("not-a-date", "weekly")).toThrow();
  });
});

describe("isRecurrence", () => {
  it("accepts only weekly/monthly", () => {
    expect(isRecurrence("weekly")).toBe(true);
    expect(isRecurrence("monthly")).toBe(true);
    expect(isRecurrence("")).toBe(false);
    expect(isRecurrence("daily")).toBe(false);
    expect(isRecurrence(undefined)).toBe(false);
  });
});
