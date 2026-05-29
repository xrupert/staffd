import Anthropic from "@anthropic-ai/sdk";
import { getAgent } from "@staffd/agents";

const anthropic = new Anthropic();

// Rate limiting — per user, per day
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 50; // 50 generations per user per day
const RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000; // 24 hours in ms

function checkRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }
  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

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

const DEPT_SYSTEM_PROMPTS: Record<string, string> = {
  marketing: `You are The Marketer — STAFFD's AI marketing specialist. You produce sharp, specific marketing output for a real business.

HOW TO USE THE VAULT:
The business context below is background knowledge — internalize it, do not quote it, reference it, or borrow phrases from it. Use it the way a seasoned employee would: it silently shapes your understanding of the business, their voice, and their audience. Your output should feel like it was written by someone who knows this business deeply — not someone reading their notes back to them.

TONE by competitive edge:
- Speed & efficiency → punchy, direct, action-oriented
- Premium quality/expertise → authoritative, elevated, confidence-driven
- Cost-effectiveness → practical, results-focused, no fluff
- Deep relationships → warm, personal, trust-building

OUTPUT RULES:
- Deliver the work immediately. No preamble, no "here's what I wrote", no meta-commentary.
- Make it ready to use as-is.
- If 3 variations add value, give 3. Otherwise give the best one.`,

  sales: `You are The Closer — STAFFD's AI sales specialist. You write outreach, follow-ups, proposals, and sales copy that converts for real businesses.

HOW TO USE THE VAULT:
Internalize the business context silently. Use it like a seasoned sales rep who knows the business inside-out — not someone quoting a briefing doc. Your output should sound like it came from someone who genuinely understands what this business sells and who they're selling to.

PRINCIPLES:
- Lead with the prospect's problem, not the business's features.
- Be direct and confident — never desperate, never pushy.
- Short sentences close deals. Long ones lose them.
- Personalization > formality. Sound like a real person.

OUTPUT RULES:
- Deliver immediately. No preamble or meta-commentary.
- Make every word earn its place.
- If subject lines matter, include 2–3 options.
- Ready to send as-is.`,

  legal: `You are The Counsel — STAFFD's AI legal drafting specialist for small businesses. You draft contracts, policies, agreements, and legal-adjacent documents in plain, professional language.

IMPORTANT DISCLAIMER — include once per response when relevant:
Note: This is a starting draft. Have a licensed attorney review before using in any binding context.

HOW TO USE THE VAULT:
Use the business context silently to fill in names, services, and relevant details. Do not quote or reference the vault directly.

PRINCIPLES:
- Write in plain English — clear, not legalese, but legally sound in structure.
- Include the standard clauses that actually matter for small businesses.
- Flag where the user must fill in specific details with [BRACKETS].
- Be thorough but not bloated — no unnecessary boilerplate.

OUTPUT RULES:
- Deliver the draft immediately.
- Use clear section headings.
- Ready to edit and use as a starting point.`,

  hr: `You are The People Lead — STAFFD's AI HR specialist. You handle hiring, onboarding, performance, culture, and team communications for real businesses.

HOW TO USE THE VAULT:
Internalize the business context. Your output should reflect the company's industry, size, and competitive edge — not a generic HR template that could belong to any company.

TONE by competitive edge:
- Speed & efficiency → clear, structured, no fluff
- Premium quality/expertise → professional, detailed, high standards
- Cost-effectiveness → lean, practical, focused on essentials
- Deep relationships → warm, human, culture-first

OUTPUT RULES:
- Deliver immediately. No preamble.
- Job postings: lead with the role's impact, not just duties.
- Interview questions: make them behavioral and specific to the business.
- Policies: clear language, fair tone, actionable.
- Ready to use or lightly edit.`,

  finance: `You are The CFO — STAFFD's AI finance specialist. You produce financial documents, invoice templates, budget breakdowns, cash flow summaries, and financial communications for real businesses.

HOW TO USE THE VAULT:
Use the business context silently. Know what kind of business this is — a service business has different cash flow dynamics than a product business. Your output should reflect that understanding without being told.

PRINCIPLES:
- Numbers must be clearly structured — tables, line items, totals.
- Financial writing should be precise and professional, not cold.
- Flag where the user must insert specific figures with [AMOUNT] or [DATE].
- Keep it practical — a small business owner needs to be able to use this today.

OUTPUT RULES:
- Deliver immediately. No preamble.
- Use clear structure: headings, line items, totals where appropriate.
- Ready to use or plug into their accounting tool.`,

  operations: `You are The Operator — STAFFD's AI operations specialist. You create SOPs, workflows, process documentation, meeting agendas, project briefs, and operational frameworks for real businesses.

HOW TO USE THE VAULT:
Internalize the business context. Understand whether this is a solo operator trying to systematize, a team that's scaling, or a business fixing broken processes. Let that shape the complexity and tone of your output.

PRINCIPLES:
- Clarity is the product. Every step must be unambiguous.
- Use numbered steps for processes. Use headers for navigation.
- If something needs a decision point, flag it with ⚠️ Decision required.
- Build for the person who will use this, not the person who commissioned it.

OUTPUT RULES:
- Deliver immediately. No preamble.
- SOPs: numbered steps, clear owner for each action, definition of done.
- Workflows: logical sequence, no gaps.
- Agendas: time-boxed, outcome-oriented.
- Ready to implement or hand to a team member.`,

  reputation: `You are The Reputation Manager — STAFFD's AI reputation specialist. You handle customer service replies, public review responses, community engagement, and feedback synthesis for real businesses.

HOW TO USE THE VAULT:
Internalize the business context — voice, industry, competitive edge, target audience. A reply from a luxury brand sounds different from one written for a fast-casual restaurant. Match the tone without quoting the vault.

PRINCIPLES:
- Acknowledge first, then solve. Customers want to feel heard before they want to feel helped.
- Future readers matter as much as the current one — every public response is marketing.
- Apologize specifically, never generically.
- De-escalate by mirroring concern, never matching anger.
- Offer concrete resolution or next step — never leave anyone in limbo.

OUTPUT RULES:
- Deliver immediately. No preamble.
- Customer support replies: ready to send, with subject line if email.
- Review responses: signed off with a real role (Owner, Manager) — never "The Management."
- Community engagement: matched to platform energy (LinkedIn ≠ TikTok).
- Feedback analysis: structured themes, root causes, top 3 priorities.
- Ready to use today.`,

  ceo: `You are The CEO — STAFFD's cross-department strategic advisor. You operate as the single executive mind for the owner's entire business, synthesizing across every other department's actual work.

CRITICAL: When the CROSS-DEPARTMENT WORKLOAD block is present below, you MUST reference real activity from it (without quoting verbatim). Cite which department produced what, what's working, what's stalling, what's missing. Generic advice is failure — your job is to make this owner feel like you read every document their team produced this week.


HOW TO USE THE VAULT:
Think like a trusted advisor who knows this business deeply. Use the vault context to ground your strategy in their specific situation — their industry, competitive edge, current challenges, and what they most want off their plate. Don't reference the vault; just think with it.

YOUR ROLE:
- Help owners zoom out and see the big picture when they're stuck in the weeds
- Cut through noise to identify what actually moves the needle
- Connect the dots across departments: marketing, sales, ops, finance, HR, legal
- Give direct, opinionated advice — not "it depends" when a clear answer exists
- Think 90 days out, not just this week

PRINCIPLES:
- Be direct. Business owners need clarity, not a menu of options.
- Prioritize ruthlessly. The right answer is usually "do less, better."
- Strategy without execution is worthless — always end with clear, numbered next steps.
- Acknowledge real constraints (time, money, team size) — no ideal-world advice.
- If you see something they're not asking about but need to hear, say it.

OUTPUT FORMAT:
- For strategy questions: Situation → Key Insight → Recommendation → Next Steps (numbered, specific)
- For decisions: Your recommendation first, then the 2-3 reasons why
- For growth plans: 90-day horizon, broken into 30/60/90 milestones
- For audits/health checks: What's working → What's broken → Top 3 priorities

OUTPUT RULES:
- Deliver immediately. No preamble, no "great question."
- Use headers to structure longer outputs.
- Be specific — name the action, not just the category.
- Ready to act on today.`,
};

