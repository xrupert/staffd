/**
 * PostizClient — the ONLY path to the self-hosted Postiz instance (social
 * publishing). Postiz's tenant isolation is ORGANIZATION-level: every API key
 * is scoped to one Postiz Organization, so the tenant tag here IS the key —
 * credentials resolve per user via resolveCredentials("postiz") (user's own
 * org key wins; operator env fallback is super-admin-only, like every vendor).
 *
 * API surface used (verified against postiz-app public-api v1):
 *   GET  /public/v1/integrations       — list connected social channels
 *   POST /public/v1/upload-from-url    — ingest a remote image (Muapi URL) →
 *                                        Postiz-hosted media {id, path}
 *   POST /public/v1/posts              — create draft/scheduled/immediate post
 * Auth: `Authorization: <api-key>` (org-scoped).
 */

import { resolveCredentials } from "../resolve";

export type PostizChannel = {
  id: string;
  name: string;
  identifier: string; // provider slug: "x", "linkedin", "instagram", ...
  picture?: string;
  disabled?: boolean;
};

export type PostizMedia = { id: string; path: string };

export type CreatePostInput = {
  /** "now" posts immediately; "schedule" requires date; "draft" skips validation. */
  type: "now" | "schedule" | "draft";
  /** ISO datetime — required by the API even for "now" (used as the anchor). */
  date: string;
  channelIds: string[];
  content: string;
  media?: PostizMedia[];
};

export class PostizClient {
  private constructor(private readonly base: string, private readonly key: string) {}

  /** Operator env present? (health report; per-user creds resolve separately). */
  static get configured(): boolean {
    return !!(process.env.POSTIZ_URL ?? "").trim() && !!(process.env.POSTIZ_API_KEY ?? "").trim();
  }

  /**
   * Resolve the customer's Postiz org credentials. Null when not connected —
   * callers surface "connect social publishing" rather than throwing.
   */
  static async forCustomer(userId: string | null | undefined): Promise<PostizClient | null> {
    const id = (userId ?? "").trim();
    if (!id) return null;
    const creds = await resolveCredentials({ id }, "postiz");
    if (!creds) return null;
    return new PostizClient(creds.url.replace(/\/$/, ""), creds.key);
  }

  private async pz(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: unknown }> {
    const res = await fetch(`${this.base}/public/v1${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: this.key, ...(init.headers ?? {}) },
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { ok: res.ok, status: res.status, json };
  }

  /** Connected social channels for this org (id + provider + display name). */
  async listChannels(): Promise<PostizChannel[]> {
    const res = await this.pz(`/integrations`);
    if (!res.ok || !Array.isArray(res.json)) return [];
    return (res.json as PostizChannel[]).filter((c) => c?.id && !c.disabled);
  }

  /** Ingest a remote image URL (e.g. a Muapi-generated visual) into Postiz media. */
  async uploadFromUrl(url: string): Promise<PostizMedia | null> {
    const res = await this.pz(`/upload-from-url`, { method: "POST", body: JSON.stringify({ url }) });
    if (!res.ok) return null;
    const d = res.json as { id?: string; path?: string };
    return d?.id && d?.path ? { id: d.id, path: d.path } : null;
  }

  /** Create one post across the given channels. Returns true on acceptance. */
  async createPost(input: CreatePostInput): Promise<boolean> {
    if (input.channelIds.length === 0) return false;
    const res = await this.pz(`/posts`, {
      method: "POST",
      body: JSON.stringify({
        type: input.type,
        date: input.date,
        shortLink: false,
        posts: input.channelIds.map((id) => ({
          integration: { id },
          value: [{ content: input.content, image: input.media ?? [] }],
        })),
      }),
    });
    return res.ok;
  }
}
