import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env.NEXT_PUBLIC_POCKETBASE_URL = "http://pb";
  process.env.PB_ADMIN_EMAIL = "admin@example.com";
  process.env.PB_ADMIN_PASSWORD = "secret";
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_POCKETBASE_URL;
  delete process.env.PB_ADMIN_EMAIL;
  delete process.env.PB_ADMIN_PASSWORD;
});

async function route() {
  return import("../../app/api/setup/eval-registry/route");
}

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("eval registry setup endpoint", () => {
  it("returns 503 when PocketBase is not configured", async () => {
    delete process.env.PB_ADMIN_PASSWORD;
    const { POST } = await route();
    const response = await POST();
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates all eval collections when they do not exist", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith("/_superusers/auth-with-password")) return jsonResponse({ token: "admin-token" });
      if (value.includes("/api/collections/eval_") && !init?.method) return jsonResponse({}, false, 404);
      if (value.endsWith("/api/collections") && init?.method === "POST") return jsonResponse({ id: "created" });
      throw new Error(`Unexpected fetch ${value}`);
    });

    const { POST } = await route();
    const response = await POST();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.collections).toEqual([
      { name: "eval_suites", action: "created" },
      { name: "eval_cases", action: "created" },
      { name: "eval_runs", action: "created" },
    ]);
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/_superusers/auth-with-password"))).toHaveLength(3);
  });

  it("patches missing fields and reports no-op collections", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith("/_superusers/auth-with-password")) return jsonResponse({ token: "admin-token" });
      if (value.endsWith("/api/collections/eval_suites")) return jsonResponse({ id: "suites", fields: [{ name: "suite_id" }] });
      if (value.endsWith("/api/collections/eval_cases")) return jsonResponse({ id: "cases", fields: [{ name: "case_id" }, { name: "suite_id" }, { name: "kind" }, { name: "definition" }] });
      if (value.endsWith("/api/collections/eval_runs")) return jsonResponse({ id: "runs", fields: [{ name: "run_id" }] });
      if (init?.method === "PATCH") return jsonResponse({ ok: true });
      throw new Error(`Unexpected fetch ${value}`);
    });

    const { POST } = await route();
    const response = await POST();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.collections[0].action).toBe("patched");
    expect(body.collections[0].added).toContain("capability");
    expect(body.collections[1]).toMatchObject({ name: "eval_cases", action: "noop", added: [] });
    expect(body.collections[2].action).toBe("patched");
  });

  it("surfaces admin authentication failures", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "bad credentials" }, false, 401));
    const { POST } = await route();
    const response = await POST();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Setup failed", detail: "PocketBase admin authentication failed" });
  });
});
