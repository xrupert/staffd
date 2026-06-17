/**
 * DocusealClient — the ONLY path to the operator-shared Docuseal instance (W95.2).
 *
 * ⚠️ ALL DOCUSEAL PARTITION ACCESS GOES THROUGH THIS CLIENT. Bypass = tenant leak. ⚠️
 *
 * Model B3 partition = staffdCustomerId METADATA on each submission.
 * staffdCustomerId = PB userId (locked by SA). Probe (W95.2): API reachable +
 * auth OK; metadata is the documented submission field, but the live round-trip
 * was NOT exercised in the probe because creating a submission sends a real
 * signature email — so listSubmissions filters by metadata CLIENT-SIDE as the
 * defensive isolation guarantee (never trust a server-side metadata filter we
 * couldn't verify). First live send lands in W95.4 (send_for_signature).
 *
 * Leak-guard: no untenanted client; the tag is injected on create; the raw HTTP
 * fn is module-private (unexported).
 */

function cfg() {
  return { base: (process.env.DOCUSEAL_URL ?? "").replace(/\/$/, ""), key: process.env.DOCUSEAL_API_KEY ?? "" };
}

/** Module-private — structural leak-guard. */
async function ds(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: unknown }> {
  const { base, key } = cfg();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Auth-Token": key, ...(init.headers ?? {}) },
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, json };
}

export type SubmissionInput = { templateId: number; name: string; signerEmail: string; signerName?: string; source?: string };

export class DocusealClient {
  private constructor(private readonly customerId: string) {}

  static forCustomer(userId: string | null | undefined): DocusealClient {
    const id = (userId ?? "").trim();
    if (!id) throw new Error("DocusealClient.forCustomer requires a customerId (tenant tag) — refusing untenanted access.");
    return new DocusealClient(id);
  }

  static get configured(): boolean {
    const { base, key } = cfg();
    return !!base && !!key;
  }

  /** Create a submission, tagged with the tenant via metadata. (Sends an email.) */
  async createSubmission(input: SubmissionInput): Promise<{ id: number; slug?: string } | null> {
    const res = await ds(`/api/submissions`, {
      method: "POST",
      body: JSON.stringify({
        template_id: input.templateId,
        send_email: true,
        metadata: { staffdCustomerId: this.customerId }, // tenant tag
        submitters: [{ role: "First Party", email: input.signerEmail, name: input.signerName ?? "" }],
        ...(input.source ? { source: input.source } : {}),
        name: input.name,
      }),
    });
    if (!res.ok) return null;
    const d = res.json as { id?: number; slug?: string };
    return d?.id ? { id: d.id, slug: d.slug } : null;
  }

  /** This tenant's submissions only — filtered CLIENT-SIDE by the metadata tag. */
  async listSubmissions(limit = 25): Promise<{ id: number; status?: string }[]> {
    const res = await ds(`/api/submissions?limit=${Math.min(100, limit * 4)}`);
    if (!res.ok) return [];
    const rows = (res.json as { data?: { id: number; status?: string; metadata?: { staffdCustomerId?: string } }[] })?.data ?? [];
    return rows
      .filter((r) => r.metadata?.staffdCustomerId === this.customerId) // defensive tenant isolation
      .slice(0, limit)
      .map((r) => ({ id: r.id, status: r.status }));
  }
}
