/**
 * PR-Tranche-2.6.2 — Qdrant client filter-shape contract tests.
 *
 * Root cause locked: qdrant.ts pushed `match: { value: null }` whenever
 * retrieve passed `client: null` (which it did via `clientId ?? null`).
 * Qdrant's MatchInterface enum doesn't accept null → 400 at column ~12,816.
 *
 * These tests assert the post-fix contract:
 *   - search() OMITS the client filter when client is undefined / null / ""
 *   - search() INCLUDES the client filter when client is a non-empty string
 *   - search() OMITS the dept filter when dept is undefined / "" (same rule)
 *   - search() INCLUDES the dept filter when dept is a non-empty string
 *   - The filter never serializes a `null` value for either field
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Set env BEFORE module load. The qdrant client reads these at module-load
// time (top-level consts), so a normal `process.env.X = ...` after import
// is too late. vi.hoisted runs before ES module imports.
vi.hoisted(() => {
  process.env.QDRANT_URL = "https://qdrant.example.test";
  process.env.QDRANT_API_KEY = "test_qdrant_key";
});

import { search } from "../../app/api/_lib/qdrant";

let fetchMock: ReturnType<typeof vi.fn>;
let lastBody: Record<string, unknown> | null;

beforeEach(() => {
  lastBody = null;
  fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    lastBody = init?.body ? JSON.parse(init.body as string) : null;
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: [] }),
      text: async () => "",
    };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => vi.restoreAllMocks());

describe("qdrant.search filter shape (W26 fix contract)", () => {
  it("omits client filter when client is undefined", async () => {
    await search("vault_test", [0.1, 0.2, 0.3], { limit: 5 });
    const body = lastBody!;
    expect(body.filter).toBeUndefined();
    // No `must` array at all when no filters apply
    expect(JSON.stringify(body)).not.toContain("client");
    expect(JSON.stringify(body)).not.toContain("null");
  });

  it("omits client filter when client is null (defense in depth)", async () => {
    await search("vault_test", [0.1], { limit: 5, client: null });
    const body = lastBody!;
    expect(body.filter).toBeUndefined();
    // CRITICAL: must NEVER serialize `match: { value: null }` (the W26 trigger)
    expect(JSON.stringify(body)).not.toContain("\"value\":null");
  });

  it("omits client filter when client is empty string", async () => {
    await search("vault_test", [0.1], { limit: 5, client: "" });
    const body = lastBody!;
    expect(body.filter).toBeUndefined();
  });

  it("includes client filter when client is a non-empty string (Agency mode)", async () => {
    await search("vault_test__abc123", [0.1], { limit: 5, client: "abc123" });
    const body = lastBody!;
    expect(body.filter).toBeDefined();
    const filter = body.filter as { must: Array<{ key: string; match: { value: unknown } }> };
    expect(filter.must).toHaveLength(1);
    expect(filter.must[0]!.key).toBe("client");
    expect(filter.must[0]!.match.value).toBe("abc123");
  });

  it("omits dept filter when dept is empty string", async () => {
    await search("vault_test", [0.1], { limit: 5, dept: "" });
    const body = lastBody!;
    expect(body.filter).toBeUndefined();
  });

  it("includes dept filter when dept is non-empty", async () => {
    await search("vault_test", [0.1], { limit: 5, dept: "marketing" });
    const body = lastBody!;
    const filter = body.filter as { must: Array<{ key: string; match: { value: unknown } }> };
    expect(filter.must).toHaveLength(1);
    expect(filter.must[0]!.key).toBe("dept");
    expect(filter.must[0]!.match.value).toBe("marketing");
  });

  it("composes both filters when both dept + client are non-empty", async () => {
    await search("vault_test__abc", [0.1], { limit: 5, dept: "marketing", client: "abc" });
    const body = lastBody!;
    const filter = body.filter as { must: Array<{ key: string; match: { value: unknown } }> };
    expect(filter.must).toHaveLength(2);
  });

  it("returns [] on 404 (collection not yet created — common for new users)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => "Not Found",
    });
    const result = await search("vault_nonexistent", [0.1], { limit: 5 });
    expect(result).toEqual([]);
  });

  it("throws on 400 (the W26 trigger class — now should never fire from this client)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => "Bad Request",
    });
    await expect(search("vault_test", [0.1], { limit: 5 })).rejects.toThrow(/failed \(400\)/);
  });
});
