const FIELDS = [
  { name: "user", type: "text", required: true },
  { name: "bundle_id", type: "text", required: true },
  { name: "topic", type: "text", required: true },
  { name: "claim", type: "text", required: true },
  { name: "label", type: "text", required: true },
  { name: "risk", type: "text", required: true },
  { name: "verified_at", type: "date", required: true },
  { name: "reverify_after", type: "date", required: true },
  { name: "reverify_status", type: "text", required: false },
  { name: "reverify_query", type: "text", required: false },
  { name: "reverify_requested_at", type: "date", required: false },
  { name: "superseded_by", type: "text", required: false },
  { name: "parent_record", type: "text", required: false },
  { name: "refresh_query", type: "text", required: false },
  { name: "verdict", type: "json", required: true },
  { name: "citations", type: "json", required: true },
  { name: "answer", type: "json", required: true },
  { name: "review_status", type: "text", required: true },
  { name: "reviewed_at", type: "date", required: false },
  { name: "reviewed_by", type: "text", required: false },
];

const INDEXES = [
  "CREATE INDEX idx_research_records_user_verified ON research_records (user, verified_at)",
  "CREATE INDEX idx_research_records_user_bundle ON research_records (user, bundle_id)",
  "CREATE INDEX idx_research_records_review ON research_records (user, review_status)",
  "CREATE INDEX idx_research_records_reverify ON research_records (user, reverify_after)",
  "CREATE INDEX idx_research_records_reverify_status ON research_records (reverify_status, reverify_after)",
  "CREATE INDEX idx_research_records_parent_review ON research_records (parent_record, review_status)",
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

async function ensureCollection(baseUrl: string) {
  const token = await adminToken(baseUrl);
  const headers = { Authorization: token, "Content-Type": "application/json" };
  const existingResponse = await fetch(`${baseUrl}/api/collections/research_records`, {
    headers: { Authorization: token },
  });

  if (!existingResponse.ok) {
    const response = await fetch(`${baseUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "research_records",
        type: "base",
        fields: FIELDS,
        indexes: INDEXES,
        ...RULES,
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to create research_records: ${(await response.text()).slice(0, 300)}`);
    }
    return { action: "created" as const };
  }

  const collection = (await existingResponse.json()) as {
    id: string;
    fields?: Array<{ name: string }>;
  };
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
  if (!response.ok) {
    throw new Error(`Failed to patch research_records: ${(await response.text()).slice(0, 300)}`);
  }
  return missing.length
    ? { action: "patched" as const, added: missing.map((field) => field.name) }
    : { action: "noop" as const };
}

export async function POST() {
  const configuredUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!configuredUrl || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  try {
    return Response.json({
      ok: true,
      ...(await ensureCollection(configuredUrl.replace(/\/$/, ""))),
    });
  } catch (error) {
    console.error("research_records setup error:", error);
    return Response.json(
      { error: "Setup failed", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export const GET = POST;
