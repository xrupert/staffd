export interface QuickAction {
  label: string;
  prompt: string;
}

export const agentQuickActions: Record<string, QuickAction[]> = {
  // ── Marketing ──────────────────────────────────────────────────────────────
  "marketing-content-creator": [
    { label: "Blog post", prompt: "Write a compelling blog post for my business that builds authority and drives traffic." },
    { label: "Landing page", prompt: "Write a high-converting landing page for my main service or offer." },
    { label: "Email newsletter", prompt: "Write an engaging newsletter email to send to my list this week." },
    { label: "Case study", prompt: "Write a client case study that shows results and builds credibility." },
  ],
  "marketing-social-media-strategist": [
    { label: "Instagram caption", prompt: "Write an engaging Instagram caption with relevant hashtags for my business." },
    { label: "LinkedIn post", prompt: "Write a thought-leadership LinkedIn post for my business." },
    { label: "Content calendar", prompt: "Create a 2-week social media content calendar for my business." },
    { label: "Twitter thread", prompt: "Write a Twitter thread that provides value and grows my audience." },
  ],
  "marketing-seo-specialist": [
    { label: "Keyword strategy", prompt: "Give me a focused keyword strategy for my business website." },
    { label: "Meta tags", prompt: "Write optimized meta title and description for my homepage and top service pages." },
    { label: "SEO audit", prompt: "Audit my website's SEO and give me the top 5 highest-impact improvements." },
    { label: "Content gap", prompt: "Identify the content gaps I should fill to rank higher in my niche." },
  ],
  "marketing-growth-hacker": [
    { label: "Referral program", prompt: "Design a referral program I can launch in the next 2 weeks." },
    { label: "Growth audit", prompt: "Audit my growth funnel and identify the biggest leaks." },
    { label: "Viral loop", prompt: "Design a viral loop or sharing mechanism for my product or service." },
    { label: "CRO wins", prompt: "Give me the 5 highest-impact conversion rate improvements I can make today." },
  ],
  "marketing-linkedin-creator": [
    { label: "Thought leadership", prompt: "Write a thought-leadership LinkedIn post positioning me as an expert in my space." },
    { label: "Story post", prompt: "Write a personal story LinkedIn post that builds trust and connection." },
    { label: "Connection request", prompt: "Write a LinkedIn connection request message to a potential client." },
    { label: "Profile summary", prompt: "Write a compelling LinkedIn profile summary for me as a business owner." },
  ],
  "marketing-email-marketer": [
    { label: "Welcome sequence", prompt: "Write a 3-email welcome sequence for new subscribers to my list." },
    { label: "Promo email", prompt: "Write a promotional email for my main service or offer." },
    { label: "Re-engagement", prompt: "Write a re-engagement email to win back inactive subscribers." },
    { label: "Subject lines", prompt: "Write 10 high-open-rate subject lines I can test for my next campaign." },
  ],

  // ── Sales ──────────────────────────────────────────────────────────────────
  "sales-outreach": [
    { label: "Cold email", prompt: "Write a cold outreach email to a potential client — short, direct, gets a reply." },
    { label: "LinkedIn DM", prompt: "Write a LinkedIn direct message to a decision-maker at a company I want to work with." },
    { label: "Follow-up", prompt: "Write a follow-up email to a prospect I haven't heard from in 5 days." },
    { label: "Email sequence", prompt: "Write a 4-step cold outreach sequence for a new target account type." },
  ],
  "sales-outbound-strategist": [
    { label: "Define ICP", prompt: "Define my ideal customer profile with firmographic criteria, pain points, and where to find them." },
    { label: "Prospecting plan", prompt: "Build a 30-day outbound prospecting plan I can execute with my current resources." },
    { label: "Channel strategy", prompt: "Tell me which outbound channels I should focus on and how to sequence them." },
    { label: "Signal triggers", prompt: "Identify the buying signals I should be monitoring to trigger outreach." },
  ],
  "sales-proposal-strategist": [
    { label: "Full proposal", prompt: "Write a professional proposal for a new client engagement." },
    { label: "Scope of work", prompt: "Write a detailed scope of work for my main service offering." },
    { label: "Executive summary", prompt: "Write the executive summary section of a proposal I'm sending." },
    { label: "Pricing section", prompt: "Write a compelling pricing section that frames value before cost." },
  ],
  "sales-deal-strategist": [
    { label: "Handle objection", prompt: "Help me respond to the most common objection I face when closing deals." },
    { label: "Closing email", prompt: "Write a closing email to push a warm deal over the line." },
    { label: "Unstick a deal", prompt: "Help me strategize getting a deal unstuck — it's been quiet for 2 weeks." },
    { label: "Negotiation prep", prompt: "Help me prepare for a pricing negotiation without caving on my rate." },
  ],
  "sales-discovery-coach": [
    { label: "Discovery questions", prompt: "Write a discovery call question bank organized by phase." },
    { label: "Call framework", prompt: "Give me a discovery call framework with timing for a 30-minute call." },
    { label: "Meeting prep", prompt: "Give me a pre-meeting prep guide for an important discovery call." },
    { label: "Post-call follow-up", prompt: "Write a post-discovery call follow-up email that moves things forward." },
  ],
  "sales-pipeline-analyst": [
    { label: "Pipeline review", prompt: "Help me review my sales pipeline and identify where deals are stalling." },
    { label: "Revenue forecast", prompt: "Build a revenue forecast for the next 90 days based on my pipeline." },
    { label: "Win/loss analysis", prompt: "Help me analyze why I'm winning or losing deals and what to change." },
    { label: "Activity metrics", prompt: "Define the leading activity metrics I should be tracking for my pipeline." },
  ],

  // ── Legal ──────────────────────────────────────────────────────────────────
  "legal-document-drafter": [
    { label: "Service agreement", prompt: "Draft a service agreement for my main service offering." },
    { label: "NDA", prompt: "Draft a mutual NDA for a new business relationship or partnership." },
    { label: "Contractor contract", prompt: "Draft a contractor/freelancer agreement for someone I'm bringing on." },
    { label: "Retainer agreement", prompt: "Draft a retainer agreement for ongoing client work." },
  ],
  "legal-policy-writer": [
    { label: "Terms of Service", prompt: "Write Terms of Service for my business website." },
    { label: "Privacy Policy", prompt: "Write a Privacy Policy for my business website." },
    { label: "Refund Policy", prompt: "Write a clear refund and cancellation policy for my services." },
    { label: "HR policy", prompt: "Write an employee or contractor policy for my business." },
  ],
  "legal-compliance-checker": [
    { label: "Review a contract", prompt: "Review this contract and flag any risks, missing clauses, or red flags I should know about before signing." },
    { label: "Vendor agreement", prompt: "Review this vendor agreement and highlight the top 3 risks for my business." },
    { label: "Missing clauses", prompt: "Tell me what key clauses are missing from a typical service agreement for my industry." },
    { label: "Risk summary", prompt: "Give me a plain-English risk summary of an agreement I'm about to sign." },
  ],
  "legal-client-intake": [
    { label: "Intake form", prompt: "Design a client intake form for my main service that captures everything I need." },
    { label: "Onboarding checklist", prompt: "Create a new client onboarding checklist for my business." },
    { label: "Discovery questionnaire", prompt: "Write a pre-project discovery questionnaire to send to new clients." },
    { label: "Welcome packet", prompt: "Write a new client welcome document that sets expectations and builds confidence." },
  ],

  // ── HR ──────────────────────────────────────────────────────────────────
  "hr-job-posting-writer": [
    { label: "Job posting", prompt: "Write a compelling job posting for a role I'm currently hiring for." },
    { label: "Role scorecard", prompt: "Create a role scorecard for a position I'm hiring — outcomes, competencies, and what great looks like." },
    { label: "Job description", prompt: "Write a detailed job description I can use internally and post externally." },
    { label: "Benefits copy", prompt: "Write the benefits and perks section of a job posting that actually attracts great candidates." },
  ],
  "hr-recruitment-specialist": [
    { label: "Interview questions", prompt: "Write a behavioral interview question bank for a role I'm hiring for." },
    { label: "Screening criteria", prompt: "Give me a phone screen criteria checklist for filtering candidates fast." },
    { label: "Assessment rubric", prompt: "Create a candidate assessment rubric with clear scoring criteria." },
    { label: "Reference check guide", prompt: "Write a reference check guide with questions that reveal what resumes don't." },
  ],
  "hr-onboarding-specialist": [
    { label: "Onboarding checklist", prompt: "Create a new hire onboarding checklist for my business — pre-start through 30 days." },
    { label: "30-60-90 plan", prompt: "Write a 30-60-90 day onboarding plan for a new hire." },
    { label: "First week schedule", prompt: "Create a detailed first-week schedule for a new team member." },
    { label: "Welcome message", prompt: "Write a warm, professional welcome message for a new team member." },
  ],
  "hr-performance-coach": [
    { label: "Performance review", prompt: "Write a performance review template for my team." },
    { label: "Feedback script", prompt: "Write a constructive feedback script for a difficult performance conversation." },
    { label: "90-day goals", prompt: "Create a 90-day goal-setting framework for a new or existing team member." },
    { label: "PIP document", prompt: "Draft a performance improvement plan (PIP) for an underperforming team member." },
  ],

  // ── Finance ──────────────────────────────────────────────────────────────────
  "finance-invoice-generator": [
    { label: "Invoice template", prompt: "Create a professional invoice template for my business." },
    { label: "Payment terms", prompt: "Write clear payment terms language for my contracts and invoices." },
    { label: "Late payment notice", prompt: "Write a professional late payment notice for an overdue invoice." },
    { label: "Deposit request", prompt: "Write a deposit request letter for a new client project." },
  ],
  "finance-bookkeeper": [
    { label: "P&L template", prompt: "Create a P&L template for my business that I can use monthly." },
    { label: "Cash flow snapshot", prompt: "Build a cash flow snapshot template for my business type." },
    { label: "Expense categories", prompt: "Define the expense categories I should be tracking for my business." },
    { label: "Month-end checklist", prompt: "Create a month-end bookkeeping checklist for my business." },
  ],
  "finance-financial-analyst": [
    { label: "Revenue projection", prompt: "Build a 90-day revenue projection for my business with assumptions." },
    { label: "Pricing analysis", prompt: "Analyze my current pricing and tell me if I'm leaving money on the table." },
    { label: "Budget template", prompt: "Create an annual budget template for my business." },
    { label: "Unit economics", prompt: "Help me understand and calculate the unit economics of my business." },
  ],
  "finance-accounts-payable": [
    { label: "AP process", prompt: "Document a simple accounts payable process for my business." },
    { label: "Expense policy", prompt: "Write an expense approval and reimbursement policy for my team." },
    { label: "Vendor tracker", prompt: "Create a vendor payment tracker template with key fields." },
    { label: "Payment schedule", prompt: "Build a vendor payment schedule template I can update monthly." },
  ],
  "finance-tax-strategist": [
    { label: "Deduction checklist", prompt: "Give me a comprehensive tax deduction checklist for my business type." },
    { label: "Quarterly estimates", prompt: "Explain how to calculate my quarterly estimated tax payments and avoid penalties." },
    { label: "Year-end prep", prompt: "Give me a year-end tax prep checklist — what to do before December 31." },
    { label: "Structure advice", prompt: "Help me understand the tax implications of my current business structure." },
  ],

  // ── Operations ──────────────────────────────────────────────────────────────────
  "operations-sop-writer": [
    { label: "Write an SOP", prompt: "Write a standard operating procedure for a key repeatable process in my business." },
    { label: "Process audit", prompt: "Help me identify the top 3 processes in my business that need to be documented first." },
    { label: "Delegation SOP", prompt: "Write an SOP for a task I want to delegate to a team member or VA." },
    { label: "Quality checklist", prompt: "Create a quality control checklist for my main deliverable or service." },
  ],
  "operations-project-manager": [
    { label: "Project plan", prompt: "Build a project plan with milestones and timeline for an upcoming project." },
    { label: "Project brief", prompt: "Write a project brief I can share with my team or a new client." },
    { label: "Kickoff agenda", prompt: "Create a project kickoff meeting agenda for a new engagement." },
    { label: "Status update", prompt: "Write a project status update template for weekly team and client reporting." },
  ],
  "operations-workflow-designer": [
    { label: "Workflow map", prompt: "Map out a key business workflow and identify where time is being lost." },
    { label: "Automation plan", prompt: "Design an automation plan for my most repetitive business process." },
    { label: "Tool stack audit", prompt: "Audit my current tool stack for redundancy and gaps." },
    { label: "Efficiency audit", prompt: "Identify the top 3 operational inefficiencies in my business and how to fix them." },
  ],
  "operations-document-generator": [
    { label: "Executive summary", prompt: "Write an executive summary for a project, proposal, or business update." },
    { label: "Meeting minutes", prompt: "Create a meeting minutes template with action items, owners, and deadlines." },
    { label: "Team update", prompt: "Write a weekly team update covering what was done, what's next, and what's blocked." },
    { label: "Business report", prompt: "Write a business performance report covering key metrics and recommendations." },
  ],
  "operations-analytics-reporter": [
    { label: "KPI dashboard", prompt: "Design a KPI dashboard for my business with the metrics that actually matter." },
    { label: "Performance report", prompt: "Write a monthly business performance report template with narrative sections." },
    { label: "Metrics framework", prompt: "Define the metrics framework I should use to track my business health." },
    { label: "Data narrative", prompt: "Turn my business data into a clear narrative with findings and recommendations." },
  ],

  // ── Design ──────────────────────────────────────────────────────────────────
  "design-brand-guardian": [
    { label: "Brand guidelines", prompt: "Create brand guidelines for my business — visual identity, colors, typography, and voice." },
    { label: "Brand voice guide", prompt: "Define my brand voice and tone with examples of on-brand vs. off-brand language." },
    { label: "Brand audit", prompt: "Audit my current brand and identify the biggest consistency gaps." },
    { label: "Color palette", prompt: "Define my brand color palette with usage rules for primary, secondary, and accent colors." },
  ],
  "design-image-prompt-engineer": [
    { label: "Hero image prompt", prompt: "Write an AI image generation prompt for a hero image for my website or marketing." },
    { label: "Social visual prompt", prompt: "Write image prompts for a set of on-brand social media visuals." },
    { label: "Product image prompt", prompt: "Write an AI image prompt for a professional product or service visual." },
    { label: "Brand photo prompt", prompt: "Write image prompts for brand photography that fits my business style." },
  ],
  "design-ui-designer": [
    { label: "UI direction", prompt: "Give me a UI design direction for a key page or feature I'm building." },
    { label: "Design critique", prompt: "Critique my current UI design and give me specific, actionable improvements." },
    { label: "Component specs", prompt: "Write component specifications for a UI element I'm designing." },
    { label: "UX improvements", prompt: "Identify the top UX improvements for my website or product." },
  ],
  "design-visual-storyteller": [
    { label: "Infographic concept", prompt: "Design an infographic concept for a key message or data point in my business." },
    { label: "Presentation design", prompt: "Give me a visual design direction for a presentation I'm building." },
    { label: "Social visual concept", prompt: "Design a visual content concept for a social media campaign." },
    { label: "Data visualization", prompt: "Design a data visualization approach for a report or dashboard I'm building." },
  ],

  // ── Paid Media ──────────────────────────────────────────────────────────────────
  "paid-media-auditor": [
    { label: "Account audit", prompt: "Audit my paid media account and identify the biggest waste and opportunity." },
    { label: "Google Ads audit", prompt: "Audit my Google Ads account structure and performance." },
    { label: "Meta Ads audit", prompt: "Audit my Meta Ads account — structure, audiences, creative, and spend efficiency." },
    { label: "Quick wins", prompt: "Give me the 3 highest-impact changes I can make to my paid media accounts today." },
  ],
  "paid-media-creative-strategist": [
    { label: "Ad creative strategy", prompt: "Build a creative strategy for my next paid media campaign." },
    { label: "Hook writing", prompt: "Write 10 ad hook variations I can test for my product or service." },
    { label: "Ad copy", prompt: "Write 3 ad copy variations — headline, body, and CTA — for my main offer." },
    { label: "Creative brief", prompt: "Write a creative brief for a new ad campaign I'm launching." },
  ],
  "paid-media-ppc-strategist": [
    { label: "Keyword plan", prompt: "Build a keyword plan for a Google Ads campaign for my main service." },
    { label: "Campaign structure", prompt: "Design a Google Ads campaign structure for my business." },
    { label: "Ad copy", prompt: "Write Google Ads headlines and descriptions for my main offer." },
    { label: "Bidding strategy", prompt: "Recommend a bidding strategy for my Google Ads account based on my goals." },
  ],
  "paid-media-paid-social-strategist": [
    { label: "Full funnel strategy", prompt: "Build a full-funnel paid social strategy for my business." },
    { label: "Audience strategy", prompt: "Define my paid social audience strategy — cold, warm, and hot targeting." },
    { label: "Budget allocation", prompt: "Help me allocate my paid social budget across the funnel." },
    { label: "Campaign plan", prompt: "Build a campaign plan for a new Meta Ads campaign I'm launching." },
  ],

  // ── CEO ──────────────────────────────────────────────────────────────────
  "ceo-chief-of-staff": [
    { label: "Priority audit", prompt: "Audit my current priorities and tell me the top 3 things I should be focused on — and what I should stop doing." },
    { label: "Weekly brief", prompt: "Build my weekly brief — what matters most this week, what's at risk, what decisions I need to make." },
    { label: "Decision framework", prompt: "Help me think through a key business decision I'm facing." },
    { label: "Business health check", prompt: "Give me an honest assessment of where my business is strong and where it's fragile." },
  ],
  "ceo-growth-strategist": [
    { label: "90-day plan", prompt: "Build a focused 90-day growth plan for my business right now." },
    { label: "Revenue strategy", prompt: "Define my revenue strategy — who I sell to, what I sell them, and how I reach them." },
    { label: "Market positioning", prompt: "Help me sharpen my market positioning — where I compete and what I own." },
    { label: "Growth levers", prompt: "Identify the 2-3 highest-leverage growth levers in my business right now." },
  ],
  "ceo-product-manager": [
    { label: "Product roadmap", prompt: "Build a Now / Next / Later product roadmap for my business." },
    { label: "Feature prioritization", prompt: "Help me prioritize my product backlog using a clear framework." },
    { label: "MVP definition", prompt: "Help me define the MVP for a product or feature I'm building." },
    { label: "User feedback synthesis", prompt: "Help me synthesize customer feedback into product insights and priorities." },
  ],
  "ceo-agents-orchestrator": [
    { label: "Weekly business briefing", prompt: "Generate my weekly business briefing — synthesize what every department has been producing, what's working, what's stalling, and the 3 things that need my attention this week." },
    { label: "Full business health check", prompt: "Run a full business health check across all my unlocked departments. Reference real work from each. Tell me what's strong, what's fragile, and what to prioritize." },
    { label: "Product launch plan", prompt: "Coordinate a full product launch plan across Marketing, Sales, Legal, and Operations — based on what each department has already produced." },
    { label: "Client acquisition system", prompt: "Build a client acquisition system coordinating Marketing, Sales, and any other relevant departments — grounded in what they have already produced." },
  ],
  "ceo-sprint-prioritizer": [
    { label: "This week's priorities", prompt: "Force-rank what I should be focused on this week — based on what's actually moving and what's stalling across my departments." },
    { label: "Kill list", prompt: "Give me my kill list — what should I stop doing this quarter based on what is and isn't producing results." },
    { label: "2-week sprint", prompt: "Design a focused 2-week sprint for me with capacity-aware scope and a stop-doing list." },
    { label: "Decision criteria", prompt: "Build me a decision framework for how I should rank initiatives going forward." },
  ],
  "ceo-trend-researcher": [
    { label: "Industry trend scan", prompt: "Scan my industry for trends that matter to my business. Rank by relevance, time horizon, and business impact." },
    { label: "Weak signals", prompt: "Identify the weak signals in my industry I should be tracking — small now, could matter soon." },
    { label: "Scenario planning", prompt: "Build 3 scenarios (likely, upside, downside) for the next 12 months in my market — with implications for my business." },
    { label: "Start / watch / ignore", prompt: "Give me a list of what to start, what to watch, and what to ignore based on current industry trends." },
  ],
  "ceo-feedback-synthesizer": [
    { label: "Cross-source themes", prompt: "Synthesize the customer, team, and market feedback I have into 3-7 themes — ranked by source diversity and severity." },
    { label: "Contradictions", prompt: "Find the contradictions in my feedback — where different sources tell different stories — and why that matters." },
    { label: "Mind-changed brief", prompt: "Tell me what I should believe differently now compared to 3 months ago, based on the feedback I have." },
    { label: "Decision frameworks", prompt: "Help me build decision frameworks for which signals should drive which decisions." },
  ],
  "ceo-cultural-intelligence-strategist": [
    { label: "Market entry plan", prompt: "Build a market entry plan for a new geography or customer segment — covering fit, go-to-market mode, milestones, and risks." },
    { label: "Localization framework", prompt: "Design a localization framework for my brand, product, pricing, support, and marketing in a new market." },
    { label: "Cultural risk audit", prompt: "Audit the cultural assumptions I might be making that could derail my expansion plans." },
    { label: "Partnership vs direct", prompt: "Help me decide whether to enter a new market via partnership or direct, with clear criteria." },
  ],
};

/** Fallback quick actions if an agent has no specific config */
export const defaultQuickActions: QuickAction[] = [
  { label: "Get started", prompt: "Help me get started with a task in your area of expertise." },
];

export function getQuickActions(agentId: string): QuickAction[] {
  return agentQuickActions[agentId] ?? defaultQuickActions;
}
