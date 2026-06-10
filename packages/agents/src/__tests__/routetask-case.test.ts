/**
 * W54 — Tag-routing case normalization regression suite.
 *
 * Phase A.5 found that `routeTask` lowercased the task but compared
 * against RAW tags, so uppercase tags (MSA, COGS, BOH, FOH, IOLTA, …)
 * could never match. W54 normalizes the tag at the match site only —
 * stored tag casing is untouched (Test 2 pins that).
 *
 * Expected specialist ids below were verified empirically against the
 * live registry per the W54 brief ("do not hardcode without
 * verification"). Notable verified behavior: "draft an MSA" routes to
 * the generic legal-document-drafter (its lowercase "draft" + "msa"
 * tags score 2, beating the pack drafter's single "MSA" hit) — a
 * correct outcome; pack specialists win when the task hits multiple of
 * their tags.
 */

import { describe, it, expect } from "vitest";
import { routeTask, getAgent } from "../index";

describe("routeTask — uppercase tags now match (W54 Test 1)", () => {
  it("routes COGS tasks to the restaurants cost tracker", () => {
    const match = routeTask("track COGS and inventory variance this month");
    expect(match?.id).toBe("pack-restaurants-finance-cogs-tracker");
  });

  it("routes IOLTA tasks to the law trust-accounting specialist", () => {
    const match = routeTask("IOLTA reconciliation for the trust account");
    expect(match?.id).toBe("pack-law-finance-trust-accounting");
  });

  it("routes FOH/BOH scheduling tasks to the restaurants shift scheduler", () => {
    const match = routeTask("plan the FOH and BOH staff schedule");
    expect(match?.id).toBe("pack-restaurants-operations-shift-scheduler");
  });

  it("routes MSA tasks (generic legal drafter wins the tie — verified)", () => {
    const match = routeTask("draft an MSA and SOW for the new agency contract");
    expect(match?.id).toBe("legal-document-drafter");
  });

  it("control — lowercase 'nda' tag already matched before W54", () => {
    const match = routeTask("draft an NDA", "legal");
    expect(match?.id).toBe("legal-document-drafter");
  });
});

describe("routeTask — stored tag casing unchanged (W54 Test 2)", () => {
  it("the agencies MSA drafter still stores 'MSA' in original case", () => {
    const agent = getAgent("pack-agencies-legal-msa-drafter");
    expect(agent).toBeTruthy();
    expect(agent!.tags).toContain("MSA");
    expect(agent!.tags).not.toContain("msa");
  });

  it("the restaurants cost tracker still stores 'COGS' in original case", () => {
    const agent = getAgent("pack-restaurants-finance-cogs-tracker");
    expect(agent).toBeTruthy();
    expect(agent!.tags).toContain("COGS");
  });
});

describe("routeTask — mixed-case tasks (W54 Test 3)", () => {
  it("all casings of the same task route to the same specialist", () => {
    const base = routeTask("draft an msa and sow for the new agency contract");
    const title = routeTask("Draft An Msa and sow for the new agency contract");
    const upper = routeTask("DRAFT AN MSA AND SOW FOR THE NEW AGENCY CONTRACT");
    expect(base?.id).toBeTruthy();
    expect(title?.id).toBe(base?.id);
    expect(upper?.id).toBe(base?.id);
  });
});

describe("routeTask — negative control (W54 Test 4)", () => {
  it("a task with no tag overlap returns undefined", () => {
    expect(routeTask("tell me a joke")).toBeUndefined();
  });
});
