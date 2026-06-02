#!/usr/bin/env node
/**
 * scripts/preflight-check.mjs — runtime environment + dependency health check.
 *
 * Verifies every env var and external service STAFFD relies on. Required
 * checks failing exit 1; optional checks log a warning but don't fail the
 * script. Designed to be run before a deploy or after rotating credentials.
 *
 *   node scripts/preflight-check.mjs            # full check
 *   node scripts/preflight-check.mjs --quick    # skip live API probes
 *
 * Exit code: 0 if all required checks green; 1 if any required check failed.
 */

const args = new Set(process.argv.slice(2));
const QUICK = args.has("--quick");

const C = {
  ok:   (s) => `\x1b[32m✓\x1b[0m ${s}`,
  warn: (s) => `\x1b[33m⚠\x1b[0m ${s}`,
  err:  (s) => `\x1b[31m✗\x1b[0m ${s}`,
  dim:  (s) => `\x1b[2m${s}\x1b[0m`,
};

const results = [];
function record(name, status, detail, required = true) {
  results.push({ name, status, detail, required });
  const line = status === "ok" ? C.ok(name) : status === "warn" ? C.warn(name) : C.err(name);
  console.log(`${line}${detail ? "  " + C.dim(detail) : ""}`);
}

// ──────────────────────────────────────────────────────────────────────────
// 1. Required env vars (app breaks without these)
// ──────────────────────────────────────────────────────────────────────────

const REQUIRED_ENVS = [
  "NEXT_PUBLIC_POCKETBASE_URL",
  "PB_ADMIN_EMAIL",
  "PB_ADMIN_PASSWORD",
  "ANTHROPIC_API_KEY",
  "MUAPI_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICES",
  "NEXT_PUBLIC_APP_URL",
  "CRON_SECRET",
  "WORKER_SECRET",
];

const VAULT_PHASE2_ENVS = [
  ["VOYAGE_API_KEY", "OPENAI_API_KEY"], // either is acceptable
  ["QDRANT_URL"],
  ["QDRANT_API_KEY"],
];

const OPTIONAL_ENVS = [
  "LISTMONK_URL", "LISTMONK_USERNAME", "LISTMONK_PASSWORD",
  "DOCUSEAL_URL", "DOCUSEAL_API_KEY",
  "TWENTY_API_URL", "TWENTY_API_KEY",
  "CHATWOOT_URL", "CHATWOOT_API_KEY", "CHATWOOT_ACCOUNT_ID",
  "NEXT_PUBLIC_PLAUSIBLE_URL", "NEXT_PUBLIC_PLAUSIBLE_DOMAIN",
  "ADMIN_IP",
];

console.log("\n── ENV VARS ─────────────────────────────────────────");

for (const v of REQUIRED_ENVS) {
  if (process.env[v]) record(`env: ${v}`, "ok", "set");
  else record(`env: ${v}`, "err", "MISSING (required)");
}

for (const group of VAULT_PHASE2_ENVS) {
  const present = group.find((v) => process.env[v]);
  const label = group.length > 1 ? group.join(" || ") : group[0];
  if (present) record(`env: ${label}`, "ok", `${present} set`);
  else record(`env: ${label}`, "err", "MISSING (Vault Phase 2 required)");
}

for (const v of OPTIONAL_ENVS) {
  if (process.env[v]) record(`env: ${v}`, "ok", "set", false);
  else record(`env: ${v}`, "warn", "unset (optional integration disabled)", false);
}

// ──────────────────────────────────────────────────────────────────────────
// 2. STRIPE_PRICES shape — must be parseable JSON with the expected keys
// ──────────────────────────────────────────────────────────────────────────

console.log("\n── CONFIG SHAPE ─────────────────────────────────────");

const REQUIRED_PRICE_KEYS = [
  "starter_monthly", "starter_yearly",
  "growth_monthly", "growth_yearly",
  "pro_monthly", "pro_yearly",
  "agency_monthly", "agency_yearly",
];

try {
  const raw = process.env.STRIPE_PRICES;
  if (!raw) throw new Error("STRIPE_PRICES not set");
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("STRIPE_PRICES must be a JSON object");
  }
  const missing = REQUIRED_PRICE_KEYS.filter((k) => !parsed[k]);
  if (missing.length === 0) {
    record("STRIPE_PRICES shape", "ok", `${Object.keys(parsed).length} prices mapped`);
  } else {
    record("STRIPE_PRICES shape", "warn", `missing keys: ${missing.join(", ")}`, false);
  }
} catch (err) {
  record("STRIPE_PRICES shape", "err", String(err.message ?? err));
}

