/**
 * GET /api/admin/twenty-probe — TEMPORARY W95.1 capability probe (super-admin).
 *
 * Answers the W80 "needs deeper investigation" flag against the LIVE operator
 * Twenty instance (creds in Vercel env, not local). Read-mostly; the only write
 * is the additive `staffdCustomerId` custom field on Person — which the
 * dispatched tag-partition architecture needs anyway ("add it via API or
 * document the operator UI step"). Each step is isolated + reports raw results.
 *
 * Remove after the probe is reported + the partition shape is ratified.
 */

import { requireSuperAdmin, toAuthErrorResponse } from "../../_lib/auth/super-admin";

const FIELD = "staffdCustomerId";

async function gql(base: string, path: string, key: string, query: string, variables?: unknown) {
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* keep raw */ }
    return { status: res.status, ok: res.ok, json, raw: text.slice(0, 600) };
  } catch (err) {
    return { status: 0, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(req: Request) {
  try { await requireSuperAdmin(req); } catch (err) { return toAuthErrorResponse(err); }

  const base = (process.env.TWENTY_API_URL ?? "").replace(/\/$/, "");
  const key = process.env.TWENTY_API_KEY ?? "";
  if (!base || !key) return Response.json({ error: "TWENTY env not configured" }, { status: 503 });

  const findings: Record<string, unknown> = { base_has_trailing: false };
  const url = new URL(req.url);
  const doCreate = url.searchParams.get("create") === "1"; // gate the write behind an explicit flag

  // A. Does Person already expose the custom field? (data-API introspection)
  findings.A_person_fields = await gql(base, "/graphql", key,
    `query { __type(name: "Person") { fields { name } } }`);

  // B. Unfiltered people query — confirms single-tenant leak (returns all).
  findings.B_unfiltered = await gql(base, "/graphql", key,
    `query { people(first: 3) { totalCount edges { node { id } } } }`);

  // C. Filtered by the custom field (only meaningful once the field exists).
  findings.C_filtered = await gql(base, "/graphql", key,
    `query { people(first: 3, filter: { ${FIELD}: { eq: "probe-nonexistent" } }) { totalCount } }`);

  // D0. Introspect the metadata `objects` query signature + ObjectFilter shape.
  findings.D0_objects_signature = await gql(base, "/metadata", key,
    `query { __schema { queryType { fields { name args { name type { name ofType { name } } } } } } }`);
  findings.D0_object_filter = await gql(base, "/metadata", key,
    `query { __type(name: "ObjectFilter") { inputFields { name type { name } } } }`);

  // D. Metadata API — page through objects (cursor) and find Person client-side.
  findings.D_metadata_objects = await gql(base, "/metadata", key,
    `query { objects(paging: { first: 200 }) { edges { node { id nameSingular } } } }`);

  // E. (write, flag-gated) attempt to create the additive text field.
  if (doCreate) {
    const objId = (() => {
      try {
        const d = findings.D_metadata_objects as { json?: { data?: { objects?: { edges?: { node?: { id?: string; nameSingular?: string } }[] } } } };
        const edges = d.json?.data?.objects?.edges ?? [];
        return edges.find((e) => e?.node?.nameSingular === "person")?.node?.id ?? null;
      } catch { return null; }
    })();
    findings.E_objectMetadataId = objId;
    if (objId) {
      findings.E_create_field = await gql(base, "/metadata", key,
        `mutation Create($input: CreateFieldInput!) { createOneField(input: $input) { id name type } }`,
        { input: { field: { name: FIELD, label: "STAFFD Customer Id", type: "TEXT", objectMetadataId: objId } } });
    } else {
      findings.E_create_field = { skipped: "no objectMetadataId resolved from step D" };
    }
  } else {
    findings.E_create_field = { skipped: "pass ?create=1 to attempt the additive field creation" };
  }

  return Response.json({ ok: true, field: FIELD, findings });
}
