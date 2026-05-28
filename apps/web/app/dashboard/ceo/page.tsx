import CEOBriefing from "../../components/CEOBriefing";
import DepartmentRoom from "../../components/DepartmentRoom";

export default function CEOPage() {
  return (
    <DepartmentRoom
      department="ceo"
      icon="🧭"
      title="The CEO"
      eyebrow="Strategy"
      tagline="Strategic advisors for growth, planning, decisions, and cross-department coordination."
      placeholder="e.g. 'What should I focus on this quarter?' or 'Build me a 90-day growth plan'…"
      headerSlot={<CEOBriefing />}
    />
  );
}
