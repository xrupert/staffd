import DepartmentRoom from "../../components/DepartmentRoom";

export default function LegalPage() {
  return (
    <DepartmentRoom
      department="legal"
      icon="⚖️"
      title="Legal"
      tagline="Contracts, policies, compliance checks — professional legal documents without the billable hours."
      placeholder="e.g. 'service agreement for my consulting business' or 'NDA for a new partnership'…"
    />
  );
}
