/**
 * ensureBaseCollection (W95.4a) — shared idempotent collection setup.
 *
 * The W95.4a intents introduce five near-identical USER_OWNED collections;
 * rather than copy the find-or-create/patch dance into five routes, they all
 * call this. Row-rule enforcement still happens in each route via
 * ensureCollectionRulesWithFreshToken (Standard #1). Pure schema work — no rules
 * here (PB defaults new-collection rules to admin-only until the rule helper
 * applies USER_OWNED_RULES).
 */

import { adminHeaders, pbUrl } from "../pb";

export type FieldDef = { name: string; type: string; required?: boolean } & Record<string, unknown>;
export type EnsureAction = { action: "created" | "noop" | "patched"; added?: string[] };

export async function ensureBaseCollection(token: string, name: string, fields: FieldDef[]): Promise<EnsureAction> {
  const url = pbUrl();
  const colRes = await fetch(`${url}/api/collections/${name}`, { headers: { Authorization: token } });

  if (!colRes.ok) {
    const createRes = await fetch(`${url}/api/collections`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({ name, type: "base", fields }),
    });
    if (!createRes.ok) throw new Error(`Failed to create ${name}: ${await createRes.text()}`);
    return { action: "created" };
  }

  const col = (await colRes.json()) as { id: string; fields?: Array<{ name: string }> };
  const existing = new Set((col.fields ?? []).map((f) => f.name));
  const missing = fields.filter((f) => !existing.has(f.name));
  if (missing.length === 0) return { action: "noop" };

  const patchRes = await fetch(`${url}/api/collections/${col.id}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify({ fields: [...(col.fields ?? []), ...missing] }),
  });
  if (!patchRes.ok) throw new Error(`Failed to patch ${name}: ${await patchRes.text()}`);
  return { action: "patched", added: missing.map((f) => f.name) };
}
