/**
 * W95.7.3d-h6d — admin-token routes that trusted a body/query `userId`.
 *
 * Each of these routes uses the PocketBase ADMIN token (which bypasses row
 * rules) while keying the per-user operation on a caller-supplied `userId`.
 * Without authenticating the caller that is an IDOR / abuse vector: a client
 * read/write/delete (clients), a UX-state change (departments/choose), trial
 * accounting (trial), and background-task enqueue (workflow/enqueue) could all
 * be driven for an arbitrary victim id. These pin the 401-without-a-session
 * guard so the caller can only ever act as their authenticated self.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: async () => auth.user }));

import { GET as clientsGet, POST as clientsPost } from "../../app/api/clients/route";
import { PATCH as clientPatch, DELETE as clientDelete } from "../../app/api/clients/[id]/route";
import { POST as deptChoose } from "../../app/api/departments/choose/route";
import { GET as trialGet, POST as trialPost } from "../../app/api/trial/route";
import { POST as enqueue } from "../../app/api/workflow/enqueue/route";

const get = (qs = "") => new Request(`https://t/x${qs}`);
const post = (body: object) =>
  new Request("https://t/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({ id: "client123" }) };

beforeEach(() => {
  auth.user = null; // unauthenticated
  process.env.NEXT_PUBLIC_POCKETBASE_URL = "https://pb.test";
  process.env.PB_ADMIN_EMAIL = "a@b.c";
  process.env.PB_ADMIN_PASSWORD = "x";
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("admin-token routes — auth required, no body/query userId trust (h6d)", () => {
  it("clients GET → 401 without a session", async () => {
    expect((await clientsGet(get("?userId=victim"))).status).toBe(401);
  });
  it("clients POST → 401 without a session", async () => {
    expect((await clientsPost(post({ userId: "victim", name: "Acme" }))).status).toBe(401);
  });
  it("clients/[id] PATCH → 401 without a session", async () => {
    expect((await clientPatch(post({ userId: "victim", name: "x" }), ctx)).status).toBe(401);
  });
  it("clients/[id] DELETE → 401 without a session", async () => {
    expect((await clientDelete(get("?userId=victim"), ctx)).status).toBe(401);
  });
  it("departments/choose POST → 401 without a session", async () => {
    expect((await deptChoose(post({ userId: "victim", departments: ["hr"] }))).status).toBe(401);
  });
  it("trial GET → 401 without a session", async () => {
    expect((await trialGet(get("?userId=victim"))).status).toBe(401);
  });
  it("trial POST → 401 without a session", async () => {
    expect((await trialPost(post({ userId: "victim", department: "hr" }))).status).toBe(401);
  });
  it("workflow/enqueue POST → 401 without a session", async () => {
    expect(
      (await enqueue(post({ userId: "victim", departmentId: "hr", inputPayload: { a: 1 } }))).status,
    ).toBe(401);
  });
});
