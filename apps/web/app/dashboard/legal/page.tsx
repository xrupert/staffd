import AgentPage from "../../components/AgentPage";

const QUICK_ACTIONS = [
  { label: "Service agreement", prompt: "Draft a professional service agreement for my business." },
  { label: "NDA", prompt: "Draft a non-disclosure agreement I can use with contractors or partners." },
  { label: "Website terms", prompt: "Write terms and conditions for my business website." },
  { label: "Privacy policy", prompt: "Draft a privacy policy for my website and customer data." },
  { label: "Contractor contract", prompt: "Write a contract for a contractor or freelancer working for me." },
  { label: "Payment clause", prompt: "Write clear payment terms and late payment clauses I can add to my contracts." },
];

export default function LegalPage() {
  return (
    <AgentPage
      department="legal"
      icon="⚖️"
      title="Legal"
      tagline="Your AI counsel drafts contracts, policies, and agreements in plain language."
      agentName="The Counsel"
      quickActions={QUICK_ACTIONS}
      placeholder="What do you need? — e.g. 'service agreement for a web design project' or 'NDA for a new business partner'…"
    />
  );
}
