import DepartmentRoom from "../../components/DepartmentRoom";

export default function FinancePage() {
  return (
    <DepartmentRoom
      department="finance"
      icon="💰"
      title="Finance"
      tagline="Invoices, budgets, projections, and financial documents — your CFO on call."
      placeholder="e.g. 'invoice template for my consulting business' or '90-day revenue projection with assumptions'…"
    />
  );
}