if (QUICK) {
  console.log("\n" + C.dim("(--quick: skipping live API probes)"));
  printSummary();
  process.exit(summaryExitCode());
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Live probes — each upstream the app actually calls
// ──────────────────────────────────────────────────────────────────────────

console.log("\n── LIVE PROBES ──────────────────────────────────────");

async function probe(name, fn, required = true) {
  try {
    const detail = await fn();
    record(name, "ok", detail);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record(name, required ? "err" : "warn", msg.slice(0, 120), required);
  }
}

async function withTimeout(p, ms, label) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`${label} timeout after ${ms}ms`)), ms);
  try {
    return await p(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

// PocketBase admin auth
await probe("PocketBase admin auth", async () => {
  const url = (process.env.NEXT_PUBLIC_POCKETBASE_URL ?? "").replace(/\/$/, "");
  if (!url) throw new Error("NEXT_PUBLIC_POCKETBASE_URL unset");
  const res = await withTimeout((signal) =>
    fetch(`${url}/api/collections/_superusers/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identity: process.env.PB_ADMIN_EMAIL ?? "",
        password: process.env.PB_ADMIN_PASSWORD ?? "",
      }),
      signal,
    }), 5000, "PB");
  if (!res.ok) throw new Error(`auth-with-password ${res.status}`);
  const { token } = await res.json();
  return token ? "authenticated" : "unexpected response";
});

// PocketBase collections present (post-setup)
await probe("PB collections (post-setup)", async () => {
  const url = (process.env.NEXT_PUBLIC_POCKETBASE_URL ?? "").replace(/\/$/, "");
  const expected = [
    "businesses", "subscriptions", "documents", "conversations",
    "vault_embeddings_index", "vault_patterns", "vault_retrieval_metrics",
    "vault_ingest_queue", "orchestrator_decisions",
  ];
  const authRes = await fetch(`${url}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identity: process.env.PB_ADMIN_EMAIL ?? "",
      password: process.env.PB_ADMIN_PASSWORD ?? "",
    }),
  });
  if (!authRes.ok) throw new Error("auth failed");
  const { token } = await authRes.json();
  const missing = [];
  for (const c of expected) {
    const r = await fetch(`${url}/api/collections/${c}`, { headers: { Authorization: token } });
    if (!r.ok) missing.push(c);
  }
  if (missing.length === 0) return `all ${expected.length} present`;
  throw new Error(`missing: ${missing.join(", ")} — run /api/setup/* routes`);
}, false);

// Qdrant reachable
await probe("Qdrant /collections", async () => {
  const url = (process.env.QDRANT_URL ?? "").replace(/\/$/, "");
  const key = process.env.QDRANT_API_KEY ?? "";
  if (!url || !key) throw new Error("QDRANT_URL / QDRANT_API_KEY unset");
  const res = await withTimeout((signal) =>
    fetch(`${url}/collections`, { headers: { "api-key": key }, signal }),
    5000, "Qdrant");
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  const count = data.result?.collections?.length ?? 0;
  return `${count} collections`;
});

// Voyage embeddings probe (cheap — single token)
await probe("Voyage embeddings", async () => {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY unset (OpenAI fallback will be used)");
  const res = await withTimeout((signal) =>
    fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "voyage-3", input: ["preflight"] }),
      signal,
    }), 5000, "Voyage");
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  const dim = data.data?.[0]?.embedding?.length ?? 0;
  return `${dim}-dim vector returned`;
}, false);

// OpenAI fallback probe
await probe("OpenAI embeddings (fallback)", async () => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY unset");
  const res = await withTimeout((signal) =>
    fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-large", input: "preflight" }),
      signal,
    }), 5000, "OpenAI");
  if (!res.ok) throw new Error(`${res.status}`);
  const data = await res.json();
  const dim = data.data?.[0]?.embedding?.length ?? 0;
  return `${dim}-dim vector returned`;
}, false);

// Anthropic probe — count_tokens is cheap (no generation)
await probe("Anthropic API key", async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY unset");
  const res = await withTimeout((signal) =>
    fetch("https://api.anthropic.com/v1/messages/count_tokens", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "preflight" }],
      }),
      signal,
    }), 5000, "Anthropic");
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status}: ${detail.slice(0, 80)}`);
  }
  const data = await res.json();
  return `${data.input_tokens ?? "?"} tokens for sanity prompt`;
});

// Muapi reachable
await probe("Muapi /api/v1 reachable", async () => {
  const url = (process.env.MUAPI_URL ?? "https://api.muapi.ai").replace(/\/$/, "");
  const key = process.env.MUAPI_API_KEY;
  if (!key) throw new Error("MUAPI_API_KEY unset");
  // Hit the base URL — Muapi doesn't publish a ping endpoint but any
  // authenticated GET that gives us a non-network error proves connectivity.
  const res = await withTimeout((signal) =>
    fetch(`${url}/api/v1/predictions/preflight/result`, {
      headers: { Authorization: `Bearer ${key}` },
      signal,
    }), 5000, "Muapi");
  // 404 (prediction doesn't exist) is the success indicator — we got past auth.
  if (res.status === 401 || res.status === 403) throw new Error(`auth ${res.status}`);
  return `reachable (status ${res.status})`;
});

// Stripe key validates
await probe("Stripe API key", async () => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY unset");
  const res = await withTimeout((signal) =>
    fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${key}` },
      signal,
    }), 5000, "Stripe");
  if (!res.ok) throw new Error(`${res.status}`);
  return "valid (balance endpoint reachable)";
});

// ──────────────────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────────────────

function printSummary() {
  const totals = { ok: 0, warn: 0, err: 0, reqErr: 0 };
  for (const r of results) {
    totals[r.status]++;
    if (r.status === "err" && r.required) totals.reqErr++;
  }
  console.log("\n── SUMMARY ──────────────────────────────────────────");
  console.log(`${C.ok("ok:")}    ${totals.ok}`);
  console.log(`${C.warn("warn:")}  ${totals.warn}  ${C.dim("(optional)")}`);
  console.log(`${C.err("err:")}   ${totals.err}  ${C.dim(`(${totals.reqErr} required)`)}`);
  if (totals.reqErr > 0) {
    console.log(`\n${C.err("PREFLIGHT FAILED")} — ${totals.reqErr} required check(s) red.`);
  } else if (totals.err > 0) {
    console.log(`\n${C.warn("PREFLIGHT PASSED WITH WARNINGS")}`);
  } else {
    console.log(`\n${C.ok("PREFLIGHT GREEN")} — every check passed.`);
  }
}

function summaryExitCode() {
  return results.some((r) => r.status === "err" && r.required) ? 1 : 0;
}

printSummary();
process.exit(summaryExitCode());
