/**
 * GET /api/admin/integrations-health  — operator diagnostic.
 *
 * Read-only connectivity + auth check for the self-hosted integrations
 * (Twenty, Chatwoot, Listmonk, Docuseal). Confirms each is configured AND
 * the stored credentials actually authenticate — WITHOUT creating any
 * records. Super-admin gated; returns status only, never secrets.
 *
 * Status per integration:
 *   not_configured — env vars absent
 *   ok             — reachable + 2xx (credentials work)
 *   auth_failed    — reachable but 401/403 (bad/expired credentials)
 *   error          — reachable but other non-2xx (misconfigured URL/path)
 *   unreachable    — network error / DNS / timeout
 */

import { requireSuperAdmin, toAuthErrorResponse } from "../../_lib/auth/super-admin";

export type ProbeStatus = "not_configured" | "ok" | "auth_failed" | "error" | "unreachable";

/** Pure classifier — exported for tests. */
export function classifyProbe(
  configured: boolean,
  result: { ok: boolean; status: number } | null,
): ProbeStatus {
  if (!configured) return "not_configured";
  if (result === null) return "unreachable";
  if (result.ok) return "ok";
  if (result.status === 401 || result.status === 403) return "auth_failed";
  return "error";
}

/** Run a read-only probe; never throws — a thrown fetch becomes null → unreachable. */
async function probe(
  configured: boolean,
  fn: () => Promise<{ ok: boolean; status: number }>,
): Promise<ProbeStatus> {
  if (!configured) return "not_configured";
  try {
    return classifyProbe(true, await fn());
  } catch {
    return classifyProbe(true, null);
  }
}

async function probeTwenty(): Promise<ProbeStatus> {
  const url = (process.env.TWENTY_API_URL ?? "").replace(/\/$/, "");
  const key = process.env.TWENTY_API_KEY ?? "";
  return probe(!!url && !!key, async () => {
    const res = await fetch(`${url}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: "{ __typename }" }),
    });
    return { ok: res.ok, status: res.status };
  });
}

async function probeChatwoot(): Promise<ProbeStatus> {
  const base = (process.env.CHATWOOT_URL ?? "").replace(/\/$/, "");
  const key = process.env.CHATWOOT_API_KEY ?? "";
  const acct = process.env.CHATWOOT_ACCOUNT_ID ?? "";
  return probe(!!base && !!key && !!acct, async () => {
    const res = await fetch(`${base}/api/v1/accounts/${acct}/inboxes`, {
      headers: { api_access_token: key },
    });
    return { ok: res.ok, status: res.status };
  });
}

async function probeListmonk(): Promise<ProbeStatus> {
  const base = (process.env.LISTMONK_URL ?? "").replace(/\/$/, "");
  const user = process.env.LISTMONK_USERNAME ?? "listmonk";
  const pass = process.env.LISTMONK_PASSWORD ?? "";
  return probe(!!base && !!pass, async () => {
    const auth = Buffer.from(`${user}:${pass}`).toString("base64");
    const res = await fetch(`${base}/api/campaigns?page=1&per_page=1`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    return { ok: res.ok, status: res.status };
  });
}

async function probeDocuseal(): Promise<ProbeStatus> {
  const base = (process.env.DOCUSEAL_URL ?? "").replace(/\/$/, "");
  const key = process.env.DOCUSEAL_API_KEY ?? "";
  return probe(!!base && !!key, async () => {
    const res = await fetch(`${base}/api/templates?limit=1`, {
      headers: { "X-Auth-Token": key },
    });
    return { ok: res.ok, status: res.status };
  });
}

export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
  } catch (err) {
    return toAuthErrorResponse(err);
  }

  const [twenty, chatwoot, listmonk, docuseal] = await Promise.all([
    probeTwenty(),
    probeChatwoot(),
    probeListmonk(),
    probeDocuseal(),
  ]);

  const integrations = { twenty, chatwoot, listmonk, docuseal };
  const allOk = Object.values(integrations).every((s) => s === "ok");

  return Response.json({ ok: true, allOk, integrations });
}
