/**
 * POST /api/handoff/suggest — orchestrator `intent:"handoff"` endpoint.
 *
 * Returns 2–3 cross-functional next-step suggestions for a generated
 * document. Locked departments are returned with `locked:true` so the
 * frontend can surface them as upsell triggers without routing into them.
 *
 * Body:
 *   {
 *     documentId?: string,   // source artifact — preferred path
 *     sourceDoc?: { department?: string, prompt?: string, outputExcerpt?: string }, // inline alternative
 *     query?:      string,   // optional free-form follow-up question
 *     pbToken:     string,
 *     userId:      string,
 *     clientId?:   string,
 *   }
 *
 * Returns the orchestrator's structured response — `{ok, followUps, ...}` on
 * success or `{ok:false, fallback, degraded:{followUps}}` on failure. Never
 * 500s — the wrapper guarantees a usable envelope.
 *
 * Latency policy (locked, from `policies.handoff`): max_tokens 1024, deadline
 * 6 s, retries 0. Spec §B5 acceptance #3.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { runOrchestrator } from "../../_lib/orchestrator";
import type { ActionCandidate } from "../../_lib/orchestrator/types";

/**
 * W62 — persist the analyzer's action candidates onto the source document
 * so W63 (UI) and W65 (threading) can read them alongside the work.
 * Fire-and-forget admin PATCH; an empty array is persisted deliberately
 * ("analyzed, nothing applies" is a distinct state from "never analyzed").
 */
async function persistActionCandidates(documentId: string, candidates: ActionCandidate[]): Promise<void> {
  try {
    const token = await getAdminToken();
    const res = await fetch(`${pbUrl()}/api/collections/documents/records/${encodeURIComponent(documentId)}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({ action_candidates: candidates }),
    });
    if (!res.ok) {
      console.warn(`[W62] action_candidates persist failed doc=${documentId} status=${res.status}`);
    }
  } catch (err) {
    console.warn("[W62] action_candidates persist failed:", err);
  }
}

const OUTPUT_EXCERPT_CHARS = 1200;

export async function POST(req: Request) {
  let body: {
    documentId?: string;
    sourceDoc?: { department?: string; prompt?: string; outputExcerpt?: string };
    query?: string;
    pbToken?: string;
    userId?: string;
    clientId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const { documentId, query, pbToken, userId, clientId } = body;
  if (!userId || !pbToken) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Resolve the source doc. Prefer fetching by id (richer + auth-checked);
  // fall back to caller-provided sourceDoc fields for callers that already
  // have the content in hand.
  let sourceDoc = body.sourceDoc;
  if (documentId && (!sourceDoc?.department || !sourceDoc?.outputExcerpt)) {
    try {
      const url = pbUrl();
      const docRes = await fetch(
        `${url}/api/collections/documents/records/${encodeURIComponent(documentId)}`,
        { headers: { Authorization: pbToken } }
      );
      if (docRes.ok) {
        const doc = (await docRes.json()) as {
          department?: string;
          prompt?: string;
          output?: string;
        };
        const excerpt = doc.output ?? "";
        sourceDoc = {
          department: doc.department,
          prompt: doc.prompt,
          outputExcerpt: excerpt.length > OUTPUT_EXCERPT_CHARS
            ? excerpt.slice(0, OUTPUT_EXCERPT_CHARS) + "…"
            : excerpt,
        };
      }
    } catch {
      /* fall through with whatever the caller supplied */
    }
  }

  if (!sourceDoc && !query) {
    return Response.json({ error: "missing_source" }, { status: 400 });
  }

  const response = await runOrchestrator({
    intent: "handoff",
    userId,
    pbToken,
    clientId,
    context: { sourceDoc, query },
  });

  // W62 — when the caller identified the source document, persist the
  // platform-action candidates onto it (success or parse-degraded — the
  // analysis axis is independent of the FollowUp parse).
  if (documentId) {
    const candidates = response.ok
      ? response.actionCandidates
      : response.degraded.actionCandidates;
    if (candidates) void persistActionCandidates(documentId, candidates);
  }

  return Response.json(response);
}
