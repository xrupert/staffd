/**
 * FC-1d — integration reads → agent context (department gating, fail-open,
 * timeout, cap).
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildIntegrationReadsBlock,
  DEPARTMENT_READERS,
  MAX_BLOCK_CHARS,
  type ReaderMap,
} from "../../app/api/_lib/integrations/context-reads";

const readers = (overrides: Partial<ReaderMap> = {}): ReaderMap => ({
  crm: async () => "CRM: 3 contacts.",
  support: async () => "Support inbox: 2 open conversations.",
  email: async () => "Email campaigns: none yet.",
  traffic: async () => "Website (last 7 days): 120 visitors.",
  ...overrides,
});

describe("buildIntegrationReadsBlock", () => {
  it("sales reads the CRM only", async () => {
    const block = await buildIntegrationReadsBlock("u1", "sales", readers());
    expect(block).toContain("LIVE BUSINESS DATA");
    expect(block).toContain("CRM: 3 contacts.");
    expect(block).not.toContain("Support inbox");
    expect(block).not.toContain("Website");
  });

  it("marketing reads email + traffic", async () => {
    const block = await buildIntegrationReadsBlock("u1", "marketing", readers());
    expect(block).toContain("Email campaigns");
    expect(block).toContain("Website (last 7 days)");
    expect(block).not.toContain("CRM:");
  });

  it("unmapped departments read nothing (no latency tax)", async () => {
    const spy = vi.fn(async () => "x");
    const block = await buildIntegrationReadsBlock("u1", "legal", readers({ crm: spy }));
    expect(block).toBe("");
    expect(spy).not.toHaveBeenCalled();
  });

  it("fail-open: a throwing reader contributes nothing, others still land", async () => {
    const block = await buildIntegrationReadsBlock("u1", "marketing", readers({
      email: async () => { throw new Error("listmonk down"); },
    }));
    expect(block).toContain("Website (last 7 days)");
    expect(block).not.toContain("Email campaigns");
  });

  it("all readers null/unconfigured → empty string, prompt untouched", async () => {
    const block = await buildIntegrationReadsBlock("u1", "sales", readers({ crm: async () => null }));
    expect(block).toBe("");
  });

  it("caps the block at MAX_BLOCK_CHARS", async () => {
    const block = await buildIntegrationReadsBlock("u1", "sales", readers({
      crm: async () => "x".repeat(MAX_BLOCK_CHARS * 2),
    }));
    expect(block.length).toBeLessThan(MAX_BLOCK_CHARS + 200);
  });

  it("no userId → empty string", async () => {
    expect(await buildIntegrationReadsBlock("", "sales", readers())).toBe("");
  });

  it("vocabulary pin — every mapped reader key exists in the default set", () => {
    const known = new Set(["crm", "support", "email", "traffic"]);
    for (const keys of Object.values(DEPARTMENT_READERS)) {
      for (const k of keys) expect(known.has(k)).toBe(true);
    }
  });
});
