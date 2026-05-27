import AgentPage from "../../components/AgentPage";

const QUICK_ACTIONS = [
  { label: "SOP template", prompt: "Create a standard operating procedure (SOP) for a key process in my business." },
  { label: "Workflow outline", prompt: "Map out a step-by-step workflow for a process I need to document." },
  { label: "Meeting agenda", prompt: "Write a structured agenda for an upcoming team or client meeting." },
  { label: "Project brief", prompt: "Draft a clear project brief for a new initiative I'm kicking off." },
  { label: "Process checklist", prompt: "Create a repeatable checklist for a process my team runs regularly." },
  { label: "Team update", prompt: "Write a clear, concise team status update for the week." },
];

export default function OperationsPage() {
  return (
    <AgentPage
      department="operations"
      icon="⚙️"
      title="Operations"
      tagline="Your AI operator builds the processes, SOPs, and workflows that keep your business running."
      agentName="The Operator"
      quickActions={QUICK_ACTIONS}
      placeholder="What do you need? — e.g. 'SOP for client onboarding' or 'weekly team meeting agenda'…"
    />
  );
}
