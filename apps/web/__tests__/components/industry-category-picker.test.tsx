/**
 * W59 Test 2 — IndustryCategoryPicker component.
 * 9 options in SA-locked order, "Other" selectable, controlled selection.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import IndustryCategoryPicker from "../../app/components/IndustryCategoryPicker";
import { INDUSTRY_CATEGORIES } from "../../lib/industry-categories";

void React;

afterEach(cleanup);

describe("IndustryCategoryPicker (W59)", () => {
  it("renders all 9 categories in locked order, Other last", () => {
    const { getAllByRole } = render(<IndustryCategoryPicker value="" onChange={() => {}} />);
    const chips = getAllByRole("radio");
    expect(chips).toHaveLength(9);
    expect(chips.map((c) => c.textContent)).toEqual(INDUSTRY_CATEGORIES.map((c) => c.label));
    expect(chips[8]!.textContent).toBe("Other / None of the above");
  });

  it("fires onChange with the category id; selection state is controlled", () => {
    const onChange = vi.fn();
    const { getByText, rerender, getAllByRole } = render(
      <IndustryCategoryPicker value="" onChange={onChange} />
    );
    fireEvent.click(getByText("Restaurants & Food Service"));
    expect(onChange).toHaveBeenCalledWith("restaurants");

    rerender(<IndustryCategoryPicker value="restaurants" onChange={onChange} />);
    const selected = getAllByRole("radio").filter((c) => c.getAttribute("aria-checked") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toBe("Restaurants & Food Service");
  });

  it("'Other' is selectable — never a dead-end", () => {
    const onChange = vi.fn();
    const { getByText } = render(<IndustryCategoryPicker value="" onChange={onChange} />);
    fireEvent.click(getByText("Other / None of the above"));
    expect(onChange).toHaveBeenCalledWith("other");
  });
});
