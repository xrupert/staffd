const FIELDS = [
  { name: "user", type: "text", required: true },
  { name: "kind", type: "text", required: true },
  { name: "stage", type: "text", required: true },
  { name: "subject", type: "text", required: true },
  { name: "statement", type: "text", required: true },
  { name: "confidence", type: "number", required: true },
  { name: "sources", type: "json", required: true },
  { name: "usage_scopes", type: "json", required: true },
  { name: "effective_at", type: "date", required: false },
  { name: "expires_at", type: "date", required: false },
  { name: "approved_by", type: "text", required: false },
  { name: "approved_at", type: "date", required: false },
  { name: "supersedes_id", type: "text", required: false },
  { name: "superseded_by_id", type: "text", required: false },
];

const INDEXES = [
  "CREATE INDEX idx_business_knowledge_user_stage ON business_knowledge (user, stage)",
  "CREATE INDEX idx_business_knowledge_user_kind ON business_knowledge (user, kind)",
  "CREATE INDEX idx_business_knowledge_user_subject ON business_knowledge (user, subject)",
  "CREATE INDEX idx_business_knowledge_supersession ON business_knowledge (supersedes_id, superseded_by_id)",
];

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

async function ensureCollection(baseUrl: string) {
  const token = await adminToken(baseUrl);
  const headers = { Authorization: token, "Content-Type": "application/json" };
  const existingResponse = await fetch(`${baseUrl}/api/collections/business_knowledge`, { headers: { Authorization: token } });
  if (!existingResponse.ok) {
    const response = await fetch(`${baseUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "business_knowledge", type: "base", fields: FIELDS, indexes: INDEXES, ...RULES }),
    });
    if (!response.ok) throw new Error(`Failed to create business_knowledge: ${(await response.text()).slice(0, 300)}`);
    return { action: "created" as const };
  }

  const collection = (await existingResponse.json()) as { id: string; fields?: Array<{ name: string }> };
  const existingNames = new Set((collection.fields ?? []).map((field) => field.name));
  const missing = FIELDS.filter((field) => !existingNames.has(field.name));
  const response = await fetch(`${baseUrl}/api/collections/${collection.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields: [...(collection.fields ?? []), ...missing], indexes: INDEXES, ...RULES }),
  });
  if (!response.ok) throw new Error(`Failed to patch business_knowledge: ${(await response.text()).slice(0, 300)}`);
  return missing.length ? { action: "patched" as const, added: missing.map((field) => field.name) } : { action: "noop" as const };
}

export async function POST() {
  const configuredUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!configuredUrl || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  try {
    return Response.json({ ok: true, ...(await ensureCollection(configuredUrl.replace(/\/$/, ""))) });
  } catch (error) {
    return Response.json({ error: "Setup failed", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export const GET = POST;
