import { describe, it, expect } from "vitest";
import {
  classifyEditKeyword, EDIT_OP_SPECS, OP_KIND, ROUTE_OPS, type EditOp,
} from "../../app/api/_lib/generation/edit-ops";

describe("classifyEditKeyword — image", () => {
  it("pure background removal → remove_background", () => {
    expect(classifyEditKeyword("no background please", "image")?.op).toBe("remove_background");
    expect(classifyEditKeyword("make it transparent", "image")?.op).toBe("remove_background");
  });

  it("COMPOUND (bg + another edit) → single instruct_edit pass (decision 3)", () => {
    const r = classifyEditKeyword("no background + a thin black outline", "image");
    expect(r?.op).toBe("instruct_edit");
    expect(r?.editPrompt).toBe("no background + a thin black outline");
  });

  it("plain instruction → instruct_edit", () => {
    expect(classifyEditKeyword("make it blue", "image")?.op).toBe("instruct_edit");
    expect(classifyEditKeyword("add a drop shadow", "image")?.op).toBe("instruct_edit");
  });

  it("variations cue → variations", () => {
    expect(classifyEditKeyword("give me more options", "image")?.op).toBe("variations");
  });

  it("non-edit text → null (falls through to normal routing)", () => {
    expect(classifyEditKeyword("what's my MRR this month", "image")).toBeNull();
    expect(classifyEditKeyword("thanks!", "image")).toBeNull();
  });
});

describe("classifyEditKeyword — video", () => {
  it("captions / trim / reorder map to their ops", () => {
    expect(classifyEditKeyword("add captions", "video")?.op).toBe("add_captions");
    expect(classifyEditKeyword("make it shorter", "video")?.op).toBe("trim");
    expect(classifyEditKeyword("reorder the clips", "video")?.op).toBe("recombine");
  });
});

describe("EDIT_OP_SPECS.buildBody — muapi body shapes", () => {
  it("remove_background → image_url only", () => {
    expect(EDIT_OP_SPECS.remove_background.buildBody("https://x/a.png", "")).toEqual({ image_url: "https://x/a.png" });
  });
  it("instruct_edit → image_url + prompt", () => {
    expect(EDIT_OP_SPECS.instruct_edit.buildBody("https://x/a.png", "make it blue")).toEqual({ image_url: "https://x/a.png", prompt: "make it blue" });
  });
  it("recombine → videos_list", () => {
    expect(EDIT_OP_SPECS.recombine.buildBody("https://x/v.mp4", "")).toEqual({ videos_list: ["https://x/v.mp4"] });
  });
});

describe("metadata", () => {
  it("ROUTE_OPS excludes variations (client-handled, never routed server-side)", () => {
    expect(ROUTE_OPS).not.toContain("variations" as EditOp);
    expect(ROUTE_OPS).toContain("instruct_edit" as EditOp);
  });
  it("OP_KIND tags every op with its source kind", () => {
    expect(OP_KIND.remove_background).toBe("image");
    expect(OP_KIND.add_captions).toBe("video");
  });
});
