const FIELDS = [
  { name: "user", type: "text", required: true },
  { name: "delivery_key", type: "text", required: true },
  { name: "channel", type: "text", required: true },
  { name: "source_item_id", type: "text", required: true },
  { name: "occurred_at", type: "date", required: true },
  { name: "status", type: "select", required: true, values: ["pending", "sent", "failed"], maxSelect: 1 },
  { name: "attempts", type: "number", required: true },
  { name: "delivered_at", type: "date", required: false },
  { name: "last_error", type: "text", required: false },
];

const INDEXES = [
  "CREATE UNIQUE INDEX idx_notification_deliveries_key ON notification_deliveries (delivery_key)",
  "CREATE INDEX idx_notification_deliveries_user_status ON notification_deliveries (user, status)",
];

const USER_RULE = "user = @request.auth.id";
const RULES = {
  listRule: USER_RULE,
  viewRule: USER_RULE,
  createRule: null,
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

async function ensureCollection(baseUrl: string) {
  const token = await adminToken(baseUrl);
  const headers = { Authorization: token, "Content-Type": "application/json" };
  const existingResponse = await fetch(`${baseUrl}/api/collections/notification_deliveries`, {
    headers: { Authorization: token },
  });

  if (!existingResponse.ok) {
    const response = await fetch(`${baseUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "notification_deliveries",
        type: "base",
        fields: FIELDS,
        indexes: INDEXES,
        ...RULES,
      }),
    });
    if (!response.ok) throw new Error(`Failed to create notification_deliveries: ${(await response.text()).slice(0, 300)}`);
    return { action: "created" as const };
  }

  const collection = (await existingResponse.json()) as { id: string; fields?: Array<{ name: string }> };
  const existingNames = new Set((collection.fields ?? []).map((field) => field.name));
  const missing = FIELDS.filter((field) => !existingNames.has(field.name));
  const response = await fetch(`${baseUrl}/api/collections/${collection.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      fields: [...(collection.fields ?? []), ...missing],
      indexes: INDEXES,
      ...RULES,
    }),
  });
  if (!response.ok) throw new Error(`Failed to patch notification_deliveries: ${(await response.text()).slice(0, 300)}`);
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
    console.error("notification_deliveries setup error:", error);
    return Response.json(
      { error: "Setup failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export const GET = POST;
