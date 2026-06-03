/**
 * GET /api/admin/verify-row-rules
 *
 * Decisions 59 + 68 + 64 + 69 — Multi-tenant security verification.
 *
 * READ-ONLY status report. Imports the canonical expected-rules registry
 * from _lib/security/row-rules (Standard #2 — single source of truth).
 * Repair happens via /api/admin/repair-row-rules; setup routes auto-enforce
 * via ensureCollectionRules at the helper level.
 *
 * Auth: super-admin (ADMIN_EMAIL match via whoAmI). Mirrors
 * /api/admin/vault-metrics canonical pattern.
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";
import {
  EXPECTED_COLLECTIONS,
  type ExpectedEntry,
  type RuleSet,
  compareRules,
  fetchCollectionRules,
  listAllCollectionNames,
} from "../../_lib/security/row-rules";

type CollectionStatus = "✅" | "🔴" | "ℹ️";

type CollectionReport = {
  name: string;
  status: CollectionStatus;
  expected_rules: RuleSet | { list: string; view: string; create: string; update: string; delete: string };
  actual_rules: RuleSet | null;
  gaps: string[];
  note?: string;
};

type VerifyReport = {
  timestamp: string;
  collections: CollectionReport[];
  overall_status: CollectionStatus;
  gap_count: number;
  collections_checked: number;
};

async function whoAmI(pbToken: string): Promise<{ id: string; email: string } | null> {
  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { record?: { id?: string; email?: string } };
    if (!data.record?.id || !data.record?.email) return null;
    return { id: data.record.id, email: data.record.email };
  } catch {
    return null;
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pbToken = url.searchParams.get("pbToken") ?? req.headers.get("authorization") ?? "";
  if (!pbToken) return Response.json({ error: "missing_auth" }, { status: 401 });

  const me = await whoAmI(pbToken);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!adminEmail) {
    return Response.json({ error: "admin_not_configured" }, { status: 503 });
  }
  if (me.email.trim().toLowerCase() !== adminEmail) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  let adminToken: string;
  try {
    adminToken = await getAdminToken();
  } catch (err) {
    return Response.json(
      { error: "admin_token_failed", detail: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  const liveCollectionNames = await listAllCollectionNames(adminToken);
  const expectedNames = new Set(EXPECTED_COLLECTIONS.map((e: ExpectedEntry) => e.name));

  const reports: CollectionReport[] = [];
  for (const entry of EXPECTED_COLLECTIONS) {
    const current = await fetchCollectionRules(adminToken, entry.name);
    if (!current) {
      reports.push({
        name: entry.name,
        status: "🔴",
        expected_rules: entry.rules,
        actual_rules: null,
        gaps: ["collection_not_found"],
        note: entry.note,
      });
      continue;
    }
    const gaps = compareRules(entry.rules, current.rules);
    reports.push({
      name: entry.name,
      status: gaps.length === 0 ? "✅" : "🔴",
      expected_rules: entry.rules,
      actual_rules: current.rules,
      gaps,
      note: entry.note,
    });
  }

  for (const name of liveCollectionNames) {
    if (expectedNames.has(name)) continue;
    if (name.startsWith("_")) continue;
    const current = await fetchCollectionRules(adminToken, name);
    reports.push({
      name,
      status: "ℹ️",
      expected_rules: {
        list: "(no expectation)",
        view: "(no expectation)",
        create: "(no expectation)",
        update: "(no expectation)",
        delete: "(no expectation)",
      },
      actual_rules: current?.rules ?? null,
      gaps: ["unexpected_collection — not in 19-collection baseline; review expected pattern"],
    });
  }

  const gapCount = reports
    .filter((r) => r.status === "🔴")
    .reduce((sum, r) => sum + r.gaps.length, 0);
  const hasRed = reports.some((r) => r.status === "🔴");
  const overall: CollectionStatus = hasRed ? "🔴" : "✅";

  const report: VerifyReport = {
    timestamp: new Date().toISOString(),
    collections: reports,
    overall_status: overall,
    gap_count: gapCount,
    collections_checked: reports.length,
  };

  return Response.json(report);
}
