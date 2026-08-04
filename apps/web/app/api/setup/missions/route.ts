const FIELDS = [
  { name: "user", type: "text", required: true },
  { name: "outcome_id", type: "text", required: true },
  { name: "goal", type: "text", required: true },
  { name: "status", type: "text", required: true },
  { name: "risk", type: "text", required: true },
  { name: "budget_credits", type: "number", required: true },
  { name: "approval_required", type: "bool", required: false },
  { name: "plan", type: "json", required: true },
  { name: "evidence", type: "json", required: false },
  { name: "pending_events", type: "json", required: false },
  { name: "correlation_id", type: "text", required: true },
];

const INDEXES = [
  "CREATE INDEX idx_missions_user ON missions (user)",
  "CREATE INDEX idx_missions_status ON missions (status)",
  "CREATE UNIQUE INDEX idx_missions_correlation ON missions (correlation_id)",
];

const USER_RULE = "user = @request.auth.id";
const RULES = {
  listRule: USER_RULE,
  viewRule: USER_RULE,
  createRule: USER_RULE,
  updateRule: USER_RULE,
  deleteRule: USER_RULE,
};

async function adminToken(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identity: process.env.PB_ADMIN_EMAIL ?? "",
      password: process.env.PB_ADMIN_PASSWORD ?? "",
    }),
  });
  if (!response.ok) throw new Error("PocketBase admin authentication failed");
  return ((await response.json()) as { token: string }).token;
}

async function ensureMissionsCollection(baseUrl: string) {
  const token = await adminToken(baseUrl);
  const headers = { Authorization: token, "Content-Type": "application/json" };
  const existingResponse = await fetch(`${baseUrl}/api/collections/missions`, {
    headers: { Authorization: token },
  });

  if (!existingResponse.ok) {
    const createResponse = await fetch(`${baseUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "missions", type: "base", fields: FIELDS, indexes: INDEXES, ...RULES }),
    });
    if (!createResponse.ok) throw new Error(`Failed to create missions: ${(await createResponse.text()).slice(0, 300)}`);
    return { action: "created" as const };
  }

  const collection = (await existingResponse.json()) as { id: string; fields?: Array<{ name: string }> };
  const existingNames = new Set((collection.fields ?? []).map((field) => field.name));
  const missing = FIELDS.filter((field) => !existingNames.has(field.name));
  const patchResponse = await fetch(`${baseUrl}/api/collections/${collection.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields: [...(collection.fields ?? []), ...missing], indexes: INDEXES, ...RULES }),
  });
  if (!patchResponse.ok) throw new Error(`Failed to patch missions: ${(await patchResponse.text()).slice(0, 300)}`);
  return missing.length ? { action: "patched" as const, added: missing.map((field) => field.name) } : { action: "noop" as const };
}

export async function POST() {
  const configuredUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!configuredUrl || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  try {
    return Response.json({ ok: true, ...(await ensureMissionsCollection(configuredUrl.replace(/\/$/, ""))) });
  } catch (error) {
    console.error("missions setup error:", error);
    return Response.json({ error: "Setup failed", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export const GET = POST;
