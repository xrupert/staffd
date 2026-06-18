/**
 * PlausibleClient — the ONLY path to the operator-shared Plausible CE for
 * per-customer stats (W95.6.y).
 *
 * ⚠️ Partition = SITE-PER-CUSTOMER. The Plausible CE has NO Sites-provisioning
 * API (W95.2 probe), so the operator creates the site manually in the Plausible
 * admin and stores its id on `businesses.plausible_site_id` (via the STAFFD
 * admin form). staffdCustomerId is NOT used here — Plausible's tenant boundary
 * IS the site_id, and every read is scoped to the customer's stored site.
 *
 * Leak-guard: forCustomer refuses an empty userId; stats methods refuse when no
 * site_id is provisioned (honest empty state via hasSiteFor — never a leak to
 * another tenant's site). Raw HTTP fn `pl()` is module-private (unexported).
 *
 * API shape mirrors the existing W80.1a route: base `${PLAUSIBLE_URL}/api/v1`,
 * `Authorization: Bearer`, /stats/aggregate|timeseries|breakdown.
 */

import { getAdminToken, pbUrl, pbEscape } from "../../pb";

function cfg() {
  return {
    base: (process.env.PLAUSIBLE_API_URL ?? process.env.NEXT_PUBLIC_PLAUSIBLE_URL ?? "https://plausible.io").replace(/\/$/, ""),
    key: process.env.PLAUSIBLE_API_KEY ?? "",
  };
}

/** Module-private — the structural half of the leak-guard. */
async function pl(path: string): Promise<unknown> {
  const { base, key } = cfg();
  const res = await fetch(`${base}/api/v1${path}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

/** Read a user's provisioned site id from businesses (admin token). */
async function siteIdFor(userId: string): Promise<string> {
  try {
    const token = await getAdminToken();
    const filter = encodeURIComponent(`user = "${pbEscape(userId)}"`);
    const res = await fetch(`${pbUrl()}/api/collections/businesses/records?filter=${filter}&perPage=1&fields=plausible_site_id`, { headers: { Authorization: token } });
    if (!res.ok) return "";
    return (((await res.json()) as { items?: { plausible_site_id?: string }[] }).items?.[0]?.plausible_site_id) ?? "";
  } catch { return ""; }
}

export type Aggregate = { visitors: number; pageviews: number; bounce_rate: number; visit_duration_seconds: number };

export class PlausibleClient {
  private site: string | null = null;
  private constructor(private readonly customerId: string) {}

  static forCustomer(userId: string | null | undefined): PlausibleClient {
    const id = (userId ?? "").trim();
    if (!id) throw new Error("PlausibleClient.forCustomer requires a customerId — refusing untenanted access.");
    return new PlausibleClient(id);
  }

  static get configured(): boolean {
    const { base, key } = cfg();
    return !!base && !!key;
  }

  /** Honest empty-state gate: is a site provisioned for this customer? */
  static async hasSiteFor(userId: string): Promise<boolean> {
    if (!(userId ?? "").trim()) return false;
    return !!(await siteIdFor(userId));
  }

  /** Resolve (cache) the site id; throws if none provisioned (caller gates via hasSiteFor). */
  private async siteId(): Promise<string> {
    if (this.site === null) this.site = await siteIdFor(this.customerId);
    if (!this.site) throw new Error("plausible: no site_id provisioned for this customer");
    return this.site;
  }
  private async q(period: string): Promise<string> {
    return `site_id=${encodeURIComponent(await this.siteId())}&period=${period}`;
  }

  async getAggregateStats(opts: { period: "day" | "7d" | "30d" }): Promise<Aggregate> {
    const data = (await pl(`/stats/aggregate?${await this.q(opts.period)}&metrics=visitors,pageviews,bounce_rate,visit_duration`)) as { results?: Record<string, { value?: number }> } | null;
    const r = data?.results ?? {};
    return {
      visitors: r.visitors?.value ?? 0,
      pageviews: r.pageviews?.value ?? 0,
      bounce_rate: r.bounce_rate?.value ?? 0,
      visit_duration_seconds: r.visit_duration?.value ?? 0,
    };
  }

  async getTimeseries(opts: { period: "7d" | "30d" }): Promise<Array<{ date: string; visitors: number; pageviews: number }>> {
    const data = (await pl(`/stats/timeseries?${await this.q(opts.period)}&metrics=visitors,pageviews`)) as { results?: { date: string; visitors?: number; pageviews?: number }[] } | null;
    return (data?.results ?? []).map((p) => ({ date: p.date, visitors: p.visitors ?? 0, pageviews: p.pageviews ?? 0 }));
  }

  async getTopPages(opts: { period: "7d" | "30d"; limit?: number }): Promise<Array<{ page: string; visitors: number }>> {
    const data = (await pl(`/stats/breakdown?${await this.q(opts.period)}&property=event:page&metrics=visitors&limit=${opts.limit ?? 5}`)) as { results?: { page?: string; visitors?: number }[] } | null;
    return (data?.results ?? []).map((p) => ({ page: p.page ?? "", visitors: p.visitors ?? 0 }));
  }

  async getTopSources(opts: { period: "7d" | "30d"; limit?: number }): Promise<Array<{ source: string; visitors: number }>> {
    const data = (await pl(`/stats/breakdown?${await this.q(opts.period)}&property=visit:source&metrics=visitors&limit=${opts.limit ?? 5}`)) as { results?: { source?: string; visitors?: number }[] } | null;
    return (data?.results ?? []).map((p) => ({ source: p.source ?? "Direct", visitors: p.visitors ?? 0 }));
  }
}
