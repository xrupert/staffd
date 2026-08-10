import { whoAmI } from "../_lib/integrations/identity";
import { getAdminToken, pbEscape, pbUrl } from "../_lib/pb";
import {
  fromStoredKnowledgeGraphEdge,
  fromStoredKnowledgeGraphNode,
  type StoredKnowledgeGraphEdge,
  type StoredKnowledgeGraphNode,
} from "../_lib/orchestrator/business-knowledge-graph-store";
import type { KnowledgeGraphNode, KnowledgeGraphNodeType } from "../_lib/orchestrator/business-knowledge-graph";

const MAX_RESULTS = 500;

function positiveLimit(value: string | null): number {
  if (!value) return 100;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("Graph query limit must be a positive integer");
  return Math.min(parsed, MAX_RESULTS);
}

function nodeFilter(ownerId: string, nodeId: string, nodeType: string): string {
  const filters = [`user = '${pbEscape(ownerId)}'`];
  if (nodeId) filters.push(`graph_id = '${pbEscape(nodeId)}'`);
  if (nodeType) filters.push(`node_type = '${pbEscape(nodeType)}'`);
  return filters.join(" && ");
}

function edgeFilter(ownerId: string, nodeId: string): string {
  const owner = `user = '${pbEscape(ownerId)}'`;
  if (!nodeId) return owner;
  const escaped = pbEscape(nodeId);
  return `${owner} && (from_node_id = '${escaped}' || to_node_id = '${escaped}')`;
}

async function fetchRecords<T>(collection: string, filter: string, token: string, limit: number): Promise<T[]> {
  const response = await fetch(
    `${pbUrl()}/api/collections/${collection}/records?filter=${encodeURIComponent(filter)}&perPage=${limit}&sort=graph_id`,
    { headers: { Authorization: token }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`${collection} query failed (${response.status})`);
  const payload = (await response.json()) as { items?: T[] };
  return payload.items ?? [];
}

export async function GET(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const nodeId = url.searchParams.get("nodeId")?.trim() ?? "";
    const nodeType = url.searchParams.get("type")?.trim() ?? "";
    const limit = positiveLimit(url.searchParams.get("limit"));
    const token = await getAdminToken();

    const storedNodes = await fetchRecords<StoredKnowledgeGraphNode>(
      "business_graph_nodes",
      nodeFilter(user.id, nodeId, nodeType),
      token,
      limit,
    );
    const nodes = storedNodes.map(fromStoredKnowledgeGraphNode);
    const nodesById = new Map<string, KnowledgeGraphNode>(nodes.map((node) => [node.id, node]));

    const storedEdges = await fetchRecords<StoredKnowledgeGraphEdge>(
      "business_graph_edges",
      edgeFilter(user.id, nodeId),
      token,
      limit,
    );

    if (!nodeId) {
      const endpointIds = new Set(storedEdges.flatMap((edge) => [edge.from_node_id, edge.to_node_id]));
      const missingIds = [...endpointIds].filter((id) => !nodesById.has(id));
      for (const missingId of missingIds) {
        const matches = await fetchRecords<StoredKnowledgeGraphNode>(
          "business_graph_nodes",
          nodeFilter(user.id, missingId, ""),
          token,
          1,
        );
        if (matches[0]) {
          const hydrated = fromStoredKnowledgeGraphNode(matches[0]);
          nodesById.set(hydrated.id, hydrated);
        }
      }
    }

    const edges = storedEdges.map((edge) => fromStoredKnowledgeGraphEdge(edge, nodesById));
    return Response.json({
      nodes: [...nodesById.values()],
      edges,
      query: { nodeId: nodeId || null, type: (nodeType || null) as KnowledgeGraphNodeType | null, limit },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown graph query error";
    const invalid = /positive integer/i.test(detail);
    return Response.json({ error: invalid ? "invalid_graph_query" : "business_graph_query_failed", detail }, { status: invalid ? 400 : 503 });
  }
}
