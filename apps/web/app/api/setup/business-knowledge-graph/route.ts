const NODE_FIELDS = [
  { name: "graph_id", type: "text", required: true },
  { name: "user", type: "text", required: true },
  { name: "node_type", type: "text", required: true },
  { name: "label", type: "text", required: true },
  { name: "properties", type: "json", required: true },
  { name: "provenance", type: "json", required: true },
  { name: "confidence", type: "number", required: true },
  { name: "effective_at", type: "date", required: false },
  { name: "expires_at", type: "date", required: false },
];

const EDGE_FIELDS = [
  { name: "graph_id", type: "text", required: true },
  { name: "user", type: "text", required: true },
  { name: "edge_type", type: "text", required: true },
  { name: "from_node_id", type: "text", required: true },
  { name: "to_node_id", type: "text", required: true },
  { name: "properties", type: "json", required: true },
  { name: "provenance", type: "json", required: true },
  { name: "confidence", type: "number", required: true },
  { name: "effective_at", type: "date", required: false },
  { name: "expires_at", type: "date", required: false },
];

const COLLECTIONS = [
  {
    name: "business_graph_nodes",
    fields: NODE_FIELDS,
    indexes: [
      "CREATE UNIQUE INDEX idx_business_graph_nodes_identity ON business_graph_nodes (user, graph_id)",
      "CREATE INDEX idx_business_graph_nodes_type ON business_graph_nodes (user, node_type)",
    ],
  },
  {
    name: "business_graph_edges",
    fields: EDGE_FIELDS,
    indexes: [
      "CREATE UNIQUE INDEX idx_business_graph_edges_identity ON business_graph_edges (user, graph_id)",
      "CREATE INDEX idx_business_graph_edges_from ON business_graph_edges (user, from_node_id)",
      "CREATE INDEX idx_business_graph_edges_to ON business_graph_edges (user, to_node_id)",
      "CREATE INDEX idx_business_graph_edges_type ON business_graph_edges (user, edge_type)",
    ],
  },
] as const;

const USER_RULE = "user = @request.auth.id";
const RULES = { listRule: USER_RULE, viewRule: USER_RULE, createRule: USER_RULE, updateRule: USER_RULE, deleteRule: USER_RULE };

async function adminToken(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL ?? "", password: process.env.PB_ADMIN_PASSWORD ?? "" }),
  });
  if (!response.ok) throw new Error("PocketBase admin authentication failed");
  return ((await response.json()) as { token: string }).token;
}

async function ensureCollection(baseUrl: string, token: string, spec: (typeof COLLECTIONS)[number]) {
  const headers = { Authorization: token, "Content-Type": "application/json" };
  const existingResponse = await fetch(`${baseUrl}/api/collections/${spec.name}`, { headers: { Authorization: token } });
  if (!existingResponse.ok) {
    const response = await fetch(`${baseUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: spec.name, type: "base", fields: spec.fields, indexes: spec.indexes, ...RULES }),
    });
    if (!response.ok) throw new Error(`Failed to create ${spec.name}: ${(await response.text()).slice(0, 300)}`);
    return { name: spec.name, action: "created" as const };
  }

  const collection = (await existingResponse.json()) as { id: string; fields?: Array<{ name: string }> };
  const existingNames = new Set((collection.fields ?? []).map((field) => field.name));
  const missing = spec.fields.filter((field) => !existingNames.has(field.name));
  const response = await fetch(`${baseUrl}/api/collections/${collection.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields: [...(collection.fields ?? []), ...missing], indexes: spec.indexes, ...RULES }),
  });
  if (!response.ok) throw new Error(`Failed to patch ${spec.name}: ${(await response.text()).slice(0, 300)}`);
  return missing.length
    ? { name: spec.name, action: "patched" as const, added: missing.map((field) => field.name) }
    : { name: spec.name, action: "noop" as const };
}

export async function POST() {
  const configuredUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!configuredUrl || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  try {
    const baseUrl = configuredUrl.replace(/\/$/, "");
    const token = await adminToken(baseUrl);
    const results = [];
    for (const spec of COLLECTIONS) results.push(await ensureCollection(baseUrl, token, spec));
    return Response.json({ ok: true, collections: results });
  } catch (error) {
    return Response.json({ error: "Setup failed", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export const GET = POST;
