"use client";

export type ExecutiveRecommendation = {
  id: string;
  missionId: string;
  priority: "critical" | "high" | "normal";
  title: string;
  reason: string;
  actionLabel: string;
  actionHref: string;
  evidence: string[];
};

type Props = {
  recommendation: ExecutiveRecommendation;
};

const PRIORITY_COPY: Record<ExecutiveRecommendation["priority"], string> = {
  critical: "Needs attention now",
  high: "Recommended next",
  normal: "Worth reviewing",
};

export default function ExecutiveAttentionCard({ recommendation }: Props) {
  return (
    <section
      className="mb-4 rounded-xl px-4 py-4"
      style={{
        background:
          recommendation.priority === "critical"
            ? "rgba(220,38,38,0.08)"
            : "rgba(91,33,232,0.09)",
        border:
          recommendation.priority === "critical"
            ? "1px solid rgba(239,68,68,0.25)"
            : "1px solid rgba(139,104,242,0.28)",
      }}
      aria-label="Executive recommendation"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: recommendation.priority === "critical" ? "#F59E9E" : "#A98CFF" }}
          >
            {PRIORITY_COPY[recommendation.priority]}
          </p>
          <h3 className="mt-1 text-sm font-semibold" style={{ color: "#F0F0F8" }}>
            {recommendation.title}
          </h3>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "#8B8BA2" }}>
            {recommendation.reason}
          </p>
        </div>

        <a
          href={recommendation.actionHref}
          className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold"
          style={{
            background: "rgba(91,33,232,0.18)",
            border: "1px solid rgba(139,104,242,0.35)",
            color: "#C4B5FD",
            textDecoration: "none",
          }}
        >
          {recommendation.actionLabel} →
        </a>
      </div>

      {recommendation.evidence.length > 0 && (
        <div className="mt-3 rounded-lg px-3 py-2" style={{ background: "rgba(9,9,15,0.42)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#5F5F78" }}>
            Why STAFFD is recommending this
          </p>
          <ul className="mt-1.5 space-y-1">
            {recommendation.evidence.slice(0, 3).map((item) => (
              <li key={item} className="text-[11px] leading-relaxed" style={{ color: "#77778F" }}>
                • {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
