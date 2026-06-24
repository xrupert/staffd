/**
 * W95.8.1 — GenerationProgress is the prominent, animated "your specialist is
 * working" state that replaces the faded 2px-dot + grey-text loaders. Its
 * contract: a live status region, kind-appropriate copy, and the walk-away
 * affordance (you can keep working — the bell pings you when it's ready), since
 * the completion event (generation.ready → bell/push) is already wired.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import GenerationProgress from "../../app/components/GenerationProgress";

describe("GenerationProgress (W95.8.1)", () => {
  it("video: announces a working status with filming copy", () => {
    render(<GenerationProgress kind="video" />);
    expect(screen.getByRole("status").textContent ?? "").toMatch(/filming|video/i);
  });

  it("image: rendering copy", () => {
    render(<GenerationProgress kind="image" />);
    expect(screen.getByRole("status").textContent ?? "").toMatch(/rendering|image|designer/i);
  });

  it("tells the customer they can walk away — the bell will ping them", () => {
    render(<GenerationProgress kind="video" />);
    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toMatch(/keep working|come back|ping|when it's ready/i);
    expect(text).toMatch(/🔔|bell/i);
  });
});
