/**
 * POST /api/vault/search  — Smart Search (MX-4).
 *
 * Body: { pbToken, query, clientId? }
 * Returns: { results: [{ sourceId, sourceKind, dept, summary, score }], degraded }
 *
 * Exposes the Living Vault semantic retrieval so users can search across
 * everything their staff has produced — the "Smart Search across all your
 * team's work" the pricing page sells.
 *
 * Security: the user is resolved from the PB auth token (auth-refresh),
 * never from the request body — so a caller can't search another user's
 * vault. Only document / conversation hits are returned (patterns are an
 * internal ranking signal, not user-facing search results).
 *
 * Fail-safe: retrieve() never throws — on any embeddings/Qdrant/PB error it
 * returns [] with costFlag:"degraded", which we surface as `degraded:true`
 * so the UI can show a soft "search is warming up" note instead of an error.
 */

import { retrieve } from "../../_lib/vault/retrieve";
import { pbUrl } from "../../_lib/pb";

async function whoAmI(pbToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${pbUrl()}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { record?: { id?: string } };
    return data.record?.id ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    pbToken?: string;
    query?: string;
    clientId?: string;
  } | null;

  const pbToken = body?.pbToken ?? req.headers.get("authorization") ?? "";
  const query = (body?.query ?? "").trim();

  if (!pbToken) return Response.json({ error: "missing_auth" }, { status: 401 });
  if (!query) return Response.json({ error: "query_required" }, { status: 400 });

  const userId = await whoAmI(pbToken);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const result = await retrieve(userId, query, {
    topK: 12,
    maxTokens: 4_000,
    clientId: body?.clientId ?? null,
    intent: "agent",
  });

  const results = result.items
    .filter((it) => it.sourceKind === "document" || it.sourceKind === "conversation")
    .map((it) => ({
      sourceId: it.sourceId,
      sourceKind: it.sourceKind,
      dept: it.dept ?? null,
      summary: it.summary,
      score: it.score,
    }));

  return Response.json({ results, degraded: result.costFlag === "degraded" });
}
