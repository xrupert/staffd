import AgentPage from "../../components/AgentPage";

const QUICK_ACTIONS = [
  { label: "Job posting", prompt: "Write a compelling job posting for a role I need to fill." },
  { label: "Interview questions", prompt: "Give me 8 strong interview questions for a candidate I'm meeting with." },
  { label: "Offer letter", prompt: "Draft a professional offer letter for a new hire." },
  { label: "Onboarding checklist", prompt: "Create a first-week onboarding checklist for a new team member." },
  { label: "Performance review", prompt: "Write a structured performance review framework for my team." },
  { label: "HR policy", prompt: "Draft a clear, fair workplace policy I can add to my employee handbook." },
];

export default function HRPage() {
  return (
    <AgentPage
      department="hr"
      icon="👥"
      title="HR"
      tagline="Your AI people lead handles hiring, onboarding, and team communications."
      agentName="The People Lead"
      quickActions={QUICK_ACTIONS}
      placeholder="What do you need? — e.g. 'job posting for a part-time bookkeeper' or 'onboarding plan for a remote hire'…"
    />
  );
}
