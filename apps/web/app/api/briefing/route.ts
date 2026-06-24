/**
 * CEO Weekly Briefing — thin wrapper over orchestrator `intent:"brief"`.
 *
 * B3 cutover: this route no longer carries its own Claude call, its own
 * activity-rollup logic, or the hand-rolled "Chief of Staff" system prompt.
 * Everything lives in `_lib/orchestrator/handlers/brief.ts`, which uses the
 * real `ceo-chief-of-staff` agent from `packages/agents`.
 *
 * Streaming UX: the orchestrator is non-streaming today, so the brief text
 * is delivered in one chunk. The dashboard's existing reader loop handles
 * single-chunk delivery without change.
 *
 * On `ok:false` (deadline / budget / upstream), we stream the deterministic
 * degraded brief from the orchestrator's fallback layer — never an empty
 * body.
 *
 * W49 — successful briefs persist to `documents` (department "ceo",
 * agent_name "Chief of Staff") so they survive navigation and appear in
 * the Library's CEO tab. Degraded fallbacks do NOT persist (they're an
 * apology, not work — Decision 3). A failed write logs at error level but
 * never blocks the brief reaching the user.
 */

import { runOrchestrator } from "../_lib/orchestrator";
import { adminHeaders, getAdminToken, pbUrl } from "../_lib/pb";
import { enqueue } from "../_lib/vault/queue";
import { verifyUserOwnsSelf } from "../_lib/integrations/identity";

async function persistBrief(opts: {
  userId: string;
  clientId?: string;
  briefText: string;
}): Promise<void> {
  try {
    const date = new Date().toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });
    const token = await getAdminToken();
    const res = await fetch(`${pbUrl()}/api/collections/documents/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        user: opts.userId,
        client: opts.clientId ?? "",
        department: "ceo",
        agent_name: "Chief of Staff",
        prompt: `Weekly briefing — ${date}`,
        output: opts.briefText,
      }),
    });
    if (!res.ok) {
      console.error(`[W49] briefing persist failed user=${opts.userId} status=${res.status}`);
      return;
    }
    const created = (await res.json()) as { id?: string };
    if (created.id) void enqueue("document", created.id);
  } catch (err) {
    console.error("[W49] briefing persist failed:", err);
  }
}

export async function POST(req: Request) {
  let body: { userId?: string; pbToken?: string; clientId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { userId, pbToken, clientId } = body;
  if (!userId || !pbToken) {
    return new Response("Unauthorized", { status: 401 });
  }
  // h6e — bind the body pbToken to the claimed userId before persisting a brief
  // into that user's library/vault via the admin token below.
  if (!(await verifyUserOwnsSelf(userId, pbToken))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const response = await runOrchestrator({
    intent: "brief",
    userId,
    pbToken,
    clientId,
    context: {},
  });

  const briefText = response.ok
    ? (response.decision.task ?? "").trim()
    : (response.degraded.task ?? "").trim();

  // W49 — persist the real brief before streaming (the orchestrator is
  // non-streaming, so the full text is in hand). Success path only.
  if (response.ok && briefText.length > 0) {
    await persistBrief({ userId, clientId, briefText });
  }

  // Last-resort guard — if even the degraded path produced nothing, give the
  // user a coherent message instead of an empty stream.
  const finalText = briefText.length > 0
    ? briefText
    // PR-Tranche-2.6.2 — brand-voiced + accurate-regardless-of-cause
    : "## Weekly Briefing\n\nWorking from limited context right now — your staff is still on duty. Try again in a moment.";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(finalText));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
