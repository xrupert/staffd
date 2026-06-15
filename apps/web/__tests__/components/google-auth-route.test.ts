/**
 * FC-4 — post-Google-OAuth routing decision.
 *
 * A brand-new account (PB `meta.isNew`) must land in onboarding so the
 * VaultContext gets populated; a returning user goes straight to the
 * dashboard. This pure helper is the decision the OAuth button uses after
 * a successful authWithOAuth2.
 */

import { describe, it, expect } from "vitest";
import { oauthNextRoute } from "../../app/components/GoogleAuthButton";

describe("oauthNextRoute (FC-4)", () => {
  it("sends a brand-new account to onboarding", () => {
    expect(oauthNextRoute(true)).toBe("/onboarding");
  });

  it("sends a returning account to the dashboard", () => {
    expect(oauthNextRoute(false)).toBe("/dashboard");
  });
});
