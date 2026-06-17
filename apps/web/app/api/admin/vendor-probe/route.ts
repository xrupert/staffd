/**
 * GET /api/admin/vendor-probe?vendor=listmonk|plausible|docuseal[&create=1]
 * TEMPORARY W95.2 capability probe (super-admin). Removed once reported.
 *
 * Verifies the per-vendor partition shape against the LIVE operator instances
 * (creds in Vercel). staffdCustomerId = PB userId everywhere. Writes are
 * additive + flag-gated (?create=1) and test-named for cleanup. Docuseal is
 * read-only here — creating a real submission would send a signature email.
 */

import { requireSuperAdmin, toAuthErrorResponse } from "../../_lib/auth/super-admin";

const PROBE_TAG = "staffd-probe"; // test-scoped artifact prefix

async function http(url: string, init: RequestInit) {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* keep raw */ }
    return { status: res.status, ok: res.ok, json, raw: text.slice(0, 500) };
  } catch (err) {
    return { status: 0, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(req: Request) {
  try { await requireSuperAdmin(req); } catch (err) { return toAuthErrorResponse(err); }
  const url = new URL(req.url);
  const vendor = url.searchParams.get("vendor");
  const create = url.searchParams.get("create") === "1";
  const f: Record<string, unknown> = {};

  // ── LISTMONK ── Basic auth; partition = list-per-customer ("staffd-<userId>")
  if (vendor === "listmonk") {
    const base = (process.env.LISTMONK_URL ?? "").replace(/\/$/, "");
    const user = process.env.LISTMONK_USERNAME ?? "listmonk";
    const pass = process.env.LISTMONK_PASSWORD ?? "";
    if (!base || !pass) return Response.json({ error: "listmonk not configured" }, { status: 503 });
    const headers = { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };

    f.L1_lists_read = await http(`${base}/api/lists?per_page=1`, { headers });
    if (create) {
      const name = `${PROBE_TAG}-${Date.now()}`;
      const mk = await http(`${base}/api/lists`, { method: "POST", headers, body: JSON.stringify({ name, type: "private", optin: "single" }) });
      f.L2_list_create = mk;
      const listId = (() => { try { return (mk.json as { data?: { id?: number } })?.data?.id ?? null; } catch { return null; } })();
      f.L2_list_id = listId;
      if (listId) {
        f.L3_subscriber_add = await http(`${base}/api/subscribers`, { method: "POST", headers, body: JSON.stringify({ email: `${PROBE_TAG}-${Date.now()}@staffd.test`, name: "Probe", lists: [listId], status: "enabled", preconfirm_subscriptions: true }) });
        f.L4_filter_by_list = await http(`${base}/api/subscribers?list_id=${listId}&per_page=5`, { headers });
        f.L5_cleanup = await http(`${base}/api/lists/${listId}`, { method: "DELETE", headers });
      }
    }
    return Response.json({ vendor, partition: "list-per-customer (staffd-<userId>)", findings: f });
  }

  // ── PLAUSIBLE ── Bearer; partition = site-per-customer (customer domain)
  if (vendor === "plausible") {
    const base = (process.env.PLAUSIBLE_API_URL ?? process.env.NEXT_PUBLIC_PLAUSIBLE_URL ?? "https://plausible.io").replace(/\/$/, "");
    const key = process.env.PLAUSIBLE_API_KEY ?? "";
    if (!key) return Response.json({ error: "plausible not configured" }, { status: 503 });
    const bearer = { Authorization: `Bearer ${key}` };

    if (create) {
      const domain = `${PROBE_TAG}-${Date.now()}.staffd.test`;
      // Sites Provisioning API expects form-encoded.
      f.P1_site_create = await http(`${base}/api/v1/sites`, {
        method: "POST",
        headers: { ...bearer, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ domain }).toString(),
      });
      f.P1_domain = domain;
      f.P2_site_get = await http(`${base}/api/v1/sites/${encodeURIComponent(domain)}`, { headers: bearer });
      f.P3_cleanup = await http(`${base}/api/v1/sites/${encodeURIComponent(domain)}`, { method: "DELETE", headers: bearer });
    } else {
      f.note = "pass ?create=1 to attempt site provisioning (needs a Sites-API-scoped key, which may differ from the Stats key)";
    }
    return Response.json({ vendor, partition: "site-per-customer (customer domain)", findings: f });
  }

  // ── DOCUSEAL ── X-Auth-Token; partition = staffdCustomerId metadata on submission
  // READ-ONLY: creating a submission would send a real signature email.
  if (vendor === "docuseal") {
    const base = (process.env.DOCUSEAL_URL ?? "").replace(/\/$/, "");
    const key = process.env.DOCUSEAL_API_KEY ?? "";
    if (!base || !key) return Response.json({ error: "docuseal not configured" }, { status: 503 });
    const headers = { "X-Auth-Token": key };

    f.D1_templates = await http(`${base}/api/templates?limit=1`, { headers });
    f.D2_submissions = await http(`${base}/api/submissions?limit=1`, { headers });
    // Does the submissions list accept a metadata-equality filter? (shape probe)
    f.D3_metadata_filter = await http(`${base}/api/submissions?limit=1&q=${PROBE_TAG}`, { headers });
    f.note = "metadata partition verified by READ shape only — live create skipped (would email a signer). Inspect D2 for a `metadata` field on existing submissions.";
    return Response.json({ vendor, partition: "staffdCustomerId metadata on submission", findings: f });
  }

  return Response.json({ error: "pass ?vendor=listmonk|plausible|docuseal" }, { status: 400 });
}
