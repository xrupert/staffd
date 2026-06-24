import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import EditAffordances from "../../app/components/EditAffordances";

describe("EditAffordances", () => {
  it("single image: shows the image edit bar immediately", () => {
    const { container } = render(<EditAffordances kind="image" urls={["https://x/a.png"]} onEdit={() => {}} />);
    expect(container.textContent).toMatch(/Remove background/);
    expect(container.textContent).toMatch(/Variations/);
    expect(container.textContent).toMatch(/Refine/);
  });

  it("3-up grid: hides the bar until an option is selected, then targets it", () => {
    const onEdit = vi.fn();
    const { container, getAllByRole } = render(
      <EditAffordances kind="image" urls={["https://x/1.png", "https://x/2.png", "https://x/3.png"]} onEdit={onEdit} />,
    );
    expect(container.textContent).not.toMatch(/Remove background/);
    const cells = getAllByRole("button", { name: /option/i });
    fireEvent.click(cells[1]!);
    expect(container.textContent).toMatch(/Remove background/);
    fireEvent.click(getAllByRole("button", { name: /Remove background/i })[0]!);
    expect(onEdit).toHaveBeenCalledWith("remove_background", "remove the background", "https://x/2.png");
  });

  it("video: shows reorder / trim / captions", () => {
    const { container } = render(<EditAffordances kind="video" urls={["https://x/v.mp4"]} onEdit={() => {}} />);
    expect(container.textContent).toMatch(/Reorder/);
    expect(container.textContent).toMatch(/Trim/);
    expect(container.textContent).toMatch(/captions/i);
  });
});
