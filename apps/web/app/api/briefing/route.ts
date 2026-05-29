/**
 * CEO Weekly Briefing — streams a personalised business briefing using
 * the user's vault data + their recent document activity.
 */

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const DEPT_NAMES: Record<string, string> = {
  marketing: "Marketing",
  sales: "Sales",
  legal: "Legal",
  hr: "HR",
  finance: "Finance",
  operations: "Operations",
  ceo: "Strategy",
  "paid-media": "Paid Media",
  design: "Design",
  reputation: "Reputation",
};

export async function POST(req: Request) {
  try {
    const { userId, pbToken } = (await req.json()) as {
      userId: string;
      pbToken: string;
    };

    if (!userId || !pbToken) {
      return new Response("Unauthorized", { status: 401 });
    }

    const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
    if (!pbUrl) return new Response("Service unavailable", { status: 503 });

    // Fetch vault
    let vault: Record<string, unknown> | null = null;
    try {
      const res = await fetch(
        `${pbUrl}/api/collections/businesses/records?filter=(user='${userId}')&perPage=1`,
        { headers: { Authorization: pbToken } }
      );
      const data = (await res.json()) as { items?: Record<string, unknown>[] };
      vault = data.items?.[0] ?? null;
    } catch { /* proceed */ }

    // Fetch last 30 days of docs
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);

    let recentDocs: Array<{
      department: string;
      agent_name: string;
      prompt: string;
      created: string;
    }> = [];
    try {
      const encoded = encodeURIComponent(`user='${userId}' && created >= '${since}'`);
      const res = await fetch(
        `${pbUrl}/api/collections/documents/records?filter=${encoded}&sort=-created&perPage=200&fields=department,agent_name,prompt,created`,
        { headers: { Authorization: pbToken } }
      );
      const data = (await res.json()) as {
        items?: typeof recentDocs;
      };
      recentDocs = data.items ?? [];
    } catch { /* proceed */ }

    // Group by department
    const deptMap = new Map<string, { count: number; samples: string[] }>();
    for (const doc of recentDocs) {
      const entry = deptMap.get(doc.department) ?? { count: 0, samples: [] };
      entry.count++;
      if (entry.samples.length < 2) entry.samples.push(doc.prompt.slice(0, 90));
      deptMap.set(doc.department, entry);
    }

    const totalDocs = recentDocs.length;

    // Build vault summary
    const FOCUS: Record<string, string> = {
      growth: "Top-line growth",
      time: "Time recovery",
      cx: "Customer experience",
      intelligence: "Intelligence & scaling",
    };
    const SITUATION: Record<string, string> = {
      solo: "Solo operator",
      skills: "Small team, missing key skills",
      scaling: "Growing faster than they can hire",
      cost: "Needs expert work without expert cost",
      chaos: "Processes are broken",
      starting: "Just starting out",
    };
    const SUPERPOWER: Record<string, string> = {
      speed: "Speed & efficiency",
      quality: "Premium quality / expertise",
      value: "Cost-effectiveness",
      relationships: "Deep relationships",
    };

    const vaultLines: string[] = [];
    if (vault) {
      if (vault.business_name) vaultLines.push(`Business: ${vault.business_name as string}`);
      if (vault.industry) vaultLines.push(`Industry: ${vault.industry as string}`);
      if (vault.description) vaultLines.push(`Description: ${vault.description as string}`);
      if (vault.target_audience) vaultLines.push(`Target audience: ${vault.target_audience as string}`);
      if (vault.website) vaultLines.push(`Website: ${vault.website as string}`);
      if (vault.focus) vaultLines.push(`Primary focus: ${FOCUS[vault.focus as string] ?? vault.focus as string}`);
      if (vault.situation) vaultLines.push(`Situation: ${SITUATION[vault.situation as string] ?? vault.situation as string}`);
      if (vault.superpower) vaultLines.push(`Competitive edge: ${SUPERPOWER[vault.superpower as string] ?? vault.superpower as string}`);
      if (vault.magic_wand) vaultLines.push(`What they most want off their plate: ${vault.magic_wand as string}`);
    }

    // Build activity summary
    const activityLines: string[] = [];
    for (const [dept, data] of deptMap.entries()) {
      const name = DEPT_NAMES[dept] ?? dept;
      const samples = data.samples.length > 0
        ? ` Recent: "${data.samples.join('"; "')}"`
        : "";
      activityLines.push(`- ${name}: ${data.count} document${data.count !== 1 ? "s" : ""}.${samples}`);
    }

    // Vault completeness check
    const coreFields = ["business_name", "industry", "description", "target_audience"];
    const missingFields = coreFields.filter((f) => !(vault?.[f] as string)?.trim());

    const today = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const systemPrompt = `You are the Chief of Staff for a business. Your job is to generate a sharp, no-nonsense weekly briefing for the business owner. This is an operating document — clear, specific, and useful. No cheerleading, no filler. Format cleanly with markdown.`;

    const userPrompt = `Today is ${today}.

${vaultLines.length > 0
  ? `BUSINESS CONTEXT:\n${vaultLines.join("\n")}`
  : "NOTE: Business vault is mostly empty. Work with what's available and use the vault gaps section to advise on what to fill in."
}

${activityLines.length > 0
  ? `STAFF ACTIVITY — Last 30 days (${totalDocs} total deliverables):\n${activityLines.join("\n")}`
  : "STAFF ACTIVITY: Your staff hasn't produced any work yet. Recommend where to start."
}

${missingFields.length > 0
  ? `VAULT GAPS (missing fields): ${missingFields.join(", ")}`
  : ""
}

Generate the weekly briefing using this exact structure:

## Weekly Briefing — ${today}

**Executive Summary**
[2–3 sentences: where the business stands, what's happening, what matters most right now]

**Top Priority This Week**
[One clear, specific action. Not a category — an actual thing to do.]

**Your Staff This Month**
[Summarise what's been happening. If nothing yet, tell them where to start and why.]

**What Would Make Your Team More Effective**
[Specific vault improvements or missing context that would sharpen AI output. Skip this section if vault is complete.]

**Next 30 Days — Focus Areas**
1. [area 1]
2. [area 2]
3. [area 3]

**Immediate Actions**
1. [specific action]
2. [specific action]
3. [specific action]

Be direct. Be specific. Cut everything that doesn't move the needle.`;

    const stream = await anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
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
    console.error("Briefing error:", err);
    return new Response("Failed to generate briefing", { status: 500 });
  }
}
