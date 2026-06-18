/**
 * GET /api/front-desk/analytics (W95.6.y) — this customer's site analytics
 * (site-per-customer via PlausibleClient). period=7d|30d. Returns hasSite:false
 * (honest empty state) when no site is provisioned. Read-only; vendor-invisible.
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { PlausibleClient } from "../../_lib/integrations/plausible/client";

export async function GET(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const period = (url.searchParams.get("period") === "30d" ? "30d" : "7d") as "7d" | "30d";

  if (!PlausibleClient.configured || !(await PlausibleClient.hasSiteFor(me.id))) {
    return Response.json({ hasSite: false });
  }
  try {
    const c = PlausibleClient.forCustomer(me.id);
    const [aggregate, timeseries, topPages, topSources] = await Promise.all([
      c.getAggregateStats({ period }),
      c.getTimeseries({ period }),
      c.getTopPages({ period, limit: 5 }),
      c.getTopSources({ period, limit: 5 }),
    ]);
    return Response.json({ hasSite: true, period, aggregate, timeseries, topPages, topSources });
  } catch {
    return Response.json({ hasSite: true, period, aggregate: null, timeseries: [], topPages: [], topSources: [] });
  }
}
