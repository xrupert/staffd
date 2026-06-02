/**
 * GET  /api/vault/briefs?userId=...
 *      Returns the user's latest Morning Brief (today's or yesterday's,
 *      whichever is most recent). Auth: PB session via Authorization header.
 *
 * POST /api/vault/briefs
 *      Body: { userId, pbToken, sectionId, status }
 *      Updates a single section's status (approved | dismissed | pending).
 *      Auth: pbToken in body matches the userId via auth-refresh.
 *
 * The brief shape stored in PB is `BriefRow` from `_lib/vault/morning-brief.ts`.
 */

import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "../../_lib/pb";
import type { BriefRow, BriefSection, BriefSectionStatus } from "../../_lib/vault/morning-brief";

async function verifyUserOwnsSelf(userId: string, pbToken: string): Promise<boolean> {
  if (!pbToken) return false;
  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { record?: { id?: string } };
    return data.record?.id === userId;
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return Response.json({ error: "missing_user_id" }, { status: 400 });

  const pbToken = req.headers.get("authorization") ?? "";
  if (!(await verifyUserOwnsSelf(userId, pbToken))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await getAdminToken();
    const pbBase = pbUrl();
    const res = await fetch(
      `${pbBase}/api/collections/vault_briefs/records?filter=${encodeURIComponent(`(user='${pbEscape(userId)}')`)}&sort=-date,-created&perPage=1`,
      { headers: { Authorization: token } }
    );
    if (!res.ok) return Response.json({ ok: true, brief: null });
    const data = (await res.json()) as { items?: BriefRow[] };
    const brief = data.items?.[0] ?? null;

    // Best-effort mark read_at on first GET — keeps the card from showing
    // a stale "new" treatment after the user opens the dashboard.
    if (brief && !brief.read_at) {
      try {
        await fetch(`${pbBase}/api/collections/vault_briefs/records/${brief.id}`, {
          method: "PATCH",
          headers: adminHeaders(token),
          body: JSON.stringify({ read_at: new Date().toISOString() }),
        });
      } catch { /* non-fatal */ }
    }

    return Response.json({ ok: true, brief });
  } catch (err) {
    console.error("Briefs GET error:", err);
    return Response.json({ error: "load_failed" }, { status: 500 });
  }
}

const VALID_STATUSES: ReadonlySet<BriefSectionStatus> = new Set(["pending", "approved", "dismissed"]);

export async function POST(req: Request) {
  let body: { userId?: string; pbToken?: string; sectionId?: string; status?: string; briefId?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }

  const { userId, pbToken, sectionId, briefId } = body;
  const status = body.status as BriefSectionStatus | undefined;
  if (!userId || !pbToken || !sectionId || !status) {
    return Response.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!VALID_STATUSES.has(status)) {
    return Response.json({ error: "invalid_status" }, { status: 400 });
  }
  if (!(await verifyUserOwnsSelf(userId, pbToken))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await getAdminToken();
    const pbBase = pbUrl();

    // Resolve the brief: prefer the supplied briefId; otherwise grab the latest.
    let row: BriefRow | null = null;
    if (briefId) {
      const res = await fetch(`${pbBase}/api/collections/vault_briefs/records/${briefId}`, {
        headers: { Authorization: token },
      });
      if (res.ok) row = (await res.json()) as BriefRow;
    } else {
      row = await pbFirst<BriefRow>(
        "vault_briefs",
        `(user='${pbEscape(userId)}')`,
        token,
        { fields: "id,user,sections,status" }
      );
    }
    if (!row || row.user !== userId) {
      return Response.json({ error: "brief_not_found" }, { status: 404 });
    }

    const sections: BriefSection[] = Array.isArray(row.sections) ? row.sections : [];
    let updated = false;
    for (const s of sections) {
      if (s.id === sectionId) { s.status = status; updated = true; break; }
    }
    if (!updated) return Response.json({ error: "section_not_found" }, { status: 404 });

    // If every section is now non-pending, mark the brief reviewed.
    const allHandled = sections.every((s) => s.status !== "pending");
    const briefStatus = allHandled ? "reviewed" : "pending";

    const patchRes = await fetch(`${pbBase}/api/collections/vault_briefs/records/${row.id}`, {
      method: "PATCH",
      headers: adminHeaders(token),
      body: JSON.stringify({ sections, status: briefStatus }),
    });
    if (!patchRes.ok) {
      const detail = await patchRes.text();
      return Response.json({ error: "patch_failed", detail: detail.slice(0, 200) }, { status: 500 });
    }
    const patched = (await patchRes.json()) as BriefRow;
    return Response.json({ ok: true, brief: patched });
  } catch (err) {
    console.error("Briefs POST error:", err);
    return Response.json({ error: "update_failed" }, { status: 500 });
  }
}
