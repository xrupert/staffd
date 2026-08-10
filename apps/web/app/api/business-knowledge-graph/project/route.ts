import { whoAmI } from "../../_lib/integrations/identity";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { fromStoredBusinessKnowledge, type StoredBusinessKnowledge } from "../../_lib/orchestrator/business-knowledge-store";
import {
  projectApprovedBusinessKnowledge,
  projectApprovedMissionOutcome,
} from "../../_lib/orchestrator/business-knowledge-graph-projection";
import {
  toStoredKnowledgeGraphEdge,
  toStoredKnowledgeGraphNode,
  type StoredKnowledgeGraphEdge,
  type StoredKnowledgeGraphNode,
} from "../../_lib/orchestrator/business-knowledge-graph-store";
import type { KnowledgeGraphNode } from "../../_lib/orchestrator/business-knowledge-graph";
import { fromStoredMissionOutcome, type StoredMissionOutcome } from "../../_lib/orchestrator/mission-memory-store";

type RequestBody =
  | { action: "project_business_knowledge"; knowledgeId?: string }
  | { action: "project_mission_outcome"; outcomeId?: string };

type GraphCollection = "business_graph_nodes" | "business_graph_edges";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

async function findSource<T>(collection: string, identityField: string, id: string, ownerId: string, token: string): Promise<T | null> {
  const filter = `${identityField} = '${pbEscape(id)}' && user = '${pbEscape(ownerId)}'`;
  const response = await fetch(
    `${pbUrl()}/api/collections/${collection}/records?filter=${encodeURIComponent(filter)}&perPage=1`,
    { headers: { Authorization: token }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`${collection} source lookup failed (${response.status})`);
  const payload = (await response.json()) as { items?: T[] };
  return payload.items?.[0] ?? null;
}

async function persistGraphRecord(
  collection: GraphCollection,
  graphId: string,
  ownerId: string,
  payload: StoredKnowledgeGraphNode | StoredKnowledgeGraphEdge,
  token: string,
): Promise<"created" | "existing"> {
  const filter = `graph_id = '${pbEscape(graphId)}' && user = '${pbEscape(ownerId)}'`;
  const lookup = await fetch(
    `${pbUrl()}/api/collections/${collection}/records?filter=${encodeURIComponent(filter)}&perPage=1`,
    { headers: { Authorization: token }, cache: "no-store" },
  );
  if (!lookup.ok) throw new Error(`${collection} graph lookup failed (${lookup.status})`);
  const existing = ((await lookup.json()) as { items?: Array<Record<string, unknown>> }).items?.[0];
  if (existing) {
    const comparable = Object.fromEntries(Object.keys(payload).map((key) => [key, existing[key]]));
    if (canonical(comparable) !== canonical(payload)) throw new Error(`Graph identity conflict: ${graphId}`);
    return "existing";
  }

  const response = await fetch(`${pbUrl()}/api/collections/${collection}/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${collection} graph creation failed (${response.status})`);
  return "created";
}

async function projectKnowledge(knowledgeId: string, ownerId: string, token: string) {
  const stored = await findSource<StoredBusinessKnowledge>("business_knowledge", "id", knowledgeId, ownerId, token);
  if (!stored) return { status: 404, body: { error: "not_found" } };
  const node = projectApprovedBusinessKnowledge(fromStoredBusinessKnowledge(stored));
  const persistence = await persistGraphRecord(
    "business_graph_nodes",
    node.id,
    ownerId,
    toStoredKnowledgeGraphNode(node),
    token,
  );
  return { status: persistence === "created" ? 201 : 200, body: { projected: true, nodeId: node.id, persistence } };
}

async function projectOutcome(outcomeId: string, ownerId: string, token: string) {
  const stored = await findSource<StoredMissionOutcome>("mission_outcomes", "outcome_id", outcomeId, ownerId, token);
  if (!stored) return { status: 404, body: { error: "not_found" } };
  const projected = projectApprovedMissionOutcome(fromStoredMissionOutcome(stored));
  const nodesById = new Map<string, KnowledgeGraphNode>(projected.nodes.map((node) => [node.id, node]));
  const nodeResults = [];
  for (const node of projected.nodes) {
    nodeResults.push(await persistGraphRecord(
      "business_graph_nodes",
      node.id,
      ownerId,
      toStoredKnowledgeGraphNode(node),
      token,
    ));
  }
  const edgeResults = [];
  for (const edge of projected.edges) {
    edgeResults.push(await persistGraphRecord(
      "business_graph_edges",
      edge.id,
      ownerId,
      toStoredKnowledgeGraphEdge(edge, nodesById),
      token,
    ));
  }
  const created = [...nodeResults, ...edgeResults].filter((result) => result === "created").length;
  return {
    status: created ? 201 : 200,
    body: {
      projected: true,
      nodeIds: projected.nodes.map((node) => node.id),
      edgeIds: projected.edges.map((edge) => edge.id),
      created,
      existing: nodeResults.length + edgeResults.length - created,
    },
  };
}

export async function POST(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const token = await getAdminToken();
    if (body.action === "project_business_knowledge") {
      const id = body.knowledgeId?.trim() ?? "";
      if (!id) return Response.json({ error: "knowledge_id_required" }, { status: 400 });
      const result = await projectKnowledge(id, user.id, token);
      return Response.json(result.body, { status: result.status });
    }
    if (body.action === "project_mission_outcome") {
      const id = body.outcomeId?.trim() ?? "";
      if (!id) return Response.json({ error: "outcome_id_required" }, { status: 400 });
      const result = await projectOutcome(id, user.id, token);
      return Response.json(result.body, { status: result.status });
    }
    return Response.json({ error: "invalid_action" }, { status: 400 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown graph projection error";
    const conflict = /Graph identity conflict/.test(detail);
    const invalid = /Only explicitly approved|Superseded|Inconclusive/.test(detail);
    return Response.json({
      error: conflict ? "graph_identity_conflict" : invalid ? "source_not_projectable" : "business_graph_projection_failed",
      detail,
    }, { status: conflict ? 409 : invalid ? 409 : 503 });
  }
}
