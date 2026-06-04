/**
 * PR-Tranche-1.6 — env resolver tests.
 *
 * Covers all 4 resolvers per the locked test minimums:
 *   - resolveMuapiBase: 6 cases (undefined, "", whitespace, missing-scheme,
 *     trailing-slash, http accepted)
 *   - resolveAppUrl: 6 cases (header valid, header null + env valid,
 *     header null + env empty [W8 clone], header null + env whitespace,
 *     header null + env missing scheme throws, scheme-less header rejected)
 *   - resolvePocketbasePublicUrl: 3 cases (undefined, empty, missing-scheme)
 *   - resolvePlausibleDomain: 3 cases (undefined, empty, valid pass-through —
 *     no scheme check)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveMuapiBase,
  resolveAppUrl,
  resolvePocketbasePublicUrl,
  resolvePlausibleDomain,
} from "../../lib/env";

// Preserve original values to restore in afterEach so test order can't leak.
const original = {
  MUAPI_URL: process.env.MUAPI_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_POCKETBASE_URL: process.env.NEXT_PUBLIC_POCKETBASE_URL,
  NEXT_PUBLIC_PLAUSIBLE_DOMAIN: process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN,
};

function setOrDelete(name: keyof typeof original, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  setOrDelete("MUAPI_URL", original.MUAPI_URL);
  setOrDelete("NEXT_PUBLIC_APP_URL", original.NEXT_PUBLIC_APP_URL);
  setOrDelete("NEXT_PUBLIC_POCKETBASE_URL", original.NEXT_PUBLIC_POCKETBASE_URL);
  setOrDelete("NEXT_PUBLIC_PLAUSIBLE_DOMAIN", original.NEXT_PUBLIC_PLAUSIBLE_DOMAIN);
});

// ─── resolveMuapiBase ───────────────────────────────────────────────────

describe("resolveMuapiBase", () => {
  beforeEach(() => delete process.env.MUAPI_URL);

  it("returns default when MUAPI_URL is undefined", () => {
    expect(resolveMuapiBase()).toBe("https://api.muapi.ai");
  });

  it("returns default when MUAPI_URL is empty string (the W8 bug case)", () => {
    process.env.MUAPI_URL = "";
    expect(resolveMuapiBase()).toBe("https://api.muapi.ai");
  });

  it("returns default when MUAPI_URL is whitespace-only", () => {
    process.env.MUAPI_URL = "   ";
    expect(resolveMuapiBase()).toBe("https://api.muapi.ai");
  });

  it("throws when scheme is missing", () => {
    process.env.MUAPI_URL = "api.muapi.ai";
    expect(() => resolveMuapiBase()).toThrow(/must include scheme/);
  });

  it("strips trailing slash from valid URL", () => {
    process.env.MUAPI_URL = "https://api.muapi.ai/";
    expect(resolveMuapiBase()).toBe("https://api.muapi.ai");
  });

  it("accepts http for self-hosted dev", () => {
    process.env.MUAPI_URL = "http://localhost:8080";
    expect(resolveMuapiBase()).toBe("http://localhost:8080");
  });
});

// ─── resolveAppUrl ──────────────────────────────────────────────────────

describe("resolveAppUrl", () => {
  beforeEach(() => delete process.env.NEXT_PUBLIC_APP_URL);

  it("returns origin header value when valid with scheme", () => {
    expect(resolveAppUrl("https://my-pr-123.vercel.app")).toBe("https://my-pr-123.vercel.app");
  });

  it("returns env value when header is null and env set with scheme", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.staffd.app";
    expect(resolveAppUrl(null)).toBe("https://staging.staffd.app");
  });

  it("returns default when header is null and env is empty string (the W8 clone path)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "";
    expect(resolveAppUrl(null)).toBe("https://urstaffd.com");
  });

  it("returns default when header is null and env is whitespace-only", () => {
    process.env.NEXT_PUBLIC_APP_URL = "   ";
    expect(resolveAppUrl(null)).toBe("https://urstaffd.com");
  });

  it("throws when header is null and env is missing scheme", () => {
    process.env.NEXT_PUBLIC_APP_URL = "urstaffd.com";
    expect(() => resolveAppUrl(null)).toThrow(/must include scheme/);
  });

  it("does NOT honor scheme-less header — falls through to default when env unset", () => {
    // Operator-set header without scheme is malformed — ignore it.
    expect(resolveAppUrl("urstaffd.com")).toBe("https://urstaffd.com");
  });
});

// ─── resolvePocketbasePublicUrl ─────────────────────────────────────────

describe("resolvePocketbasePublicUrl", () => {
  beforeEach(() => delete process.env.NEXT_PUBLIC_POCKETBASE_URL);

  it("returns default when undefined", () => {
    expect(resolvePocketbasePublicUrl()).toBe("http://127.0.0.1:8090");
  });

  it("returns default when empty string", () => {
    process.env.NEXT_PUBLIC_POCKETBASE_URL = "";
    expect(resolvePocketbasePublicUrl()).toBe("http://127.0.0.1:8090");
  });

  it("throws when scheme is missing", () => {
    process.env.NEXT_PUBLIC_POCKETBASE_URL = "pb.railway.internal";
    expect(() => resolvePocketbasePublicUrl()).toThrow(/must include scheme/);
  });
});

// ─── resolvePlausibleDomain ─────────────────────────────────────────────

describe("resolvePlausibleDomain", () => {
  beforeEach(() => delete process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN);

  it("returns default when undefined", () => {
    expect(resolvePlausibleDomain()).toBe("urstaffd.com");
  });

  it("returns default when empty string", () => {
    process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN = "";
    expect(resolvePlausibleDomain()).toBe("urstaffd.com");
  });

  it("passes valid domain through unchanged (no scheme check — accepts bare hostname)", () => {
    process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN = "example.com";
    expect(resolvePlausibleDomain()).toBe("example.com");
  });
});
