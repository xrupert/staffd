import DepartmentRoom from "../../components/DepartmentRoom";

export default function SalesPage() {
  return (
    <DepartmentRoom
      department="sales"
      icon="🤝"
      title="Sales"
      tagline="Outreach, proposals, deal strategy, and pipeline — your AI sales team, always ready."
      placeholder="e.g. 'cold email to a small business owner' or 'proposal for a new consulting engagement'…"
    />
  );
}
