/**
 * W91 — resolveCredentials. User's own creds win; the operator env fallback
 * is SUPER-ADMIN ONLY (no cross-tenant leak for ordinary customers).
 * Pure logic via injected deps; no PB / HTTP.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveCredentials, type ResolveDeps } from "../../app/api/_lib/integrations/resolve";

function deps(over: Partial<ResolveDeps> = {}): ResolveDeps {
  return {
    fetchUserRow: vi.fn(async () => null),
    decrypt: vi.fn((b: string) => b.replace("enc:", "")),
    isOperator: vi.fn(async () => false),
    ...over,
  };
}

beforeEach(() => {
  vi.stubEnv("TWENTY_API_URL", "https://crm.operator.test");
  vi.stubEnv("TWENTY_API_KEY", "operator-twenty-key");
  vi.stubEnv("CHATWOOT_URL", "https://cw.operator.test");
  vi.stubEnv("CHATWOOT_API_KEY", "op-cw-key");
  vi.stubEnv("CHATWOOT_ACCOUNT_ID", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("resolveCredentials", () => {
  it("prefers the user's stored creds (decrypts the key) — any user", async () => {
    const d = deps({
      fetchUserRow: vi.fn(async () => ({ connection_url: "https://crm.jane.test", api_key: "enc:jane-key", additional_config: { account_id: "9" }, status: "connected" })),
    });
    const r = await resolveCredentials({ id: "jane", email: "jane@acme.com" }, "twenty", d);
    expect(r).toMatchObject({ source: "user", url: "https://crm.jane.test", key: "jane-key", config: { account_id: "9" } });
    expect(d.decrypt).toHaveBeenCalledWith("enc:jane-key");
  });

  it("a non-operator with no usable row gets null — NEVER the operator's data", async () => {
    const d = deps({ isOperator: vi.fn(async () => false) });
    expect(await resolveCredentials({ id: "jane", email: "jane@acme.com" }, "twenty", d)).toBeNull();
  });

  it("a non-operator with a row in error state also gets null (no operator leak)", async () => {
    const d = deps({
      fetchUserRow: vi.fn(async () => ({ connection_url: "x", api_key: "enc:broken", additional_config: {}, status: "error" })),
      isOperator: vi.fn(async () => false),
    });
    expect(await resolveCredentials({ id: "jane", email: "jane@acme.com" }, "twenty", d)).toBeNull();
  });

  it("the operator (super-admin) with no row falls back to operator env", async () => {
    const d = deps({ isOperator: vi.fn(async () => true) });
    const r = await resolveCredentials({ id: "admin", email: "admin@staffd.com" }, "chatwoot", d);
    expect(r).toMatchObject({ source: "operator", url: "https://cw.operator.test", key: "op-cw-key", config: { account_id: "1" } });
  });

  it("returns null when the operator env is also absent", async () => {
    vi.stubEnv("TWENTY_API_URL", "");
    vi.stubEnv("TWENTY_API_KEY", "");
    const d = deps({ isOperator: vi.fn(async () => true) });
    expect(await resolveCredentials({ id: "admin" }, "twenty", d)).toBeNull();
  });
});
