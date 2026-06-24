/**
 * W95.7.3d-h6e — routes that take the session token in the request *body*
 * (briefing, handoff/suggest) must bind that pbToken to the claimed `userId`.
 *
 * Both hold the PocketBase admin token and previously trusted the body `userId`
 * after only checking that *some* non-empty pbToken was present — so any valid
 * session could run the orchestrator as another user and (briefing) persist a
 * document into the victim's library/vault. These pin the 401 when the token
 * does not belong to the claimed user.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const auth = vi.hoisted(() => ({ owns: false }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({
  verifyUserOwnsSelf: async () => auth.owns,
}));
// Keep the orchestrator inert so the *un-gated* path would resolve (proving the
// guard, not orchestrator behaviour, is what produces the 401).
vi.mock("../../app/api/_lib/orchestrator", () => ({
  runOrchestrator: async () => ({ ok: true, decision: { task: "hi" }, actionCandidates: [] }),
}));
vi.mock("../../app/api/_lib/vault/queue", () => ({ enqueue: () => {} }));

import { POST as briefing } from "../../app/api/briefing/route";
import { POST as handoff } from "../../app/api/handoff/suggest/route";

const post = (body: object) =>
  new Request("https://t/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  auth.owns = false; // the presented token does NOT belong to the claimed userId
  process.env.NEXT_PUBLIC_POCKETBASE_URL = "https://pb.test";
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("body-pbToken routes — token must bind to userId (h6e)", () => {
  it("briefing → 401 when the token does not own the claimed userId", async () => {
    const res = await briefing(post({ userId: "victim", pbToken: "attacker-valid-token" }));
    expect(res.status).toBe(401);
  });
  it("handoff/suggest → 401 when the token does not own the claimed userId", async () => {
    const res = await handoff(
      post({ userId: "victim", pbToken: "attacker-valid-token", query: "what next" }),
    );
    expect(res.status).toBe(401);
  });
});
