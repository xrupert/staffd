/**
 * PostizClient (social publishing) — the only path to the Postiz instance.
 * Pins: per-user credential resolution (null when unconnected), the public-api
 * v1 call shapes (list/upload-from-url/create-post), and the org-key auth
 * header on every request.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const resolveMock = vi.hoisted(() => ({
  creds: null as { source: "user" | "operator"; url: string; key: string; config: Record<string, unknown> } | null,
}));
vi.mock("../../app/api/_lib/integrations/resolve", () => ({
  resolveCredentials: async () => resolveMock.creds,
}));

import { PostizClient } from "../../app/api/_lib/integrations/postiz/client";

let calls: { url: string; init?: RequestInit }[];

beforeEach(() => {
  calls = [];
  resolveMock.creds = { source: "user", url: "https://postiz.test/", key: "org_key_1", config: {} };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/integrations")) {
      return { ok: true, json: async () => ([
        { id: "ch1", name: "Acme on X", identifier: "x", disabled: false },
        { id: "ch2", name: "Acme IG", identifier: "instagram", disabled: false },
        { id: "ch3", name: "Old FB", identifier: "facebook", disabled: true },
      ]) };
    }
    if (String(url).includes("/upload-from-url")) {
      return { ok: true, json: async () => ({ id: "m1", path: "/uploads/abc.jpg" }) };
    }
    return { ok: true, json: async () => ({}) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("PostizClient", () => {
  it("forCustomer resolves per-user creds; null when unconnected", async () => {
    expect(await PostizClient.forCustomer("u1")).not.toBeNull();
    resolveMock.creds = null;
    expect(await PostizClient.forCustomer("u1")).toBeNull();
    expect(await PostizClient.forCustomer("")).toBeNull();
  });

  it("listChannels hits /public/v1/integrations with the org key and drops disabled channels", async () => {
    const client = (await PostizClient.forCustomer("u1"))!;
    const channels = await client.listChannels();
    expect(calls[0]!.url).toBe("https://postiz.test/public/v1/integrations");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("org_key_1");
    expect(channels.map((c) => c.id)).toEqual(["ch1", "ch2"]); // ch3 disabled → dropped
  });

  it("uploadFromUrl posts the remote URL and returns {id, path}", async () => {
    const client = (await PostizClient.forCustomer("u1"))!;
    const media = await client.uploadFromUrl("https://muapi.test/img.jpg");
    expect(media).toEqual({ id: "m1", path: "/uploads/abc.jpg" });
    const call = calls.find((c) => c.url.includes("/upload-from-url"))!;
    expect(JSON.parse(call.init!.body as string)).toEqual({ url: "https://muapi.test/img.jpg" });
  });

  it("createPost sends one posts[] entry per channel with content + media", async () => {
    const client = (await PostizClient.forCustomer("u1"))!;
    const ok = await client.createPost({
      type: "now", date: "2026-07-04T12:00:00Z", channelIds: ["ch1", "ch2"],
      content: "Big news!", media: [{ id: "m1", path: "/uploads/abc.jpg" }],
    });
    expect(ok).toBe(true);
    const call = calls.find((c) => c.url.endsWith("/public/v1/posts"))!;
    const body = JSON.parse(call.init!.body as string);
    expect(body.type).toBe("now");
    expect(body.posts).toHaveLength(2);
    expect(body.posts[0]).toEqual({
      integration: { id: "ch1" },
      value: [{ content: "Big news!", image: [{ id: "m1", path: "/uploads/abc.jpg" }] }],
    });
  });

  it("createPost with zero channels refuses without calling the API", async () => {
    const client = (await PostizClient.forCustomer("u1"))!;
    expect(await client.createPost({ type: "now", date: "2026-07-04T12:00:00Z", channelIds: [], content: "x" })).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/posts"))).toBe(false);
  });
});
