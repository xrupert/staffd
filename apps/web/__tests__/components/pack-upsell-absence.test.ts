/**
 * W58.3 Test 1 — PackUpsellCard is gone, surgically.
 *
 * Static source assertions (per the W58.3 brief's "static grep test"
 * option): the component file is deleted, no import or render site
 * remains, and the T3.0 credit-widget invariants in DepartmentRoom are
 * untouched (SA Decision 9).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const COMPONENTS = join(__dirname, "..", "..", "app", "components");
const deptRoomSrc = readFileSync(join(COMPONENTS, "DepartmentRoom.tsx"), "utf8");

describe("W58.3 — PackUpsellCard retirement", () => {
  it("the component file is deleted", () => {
    expect(existsSync(join(COMPONENTS, "PackUpsellCard.tsx"))).toBe(false);
  });

  it("DepartmentRoom has no PackUpsellCard import or render", () => {
    expect(deptRoomSrc).not.toContain("PackUpsellCard");
  });

  it("no upsell/purchase-pack language remains in DepartmentRoom", () => {
    // Purchase semantics only — the pre-existing "always unlocked (starter
    // pack)" comment at the top of the file is plan scoping, not an upsell.
    expect(deptRoomSrc).not.toMatch(/upsell|buy.*pack|purchase.*pack|pack.*\$19|opening stripe/i);
  });

  it("T3.0 invariants preserved — no agent-credit strings or inline credit indicator (Decision 9)", () => {
    expect(deptRoomSrc).not.toMatch(/agent.{0,5}credit|specialist.{0,5}credit|credits remaining/i);
    expect(deptRoomSrc).not.toContain("creditsRemaining");
  });

  it("no other component imports PackUpsellCard", () => {
    // The only historical consumer was DepartmentRoom (W58.3 Phase A §E);
    // settings page + badge are checked here for drift.
    const settingsSrc = readFileSync(
      join(__dirname, "..", "..", "app", "dashboard", "settings", "page.tsx"),
      "utf8"
    );
    const badgeSrc = readFileSync(join(COMPONENTS, "PackActiveBadge.tsx"), "utf8");
    expect(settingsSrc).not.toContain("PackUpsellCard");
    expect(badgeSrc).not.toContain("PackUpsellCard");
  });
});