function buildSystemPrompt(department: string, vault: Record<string, unknown> | null): string {
  const base = DEPT_SYSTEM_PROMPTS[department] ?? DEPT_SYSTEM_PROMPTS["marketing"] ?? "";

  if (!vault) return base;

  const focus = FOCUS_LABELS[vault.focus as string] ?? vault.focus;
  const situation = SITUATION_LABELS[vault.situation as string] ?? vault.situation;
  const superpower = SUPERPOWER_LABELS[vault.superpower as string] ?? vault.superpower;
  const bottlenecks = ((vault.bottlenecks as string[]) ?? [])
    .map((b) => BOTTLENECK_LABELS[b] ?? b)
    .join(", ");
  const magicWand = vault.magic_wand as string;

  const businessName = vault.business_name as string;
  const industry = vault.industry as string;
  const description = vault.description as string;
  const targetAudience = vault.target_audience as string;
  const website = vault.website as string;
  const address = vault.address as string;
  const primaryEmail = vault.primary_email as string;
  const secondaryEmail = vault.secondary_email as string;
  const otherEmail = vault.other_email as string;
  const phone = vault.phone as string;

  return `${base}

--- BUSINESS VAULT ---
${businessName ? `Business name: ${businessName}` : ""}
${industry ? `Industry / What they do: ${industry}` : ""}
${description ? `Business description: ${description}` : ""}
${targetAudience ? `Target audience: ${targetAudience}` : ""}
${website ? `Website: ${website}` : ""}
${address ? `Business address: ${address}` : ""}
${phone ? `Phone: ${phone}` : ""}
${primaryEmail ? `Primary email: ${primaryEmail}` : ""}
${secondaryEmail ? `Secondary email: ${secondaryEmail}` : ""}
${otherEmail ? `Other email: ${otherEmail}` : ""}
Primary focus: ${focus}
Current situation: ${situation}
Competitive advantage: ${superpower}
${bottlenecks ? `Key bottlenecks: ${bottlenecks}` : ""}
${magicWand ? `What they most want off their plate: ${magicWand}` : ""}
--- END VAULT ---`;
}

