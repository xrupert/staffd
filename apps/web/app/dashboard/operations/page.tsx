import DepartmentRoom from "../../components/DepartmentRoom";

export default function OperationsPage() {
  return (
    <DepartmentRoom
      department="operations"
      icon="⚙️"
      title="Operations"
      tagline="SOPs, workflows, projects, and reporting — the systems that let your business run without you."
      placeholder="e.g. 'SOP for client onboarding' or 'project plan for a website launch'…"
    />
  );
}
