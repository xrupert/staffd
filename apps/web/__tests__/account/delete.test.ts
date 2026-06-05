/**
 * PR-Tranche-2 Item 1 — GDPR account deletion route tests.
 *
 * Covers:
 *   - Missing auth → 401
 *   - Super-admin self-delete → 403
 *   - Missing confirm_email → 400
 *   - Wrong confirm_email → 400
 *   - Correct confirm_email + non-admin → cascade delete + Stripe cancel
 *   - Cascade calls delete on every expected collection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "fake_admin_token",
  pbUrl: () => "https://pb.example.test",
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
}));

import { POST } from "../../app/api/account/delete/route";

const USER_ID = "u_test_user";
const USER_EMAIL = "user@example.com";
const ADMIN_EMAIL = "admin@staffd.test";

let fetchMock: ReturnType<typeof vi.fn>;

function makeReq(body: unknown, pbToken = "user_token"): Request {
  return new Request(
    `https://staffd.test/api/account/delete?pbToken=${encodeURIComponent(pbToken)}`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    },
  );
}

const okJson = (data: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

beforeEach(() => {
  process.env.ADMIN_EMAIL = ADMIN_EMAIL;
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ADMIN_EMAIL;
  delete process.env.STRIPE_SECRET_KEY;
});

describe("POST /api/account/delete", () => {
  it("returns 401 without pbToken", async () => {
    const res = await POST(new Request("https://staffd.test/api/account/delete", {
      method: "POST",
      body: JSON.stringify({ confirm_email: USER_EMAIL }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(res.status).toBe(401);
  });

  it("refuses super-admin self-delete with 403", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) {
        return okJson({ record: { id: "u_super", email: ADMIN_EMAIL } });
      }
      return okJson({}, 404);
    });
    const res = await POST(makeReq({ confirm_email: ADMIN_EMAIL }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("super_admin_self_delete_refused");
  });

  it("returns 400 when confirm_email missing", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ record: { id: USER_ID, email: USER_EMAIL } }));
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("confirm_email_required");
  });

  it("returns 400 when confirm_email doesn't match", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ record: { id: USER_ID, email: USER_EMAIL } }));
    const res = await POST(makeReq({ confirm_email: "wrong@example.com" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("confirm_email_mismatch");
  });

  it("cascades delete on correct confirm_email + cancels Stripe + deletes user record", async () => {
    const deletedCollections: string[] = [];
    let stripeCancelled = false;
    let userDeleted = false;

    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) {
        return okJson({ record: { id: USER_ID, email: USER_EMAIL } });
      }
      // Stripe DELETE
      if (u.startsWith("https://api.stripe.com/v1/subscriptions/") && init?.method === "DELETE") {
        stripeCancelled = true;
        return okJson({ id: "sub_123", status: "canceled" });
      }
      // Per-collection row list. Subscriptions row gets BOTH `id` (for cascade
      // delete) and `stripe_subscription_id` (for the Stripe cancel path
      // — both read the same first item).
      const listMatch = u.match(/\/api\/collections\/([^/]+)\/records\?filter=/);
      if (listMatch && (!init?.method || init.method === "GET")) {
        const c = listMatch[1]!;
        if (c === "subscriptions") {
          return okJson({
            items: [{ id: `row_${c}`, stripe_subscription_id: "sub_123" }],
            totalPages: 1,
          });
        }
        return okJson({ items: [{ id: `row_${c}` }], totalPages: 1 });
      }
      // Per-collection row delete
      const delMatch = u.match(/\/api\/collections\/([^/]+)\/records\/([^?]+)$/);
      if (delMatch && init?.method === "DELETE") {
        const collection = delMatch[1]!;
        if (collection === "users") {
          userDeleted = true;
        } else {
          deletedCollections.push(collection);
        }
        return okJson({});
      }
      return okJson({}, 404);
    });

    const res = await POST(makeReq({ confirm_email: USER_EMAIL }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user_deleted).toBe(true);
    expect(body.stripe.cancelled).toBe(true);

    // Spot-check that core collections were hit
    expect(deletedCollections).toContain("documents");
    expect(deletedCollections).toContain("conversations");
    expect(deletedCollections).toContain("vault_patterns");
    expect(deletedCollections).toContain("subscriptions");
    expect(stripeCancelled).toBe(true);
    expect(userDeleted).toBe(true);
  });

  it("is case-insensitive on confirm_email match", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) {
        return okJson({ record: { id: USER_ID, email: USER_EMAIL } });
      }
      // Empty cascades + no subscription
      if (u.includes("/records?filter=")) return okJson({ items: [], totalPages: 0 });
      return okJson({});
    });
    const res = await POST(makeReq({ confirm_email: USER_EMAIL.toUpperCase() }));
    expect(res.status).toBe(200);
  });
});
