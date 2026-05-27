import AgentPage from "../../components/AgentPage";

const QUICK_ACTIONS = [
  { label: "Cold outreach", prompt: "Write a short, direct cold outreach email to a potential client." },
  { label: "Follow-up email", prompt: "Write a follow-up email to a prospect I haven't heard back from." },
  { label: "Proposal intro", prompt: "Write a compelling opening section for a proposal I'm sending." },
  { label: "Objection response", prompt: "Help me respond to a common sales objection I keep running into." },
  { label: "LinkedIn message", prompt: "Write a short LinkedIn outreach message to a decision-maker." },
  { label: "Closing email", prompt: "Write a closing email to push a deal over the line." },
];

export default function SalesPage() {
  return (
    <AgentPage
      department="sales"
      icon="🤝"
      title="Sales"
      tagline="Your AI closer writes the outreach, follow-ups, and proposals that win deals."
      agentName="The Closer"
      quickActions={QUICK_ACTIONS}
      placeholder="What do you need? — e.g. 'cold email to a small business owner about our bookkeeping service' or 'follow-up for a proposal sent 5 days ago'…"
    />
  );
}
