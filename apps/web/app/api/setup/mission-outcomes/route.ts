const FIELDS = [
  { name: "user", type: "text", required: true },
  { name: "mission_id", type: "text", required: true },
  { name: "outcome_id", type: "text", required: true },
  { name: "hypothesis", type: "text", required: true },
  { name: "expected_outcome", type: "text", required: true },
  { name: "actual_outcome", type: "text", required: true },
  { name: "status", type: "text", required: true },
  { name: "metrics", type: "json", required: true },
  { name: "evidence", type: "json", required: true },
  { name: "lesson", type: "text", required: true },
  { name: "confidence_before", type: "number", required: true },
  { name: "confidence_after", type: "number", required: true },
  { name: "observed_at", type: "date", required: true },
  { name: "approved_for_learning", type: "bool", required: true },
  { name: "approved_by", type: "text", required: false },
  { name: "approved_at", type: "date", required: false },
];

const INDEXES = [
  "CREATE UNIQUE INDEX idx_mission_outcomes_identity ON mission_outcomes (user, outcome_id)",
  "CREATE INDEX idx_mission_outcomes_mission ON mission_outcomes (user, mission_id, observed_at)",
  "CREATE INDEX idx_mission_outcomes_learning ON mission_outcomes (user, approved_for_learning, observed_at)",
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
  const existingResponse = await fetch(`${baseUrl}/api/collections/mission_outcomes`, { headers: { Authorization: token } });
  if (!existingResponse.ok) {
    const response = await fetch(`${baseUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "mission_outcomes", type: "base", fields: FIELDS, indexes: INDEXES, ...RULES }),
    });
    if (!response.ok) throw new Error(`Failed to create mission_outcomes: ${(await response.text()).slice(0, 300)}`);
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
  if (!response.ok) throw new Error(`Failed to patch mission_outcomes: ${(await response.text()).slice(0, 300)}`);
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
