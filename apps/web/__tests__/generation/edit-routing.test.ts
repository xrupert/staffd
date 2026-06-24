import { describe, it, expect } from "vitest";
import { routeForEdit, allRoutingSlugs } from "../../app/api/_lib/generation/routing";
import { ROUTE_OPS } from "../../app/api/_lib/generation/edit-ops";

describe("routeForEdit", () => {
  it("every routable op resolves to at least one slug", () => {
    for (const op of ROUTE_OPS) {
      expect(routeForEdit(op).length, `op ${op} has no slug`).toBeGreaterThan(0);
    }
  });
  it("instruct_edit prefers the instruction-edit model", () => {
    expect(routeForEdit("instruct_edit")[0]).toBe("nano-banana-pro-edit");
  });
  it("video ops route to the combiner / captioner", () => {
    expect(routeForEdit("recombine")).toContain("video-combiner");
    expect(routeForEdit("add_captions")).toContain("motion-graphics-edit");
  });
});

describe("allRoutingSlugs", () => {
  it("includes the edit slugs (so validateRoutingSlugs guards them)", () => {
    const slugs = allRoutingSlugs();
    expect(slugs).toContain("nano-banana-pro-edit");
    expect(slugs).toContain("video-combiner");
  });
});
