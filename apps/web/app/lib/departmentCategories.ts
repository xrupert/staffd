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
      label: "Content & Authority",
      tagline: "Write content that builds authority and converts.",
      capabilities: [
        "Blog posts, case studies, newsletters & landing pages",
        "LinkedIn articles, podcasts & long-form thought leadership",
        "Book outlines and ghostwritten chapters",
      ],
      integrationFeatures: ["Publish any piece directly as an email campaign"],
      agentIds: [
        "marketing-content-creator",
        "marketing-linkedin-creator",
        "marketing-email-marketer",
        "marketing-podcast-strategist",
        "marketing-book-co-author",
      ],
    },
    {
      id: "social",
      label: "Social Media & Video",
      tagline: "Own every platform, every week.",
      capabilities: [
        "Instagram, TikTok, X, Reels & Shorts strategy",
        "Carousels engineered for saves and shares",
        "Video optimization for YouTube and YouTube Shorts",
      ],
      agentIds: [
        "marketing-social-media-strategist",
        "marketing-instagram-curator",
        "marketing-tiktok-strategist",
        "marketing-twitter-engager",
        "marketing-carousel-growth-engine",
        "marketing-video-optimization-specialist",
      ],
    },
    {
      id: "growth",
      label: "Growth, SEO & AI Search",
      tagline: "Drive traffic, rank for what matters, get cited by AI.",
      capabilities: [
        "Keyword strategy, on-page audits, referrals & viral loops",
        "AI search visibility (Perplexity, ChatGPT, Google AI Overviews)",
        "App store optimization for mobile apps",
      ],
      agentIds: [
        "marketing-seo-specialist",
        "marketing-growth-hacker",
        "marketing-agentic-search-optimizer",
        "marketing-ai-citation-strategist",
        "marketing-app-store-optimizer",
      ],
    },
  ],

  // ─── Sales ───────────────────────────────────────────────────────────────────
  sales: [
    {
      id: "outreach",
      label: "Outreach & Research",
      tagline: "Get in front of the right people and start real conversations.",
      capabilities: [
        "Cold email sequences, LinkedIn DMs & buying-signal plays",
        "ICP definition, 30-day prospecting plans, channel mix",
        "Prospect research and account intelligence briefs",
      ],
      integrationFeatures: [
        "Book a discovery call without leaving the platform",
        "Add new contacts directly to your sales pipeline",
      ],
      agentIds: [
        "sales-outreach",
        "sales-outbound-strategist",
        "sales-research-agent",
      ],
    },
    {
      id: "proposals",
      label: "Proposals & Demos",
      tagline: "Win more with proposals that sell for you.",
      capabilities: [
        "Full proposals, scopes of work, retainer agreements",
        "Pricing sections that frame value before cost",
        "Technical demos, RFP responses & POC plans",
      ],
      integrationFeatures: ["Send any proposal for e-signature without leaving the platform"],
      agentIds: ["sales-proposal-strategist", "sales-engineer"],
    },
    {
      id: "closing",
      label: "Closing & Accounts",
      tagline: "Turn warm deals into signed clients and grow them.",
      capabilities: [
        "Objection handling, negotiation prep & closing emails",
        "Pipeline analysis, forecasting & deal-unsticking",
        "Account expansion plans, QBRs & sales coaching",
      ],
      integrationFeatures: ["Add closed contacts directly to your CRM pipeline"],
      agentIds: [
        "sales-deal-strategist",
        "sales-discovery-coach",
        "sales-pipeline-analyst",
        "sales-account-strategist",
        "sales-coach",
      ],
    },
  ],

  // ─── Legal ───────────────────────────────────────────────────────────────────
  legal: [
    {
      id: "contracts",
      label: "Contracts & Review",
      tagline: "Legally sound documents drafted — and reviewed — in minutes.",
      capabilities: [
        "Service agreements, NDAs, retainers & contractor docs",
        "Contract review for red flags, missing protections, risks",
        "Plain-English summaries of any legal document",
      ],
      integrationFeatures: ["Send any contract for e-signature without leaving the platform"],
      agentIds: ["legal-document-drafter", "legal-document-reviewer"],
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
      label: "Client Intake & Billing",
      tagline: "Onboard clients and get paid with confidence.",
      capabilities: [
        "Intake forms, engagement letters & scope confirmations",
        "Time-tracking workflows & billable-hour audits",
        "Invoice templates and billing dispute responses",
      ],
      integrationFeatures: ["Collect signatures on all intake documents in a single step"],
      agentIds: ["legal-client-intake", "legal-billing-time-tracker"],
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
      label: "Billing & Bookkeeping",
      tagline: "Get paid on time, every time.",
      capabilities: [
        "Professional invoices, payment terms & deposit requests",
        "Late payment notices & collections language",
        "Bookkeeping workflows & accounts payable processes",
      ],
      integrationFeatures: ["Collect e-signatures on invoices and proposals in one step"],
      agentIds: ["finance-invoice-generator", "finance-accounts-payable", "finance-bookkeeper"],
    },
    {
      id: "analysis",
      label: "Planning & Forecasting",
      tagline: "Understand your numbers and make smarter decisions.",
      capabilities: [
        "Revenue projections, P&L templates & cash flow snapshots",
        "Forecasts, scenario models & variance analysis",
        "Tax strategy and unit economics breakdowns",
      ],
      agentIds: [
        "finance-financial-analyst",
        "finance-fpa-analyst",
        "finance-tax-strategist",
      ],
    },
    {
      id: "capital",
      label: "Capital Strategy",
      tagline: "Decide where the money goes with confidence.",
      capabilities: [
        "Industry benchmarks and competitor financial analysis",
        "Capital allocation frameworks and investment theses",
        "M&A target evaluation and integration risk checks",
      ],
      agentIds: ["finance-investment-researcher"],
    },
  ],

  // ─── Operations ──────────────────────────────────────────────────────────────
  operations: [
    {
      id: "processes",
      label: "Processes & Automation",
      tagline: "Document how your business works so it runs without you.",
      capabilities: [
        "SOPs, workflow maps, automation plans & tool stack reviews",
        "Supply chain, procurement and vendor frameworks",
        "Automation governance and ROI calculations",
      ],
      agentIds: [
        "operations-sop-writer",
        "operations-workflow-designer",
        "operations-supply-chain-strategist",
        "operations-automation-architect",
      ],
    },
    {
      id: "projects",
      label: "Projects & Coordination",
      tagline: "Deliver every project on time and on scope.",
      capabilities: [
        "Project plans, briefs and kickoff agendas",
        "Cross-functional dependency tracking & unblocking",
        "Creative production scheduling and review cycles",
      ],
      agentIds: [
        "operations-project-manager",
        "operations-project-shepherd",
        "operations-studio-producer",
      ],
    },
    {
      id: "reporting",
      label: "Reporting & Insights",
      tagline: "Turn business data into clarity and decisions.",
      capabilities: [
        "KPI dashboards, metrics frameworks & monthly reports",
        "Stakeholder reporting plans, automated distribution",
        "Executive summaries & TL;DRs from anything long",
      ],
      agentIds: [
        "operations-analytics-reporter",
        "operations-document-generator",
        "operations-data-consolidator",
        "operations-report-distributor",
        "operations-executive-summary-generator",
      ],
    },
  ],

  // ─── Design ──────────────────────────────────────────────────────────────────
  design: [
    {
      id: "brand",
      label: "Brand & Visuals",
      tagline: "Build a brand that is instantly recognisable.",
      capabilities: [
        "Brand guidelines, color palettes & typography rules",
        "Image prompts that produce social, hero, and product visuals",
        "Visual storytelling, inclusive imagery direction",
      ],
      integrationFeatures: ["Generate real images on demand without leaving the platform"],
      agentIds: [
        "design-brand-guardian",
        "design-visual-storyteller",
        "design-image-prompt-engineer",
        "design-inclusive-visuals-specialist",
      ],
    },
    {
      id: "product",
      label: "UI & UX",
      tagline: "Design products and pages people love to use.",
      capabilities: [
        "UI direction, component specs and design tokens",
        "Information architecture, sitemaps and user flows",
        "User research plans and finding synthesis",
      ],
      agentIds: [
        "design-ui-designer",
        "design-ux-architect",
        "design-ux-researcher",
      ],
    },
    {
      id: "delight",
      label: "Delight & Detail",
      tagline: "Add the moments that make a product feel alive.",
      capabilities: [
        "Microcopy, empty states and 404 personalities",
        "Micro-interactions, milestone moments, easter eggs",
        "Brand-rooted whimsy that doesn't break the work",
      ],
      agentIds: ["design-whimsy-injector"],
    },
  ],

  // ─── Paid Media ──────────────────────────────────────────────────────────────
  "paid-media": [
    {
      id: "campaigns",
      label: "Campaigns",
      tagline: "Show up when buyers are looking, and stop scrollers when they're not.",
      capabilities: [
        "Google Ads structure, keyword plans & search ad copy",
        "Meta, TikTok & Instagram full-funnel strategies",
        "Programmatic display, CTV & OOH playbooks",
      ],
      agentIds: [
        "paid-media-ppc-strategist",
        "paid-media-paid-social-strategist",
        "paid-media-programmatic-buyer",
      ],
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
    {
      id: "measurement",
      label: "Measurement",
      tagline: "Track every dollar, optimize every query.",
      capabilities: [
        "Search term reports and negative keyword strategy",
        "Conversion tracking, GA4 and GTM architecture",
        "Server-side tagging and attribution model design",
      ],
      agentIds: [
        "paid-media-search-query-analyst",
        "paid-media-tracking-specialist",
      ],
    },
  ],

  // ─── Reputation ──────────────────────────────────────────────────────────────
  reputation: [
    {
      id: "support",
      label: "Customer Support",
      tagline: "Resolve issues fast and protect every customer relationship.",
      capabilities: [
        "Email & chat replies for complaints, refunds and billing",
        "Tone-matched de-escalation for tense conversations",
        "Escalation flags and internal notes for your team",
      ],
      integrationFeatures: ["Reply directly from your shared inbox without leaving the platform"],
      agentIds: ["reputation-customer-service-responder"],
    },
    {
      id: "reviews",
      label: "Reviews & Listings",
      tagline: "Turn every review — good or bad — into a marketing asset.",
      capabilities: [
        "On-brand responses to Google, Yelp & Trustpilot reviews",
        "Review acquisition campaigns and post-purchase sequences",
        "Reputation audits and 30-day improvement plans",
      ],
      agentIds: ["reputation-review-responder", "reputation-reputation-manager"],
    },
    {
      id: "community",
      label: "Community & Insights",
      tagline: "Engage your community and turn feedback into decisions.",
      capabilities: [
        "Comment & DM responses across all social platforms",
        "Community playbooks for positive, negative and sensitive moments",
        "Feedback synthesis into themes, root causes and prioritized fixes",
      ],
      agentIds: ["reputation-community-manager", "reputation-feedback-analyst"],
    },
  ],

  // ─── CEO / Strategy ──────────────────────────────────────────────────────────
  ceo: [
    {
      id: "strategy",
      label: "Strategy & Foresight",
      tagline: "See clearly, decide confidently, move fast.",
      capabilities: [
        "90-day growth plans, revenue strategies & decision frameworks",
        "Industry trend scans and weak-signal detection",
        "Market expansion strategy and cultural intelligence",
      ],
      agentIds: [
        "ceo-growth-strategist",
        "ceo-chief-of-staff",
        "ceo-trend-researcher",
        "ceo-cultural-intelligence-strategist",
      ],
    },
    {
      id: "product",
      label: "Product & Priorities",
      tagline: "Build the right things in the right order.",
      capabilities: [
        "Product roadmaps (Now / Next / Later) & feature prioritisation",
        "Sprint planning and ruthless force-ranking",
        "Customer and team feedback synthesis",
      ],
      agentIds: [
        "ceo-product-manager",
        "ceo-sprint-prioritizer",
        "ceo-feedback-synthesizer",
      ],
    },
    {
      id: "execution",
      label: "Full Team",
      tagline: "Coordinate your entire operation from one place.",
      capabilities: [
        "Cross-department launch plans & client acquisition systems",
        "Full business health checks across every team",
        "Weekly AI-generated business briefings",
      ],
      integrationFeatures: ["Includes your weekly AI-generated business briefing"],
      agentIds: ["ceo-agents-orchestrator"],
    },
  ],
};
