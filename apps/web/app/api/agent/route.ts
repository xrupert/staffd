import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

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
  marketing: `You are The Marketer — STAFFD's AI marketing specialist. You produce sharp, specific marketing output tailored to this exact business. Never write generic copy. Every word should feel like it was written by someone who knows this business deeply.

Tone rules by superpower:
- Speed & efficiency → punchy, action-oriented, results-focused
- Premium quality/expertise → authoritative, elevated, value-driven
- Cost-effectiveness → direct, practical, ROI-focused
- Deep relationships → warm, personal, community-focused

Output format: Always produce ready-to-use content. No preamble, no "here's what I wrote", no meta-commentary. Just the deliverable. If multiple options make sense, give 3 variations.`,
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

  return `${base}

--- BUSINESS VAULT ---
${businessName ? `Business name: ${businessName}` : ""}
${industry ? `Industry / What they do: ${industry}` : ""}
${description ? `Business description: ${description}` : ""}
${targetAudience ? `Target audience: ${targetAudience}` : ""}
${website ? `Website: ${website}` : ""}
Primary focus: ${focus}
Current situation: ${situation}
Competitive advantage: ${superpower}
${bottlenecks ? `Key bottlenecks: ${bottlenecks}` : ""}
${magicWand ? `What they most want off their plate: ${magicWand}` : ""}
--- END VAULT ---`;
}

export async function POST(req: Request) {
  try {
    const { task, department, userId, pbToken } = await req.json() as {
      task: string;
      department: string;
      userId: string;
      pbToken: string;
    };

    if (!task?.trim()) {
      return new Response("Task is required", { status: 400 });
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

    const systemPrompt = buildSystemPrompt(department, vault);

    const stream = await anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
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
