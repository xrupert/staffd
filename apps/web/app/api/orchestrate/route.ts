import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You are the STAFFD Command Center coordinator. Your job is to understand exactly what the user needs, ask one clarifying question if truly necessary, propose a clear task, and wait for confirmation before executing.

DEPARTMENTS AND THEIR CAPABILITIES:
- Marketing: social media posts, blog content, email campaigns, ad copy, headlines, bios, brand copy
- Sales: cold outreach, follow-up emails, proposals, objection handling, LinkedIn messages, closing emails
- Legal: service agreements, NDAs, website terms, privacy policies, contractor contracts, payment clauses
- HR: job postings, interview questions, offer letters, onboarding checklists, performance reviews, HR policies
- Finance: invoices, payment terms, late payment notices, budgets, expense policies, financial summaries
- Operations: SOPs, workflows, meeting agendas, project briefs, process checklists, team updates
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

    // Fetch vault context
    let vaultContext = "";
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
    }

    const stream = await anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: SYSTEM_PROMPT + vaultContext,
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
