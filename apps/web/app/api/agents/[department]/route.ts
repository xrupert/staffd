import { getDepartmentAgents } from "@staffd/agents";
import type { Department } from "@staffd/agents";
import { resolveDepartments } from "../../_lib/trial";

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
      const trial = await resolveDepartments(userId);
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
