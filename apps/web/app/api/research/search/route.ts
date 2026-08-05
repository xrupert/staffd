import { whoAmI } from "../../_lib/integrations/identity";
import { searchResearchSources } from "../../_lib/orchestrator/research-retrieval";

export async function POST(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { query?: string };
  try {
    body = (await request.json()) as { query?: string };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await searchResearchSources(body.query ?? "");
    return Response.json({
      ...result,
      answerable: false,
      nextStep: "Classify support, resolve disagreement, and evaluate evidence before presenting an answer.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research search failed";
    const status = /required|500 characters/.test(message) ? 400 : /not configured/.test(message) ? 503 : 502;
    console.error("governed research search failed:", error);
    return Response.json({ error: "research_search_failed", detail: message }, { status });
  }
}
