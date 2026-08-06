import { whoAmI } from "../../../_lib/integrations/identity";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../../_lib/pb";
import {
  compareRefreshedEvidence,
  type RefreshComparisonInput,
} from "../../../_lib/orchestrator/research-comparison";
import { nextReverificationDeadline } from "../../../_lib/orchestrator/research-reverification";

type StoredRecord = {
  id: string;
  user: string;
  topic: string;
  claim: string;
  label: RefreshComparisonInput["label"];
  risk: "standard" | "high";
  parent_record?: string;
  reverify_status?: string;
  citations?: Array<{
    id: string;
    title: string;
    url: string;
    sourceClass: RefreshComparisonInput["sources"][number]["sourceClass"];
    retrievedAt: string;
    publishedAt?: string | null;
    excerpt?: string;
  }>;
};

async function ownerRecord(id: string, userId: string, token: string): Promise<StoredRecord | null> {
  const filter = encodeURIComponent(`id = "${pbEscape(id)}" && user = "${pbEscape(userId)}"`);
  const response = await fetch(
    `${pbUrl()}/api/collections/research_records/records?filter=${filter}&perPage=1`,
    { headers: { Authorization: token }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Research record lookup failed (${response.status})`);
  return ((await response.json()) as { items?: StoredRecord[] }).items?.[0] ?? null;
}

async function patchRecord(token: string, id: string, body: Record<string, unknown>) {
  const response = await fetch(`${pbUrl()}/api/collections/research_records/records/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Research comparison update failed (${response.status})`);
  return response.json();
}

export async function POST(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { id?: string; relationships?: Record<string, "supports" | "contradicts" | "context_only"> };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const id = body.id?.trim() ?? "";
  if (!id || !body.relationships) {
    return Response.json({ error: "record_id_and_relationships_required" }, { status: 400 });
  }

  try {
    const token = await getAdminToken();
    const refresh = await ownerRecord(id, user.id, token);
    if (!refresh) return Response.json({ error: "not_found" }, { status: 404 });
    if (!refresh.parent_record || refresh.reverify_status !== "awaiting_classification") {
      return Response.json({ error: "record_not_awaiting_classification" }, { status: 409 });
    }
    const parent = await ownerRecord(refresh.parent_record, user.id, token);
    if (!parent) return Response.json({ error: "parent_not_found" }, { status: 409 });

    const sources = (refresh.citations ?? []).map((citation) => ({
      ...citation,
      relationship: body.relationships?.[citation.id] ?? "context_only" as const,
    }));
    const comparison = compareRefreshedEvidence({
      topic: refresh.topic,
      claim: refresh.claim,
      label: refresh.label,
      timeSensitive: true,
      sources,
    });
    if (comparison.outcome === "unclassified") {
      return Response.json({ error: "all_sources_must_be_classified", comparison }, { status: 409 });
    }

    const now = new Date();
    const refreshPatch = {
      verdict: comparison.bundle?.verdict,
      answer: comparison.bundle?.answer,
      citations: comparison.bundle?.citations,
      comparison_outcome: comparison.outcome,
      blocks_dependent_actions: comparison.blocksDependentActions,
      reverify_status: comparison.outcome === "confirmed" ? "confirmed" : "awaiting_review",
      review_status: comparison.outcome === "confirmed" && !comparison.requiresOwnerReview ? "not_required" : "pending",
    };
    const updatedRefresh = await patchRecord(token, refresh.id, refreshPatch);

    if (comparison.outcome === "confirmed" && !comparison.requiresOwnerReview) {
      await patchRecord(token, parent.id, {
        reverify_status: "scheduled",
        reverify_after: nextReverificationDeadline(parent.risk, now),
      });
    } else {
      await patchRecord(token, parent.id, {
        reverify_status: comparison.outcome === "contradicted" ? "contradicted" : "awaiting_review",
        blocks_dependent_actions: comparison.blocksDependentActions,
      });
    }

    return Response.json({ comparison, record: updatedRefresh });
  } catch (error) {
    return Response.json({
      error: "research_comparison_failed",
      detail: error instanceof Error ? error.message : "Unknown comparison error",
    }, { status: 503 });
  }
}
