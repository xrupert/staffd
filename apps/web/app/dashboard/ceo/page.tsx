import AgentPage from "../../components/AgentPage";

const QUICK_ACTIONS = [
  { label: "90-day plan", prompt: "Build me a focused 90-day growth plan for my business right now." },
  { label: "Priority audit", prompt: "Audit my business and tell me the top 3 things I should be focused on — and what I should stop doing." },
  { label: "Growth strategy", prompt: "What's the fastest, most realistic path to growing my revenue in the next quarter?" },
  { label: "Decision help", prompt: "Help me think through a key business decision I'm facing." },
  { label: "Health check", prompt: "Give me an honest assessment of where my business is strong and where it has real gaps." },
  { label: "Weekly brief", prompt: "What should I be focused on this week as the owner of this business?" },
];

export default function CEOPage() {
  return (
    <AgentPage
      department="ceo"
      icon="🎯"
      title="The CEO"
      eyebrow="Strategy"
      tagline="Cross-department strategic advisor. Cuts through noise, connects the dots, tells you what actually matters."
      agentName="The CEO"
      generatingWord="Thinking"
      quickActions={QUICK_ACTIONS}
      placeholder="Ask anything — e.g. 'What should I focus on this quarter?' or 'Help me decide between hiring vs. outsourcing right now'…"
    />
  );
}
