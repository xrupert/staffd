import { getDepartmentAgents } from "@staffd/agents";
import type { Department } from "@staffd/agents";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ department: string }> }
) {
  const { department } = await params;

  const agents = getDepartmentAgents(department as Department);

  if (!agents.length) {
    return new Response("Department not found", { status: 404 });
  }

  // Return metadata only — system prompts stay server-side
  const meta = agents.map(({ id, name, department: dept, description, emoji, color, tags }) => ({
    id,
    name,
    department: dept,
    description,
    emoji,
    color,
    tags,
  }));

  return Response.json(meta);
}
