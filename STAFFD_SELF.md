---
business_name: "STAFFD"
industry: "Compound agentic business operating system — specialists organized as departments that owners direct, not operate"
description: "STAFFD staffs your business with specialists across Marketing, Sales, Legal, HR, Finance, Operations, Paid Media, Design, Reputation, and the CEO — on call the moment you hire them. The Vault compounds your business context so the work gets sharper over time."
target_audience: "SMB owners with roughly 1-10 employees — solopreneurs and small teams who need expert-level work across functions without expert-level headcount."
brand_voice: "Direct, confident, specific. You STAFF your business — it's a verb. You're the owner/employer; specialists are your employees on call; departments are your org chart; the CEO is your strategic advisor. You direct the work; specialists produce it."
brand_tone: "Like a sharp chief of staff giving a brief — no hedging, no 'we believe', no jargon. Specialists have names and roles, not 'capabilities'. The owner is the boss; talk to them like one."
brand_visuals: "LSU Purple #5B21E8 on near-black #09090F with steel grays. Logo is a 2x2 grid of blocks with a boxed D in the wordmark. Dark, premium, minimal."
messaging_pillars:
  - "You've been staffed — you direct a team of specialists, you don't operate software"
  - "SMBs deserve to compete — enterprise-grade capability without enterprise headcount or cost"
  - "The Vault is the moat — your business context compounds with every action, making your staff sharper over time"
  - "Compound execution, not a chatbot — specialists do real work end to end, they don't just answer questions"
hard_nos:
  - "Never leak vendor / backend names — the infrastructure is invisible to the customer"
  - "Never 'AI team', 'AI agents', 'bots', or 'modules' — we sell specialists and departments"
  - "Never 'subscribe' or 'upgrade' — you 'hire', 'staff up', 'add to payroll'"
  - "Never 'AI-powered', 'AI-generated', or 'output' — specialists 'write', 'draft', and 'produce work'"
customer_profile: "SMB owners running businesses with roughly 1-10 employees — solopreneurs and small teams who want a full org of specialists for less than the cost of one hire."
positioning: "The compound agentic business operating system for SMBs — a full organization of specialists you direct, with a Vault that compounds your context so every piece of work gets sharper over time."
service_area: "Global, online — delivered in-app as software."
average_ticket: "Starter $39/mo, Growth $79/mo, Pro $149/mo, Agency $450/mo; department add-on $29/mo; CEO add-on $49.99/mo."
lead_sources: "Demo-based selling, founder network, and inbound from the live product."
seasonality_capacity: "SaaS — no seasonality; capacity is software-elastic, specialists are always on call."
review_count: 0
review_rating: 0
review_platform: ""
---

# STAFFD Self-Knowledge (canonical Vault source)

This file is the **canonical, human-editable brand identity** for the STAFFD
operator account. The Vault loader injects this content as the operator's
Business Vault — overriding anything typed into the Settings → Business Vault
form for the super-admin account. Canonical source wins; the operator can't
drift STAFFD's own brand voice by editing a form.

> **SYNC CONTRACT (important):** the runtime loader
> (`apps/web/app/api/_lib/vault/staffd-self.ts`) does **not** read this file at
> runtime — an earlier fs-based version 500'd on Vercel serverless. Instead it
> embeds a **verbatim mirror** of the YAML frontmatter above as a string
> constant (`SELF_FRONTMATTER`) and parses that. **If you edit the frontmatter
> here, copy the same change into `staffd-self.ts`.** This file stays the
> ratifiable human source of truth; the constant is what ships.

**This file consolidates content that also lives in:**
- `BRAND_VOICE.md` — the full voice & vocabulary guide (word choices, tone,
  copy patterns). The `brand_voice`, `brand_tone`, and `hard_nos` keys above
  are the Vault-shaped distillation of it.
- `ARCHITECTURE.md` — the system/department model and product structure.

If any of the three drift, reconcile them. BRAND_VOICE.md governs copy;
ARCHITECTURE.md governs structure; this file is the machine-readable Vault
projection of both. Editing the YAML here changes what every STAFFD specialist
silently knows about STAFFD when the operator puts them to work.

## Notes

- `review_count`/`review_rating` are an honest zero until STAFFD has public
  reviews — do not invent social proof.
- Pricing in `average_ticket` mirrors the locked pricing model; update here if
  pricing changes (and reconcile with the pricing page + Stripe SKUs).
- Customers are unaffected by this file — their Vault is their own
  `businesses` row, exactly as before.
