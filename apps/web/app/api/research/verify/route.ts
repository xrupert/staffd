import { whoAmI } from "../../_lib/integrations/identity";
import {
  verifyResearchClaim,
  type ResearchVerificationRequest,
} from "../../_lib/orchestrator/research-verification";

export async function POST(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: ResearchVerificationRequest;
  try {
    body = (await request.json()) as ResearchVerificationRequest;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const verification = verifyResearchClaim(body);
    return Response.json({
      verification,
      mayPresentAnswer: verification.answer.supported,
      requiresHumanReview: verification.answer.requiresHumanReview,
    });
  } catch (error) {
    return Response.json({
      error: "research_verification_failed",
      detail: error instanceof Error ? error.message : "Unknown verification error",
    }, { status: 400 });
  }
}
