const COLLECTIONS = [
  {
    name: "eval_suites",
    fields: [
      { name: "suite_id", type: "text", required: true },
      { name: "capability", type: "text", required: true },
      { name: "capability_version", type: "text", required: true },
      { name: "suite_version", type: "text", required: true },
      { name: "definition", type: "json", required: true },
      { name: "created_by", type: "text", required: true },
      { name: "supersedes_suite_id", type: "text", required: false },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_eval_suites_identity ON eval_suites (suite_id)",
      "CREATE INDEX idx_eval_suites_capability_version ON eval_suites (capability, capability_version, suite_version)",
    ],
  },
  {
    name: "eval_cases",
    fields: [
      { name: "case_id", type: "text", required: true },
      { name: "suite_id", type: "text", required: true },
      { name: "kind", type: "text", required: true },
      { name: "definition", type: "json", required: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_eval_cases_identity ON eval_cases (case_id)",
      "CREATE INDEX idx_eval_cases_suite_kind ON eval_cases (suite_id, kind)",
    ],
  },
  {
    name: "eval_runs",
    fields: [
      { name: "run_id", type: "text", required: true },
      { name: "suite_id", type: "text", required: true },
      { name: "capability", type: "text", required: true },
      { name: "capability_version", type: "text", required: true },
      { name: "suite_version", type: "text", required: true },
      { name: "baseline_run_id", type: "text", required: false },
      { name: "verdict", type: "json", required: true },
      { name: "evidence", type: "json", required: true },
      { name: "release_decision", type: "text", required: true },
      { name: "started_at", type: "date", required: true },
      { name: "completed_at", type: "date", required: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_eval_runs_identity ON eval_runs (run_id)",
      "CREATE INDEX idx_eval_runs_capability_version ON eval_runs (capability, capability_version, completed_at)",
      "CREATE INDEX idx_eval_runs_baseline ON eval_runs (baseline_run_id)",
      "CREATE INDEX idx_eval_runs_release ON eval_runs (release_decision, completed_at)",
    ],
  },
] as const;

async function adminToken(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL ?? "", password: process.env.PB_ADMIN_PASSWORD ?? "" }),
  });
  if (!response.ok) throw new Error("PocketBase admin authentication failed");
  return ((await response.json()) as { token: string }).token;
}

async function ensureCollection(baseUrl: string, definition: (typeof COLLECTIONS)[number]) {
  const token = await adminToken(baseUrl);
  const headers = { Authorization: token, "Content-Type": "application/json" };
  const existingResponse = await fetch(`${baseUrl}/api/collections/${definition.name}`, { headers: { Authorization: token } });
  if (!existingResponse.ok) {
    const response = await fetch(`${baseUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: definition.name, type: "base", fields: definition.fields, indexes: definition.indexes }),
    });
    if (!response.ok) throw new Error(`Failed to create ${definition.name}: ${(await response.text()).slice(0, 300)}`);
    return { name: definition.name, action: "created" as const };
  }

  const collection = (await existingResponse.json()) as { id: string; fields?: Array<{ name: string }> };
  const existingNames = new Set((collection.fields ?? []).map((field) => field.name));
  const missing = definition.fields.filter((field) => !existingNames.has(field.name));
  const response = await fetch(`${baseUrl}/api/collections/${collection.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields: [...(collection.fields ?? []), ...missing], indexes: definition.indexes }),
  });
  if (!response.ok) throw new Error(`Failed to patch ${definition.name}: ${(await response.text()).slice(0, 300)}`);
  return { name: definition.name, action: missing.length ? "patched" as const : "noop" as const, added: missing.map((field) => field.name) };
}

export async function POST() {
  const configuredUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!configuredUrl || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  try {
    const baseUrl = configuredUrl.replace(/\/$/, "");
    const results = [];
    for (const definition of COLLECTIONS) results.push(await ensureCollection(baseUrl, definition));
    return Response.json({ ok: true, collections: results });
  } catch (error) {
    return Response.json({ error: "Setup failed", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export const GET = POST;
