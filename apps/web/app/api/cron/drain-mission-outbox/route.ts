import { drainMissionOutbox } from "../../_lib/orchestrator/mission-outbox.server";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const result = await drainMissionOutbox();
    return Response.json({ ok: result.failed === 0, ...result });
  } catch (error) {
    console.error("mission outbox cron failed:", error);
    return Response.json(
      { error: "mission_outbox_drain_failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
