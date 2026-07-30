/**
 * PR-Wire-Directives — the owner's standing orders reach every specialist
 * through the single vault render point (agent route + all orchestrator
 * handlers call renderVaultBlock full).
 */

import { describe, it, expect } from "vitest";
import { renderVaultBlock, type Vault } from "../../app/api/_lib/vault";

describe("standing directives in renderVaultBlock", () => {
  const vault: Vault = {
    business_name: "Acme Fence Co",
    industry: "Fencing",
    staff_directives: "Sign everything 'Chris'. Never discount more than 10%.",
  };

  it("full detail renders the directives as an always-obey block after the vault", () => {
    const block = renderVaultBlock(vault, { detail: "full" });
    expect(block).toContain("--- BUSINESS VAULT ---");
    expect(block).toContain("STANDING DIRECTIVES");
    expect(block).toContain("follow on EVERY task");
    expect(block).toContain("Never discount more than 10%.");
  });

  it("no directives → no block (unchanged output)", () => {
    const block = renderVaultBlock({ business_name: "Acme" }, { detail: "full" });
    expect(block).not.toContain("STANDING DIRECTIVES");
  });

  it("directives render even when the rest of the vault is empty", () => {
    const block = renderVaultBlock({ staff_directives: "Always be brief." }, { detail: "full" });
    expect(block).toContain("Always be brief.");
  });

  it("summary detail (routing) stays lean — no directives", () => {
    const block = renderVaultBlock(vault, { detail: "summary" });
    expect(block).not.toContain("STANDING DIRECTIVES");
  });
});
