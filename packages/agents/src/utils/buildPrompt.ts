import type { VaultContext } from "../types";

const FOCUS_LABELS: Record<string, string> = {
  growth: "Top-line growth — finding leads, closing deals, driving revenue",
  time: "Time recovery — automating repetitive tasks and fixing broken workflows",
  cx: "Customer experience — retention, faster support, client satisfaction",
  intelligence: "Intelligence & scaling — data analysis, market research, strategic planning",
};

const SITUATION_LABELS: Record<string, string> = {
  solo: "Solo operator — doing everything themselves, out of hours",
  skills: "Small team missing key skills",
  scaling: "Growing faster than they can hire",
  cost: "Needs expert-level work without expert-level cost",
  chaos: "Broken processes — things keep slipping through the cracks",
  starting: "Just starting out — building everything from scratch",
};

const SUPERPOWER_LABELS: Record<string, string> = {
  speed: "Speed & efficiency — fastest in their space",
  quality: "Premium quality / expertise — high-end, bespoke solutions",
  value: "Cost-effectiveness — best value for the budget",
  relationships: "Deep relationships — unmatched customer service and personal touch",
};

const BOTTLENECK_LABELS: Record<string, string> = {
  content: "Content creation & marketing",
  leads: "Lead generation & outbound sales",
  support: "Customer support & account management",
  ops: "Data entry, invoicing & ops admin",
  research: "Market research & competitor analysis",
};

/**
 * Combines an agent's base system prompt with the user's vault context.
 * The vault is appended as a clearly delimited block so the agent can
 * silently internalize it without quoting or referencing it directly.
 */
export function buildPrompt(basePrompt: string, vault: VaultContext | null): string {
  if (!vault) return basePrompt;

  const lines: string[] = ["--- BUSINESS VAULT ---"];

  if (vault.business_name) lines.push(`Business name: ${vault.business_name}`);
  if (vault.industry) lines.push(`Industry / What they do: ${vault.industry}`);
  if (vault.description) lines.push(`Business description: ${vault.description}`);
  if (vault.target_audience) lines.push(`Target audience: ${vault.target_audience}`);
  if (vault.website) lines.push(`Website: ${vault.website}`);
  if (vault.address) lines.push(`Business address: ${vault.address}`);
  if (vault.phone) lines.push(`Phone: ${vault.phone}`);
  if (vault.primary_email) lines.push(`Primary email: ${vault.primary_email}`);
  if (vault.secondary_email) lines.push(`Secondary email: ${vault.secondary_email}`);
  if (vault.other_email) lines.push(`Other email: ${vault.other_email}`);

  if (vault.focus) {
    lines.push(`Primary focus: ${FOCUS_LABELS[vault.focus] ?? vault.focus}`);
  }
  if (vault.situation) {
    lines.push(`Current situation: ${SITUATION_LABELS[vault.situation] ?? vault.situation}`);
  }
  if (vault.superpower) {
    lines.push(`Competitive advantage: ${SUPERPOWER_LABELS[vault.superpower] ?? vault.superpower}`);
  }
  if (vault.bottlenecks?.length) {
    const bottleneckList = vault.bottlenecks
      .map((b) => BOTTLENECK_LABELS[b] ?? b)
      .join(", ");
    lines.push(`Key bottlenecks: ${bottleneckList}`);
  }
  if (vault.magic_wand) {
    lines.push(`What they most want off their plate: ${vault.magic_wand}`);
  }

  lines.push("--- END VAULT ---");

  return `${basePrompt}\n\n${lines.join("\n")}`;
}
