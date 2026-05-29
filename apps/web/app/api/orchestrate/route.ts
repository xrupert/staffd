import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const DEPT_CAPABILITIES: Record<string, string> = {
  marketing:   "Content (blog, email, newsletters), Social Media (Instagram, TikTok, LinkedIn, X, Reels, carousels), Growth & SEO, AI Search Optimization, Podcast Strategy, App Store Optimization, Book Authoring",
  sales:       "Cold outreach, Follow-ups, Proposals, Objection handling, Pipeline analysis, Account strategy, Sales coaching, Technical demos, Prospect research",
  legal:       "Contracts (services, NDAs, retainers), Policies (Terms, Privacy, refund), Compliance reviews, Document review for risks, Client intake, Legal billing setup",
  hr:          "Job postings, Interview questions, Onboarding plans, 30-60-90 day plans, Performance reviews, PIPs, Hiring scorecards",
  finance:     "Invoices, Late payment notices, Budgets, P&L templates, Cash flow, Tax strategy, Financial forecasting, Variance analysis, Industry benchmarking",
  operations:  "SOPs, Workflows, Meeting agendas, Project briefs, Project shepherding, Supply chain & procurement, Automation, Data consolidation, Executive summaries",
  "paid-media": "Google Ads (search), Meta/TikTok/Instagram Ads (social), Ad creative & copy, Campaign audits, Programmatic & CTV, Search query analysis, Tracking & attribution setup",
  design:      "Brand identity, Brand guidelines, AI image generation prompts, UI design, UX architecture & flows, UX research, Accessibility reviews, Microcopy & delight",
  reputation:  "Customer service email replies, Public review responses (Google/Yelp), Community management (comments/DMs), Feedback synthesis, Reputation strategy",
  ceo:         "90-day plans, Priority audits, Growth strategy, Business decisions, Trend analysis, Sprint prioritization, Feedback synthesis, Market expansion, Weekly briefs",
};

function buildSystemPrompt(unlockedDepts: string[]): string {
  const unlocked = unlockedDepts.length ? unlockedDepts : ["marketing", "sales", "legal"];
  const lockedDepts = Object.keys(DEPT_CAPABILITIES).filter((d) => !unlocked.includes(d));

  const unlockedSection = unlocked
    .map((d) => `- ${d}: ${DEPT_CAPABILITIES[d] ?? ""}`)
    .join("\n");

  const lockedSection = lockedDepts.length
    ? lockedDepts.map((d) => `- ${d}: ${DEPT_CAPABILITIES[d] ?? ""}`).join("\n")
    : "(none — all departments unlocked)";

  return `You are the STAFFD Command Center coordinator. Your job is to understand exactly what the user needs, ask one clarifying question if truly necessary, propose a clear task, and wait for confirmation before executing.

DEPARTMENTS THE USER HAS ACCESS TO (route here first):
${unlockedSection}

DEPARTMENTS THE USER HAS NOT UNLOCKED YET (do NOT route here by default):
${lockedSection}

RULES:
1. Read the user's message and identify which UNLOCKED department best fits the request.
2. If the request is clear enough, go straight to the proposal — don't ask questions you can figure out.
3. Only ask ONE clarifying question if you genuinely cannot propose a useful task without it. But don't ask if context from their vault would cover it.
4. ALWAYS route to an UNLOCKED department first — the user can only execute against departments they have access to.
5. If a LOCKED department would be a sharper fit for this specific request (e.g. a TikTok ad task best fits Paid Media but Marketing can handle it), include "lockedAlternative" in the READY payload so we can surface the upgrade nudge AFTER generating from the unlocked dept.
6. When you're ready to execute, end your message with exactly this format on its own line:
   READY:{"department":"<unlocked-dept>","task":"<full specific task>","lockedAlternative":"<locked-dept-or-empty>"}
7. NEVER execute before getting confirmation. The user must say yes, confirm, do it, go, approved, or similar.
8. After confirmation, respond with only:
   EXECUTE:{"department":"<unlocked-dept>","task":"<full specific task>"}
9. Keep all messages short and direct. No filler.
10. NEVER route to a locked department. Always route to the best UNLOCKED fit, and use lockedAlternative for the soft nudge.

TONE: Direct, confident, like a chief of staff. No corporate fluff.`;
}

export async function POST(req: Request) {
  try {
    const { messages, userId, pbToken } = await req.json() as {
      messages: { role: "user" | "assistant"; content: string }[];
      userId: string;
      pbToken: string;
    };

    if (!messages?.length) {
      return new Response("Messages required", { status: 400 });
    }

    // Fetch vault context + unlocked departments
    let vaultContext = "";
    let unlockedDepts: string[] = ["marketing", "sales", "legal"]; // safe default

    if (pbToken && userId) {
      try {
        const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
        const res = await fetch(
          `${pbUrl}/api/collections/businesses/records?filter=(user='${userId}')&perPage=1`,
          { headers: { Authorization: pbToken } }
        );
        const data = await res.json() as { items?: Record<string, unknown>[] };
        const vault = data.items?.[0];
        if (vault?.business_name) {
          vaultContext = `\n\nUSER'S BUSINESS: ${vault.business_name as string}${vault.industry ? ` — ${vault.industry as string}` : ""}`;
        }
      } catch {
        // proceed without
      }

      // Fetch unlocked departments via internal /api/trial endpoint
      try {
        const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
        const trialRes = await fetch(`${origin}/api/trial?userId=${userId}`);
        if (trialRes.ok) {
          const trialData = (await trialRes.json()) as { resolved_departments?: string[] };
          if (Array.isArray(trialData.resolved_departments) && trialData.resolved_departments.length > 0) {
            unlockedDepts = trialData.resolved_departments;
          }
        }
      } catch {
        // proceed with default
      }
    }

    const systemPrompt = buildSystemPrompt(unlockedDepts);

    const stream = await anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: systemPrompt + vaultContext,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
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
      },
    });
  } catch (err) {
    console.error("Orchestrate error:", err);
    return new Response("Something went wrong", { status: 500 });
  }
}
