import Anthropic from "@anthropic-ai/sdk";
import { resolveIndustryToPackId } from "@staffd/agents";

const anthropic = new Anthropic();

export async function POST(req: Request) {
  try {
    const { url } = await req.json() as { url: string };

    if (!url?.trim()) {
      return Response.json({ error: "URL is required" }, { status: 400 });
    }

    let html = "";
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" },
        signal: AbortSignal.timeout(8000),
      });
      html = await res.text();
    } catch {
      return Response.json(
        { error: "Could not reach that website. Check the URL and try again." },
        { status: 422 }
      );
    }

    // Strip scripts, styles, and HTML tags to get readable text
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: `Extract business information from this website content and return ONLY a valid JSON object with these exact fields:
- business_name: the company or business name
- industry: what the business does (short phrase, e.g. "Digital marketing agency" or "Residential plumbing contractor")
- description: 1-2 sentences — what they do, who for, and what makes them stand out
- target_audience: who their customers are (e.g. "Small business owners in the US" or "Homeowners aged 35–55")

Website content:
${text}

Return ONLY the JSON object. No explanation, no markdown, no code fences.`,
        },
      ],
    });

    const content = message.content[0];
    if (!content || content.type !== "text") throw new Error("Unexpected response");

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const data = JSON.parse(jsonMatch[0]) as {
      business_name?: string;
      industry?: string;
      description?: string;
      target_audience?: string;
    };

    // W59 — when the scraped industry phrase resolves to a known category,
    // send it along so onboarding pre-selects the matching chip.
    const industry_category = resolveIndustryToPackId(data.industry);
    return Response.json(industry_category ? { ...data, industry_category } : data);
  } catch (err) {
    console.error("Prefill error:", err);
    return Response.json(
      { error: "Couldn't extract info automatically. Please fill in manually." },
      { status: 500 }
    );
  }
}
