import type { MissionDeliveryPackage as DeliveryPackage } from "../../api/_lib/orchestrator/mission-delivery";

type Props = {
  delivery: DeliveryPackage | null;
};

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#9A9AAF" }}>{title}</p>
      <ul className="mt-2 space-y-1 text-xs" style={{ color: "#D0D0E8" }}>
        {items.map((item) => <li key={item}>• {item}</li>)}
      </ul>
    </div>
  );
}

export default function MissionDeliveryPackage({ delivery }: Props) {
  if (!delivery) return null;

  return (
    <section className="mt-5 rounded-xl p-4" style={{ background: "rgba(91,33,232,.08)", border: "1px solid rgba(160,123,255,.28)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#A07BFF" }}>Delivery package</p>
          <p className="mt-2 text-sm font-semibold" style={{ color: "#F0F0F8" }}>{delivery.outcome}</p>
          {delivery.completedAt && (
            <p className="mt-1 text-xs" style={{ color: "#7A7A95" }}>
              Completed {new Date(delivery.completedAt).toLocaleString()}
            </p>
          )}
        </div>
        <span className="rounded-full px-2 py-1 text-xs" style={{ background: "#181824", color: "#C4B5FD" }}>
          {delivery.spentCredits}/{delivery.budgetCredits} credits used
        </span>
      </div>

      {delivery.artifacts.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#9A9AAF" }}>Delivered files and links</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {delivery.artifacts.map((artifact) => (
              <a
                key={artifact.href}
                href={artifact.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg px-3 py-2 text-xs font-medium"
                style={{ background: "#5B21E8", color: "white" }}
              >
                {artifact.label}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Section title="Evidence" items={delivery.evidence.slice(0, 6)} />
        <Section title="Actions taken" items={delivery.actionsTaken.slice(0, 6)} />
        <Section title="Approvals" items={delivery.approvals.slice(0, 4)} />
      </div>

      <div className="mt-4 rounded-lg p-3" style={{ background: "#15151F" }}>
        <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#9A9AAF" }}>Recommended next step</p>
        <p className="mt-1 text-xs" style={{ color: "#D0D0E8" }}>{delivery.nextAction}</p>
      </div>
    </section>
  );
}
