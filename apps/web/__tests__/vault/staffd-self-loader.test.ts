/**
 * W91.5 — fetchVault injects STAFFD self-knowledge for the super-admin,
 * overriding the businesses row. Customers are unchanged (regression).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const adminMock = vi.hoisted(() => ({ isOperator: false }));
vi.mock("../../app/api/_lib/auth/super-admin", () => ({
  trySuperAdminByUserId: vi.fn(async () => (adminMock.isOperator ? { id: "admin", email: "a@staffd.com" } : null)),
}));
vi.mock("../../app/api/_lib/vault/staffd-self", () => ({
  staffdSelfVault: vi.fn(() => ({ business_name: "STAFFD", brand_voice: "You STAFF your business.", positioning: "The Porsche." })),
}));
vi.mock("../../app/api/_lib/pb", () => ({ pbUrl: () => "https://pb.test", pbEscape: (s: string) => s }));

import { fetchVault } from "../../app/api/_lib/vault/index";

beforeEach(() => { adminMock.isOperator = false; });
afterEach(() => vi.unstubAllGlobals());

describe("fetchVault — STAFFD self override (W91.5)", () => {
  it("super-admin gets STAFFD self-knowledge, NOT the businesses row", async () => {
    adminMock.isOperator = true;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ business_name: "Operator typed this", brand_voice: "wrong" }] }) })));
    const v = await fetchVault("tok", "admin-unique-1");
    expect(v!.business_name).toBe("STAFFD");
    expect(v!.brand_voice).toMatch(/STAFF/);
  });

  it("non-super-admin gets their businesses row (regression — customer path unchanged)", async () => {
    adminMock.isOperator = false;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ business_name: "Acme Co", brand_voice: "friendly" }] }) })));
    const v = await fetchVault("tok", "user-unique-1");
    expect(v!.business_name).toBe("Acme Co");
    expect(v!.brand_voice).toBe("friendly");
  });

  // W95.7.3a — INVARIANT: the operator's identity is absolute. A clientId
  // (e.g. a stale staffd_active_client) can NEVER shadow STAFFD self for the
  // super-admin. The self-override now runs BEFORE the agency-client branch.
  // (This replaces the old W91.5 assertion that pinned the buggy behavior —
  // operator+clientId → client vault — which was the W95.7.2 regression.)
  it("operator + clientId STILL gets STAFFD self (clientId can't shadow the operator)", async () => {
    adminMock.isOperator = true;
    const clientFetch = vi.fn(async (url: string) =>
      url.includes("/clients/")
        ? { ok: true, json: async () => ({ agency_user: "admin-unique-2", name: "Client X" }) }
        : { ok: true, json: async () => ({ items: [] }) },
    );
    vi.stubGlobal("fetch", clientFetch);
    const v = await fetchVault("tok", "admin-unique-2", { clientId: "c1" });
    expect(v!.business_name).toBe("STAFFD"); // self wins
    expect(v!.brand_voice).toMatch(/STAFF/);
    // The operator short-circuits before any clients/ fetch is attempted.
    expect(clientFetch.mock.calls.some(([u]) => String(u).includes("/clients/"))).toBe(false);
  });

  // W94 path preserved: a NON-operator agency user with an owned client still
  // gets the client vault (the legitimate clientId-routing use case).
  it("non-operator agency user + owned clientId gets the client vault (W94 path intact)", async () => {
    adminMock.isOperator = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/clients/")
        ? { ok: true, json: async () => ({ agency_user: "agency-unique-3", name: "Client X" }) }
        : { ok: true, json: async () => ({ items: [{ business_name: "should not be used" }] }) },
    ));
    const v = await fetchVault("tok", "agency-unique-3", { clientId: "c1" });
    expect(v!.business_name).toBe("Client X");
  });

  // Regression pin: operator with NO clientId gets self (the W91.5 baseline,
  // now guarded explicitly so the reorder can't break it).
  it("operator + no clientId gets STAFFD self", async () => {
    adminMock.isOperator = true;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ items: [{ business_name: "typed" }] }) })));
    const v = await fetchVault("tok", "admin-unique-4");
    expect(v!.business_name).toBe("STAFFD");
  });
});
