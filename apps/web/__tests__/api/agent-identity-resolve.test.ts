/**
 * W95.7.3d-h6f — /api/agent must not trust a body `userId`. It resolves the
 * trusted user id from the presented pbToken:
 *   - a valid USER session token  → that token's owner (body userId ignored)
 *   - a valid ADMIN/superuser token (internal worker: workflow-drain passes the
 *     admin token as pbToken) → trust the body userId so worker runs keep context
 *   - anything else / no token    → null (anonymous; no user-scoped reads/writes)
 *
 * This pins the resolver so an attacker presenting their own session can never
 * make agent act as another user (voice-profile read, conversation/vault write,
 * trial burn were all keyed on the unverified body userId).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({ pbUrl: () => "https://pb.test" }));

import { resolveAgentUserId } from "../../app/api/_lib/integrations/identity";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { headers?: Record<string, string> }) => {
      const url = String(input);
      const tok = init?.headers?.Authorization ?? "";
      if (url.includes("/users/auth-refresh")) {
        return tok === "user-tok"
          ? { ok: true, json: async () => ({ record: { id: "real-user", email: "u@t" } }) }
          : { ok: false, json: async () => ({}) };
      }
      if (url.includes("/_superusers/auth-refresh")) {
        return tok === "admin-tok"
          ? { ok: true, json: async () => ({ record: { id: "admin" } }) }
          : { ok: false, json: async () => ({}) };
      }
      return { ok: false, json: async () => ({}) };
    }),
  );
});
afterEach(() => vi.restoreAllMocks());

describe("resolveAgentUserId (h6f)", () => {
  it("user session token → the token's own id, ignoring the body userId", async () => {
    expect(await resolveAgentUserId("user-tok", "victim")).toBe("real-user");
  });
  it("admin/worker token → trusts the body userId", async () => {
    expect(await resolveAgentUserId("admin-tok", "task-owner")).toBe("task-owner");
  });
  it("admin token with no body userId → null", async () => {
    expect(await resolveAgentUserId("admin-tok", undefined)).toBeNull();
  });
  it("garbage token → null", async () => {
    expect(await resolveAgentUserId("garbage", "victim")).toBeNull();
  });
  it("no token → null", async () => {
    expect(await resolveAgentUserId(undefined, "victim")).toBeNull();
  });
});
