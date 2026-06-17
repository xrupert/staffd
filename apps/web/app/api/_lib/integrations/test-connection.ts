/**
 * W91 — minimal live "is this credential valid?" probe per vendor.
 * Each does the cheapest authenticated read the vendor offers. Returns
 * { ok } or { ok:false, error } — never throws.
 */

import type { IntegrationType, Resolved } from "./resolve";

export async function testConnection(type: IntegrationType, r: Resolved): Promise<{ ok: boolean; error?: string }> {
  const base = r.url.replace(/\/$/, "");
  try {
    let res: Response;
    switch (type) {
      case "twenty":
        res = await fetch(`${base}/graphql`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${r.key}` },
          body: JSON.stringify({ query: "query { opportunities(first: 1) { edges { node { id } } } }" }),
        });
        break;
      case "chatwoot":
        res = await fetch(`${base}/api/v1/accounts/${encodeURIComponent(String(r.config.account_id ?? ""))}/conversations?status=open&page=1`, {
          headers: { api_access_token: r.key },
        });
        break;
      case "listmonk":
        res = await fetch(`${base}/api/lists?per_page=1`, {
          headers: { Authorization: `Basic ${Buffer.from(`${r.config.username ?? "api"}:${r.key}`).toString("base64")}` },
        });
        break;
      case "plausible":
        res = await fetch(`${base}/api/v1/stats/aggregate?site_id=${encodeURIComponent(String(r.config.site_id ?? ""))}&period=day&metrics=visitors`, {
          headers: { Authorization: `Bearer ${r.key}` },
        });
        break;
      case "docuseal":
        res = await fetch(`${base}/api/templates?limit=1`, { headers: { "X-Auth-Token": r.key } });
        break;
      default:
        return { ok: false, error: "Unknown integration type" };
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 160);
      return { ok: false, error: `${res.status} ${detail}`.trim() };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "connection failed" };
  }
}
