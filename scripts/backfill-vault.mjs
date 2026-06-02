#!/usr/bin/env node
/**
 * scripts/backfill-vault.mjs — one-shot Vault ingestion backfill.
 *
 * Chunks through every existing `documents` row and enqueues each into
 * `vault_ingest_queue` for the V4a worker to consume. Idempotent: the
 * `source_id` UNIQUE index on the queue means re-running this script does
 * not produce duplicate rows — pre-existing entries are silently skipped.
 *
 * Usage:
 *
 *   NEXT_PUBLIC_POCKETBASE_URL=...  \
 *   PB_ADMIN_EMAIL=...              \
 *   PB_ADMIN_PASSWORD=...           \
 *   node scripts/backfill-vault.mjs
 *
 * Flags (optional):
 *
 *   --kind=document      kind to enqueue (default: document)
 *   --since=2026-01-01   only backfill documents created on or after this
 *                         ISO date (skip ancient docs that aren't worth
 *                         indexing)
 *   --limit=N            stop after enqueueing N docs (for partial runs)
 *   --per-page=100       PB pagination size
 *
 * Notes:
 *
 *   • No TS imports — pure ESM + fetch, runnable with plain `node`.
 *   • Direct PB writes; never hits /api/vault/enqueue (avoids round-tripping
 *     through Vercel for thousands of small POSTs).
 *   • Exit code 0 on success, 1 on auth/setup failure.
 */

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a) => a.replace(/^--/, "").split("="))
    .map(([k, v]) => [k, v ?? "true"])
);

const KIND = args["kind"] || "document";
const SINCE = args["since"] || null;
const LIMIT = args["limit"] ? parseInt(args["limit"], 10) : Infinity;
const PER_PAGE = args["per-page"] ? parseInt(args["per-page"], 10) : 100;

const PB_URL = (process.env.NEXT_PUBLIC_POCKETBASE_URL || process.env.POCKETBASE_URL || "").replace(/\/$/, "");
const PB_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_PASS = process.env.PB_ADMIN_PASSWORD;

if (!PB_URL || !PB_EMAIL || !PB_PASS) {
  console.error("FATAL: NEXT_PUBLIC_POCKETBASE_URL, PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD required.");
  process.exit(1);
}

const COLLECTION = KIND === "conversation" ? "conversations" : "documents";

function pbDateNow() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

async function getAdminToken() {
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASS }),
  });
  if (!res.ok) {
    console.error(`FATAL: PB admin auth failed (${res.status})`);
    process.exit(1);
  }
  const { token } = await res.json();
  return token;
}

async function enqueueOne(token, sourceId) {
  const res = await fetch(`${PB_URL}/api/collections/vault_ingest_queue/records`, {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: KIND,
      source_id: sourceId,
      status: "pending",
      attempts: 0,
      next_run_at: pbDateNow(),
    }),
  });
  if (res.ok) return "enqueued";
  // Unique-index violation = already in the queue. PB returns 400 with a
  // validation error payload — treat as "already present".
  if (res.status === 400) return "duplicate";
  const detail = await res.text();
  console.warn(`  enqueue ${sourceId} failed (${res.status}): ${detail.slice(0, 200)}`);
  return "error";
}

async function main() {
  const token = await getAdminToken();
  console.log(`Backfill kind=${KIND} from collection=${COLLECTION}${SINCE ? ` since=${SINCE}` : ""} limit=${LIMIT === Infinity ? "all" : LIMIT}`);

  let page = 1;
  const tally = { enqueued: 0, duplicate: 0, error: 0, seen: 0 };

  while (true) {
    const filter = SINCE ? `(created>='${SINCE} 00:00:00')` : "";
    const qs = new URLSearchParams({
      perPage: String(PER_PAGE),
      page: String(page),
      fields: "id,created",
      sort: "created",
    });
    if (filter) qs.set("filter", filter);

    const res = await fetch(`${PB_URL}/api/collections/${COLLECTION}/records?${qs.toString()}`, {
      headers: { Authorization: token },
    });
    if (!res.ok) {
      console.error(`FATAL: failed to list ${COLLECTION} (${res.status})`);
      process.exit(1);
    }
    const data = await res.json();
    const items = data.items || [];
    if (items.length === 0) break;

    for (const item of items) {
      if (tally.seen >= LIMIT) break;
      tally.seen++;
      const outcome = await enqueueOne(token, item.id);
      tally[outcome]++;
    }

    console.log(
      `  page ${page}: seen=${tally.seen} enqueued=${tally.enqueued} duplicate=${tally.duplicate} error=${tally.error}`
    );

    if (items.length < PER_PAGE) break;
    if (tally.seen >= LIMIT) break;
    page++;
  }

  console.log(`Done. ${tally.enqueued} enqueued, ${tally.duplicate} duplicates, ${tally.error} errors out of ${tally.seen} scanned.`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
