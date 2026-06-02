/**
 * Orchestrator decision logger — writes one row to `orchestrator_decisions`
 * per orchestrator request. Spec §B1 acceptance #5.
 *
 * Fire-and-forget: any PB failure is swallowed. We never block a response
 * because the audit log had a bad moment.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../pb";
import type { DecisionLog } from "./types";

export async function logDecision(row: DecisionLog): Promise<void> {
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    await fetch(`${url}/api/collections/orchestrator_decisions/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        user: row.user || null,
        intent: row.intent,
        decision_json: row.decision_json ?? null,
        latency_ms: row.latency_ms ?? 0,
        attempts: row.attempts ?? 0,
        tokens_in: row.tokens_in ?? 0,
        tokens_out: row.tokens_out ?? 0,
        fallback: row.fallback ?? null,
        vault_cost_flag: row.vault_cost_flag ?? null,
        model: row.model ?? null,
        estimated_cost_usd: row.estimated_cost_usd ?? null,
      }),
    });
  } catch {
    /* best-effort */
  }
}
