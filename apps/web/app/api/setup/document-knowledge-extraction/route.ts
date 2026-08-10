const FIELDS = [
  { name: "knowledge_extraction_status", type: "text", required: false },
  { name: "knowledge_extraction_attempts", type: "number", required: false },
  { name: "knowledge_extraction_claim_id", type: "text", required: false },
  { name: "knowledge_extraction_claimed_at", type: "date", required: false },
  { name: "knowledge_extracted_at", type: "date", required: false },
  { name: "knowledge_extraction_error", type: "text", required: false },
];

async function adminToken(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: process.env.PB_ADMIN_EMAIL ?? "", password: process.env.PB_ADMIN_PASSWORD ?? "" }),
  });
  if (!response.ok) throw new Error("PocketBase admin authentication failed");
  return ((await response.json()) as { token: string }).token;
}

export async function POST() {
  const configuredUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!configuredUrl || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  try {
    const baseUrl = configuredUrl.replace(/\/$/, "");
    const token = await adminToken(baseUrl);
    const headers = { Authorization: token, "Content-Type": "application/json" };
    const existingResponse = await fetch(`${baseUrl}/api/collections/documents`, { headers: { Authorization: token } });
    if (!existingResponse.ok) throw new Error(`Documents collection lookup failed (${existingResponse.status})`);
    const collection = (await existingResponse.json()) as { id: string; fields?: Array<{ name: string }> };
    const existingNames = new Set((collection.fields ?? []).map((field) => field.name));
    const missing = FIELDS.filter((field) => !existingNames.has(field.name));
    if (!missing.length) return Response.json({ ok: true, action: "noop", added: [] });

    const response = await fetch(`${baseUrl}/api/collections/${collection.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ fields: [...(collection.fields ?? []), ...missing] }),
    });
    if (!response.ok) throw new Error(`Documents collection patch failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    return Response.json({ ok: true, action: "patched", added: missing.map((field) => field.name) });
  } catch (error) {
    return Response.json({ error: "Setup failed", detail: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export const GET = POST;
