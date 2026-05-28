/**
 * Department capability categories — defines the Option B tab navigation for DepartmentRoom.
 *
 * Each category communicates WHAT a department can do (user-facing capability),
 * not which underlying service powers it. Integration features are surfaced as
 * capability statements ("Send for e-signature") without naming the backing tool.
 */

export interface DeptCategory {
  id: string;
  label: string;
  tagline: string;
  capabilities: string[];
  /** Surfaced as purple "→" items — feature availability hints, no service names */
  integrationFeatures?: string[];
  /** Ordered — first agent is auto-selected when category is chosen */
  agentIds: string[];
}

export const DEPARTMENT_CATEGORIES: Record<string, DeptCategory[]> = {

  // ─── Marketing ───────────────────────────────────────────────────────────────
  marketing: [
    {
      id: "content",
      label: "Content",
      tagline: "Write content that builds authority and converts.",
      capabilities: [
        "Blog posts, case studies & newsletters",
        "Landing page & high-converting email copy",
        "LinkedIn articles & audience-building posts",
      ],
      integrationFeatures: ["Publish any piece directly as an email campaign"],
      agentIds: [
        "marketing-content-creator",
        "marketing-linkedin-creator",
        "marketing-email-marketer",
      ],
    },
    {
      id: "social",
      label: "Social Media",
      tagline: "Own every platform, every week.",
      capabilities: [
        "2-week content calendars & post packs",
        "Platform-specific captions, hooks & hashtag strategy",
        "Community playbooks & engagement scripts",
      ],
      agentIds: ["marketing-social-media-strategist"],
    },
    {
      id: "growth",
      label: "Growth & SEO",
      tagline: "Drive traffic, rank for what matters, grow fast.",
      capabilities: [
        "Keyword strategy, on-page audits & meta copy",
        "Referral programs, viral loops & CRO improvements",
        "Growth experiments & conversion funnel analysis",
      ],
      agentIds: ["marketing-seo-specialist", "marketing-growth-hacker"],
    },
  ],

  // ─── Sales ───────────────────────────────────────────────────────────────────
  sales: [
    {
      id: "outreach",
      label: "Outreach",
      tagline: "Get in front of the right people and start real conversations.",
      capabilities: [
        "Cold email sequences & LinkedIn DMs",
        "ICP definition & 30-day prospecting plans",
        "Buying signal strategies & channel mix",
      ],
      integrationFeatures: [
        "Book a discovery call without leaving the platform",
        "Add new contacts directly to your sales pipeline",
      ],
      agentIds: ["sales-outreach", "sales-outbound-strategist"],
    },
    {
      id: "proposals",
      label: "Proposals",
      tagline: "Win more with proposals that sell for you.",
      capabilities: [
        "Full proposals, scopes of work & executive summaries",
        "Pricing sections that frame value before cost",
        "Retainer agreements & client presentations",
      ],
      integrationFeatures: ["Send any proposal for e-signature without leaving the platform"],
      agentIds: ["sales-proposal-strategist"],
    },
    {
      id: "closing",
      label: "Closing",
      tagline: "Turn warm deals into signed clients.",
      capabilities: [
        "Objection handling scripts & negotiation prep",
        "Closing emails & deal-unsticking strategies",
        "Pipeline analysis & revenue forecasting",
      ],
      integrationFeatures: ["Add closed contacts directly to your CRM pipeline"],
      agentIds: [
        "sales-deal-strategist",
        "sales-discovery-coach",
        "sales-pipeline-analyst",
      ],
    },
  ],

  // ─── Legal ───────────────────────────────────────────────────────────────────
  legal: [
    {
      id: "contracts",
      label: "Contracts",
      tagline: "Legally sound documents drafted in minutes.",
      capabilities: [
        "Service agreements, NDAs & retainer contracts",
        "Contractor agreements & partnership documents",
        "Contract review, red flags & risk summaries",
      ],
      integrationFeatures: ["Send any contract for e-signature without leaving the platform"],
      agentIds: ["legal-document-drafter"],
    },
    {
      id: "compliance",
      label: "Policies & Compliance",
      tagline: "Stay protected with the right policies in place.",
      capabilities: [
        "Terms of Service, Privacy Policy & refund terms",
        "HR, employee & contractor policies",
        "Compliance audits & plain-English risk assessments",
      ],
      agentIds: ["legal-policy-writer", "legal-compliance-checker"],
    },
    {
      id: "intake",
      label: "Client Intake",
      tagline: "Onboard clients with confidence and clarity.",
      capabilities: [
        "Intake forms & pre-project discovery questionnaires",
        "New client onboarding checklists & welcome packets",
        "Engagement letters & scope confirmations",
      ],
      integrationFeatures: ["Collect signatures on all intake documents in a single step"],
      agentIds: ["legal-client-intake"],
    },
  ],

  // ─── HR ──────────────────────────────────────────────────────────────────────
  hr: [
    {
      id: "hiring",
      label: "Hiring",
      tagline: "Attract and select the right people — faster.",
      capabilities: [
        "Job postings, role scorecards & job descriptions",
        "Interview question banks & screening criteria",
        "Assessment rubrics & reference check guides",
      ],
      agentIds: ["hr-job-posting-writer", "hr-recruitment-specialist"],
    },
    {
      id: "team",
      label: "Team Development",
      tagline: "Build the systems that make your team great.",
      capabilities: [
        "New hire onboarding plans & first-week schedules",
        "30-60-90 day plans & goal-setting frameworks",
        "Performance reviews, feedback scripts & PIPs",
      ],
      agentIds: ["hr-onboarding-specialist", "hr-performance-coach"],
    },
  ],

  // ─── Finance ─────────────────────────────────────────────────────────────────
  finance: [
    {
      id: "billing",
      label: "Billing",
      tagline: "Get paid on time, every time.",
      capabilities: [
        "Professional invoices, payment terms & deposit requests",
        "Late payment notices & collections language",
        "Accounts payable processes & vendor payment schedules",
      ],
      integrationFeatures: ["Collect e-signatures on invoices and proposals in one step"],
      agentIds: ["finance-invoice-generator", "finance-accounts-payable"],
    },
    {
      id: "analysis",
      label: "Finance & Planning",
      tagline: "Understand your numbers and make smarter decisions.",
      capabilities: [
        "Revenue projections, P&L templates & cash flow snapshots",
        "Budget frameworks, unit economics & pricing analysis",
        "Tax strategy, deduction checklists & year-end prep",
      ],
      agentIds: [
        "finance-financial-analyst",
        "finance-bookkeeper",
        "finance-tax-strategist",
      ],
    },
  ],

  // ─── Operations ──────────────────────────────────────────────────────────────
  operations: [
    {
      id: "processes",
      label: "Processes & SOPs",
      tagline: "Document how your business works so it runs without you.",
      capabilities: [
        "Standard operating procedures & process audits",
        "Workflow maps, automation plans & tool stack reviews",
        "Delegation guides & quality control checklists",
      ],
      agentIds: ["operations-sop-writer", "operations-workflow-designer"],
    },
    {
      id: "projects",
      label: "Projects",
      tagline: "Deliver every project on time and on scope.",
      capabilities: [
        "Project plans with milestones, timelines & owners",
        "Project briefs & kickoff meeting agendas",
        "Status update templates & stakeholder reporting",
      ],
      agentIds: ["operations-project-manager"],
    },
    {
      id: "reporting",
      label: "Reporting",
      tagline: "Turn business data into clarity and decisions.",
      capabilities: [
        "KPI dashboards & metrics frameworks",
        "Monthly performance reports with narrative sections",
        "Executive summaries & business health snapshots",
      ],
      agentIds: [
        "operations-analytics-reporter",
        "operations-document-generator",
      ],
    },
  ],

  // ─── Design ──────────────────────────────────────────────────────────────────
  design: [
    {
      id: "brand",
      label: "Brand Identity",
      tagline: "Build a brand that is instantly recognisable.",
      capabilities: [
        "Brand guidelines, color palettes & typography rules",
        "Brand voice guide with on-brand vs off-brand examples",
        "Brand audits, consistency reviews & evolution plans",
      ],
      agentIds: ["design-brand-guardian", "design-visual-storyteller"],
    },
    {
      id: "creative",
      label: "Creative Direction",
      tagline: "Generate visual concepts that stop the scroll.",
      capabilities: [
        "AI image generation prompts for any format or platform",
        "Hero images, social visuals, product shots & brand photography",
        "Infographic concepts & data visualization direction",
      ],
      agentIds: ["design-image-prompt-engineer"],
    },
    {
      id: "product",
      label: "UI & UX",
      tagline: "Design products and pages people love to use.",
      capabilities: [
        "UI direction, design critique & specific improvements",
        "Component specs, pattern definitions & design tokens",
        "UX improvements, conversion analysis & usability wins",
      ],
      agentIds: ["design-ui-designer"],
    },
  ],

  // ─── Paid Media ──────────────────────────────────────────────────────────────
  "paid-media": [
    {
      id: "search",
      label: "Search Ads",
      tagline: "Show up when buyers are actively looking for you.",
      capabilities: [
        "Google Ads campaign structure & keyword plans",
        "Search ad headlines, descriptions & extensions",
        "Bidding strategies, budget allocation & Quality Score fixes",
      ],
      agentIds: ["paid-media-ppc-strategist"],
    },
    {
      id: "social-ads",
      label: "Social Ads",
      tagline: "Turn scrollers into buyers with precision targeting.",
      capabilities: [
        "Full-funnel Meta, TikTok & Instagram strategies",
        "Cold, warm & retargeting audience frameworks",
        "Campaign plans, budget splits & scaling playbooks",
      ],
      agentIds: ["paid-media-paid-social-strategist"],
    },
    {
      id: "creative-audit",
      label: "Creative & Audit",
      tagline: "Maximise what you are already spending.",
      capabilities: [
        "Ad creative strategies, hook variations & copy testing",
        "Ad copy with headline, body & CTA for any format",
        "Full account audits with prioritised quick wins",
      ],
      agentIds: ["paid-media-creative-strategist", "paid-media-auditor"],
    },
  ],

  // ─── CEO / Strategy ──────────────────────────────────────────────────────────
  ceo: [
    {
      id: "strategy",
      label: "Strategy",
      tagline: "See clearly, decide confidently, move fast.",
      capabilities: [
        "90-day growth plans & revenue strategies",
        "Market positioning & competitive differentiation",
        "Weekly briefs, priority audits & decision frameworks",
      ],
      agentIds: ["ceo-growth-strategist", "ceo-chief-of-staff"],
    },
    {
      id: "product",
      label: "Product",
      tagline: "Build the right things in the right order.",
      capabilities: [
        "Product roadmaps (Now / Next / Later) & backlogs",
        "Feature prioritisation, MVP definitions & OKRs",
        "User feedback synthesis & product insight reports",
      ],
      agentIds: ["ceo-product-manager"],
    },
    {
      id: "execution",
      label: "Full Team",
      tagline: "Coordinate your entire operation from one place.",
      capabilities: [
        "Cross-department launch plans & client acquisition systems",
        "Full business health checks across every team",
        "Hiring plans, escalation playbooks & team coordination",
      ],
      integrationFeatures: ["Includes your weekly AI-generated business briefing"],
      agentIds: ["ceo-agents-orchestrator"],
    },
  ],
};
