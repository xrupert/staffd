import AgentPage from "../../components/AgentPage";

const QUICK_ACTIONS = [
  { label: "Social post", prompt: "Write a social media post I can publish today." },
  { label: "Blog intro", prompt: "Write a compelling blog post introduction for my business." },
  { label: "Email to list", prompt: "Draft a short email to send to my customer list." },
  { label: "Headline ideas", prompt: "Give me 5 headline ideas for my homepage or next campaign." },
  { label: "Ad copy", prompt: "Write short ad copy — headline plus one punchy sentence — I can run as a paid ad." },
  { label: "Bio / About", prompt: "Write a punchy 3-sentence bio or About section for my business." },
];

export default function MarketingPage() {
  return (
    <AgentPage
      department="marketing"
      icon="📣"
      title="Marketing"
      tagline="Your AI marketer knows your business. Tell it what to create."
      agentName="The Marketer"
      quickActions={QUICK_ACTIONS}
      placeholder="What do you need today? — e.g. 'Instagram post about our new service' or 'email to re-engage lapsed customers'…"
    />
  );
}
