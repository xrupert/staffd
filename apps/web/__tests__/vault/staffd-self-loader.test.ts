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

  it("a clientId (agency mode) loads the client vault, not STAFFD self", async () => {
    adminMock.isOperator = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("/clients/")
        ? { ok: true, json: async () => ({ agency_user: "admin-unique-2", name: "Client X" }) }
        : { ok: true, json: async () => ({ items: [] }) },
    ));
    const v = await fetchVault("tok", "admin-unique-2", { clientId: "c1" });
    expect(v!.business_name).toBe("Client X");
  });
});
