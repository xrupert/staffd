const FIELDS = [
  { name: "event_key", type: "text", required: true },
  { name: "user", type: "text", required: true },
  { name: "mission", type: "text", required: true },
  { name: "type", type: "text", required: true },
  { name: "step_id", type: "text", required: false },
  { name: "message", type: "text", required: true },
  { name: "evidence", type: "json", required: false },
  { name: "cost_credits", type: "number", required: false },
];

const INDEXES = [
  "CREATE UNIQUE INDEX idx_mission_events_key ON mission_events (event_key)",
  "CREATE INDEX idx_mission_events_user ON mission_events (user)",
  "CREATE INDEX idx_mission_events_mission ON mission_events (mission)",
  "CREATE INDEX idx_mission_events_created ON mission_events (created)",
];

const USER_RULE = "user = @request.auth.id";
const RULES = {
  listRule: USER_RULE,
  viewRule: USER_RULE,
  createRule: USER_RULE,
  updateRule: null,
  deleteRule: null,
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

async function ensureMissionEventsCollection(baseUrl: string) {
  const token = await adminToken(baseUrl);
  const headers = { Authorization: token, "Content-Type": "application/json" };
  const existingResponse = await fetch(`${baseUrl}/api/collections/mission_events`, {
    headers: { Authorization: token },
  });

  if (!existingResponse.ok) {
    const response = await fetch(`${baseUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "mission_events", type: "base", fields: FIELDS, indexes: INDEXES, ...RULES }),
    });
    if (!response.ok) throw new Error(`Failed to create mission_events: ${(await response.text()).slice(0, 300)}`);
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
  if (!response.ok) throw new Error(`Failed to patch mission_events: ${(await response.text()).slice(0, 300)}`);
  return missing.length ? { action: "patched" as const, added: missing.map((field) => field.name) } : { action: "noop" as const };
}

export async function POST() {
  const configuredUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!configuredUrl || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  try {
    return Response.json({ ok: true, ...(await ensureMissionEventsCollection(configuredUrl.replace(/\/$/, ""))) });
  } catch (error) {
    console.error("mission_events setup error:", error);
    return Response.json({ error: "Setup failed", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export const GET = POST;
