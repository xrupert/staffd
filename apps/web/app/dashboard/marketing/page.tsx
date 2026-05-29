import DepartmentRoom from "../../components/DepartmentRoom";

export default function MarketingPage() {
  return (
    <DepartmentRoom
      department="marketing"
      icon="📣"
      title="Marketing"
      tagline="Content, campaigns, SEO, and social — your marketing staff, on call."
      placeholder="e.g. 'Instagram post about our new service' or 'email re-engaging lapsed customers'…"
    />
  );
}
