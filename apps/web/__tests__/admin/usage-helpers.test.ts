/**
 * W92 — Super-Admin Usage Dashboard pure helpers (runtime tests).
 *
 * Fleet metric primitives: user classification (operator/comp/customer),
 * the last-activity proxy, activity bucketing, churn state, task success
 * rate, and the operator-row badge. No HTTP / PB.
 */

import { describe, it, expect } from "vitest";
import {
  classifyUser,
  lastActivityProxy,
  activityBucket,
  churnState,
  taskSuccessRate,
  usageBadge,
} from "../../app/api/_lib/usage";

const ADMIN = "chris.rupert@cybridagency.com";

describe("classifyUser", () => {
  it("the operator email is super-admin (even though it is also a comp email)", () => {
    expect(classifyUser(ADMIN, ADMIN)).toBe("super-admin");
  });
  it("a comp-domain email is comp", () => {
    expect(classifyUser("dana@jrw-solutions.com", ADMIN)).toBe("comp");
  });
  it("anyone else is a customer", () => {
    expect(classifyUser("jane@acme.com", ADMIN)).toBe("customer");
  });
  it("case-insensitive on the admin match", () => {
    expect(classifyUser("Chris.Rupert@Cybridagency.com", ADMIN)).toBe("super-admin");
  });
});

describe("lastActivityProxy", () => {
  it("returns the most recent of mixed/empty dates", () => {
    expect(lastActivityProxy(["2026-06-01", null, "2026-06-10", undefined, "2026-05-20"])).toBe("2026-06-10");
  });
  it("returns null when nothing is present", () => {
    expect(lastActivityProxy([null, undefined, ""])).toBeNull();
  });
});

describe("activityBucket", () => {
  const now = new Date("2026-06-16T00:00:00Z");
  it("within 7 days → active7", () => {
    expect(activityBucket("2026-06-12T00:00:00Z", now)).toBe("active7");
  });
  it("within 30 days → active30", () => {
    expect(activityBucket("2026-05-30T00:00:00Z", now)).toBe("active30");
  });
  it("older than 30 days → dormant", () => {
    expect(activityBucket("2026-04-01T00:00:00Z", now)).toBe("dormant");
  });
  it("no activity → never", () => {
    expect(activityBucket(null, now)).toBe("never");
  });
});

describe("churnState", () => {
  const now = new Date("2026-06-16T00:00:00Z");
  it("past active_until → expired", () => {
    expect(churnState("2026-06-01T00:00:00Z", now)).toBe("expired");
  });
  it("within 14 days → expiring", () => {
    expect(churnState("2026-06-20T00:00:00Z", now)).toBe("expiring");
  });
  it("comfortably in the future → ok", () => {
    expect(churnState("2026-09-01T00:00:00Z", now)).toBe("ok");
  });
  it("no active_until → none", () => {
    expect(churnState(null, now)).toBe("none");
  });
});

describe("taskSuccessRate", () => {
  it("computes a rounded percentage", () => {
    expect(taskSuccessRate(3, 4)).toBe(75);
  });
  it("is 0 when there are no tasks (no divide-by-zero)", () => {
    expect(taskSuccessRate(0, 0)).toBe(0);
  });
});

describe("usageBadge (operator-row marking)", () => {
  it("marks the operator (super-admin)", () => {
    expect(usageBadge("super-admin")).toMatchObject({ label: "Operator" });
  });
  it("marks comp accounts", () => {
    expect(usageBadge("comp")).toMatchObject({ label: "Comp" });
  });
  it("does not mark customers", () => {
    expect(usageBadge("customer")).toBeNull();
  });
});
