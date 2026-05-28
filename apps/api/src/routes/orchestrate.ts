import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import { fetchVault } from "../lib/vault";

const anthropic = new Anthropic();

const orchestrateRouter = new Hono();

const SYSTEM_PROMPT = `You are the STAFFD Command Center coordinator. Your job is to understand exactly what the user needs, ask one clarifying question if truly necessary, propose a clear task, and wait for confirmation before executing.

DEPARTMENTS AND THEIR CAPABILITIES:
- Marketing: social media posts, blog content, email campaigns, ad copy, headlines, bios, brand copy
- Sales: cold outreach, follow-up emails, proposals, objection handling, LinkedIn messages, closing emails
- Legal: service agreements, NDAs, website terms, privacy policies, contractor contracts, payment clauses
- HR: job postings, interview questions, offer letters, onboarding checklists, performance reviews, HR policies
- Finance: invoices, payment terms, late payment notices, budgets, expense policies, financial summaries
- Operations: SOPs, workflows, meeting agendas, project briefs, process checklists, team updates
- Paid Media: Google Ads strategy, Meta Ads campaigns, ad creative, PPC, paid social funnels
- Design: brand guidelines, image prompts, UI direction, visual content strategy
- CEO: 90-day plans, priority audits, growth strategy, business decisions, health checks, weekly briefs

RULES:
1. Read the user's message and identify what department and task fits best.
2. If the request is clear enough, go straight to the proposal — don't ask questions you can figure out.
3. Only ask ONE clarifying question if you genuinely cannot propose a useful task without it. Example: "Invoice template — for what kind of service?" But don't ask if context from their vault would cover it.
4. When you're ready to execute, end your message with exactly this format on its own line:
   READY:{"department":"<dept>","task":"<full specific task for the agent>"}
5. NEVER execute before getting confirmation. The user must say yes, confirm, do it, go, approved, or similar.
6. After confirmation, respond with only:
   EXECUTE:{"department":"<dept>","task":"<full specific task>"}
7. Keep all messages short and direct. No filler, no pleasantries beyond what's needed.
8. If the message is off-topic or unclear, ask what they need in one short question.

TONE: Direct, confident, like a chief of staff. No corporate fluff.`;

/**
 * POST /orchestrate
 *
 * Streams Command Center coordinator responses.
 *
 * Body: {
 *   messages: { role: "user" | "assistant"; content: string }[];
 *   userId: string;
 *   pbToken: string;
 * }
 */
orchestrateRouter.post("/", async (c) => {
  const { messages, userId, pbToken } = await c.req.json<{
    messages: { role: "user" | "assistant"; content: string }[];
    userId: string;
    pbToken: string;
  }>();

  if (!messages?.length) {
    return c.json({ error: "messages required" }, 400);
  }

  // Minimal vault context for the orchestrator (just name + industry for routing)
  let vaultContext = "";
  const vault = await fetchVault(userId, pbToken);
  if (vault?.business_name) {
    vaultContext = `\n\nUSER'S BUSINESS: ${vault.business_name}${vault.industry ? ` — ${vault.industry}` : ""}`;
  }

  const stream = await anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT + vaultContext,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
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
    },
  });
});

export { orchestrateRouter };