export async function POST(req: Request) {
  try {
    const { task, department, agentId, userId, pbToken, templateContent } = await req.json() as {
      task: string;
      department: string;
      agentId?: string;
      userId: string;
      pbToken: string;
      templateContent?: string;
    };

    if (!task?.trim()) {
      return new Response("Task is required", { status: 400 });
    }

    // Rate limiting
    const rateLimitKey = userId || req.headers.get("x-forwarded-for") || "anonymous";
    const { allowed: rateLimitAllowed } = checkRateLimit(rateLimitKey);
    if (!rateLimitAllowed) {
      return new Response("Daily generation limit reached. Limit resets in 24 hours.", {
        status: 429,
        headers: { "X-RateLimit-Remaining": "0" },
      });
    }

    // Trial gate — record usage and check if limit reached for this department
    if (userId) {
      try {
        const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
        const trialRes = await fetch(`${origin}/api/trial`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, department }),
        });
        if (trialRes.status === 402) {
          const data = (await trialRes.json()) as { plan: string };
          return new Response(
            JSON.stringify({ error: "trial_exhausted", plan: data.plan }),
            { status: 402, headers: { "Content-Type": "application/json" } }
          );
        }
      } catch {
        // Fail open — don't block users if trial check fails
      }
    }

    // Fetch user's vault from PocketBase using their auth token
    let vault: Record<string, unknown> | null = null;
    if (pbToken && userId) {
      try {
        const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
        const res = await fetch(
          `${pbUrl}/api/collections/businesses/records?filter=(user='${userId}')&perPage=1`,
          { headers: { Authorization: pbToken } }
        );
        const data = await res.json() as { items?: Record<string, unknown>[] };
        vault = data.items?.[0] ?? null;
      } catch {
        // proceed without vault
      }
    }

    // If a specific agentId is provided, use that agent's system prompt from packages/agents.
    // Otherwise fall back to the department-level prompt (legacy / backward compat).
    let systemPrompt: string;
    if (agentId) {
      const agentDef = getAgent(agentId);
      if (agentDef) {
        // Build prompt with vault context using the agent's own system prompt
        const vaultLines: string[] = [];
        if (vault) {
          const v = vault as Record<string, unknown>;
          if (v.business_name) vaultLines.push(`Business name: ${v.business_name as string}`);
          if (v.industry) vaultLines.push(`Industry / What they do: ${v.industry as string}`);
          if (v.description) vaultLines.push(`Business description: ${v.description as string}`);
          if (v.target_audience) vaultLines.push(`Target audience: ${v.target_audience as string}`);
          if (v.website) vaultLines.push(`Website: ${v.website as string}`);
          if (v.address) vaultLines.push(`Business address: ${v.address as string}`);
          if (v.phone) vaultLines.push(`Phone: ${v.phone as string}`);
          if (v.primary_email) vaultLines.push(`Primary email: ${v.primary_email as string}`);
          if (v.secondary_email) vaultLines.push(`Secondary email: ${v.secondary_email as string}`);
          if (v.other_email) vaultLines.push(`Other email: ${v.other_email as string}`);

          const focusMap: Record<string, string> = {
            growth: "Top-line growth — finding leads, closing deals, driving revenue",
            time: "Time recovery — automating repetitive tasks and fixing broken workflows",
            cx: "Customer experience — retention, faster support, client satisfaction",
            intelligence: "Intelligence & scaling — data analysis, market research, strategic planning",
          };
          const situationMap: Record<string, string> = {
            solo: "Solo operator — doing everything themselves, out of hours",
            skills: "Small team missing key skills",
            scaling: "Growing faster than they can hire",
            cost: "Needs expert-level work without expert-level cost",
            chaos: "Broken processes — things keep slipping through the cracks",
            starting: "Just starting out — building everything from scratch",
          };
          const superpowerMap: Record<string, string> = {
            speed: "Speed & efficiency — fastest in their space",
            quality: "Premium quality / expertise — high-end, bespoke solutions",
            value: "Cost-effectiveness — best value for the budget",
            relationships: "Deep relationships — unmatched customer service and personal touch",
          };
          const bottleneckMap: Record<string, string> = {
            content: "Content creation & marketing",
            leads: "Lead generation & outbound sales",
            support: "Customer support & account management",
            ops: "Data entry, invoicing & ops admin",
            research: "Market research & competitor analysis",
          };

          if (v.focus) vaultLines.push(`Primary focus: ${focusMap[v.focus as string] ?? v.focus as string}`);
          if (v.situation) vaultLines.push(`Current situation: ${situationMap[v.situation as string] ?? v.situation as string}`);
          if (v.superpower) vaultLines.push(`Competitive advantage: ${superpowerMap[v.superpower as string] ?? v.superpower as string}`);
          if (v.bottlenecks && Array.isArray(v.bottlenecks) && v.bottlenecks.length > 0) {
            vaultLines.push(`Key bottlenecks: ${(v.bottlenecks as string[]).map((b) => bottleneckMap[b] ?? b).join(", ")}`);
          }
          if (v.magic_wand) vaultLines.push(`What they most want off their plate: ${v.magic_wand as string}`);
        }

        systemPrompt = vault && vaultLines.length > 0
          ? `${agentDef.systemPrompt}\n\n--- BUSINESS VAULT ---\n${vaultLines.join("\n")}\n--- END VAULT ---`
          : agentDef.systemPrompt;
      } else {
        systemPrompt = buildSystemPrompt(department, vault);
      }
    } else {
      systemPrompt = buildSystemPrompt(department, vault);
    }

    // Inject prior work as memory context.
    // - Regular departments: last 2 docs from same user+department (continuity).
    // - CEO: cross-department synthesis — last 3 docs from EACH unlocked department
    //   so The CEO can see the full operating picture.
    if (userId && pbToken) {
      try {
        const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;

        if (department === "ceo") {
          // Resolve which departments to synthesize across
          const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
          let unlockedDepts: string[] = ["marketing", "sales", "legal"];
          try {
            const trialRes = await fetch(`${origin}/api/trial?userId=${userId}`);
            if (trialRes.ok) {
              const trialData = (await trialRes.json()) as { resolved_departments?: string[] };
              if (Array.isArray(trialData.resolved_departments) && trialData.resolved_departments.length > 0) {
                unlockedDepts = trialData.resolved_departments;
              }
            }
          } catch { /* fall back to defaults */ }

          // Fetch up to 3 most-recent docs per unlocked department (in parallel)
          const otherDepts = unlockedDepts.filter((d) => d !== "ceo");
          const deptDocResults = await Promise.all(
            otherDepts.map(async (dept) => {
              try {
                const memRes = await fetch(
                  `${pbUrl}/api/collections/documents/records?filter=(user='${userId}'%26%26department='${dept}')&sort=-created&perPage=3&fields=prompt,output,department,created`,
                  { headers: { Authorization: pbToken } }
                );
                if (!memRes.ok) return { dept, items: [] as Array<{ prompt: string; output: string; created: string }> };
                const memData = (await memRes.json()) as { items?: Array<{ prompt: string; output: string; created: string }> };
                return { dept, items: memData.items ?? [] };
              } catch {
                return { dept, items: [] as Array<{ prompt: string; output: string; created: string }> };
              }
            })
          );

          const sections: string[] = [];
          for (const { dept, items } of deptDocResults) {
            if (items.length === 0) continue;
            const deptLines = items
              .map((d) => {
                const summary = d.output.length > 350 ? d.output.slice(0, 350) + "…" : d.output;
                return `  • Task: ${d.prompt}\n    Output excerpt: ${summary}`;
              })
              .join("\n\n");
            sections.push(`[${dept.toUpperCase()}]\n${deptLines}`);
          }

          if (sections.length > 0) {
            systemPrompt += `\n\n--- CROSS-DEPARTMENT WORKLOAD (recent activity across the business — synthesize, don't repeat) ---\n${sections.join("\n\n")}\n--- END CROSS-DEPARTMENT WORKLOAD ---`;
          } else {
            systemPrompt += `\n\n--- CROSS-DEPARTMENT WORKLOAD ---\nNo recent work in other departments yet. Base advice on the Vault and the task at hand. Encourage the owner to start generating in their unlocked departments so future briefings can synthesize real activity.\n--- END CROSS-DEPARTMENT WORKLOAD ---`;
          }

          // Also include last 2 CEO conversations for continuity
          try {
            const ceoMemRes = await fetch(
              `${pbUrl}/api/collections/documents/records?filter=(user='${userId}'%26%26department='ceo')&sort=-created&perPage=2&fields=prompt,output,created`,
              { headers: { Authorization: pbToken } }
            );
            if (ceoMemRes.ok) {
              const ceoMemData = (await ceoMemRes.json()) as { items?: Array<{ prompt: string; output: string; created: string }> };
              const prior = ceoMemData.items ?? [];
              if (prior.length > 0) {
                const block = prior
                  .map((d, i) => {
                    const summary = d.output.length > 500 ? d.output.slice(0, 500) + "…" : d.output;
                    return `[Prior CEO conversation ${i + 1}]\nTask: ${d.prompt}\nOutput: ${summary}`;
                  })
                  .join("\n\n");
                systemPrompt += `\n\n--- PRIOR CEO CONVERSATIONS (context only — do not repeat) ---\n${block}\n--- END PRIOR CONVERSATIONS ---`;
              }
            }
          } catch { /* proceed without CEO continuity */ }
        } else {
          // Regular department: same-department memory (last 2 docs)
          const memRes = await fetch(
            `${pbUrl}/api/collections/documents/records?filter=(user='${userId}'%26%26department='${department}')&sort=-created&perPage=2&fields=prompt,output,created`,
            { headers: { Authorization: pbToken } }
          );
          if (memRes.ok) {
            const memData = (await memRes.json()) as { items?: Array<{ prompt: string; output: string; created: string }> };
            const prior = memData.items ?? [];
            if (prior.length > 0) {
              const memoryBlock = prior
                .map((d, i) => {
                  const summary = d.output.length > 500 ? d.output.slice(0, 500) + "…" : d.output;
                  return `[Prior task ${i + 1}]\nTask: ${d.prompt}\nOutput: ${summary}`;
                })
                .join("\n\n");
              systemPrompt += `\n\n--- PRIOR WORK (context only — do not repeat) ---\n${memoryBlock}\n--- END PRIOR WORK ---`;
            }
          }
        }
      } catch {
        // proceed without memory
      }
    }

    if (templateContent?.trim()) {
      systemPrompt += `\n\n--- USER TEMPLATE ---\nThe user has provided an existing document template. Use this EXACT structure, layout, and format as your output. Replace placeholder values and example data with the appropriate content for this task. Preserve every section heading, field label, and formatting pattern from the template.\n\n${templateContent.trim()}\n--- END TEMPLATE ---`;
    }

    const stream = await anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" }, // cache system prompt — vault context is expensive to reprocess
        },
      ],
      messages: [{ role: "user", content: task }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("Agent route error:", err);
    return new Response("Something went wrong", { status: 500 });
  }
}
