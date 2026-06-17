/**
 * GET /api/documents/<id> (W95.3.5) — lightweight status poll for the upload UI.
 *
 * Returns the document's extraction status + a short preview, scoped to the
 * authed owner. Used by /dashboard/upload to show "Processing… → Ready/Error"
 * after a PDF/DOCX upload.
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: RouteContext) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!id) return Response.json({ error: "missing_doc_id" }, { status: 400 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }
  const pb = pbUrl();

  const res = await fetch(`${pb}/api/collections/documents/records/${encodeURIComponent(id)}`, { headers: { Authorization: token } });
  if (!res.ok) return Response.json({ error: "not_found" }, { status: 404 });
  const doc = (await res.json()) as { id: string; user?: string; prompt?: string; output?: string; source?: string; extraction_status?: string };

  if (doc.user !== me.id) return Response.json({ error: "not_found" }, { status: 404 }); // own docs only

  return Response.json({
    id: doc.id,
    name: doc.prompt ?? "",
    source: doc.source ?? "",
    extraction_status: doc.extraction_status ?? "",
    preview: (doc.output ?? "").slice(0, 200),
  });
}
