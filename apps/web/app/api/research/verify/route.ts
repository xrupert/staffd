import { whoAmI } from "../../_lib/integrations/identity";
import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import {
  persistResearchBundle,
  type ResearchRecord,
} from "../../_lib/orchestrator/research-records";
import {
  verifyResearchClaim,
  type ResearchVerificationRequest,
} from "../../_lib/orchestrator/research-verification";

async function createResearchRecord(record: ResearchRecord): Promise<{ id: string }> {
  const token = await getAdminToken();
  const response = await fetch(`${pbUrl()}/api/collections/research_records/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify(record),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Research ledger write failed (${response.status})`);
  }
  return (await response.json()) as { id: string };
}

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
    const record = await persistResearchBundle(user.id, verification, {
      create: createResearchRecord,
    });
    return Response.json({
      verification,
      record,
      mayPresentAnswer: verification.answer.supported,
      requiresHumanReview: verification.answer.requiresHumanReview,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown verification error";
    const persistenceFailure = /ledger|PocketBase|research_records/i.test(detail);
    return Response.json({
      error: persistenceFailure ? "research_persistence_failed" : "research_verification_failed",
      detail,
    }, { status: persistenceFailure ? 503 : 400 });
  }
}
