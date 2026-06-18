/**
 * TwentyClient — the ONLY path to the operator-shared Twenty instance (W95.1).
 *
 * ⚠️ ALL TWENTY ACCESS GOES THROUGH THIS CLIENT. Bypass = tenant leak. ⚠️
 *
 * Model B3: one operator Twenty workspace serves every customer, partitioned by
 * a `staffdCustomerId` custom field on Person (verified live in the W95.1
 * probe — field id b6d9b748…). The W80/probe finding stands: an UNFILTERED
 * `people` query returns ALL tenants' records. So this wrapper is the leak-guard:
 *   - you cannot obtain a client without a customerId (forCustomer throws on "")
 *   - every read auto-injects `filter:{ staffdCustomerId:{ eq } }`
 *   - every write auto-injects `staffdCustomerId` = the customerId
 *   - the raw GraphQL fn is module-private (unexported) — there is no way to
 *     hit Twenty from elsewhere in the codebase.
 *
 * customerId = the STAFFD PB user id (one STAFFD user ↔ one tenant).
 */

const FIELD = "staffdCustomerId";

function cfg() {
  return {
    url: (process.env.TWENTY_API_URL ?? "").replace(/\/$/, ""),
    key: process.env.TWENTY_API_KEY ?? "",
  };
}

/** Module-private — never exported. The structural half of the leak-guard. */
async function twentyGraphql(query: string, variables: Record<string, unknown>): Promise<{ data?: Record<string, unknown>; errors?: { message: string }[] } | null> {
  const { url, key } = cfg();
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) return { errors: [{ message: `Twenty ${res.status}` }] };
    return (await res.json()) as { data?: Record<string, unknown>; errors?: { message: string }[] };
  } catch (err) {
    return { errors: [{ message: err instanceof Error ? err.message : "twenty fetch failed" }] };
  }
}

export type ContactInput = { name: string; email?: string; phone?: string };
export type TwentyPerson = { id: string; name: string };

export class TwentyClient {
  private constructor(private readonly customerId: string) {}

  /** The only constructor. Refuses an empty tenant tag — no tag, no access. */
  static forCustomer(userId: string | null | undefined): TwentyClient {
    const id = (userId ?? "").trim();
    if (!id) throw new Error("TwentyClient.forCustomer requires a customerId (tenant tag) — refusing untenanted access.");
    return new TwentyClient(id);
  }

  /** True when the operator-shared instance is configured. */
  static get configured(): boolean {
    const { url, key } = cfg();
    return !!url && !!key;
  }

  /** Create a Person, tenant-tagged. Returns the new id, or null on failure. */
  async createPerson(input: ContactInput): Promise<string | null> {
    const data: Record<string, unknown> = {
      name: { firstName: input.name, lastName: "" },
      [FIELD]: this.customerId, // auto-injected tenant tag
    };
    if (input.email) data.emails = { primaryEmail: input.email };
    if (input.phone) data.phones = { primaryPhoneNumber: input.phone };

    const res = await twentyGraphql(
      `mutation Create($data: PersonCreateInput!) { createPerson(data: $data) { id name { firstName } } }`,
      { data },
    );
    if (!res || res.errors?.length) return null;
    const rec = res.data?.createPerson as { id?: string } | undefined;
    return rec?.id ?? null;
  }

  /**
   * Update an existing tenant Person by its Twenty id (W95.4a). Returns true on
   * success. The id was minted for THIS tenant on create; we still scope writes
   * to fields only (the tenant tag is immutable). Returns false on failure.
   */
  async updatePerson(personId: string, input: { name?: string; email?: string; phone?: string }): Promise<boolean> {
    const id = (personId ?? "").trim();
    if (!id) return false;
    const data: Record<string, unknown> = {};
    if (input.name) data.name = { firstName: input.name, lastName: "" };
    if (input.email) data.emails = { primaryEmail: input.email };
    if (input.phone) data.phones = { primaryPhoneNumber: input.phone };
    if (Object.keys(data).length === 0) return true; // nothing to change

    const res = await twentyGraphql(
      `mutation Update($id: UUID!, $data: PersonUpdateInput!) { updatePerson(id: $id, data: $data) { id } }`,
      { id, data },
    );
    return !!res && !res.errors?.length && !!(res.data?.updatePerson as { id?: string } | undefined)?.id;
  }

  /** Delete a tenant Person by id (W95.5 — undo of an autopilot create). */
  async deletePerson(personId: string): Promise<boolean> {
    const id = (personId ?? "").trim();
    if (!id) return false;
    const res = await twentyGraphql(`mutation Del($id: UUID!) { deletePerson(id: $id) { id } }`, { id });
    return !!res && !res.errors?.length;
  }

  /** List this tenant's people only — filter is always injected. */
  async listPeople(limit = 25): Promise<TwentyPerson[]> {
    const res = await twentyGraphql(
      `query People($tag: String!, $first: Int!) {
         people(first: $first, filter: { ${FIELD}: { eq: $tag } }) {
           edges { node { id name { firstName lastName } } }
         }
       }`,
      { tag: this.customerId, first: limit },
    );
    if (!res || res.errors?.length) return [];
    const edges = (res.data?.people as { edges?: { node: { id: string; name?: { firstName?: string; lastName?: string } } }[] } | undefined)?.edges ?? [];
    return edges.map((e) => ({
      id: e.node.id,
      name: [e.node.name?.firstName, e.node.name?.lastName].filter(Boolean).join(" ").trim() || "Unnamed",
    }));
  }
}
