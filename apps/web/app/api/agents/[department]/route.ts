import { getDepartmentAgents } from "@staffd/agents";
import type { Department } from "@staffd/agents";
import { resolveDepartments } from "../../_lib/trial";
import { getAdminToken, pbEscape, pbFirst } from "../../_lib/pb";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ department: string }> }
) {
  const { department } = await params;

  // Phase 8 — when a `userId` query param is present, expand the roster to
  // include packed agents for whichever industry packs the user has active.
  // Generic users (no packs / no userId) see the unchanged generic roster.
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  let activePacks: string[] = [];
  if (userId) {
    try {
      // W58.2 (D-19 bridging) — read the business industry so the roster
      // drawer lists bridged pack specialists, not just purchased ones.
      // Same admin-read pattern as /api/packs (W58.3, SA Decision 7).
      let vaultIndustry: string | undefined;
      try {
        const token = await getAdminToken();
        const biz = await pbFirst<{ industry?: string }>(
          "businesses",
          `(user='${pbEscape(userId)}')`,
          token
        );
        vaultIndustry = biz?.industry;
      } catch {
        /* no industry — bridging silently skipped */
      }
      const trial = await resolveDepartments(userId, { vaultIndustry });
      activePacks = trial.activePacks;
    } catch {
      /* fall through with no packs */
    }
  }

  const agents = getDepartmentAgents(
    department as Department,
    activePacks.length > 0 ? { activePacks } : undefined
  );

  if (!agents.length) {
    return new Response("Department not found", { status: 404 });
  }

  // Return metadata only — system prompts stay server-side. `pack` surfaces
  // so the UI can badge industry-pack specialists distinctly from generic ones.
  const meta = agents.map(({ id, name, department: dept, description, emoji, color, tags, pack }) => ({
    id,
    name,
    department: dept,
    description,
    emoji,
    color,
    tags,
    pack: pack ?? null,
  }));

  return Response.json(meta);
}
