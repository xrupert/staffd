import AgentPage from "../../components/AgentPage";

const QUICK_ACTIONS = [
  { label: "Invoice template", prompt: "Create a professional invoice template for my business." },
  { label: "Payment terms", prompt: "Write clear payment terms I can add to my invoices and contracts." },
  { label: "Late payment notice", prompt: "Write a firm but professional notice for a client with an overdue invoice." },
  { label: "Budget breakdown", prompt: "Help me create a simple monthly budget breakdown for my business." },
  { label: "Expense policy", prompt: "Write a short expense policy for my team or contractors." },
  { label: "Financial summary", prompt: "Write a simple financial summary template I can fill in each month." },
];

export default function FinancePage() {
  return (
    <AgentPage
      department="finance"
      icon="💰"
      title="Finance"
      tagline="Your AI CFO handles invoicing, budgets, and financial documents."
      agentName="The CFO"
      quickActions={QUICK_ACTIONS}
      placeholder="What do you need? — e.g. 'invoice template for a service business' or 'monthly budget for a 3-person team'…"
    />
  );
}
