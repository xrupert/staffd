/**
 * W95.4b — GET /api/front-desk/<list>: USER-scoped, server canonical order,
 * top-10. tasks/followups = pending-first, due asc, nulls last; leads = -created.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const who = vi.hoisted(() => ({ user: { id: "userA", email: "a@x.com" } as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: vi.fn(async () => who.user) }));
vi.mock("../../app/api/_lib/pb", () => ({ pbUrl: () => "https://pb.test", getAdminToken: async () => "tok", pbEscape: (s: string) => s }));

import { GET } from "../../app/api/front-desk/[list]/route";

let items: unknown[];
function setFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/records?")) return { ok: true, json: async () => ({ items }) };
    return { ok: true, json: async () => ({}) };
  }));
}
const call = (list: string) => GET(new Request("https://t/api/front-desk/" + list, { headers: { authorization: "tok" } }), { params: Promise.resolve({ list }) });

beforeEach(() => setFetch());
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/front-desk/<list>", () => {
  it("orders tasks: pending before done, due asc, nulls last", async () => {
    items = [
      { id: "t1", status: "pending", due_date: "2026-08-01", created: "2026-06-01" },
      { id: "t2", status: "done", due_date: "2026-01-01", created: "2026-06-02" },
      { id: "t3", status: "pending", due_date: "", created: "2026-06-03" },
      { id: "t4", status: "pending", due_date: "2026-07-01", created: "2026-06-04" },
    ];
    const d = await (await call("tasks")).json() as { items: { id: string }[] };
    expect(d.items.map((r) => r.id)).toEqual(["t4", "t1", "t3", "t2"]);
  });

  it("passes leads through in server -created order and caps at 10", async () => {
    items = Array.from({ length: 12 }, (_, i) => ({ id: `l${i}`, status: "new", created: `2026-06-${12 - i}` }));
    const d = await (await call("leads")).json() as { items: { id: string }[] };
    expect(d.items).toHaveLength(10);
    expect(d.items[0]!.id).toBe("l0"); // first as returned by PB
  });

  it("401 unauth, 404 unknown list", async () => {
    who.user = null;
    expect((await call("tasks")).status).toBe(401);
    who.user = { id: "userA", email: "a@x.com" };
    expect((await call("rockets")).status).toBe(404);
  });
});
