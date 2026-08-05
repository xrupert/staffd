"use client";

import type { MissionRecord } from "../../api/_lib/orchestrator/mission-repository";
import {
  missionParticipationCard,
  type MissionParticipationAction,
} from "../../api/_lib/orchestrator/mission-participation";

type Props = {
  mission: MissionRecord;
  disabled: boolean;
  onAction: (action: MissionParticipationAction) => void;
};

export default function MissionParticipationPanel({ mission, disabled, onAction }: Props) {
  const card = missionParticipationCard(mission);
  if (!card) return null;

  return (
    <section
      className="mt-5 rounded-xl p-4"
      style={{ background: "rgba(91,33,232,.08)", border: "1px solid rgba(160,123,255,.3)" }}
      aria-label={card.title}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#A07BFF" }}>
        {card.eyebrow}
      </p>
      <h3 className="mt-2 text-sm font-semibold" style={{ color: "#F0F0F8" }}>{card.title}</h3>
      <p className="mt-1 text-xs" style={{ color: "#B5B5C8" }}>{card.question}</p>

      <div className="mt-3 rounded-lg p-3" style={{ background: "rgba(17,17,24,.72)" }}>
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#8E8EA6" }}>
          What this decision covers
        </p>
        <ul className="mt-2 space-y-1 text-xs" style={{ color: "#D0D0E8" }}>
          {card.scope.map((item) => <li key={item}>• {item}</li>)}
        </ul>
      </div>

      <p className="mt-3 text-xs leading-relaxed" style={{ color: "#8E8EA6" }}>{card.consequence}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          disabled={disabled}
          onClick={() => onAction(card.primaryAction)}
          className="rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
          style={{ background: "#5B21E8", color: "white" }}
        >
          {card.primaryLabel}
        </button>
        <span className="text-xs" style={{ color: "#77778F" }}>{card.secondaryLabel}</span>
      </div>
    </section>
  );
}
