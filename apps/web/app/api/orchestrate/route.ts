/**
 * Command Center routing — streams a rationale + READY:{...} marker so the
 * existing CommandCenter.tsx UI keeps working without a frontend change.
 *
 * B2 cutover: this route no longer carries its own Claude call or
 * `DEPT_CAPABILITIES` map. It delegates to `runOrchestrator` with
 * `intent:"route"` and synthesizes the streamed text payload the frontend
 * already expects.
 *
 * Streaming UX: the orchestrator is non-streaming today, so we emit the full
 * payload in one chunk. The CC's `TextDecoder({stream:true})` loop handles
 * single-chunk delivery without changes. Future: if real streaming is
 * needed, the orchestrator wrapper would have to grow a streaming variant.
 *
 * Frontend contract preserved:
 *   • `READY:{"department":"...","task":"...","lockedAlternative":"..."}`
 *     emitted on its own line at the end.
 *   • The rationale text precedes the marker and is what the user sees as
 *     the coordinator's reply.
 *   • CommandCenter.tsx parses `READY:` to drive the confirmation UI and
 *     handles EXECUTE locally — that flow is unchanged.
 */

import { runOrchestrator } from "../_lib/orchestrator";

type IncomingMessage = { role: "user" | "assistant"; content: string };

function extractLockedAlternative(notes: string | undefined): string {
  if (!notes) return "";
  const m = notes.match(/^lockedAlternative:(.+)$/);
  return m?.[1]?.trim() ?? "";
}

function lastUserMessage(messages: IncomingMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user" && m.content.trim()) return m.content;
  }
  return "";
}

export async function POST(req: Request) {
  let body: {
    messages?: IncomingMessage[];
    userId?: string;
    pbToken?: string;
    clientId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const messages = body.messages ?? [];
  if (!messages.length) {
    return new Response("Messages required", { status: 400 });
  }

  const userMessage = lastUserMessage(messages);

  const response = await runOrchestrator({
    intent: "route",
    userId: body.userId ?? "",
    pbToken: body.pbToken ?? "",
    clientId: body.clientId,
    context: {
      messages,
      message: userMessage,
    },
  });

  // Pull department / task / rationale / lockedAlternative from either the
  // success decision or the degraded fallback — the envelope shape is the
  // same down both paths.
  let department: string;
  let task: string;
  let rationale: string;
  let lockedAlt: string;

  if (response.ok) {
    department = response.decision.department ?? "marketing";
    task = (response.decision.task ?? userMessage).trim() || userMessage;
    rationale = (response.decision.rationale ?? "").trim();
    lockedAlt = extractLockedAlternative(response.notes);
  } else {
    department = response.degraded.department ?? "marketing";
    task = (response.degraded.task ?? userMessage).trim() || userMessage;
    rationale = (response.degraded.rationale ?? "").trim();
    lockedAlt = "";
  }

  const readyLine = `READY:${JSON.stringify({
    department,
    task,
    lockedAlternative: lockedAlt,
  })}`;

  const streamText = rationale ? `${rationale}\n\n${readyLine}` : readyLine;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(streamText));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
