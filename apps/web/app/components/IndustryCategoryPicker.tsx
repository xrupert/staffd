"use client";

/**
 * IndustryCategoryPicker (W59) — shared chip-grid picker for the 9
 * industry categories. Used by onboarding step 1 and the settings
 * "Your industry support" panel. Labels are SA-locked (Decision 7) and
 * live in lib/industry-categories.ts.
 *
 * Chip-grid (not a dropdown) matches the selection idiom of onboarding
 * steps 2–5. "Other / None of the above" is always selectable — the
 * picker is required but never a dead-end.
 */

import { INDUSTRY_CATEGORIES, type IndustryCategoryId } from "../../lib/industry-categories";

type Props = {
  value: IndustryCategoryId | "";
  onChange: (id: IndustryCategoryId) => void;
  /** Tighter spacing for the inline settings form. */
  compact?: boolean;
};

export default function IndustryCategoryPicker({ value, onChange, compact }: Props) {
  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-3 ${compact ? "gap-2" : "gap-2.5"}`}
      role="radiogroup"
      aria-label="What kind of business do you run?"
    >
      {INDUSTRY_CATEGORIES.map((cat) => {
        const selected = value === cat.id;
        return (
          <button
            key={cat.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(cat.id)}
            className={`text-left rounded-xl transition-all ${compact ? "px-3 py-2" : "px-4 py-3"}`}
            style={{
              background: selected ? "rgba(91,33,232,0.12)" : "#111118",
              border: `1px solid ${selected ? "#5B21E8" : "#2A2A38"}`,
              color: selected ? "#F0F0F8" : "#9090A8",
              fontSize: compact ? "12px" : "13px",
              fontWeight: selected ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {cat.label}
          </button>
        );
      })}
    </div>
  );
}
