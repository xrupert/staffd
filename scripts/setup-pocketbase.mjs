#!/usr/bin/env node
/**
 * One-time PocketBase setup script.
 * Creates the documents and templates collections, and adds
 * phone/email/logo fields to the businesses collection.
 *
 * Usage:
 *   node scripts/setup-pocketbase.mjs <pb-url> <admin-email> <admin-password>
 *
 * Example:
 *   node scripts/setup-pocketbase.mjs https://yourpb.railway.app admin@email.com yourpassword
 */

const [, , PB_URL, PB_EMAIL, PB_PASSWORD] = process.argv;

if (!PB_URL || !PB_EMAIL || !PB_PASSWORD) {
  console.error("Usage: node scripts/setup-pocketbase.mjs <pb-url> <admin-email> <admin-password>");
  process.exit(1);
}

const base = PB_URL.replace(/\/$/, "");

async function adminToken() {
  const res = await fetch(`${base}/api/admins/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: PB_EMAIL, password: PB_PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Admin auth failed: ${JSON.stringify(data)}`);
  return data.token;
}

async function getCollections(token) {
  const res = await fetch(`${base}/api/collections?perPage=100`, {
    headers: { Authorization: token },
  });
  const data = await res.json();
  return data.items ?? [];
}

async function createCollection(token, schema) {
  const res = await fetch(`${base}/api/collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify(schema),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Create collection failed: ${JSON.stringify(data)}`);
  return data;
}

async function updateCollection(token, id, schema) {
  const res = await fetch(`${base}/api/collections/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify(schema),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Update collection failed: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log(`Connecting to PocketBase at ${base}…`);
  const token = await adminToken();
  console.log("✓ Admin authenticated");

  const collections = await getCollections(token);
  const byName = Object.fromEntries(collections.map((c) => [c.name, c]));

  // ── 1. documents collection ──────────────────────────────────
  if (byName.documents) {
    console.log("  documents collection already exists — skipping");
  } else {
    await createCollection(token, {
      name: "documents",
      type: "base",
      schema: [
        { name: "user", type: "relation", required: true, options: { collectionId: byName.users?.id ?? "_pb_users_auth_", cascadeDelete: false } },
        { name: "department", type: "text", required: false },
        { name: "agent_name", type: "text", required: false },
        { name: "prompt", type: "text", required: false, options: { max: 2000 } },
        { name: "output", type: "text", required: false, options: { max: 50000 } },
      ],
      listRule: "@request.auth.id = user",
      viewRule: "@request.auth.id = user",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id = user",
      deleteRule: "@request.auth.id = user",
    });
    console.log("✓ Created documents collection");
  }

  // ── 2. templates collection ──────────────────────────────────
  if (byName.templates) {
    console.log("  templates collection already exists — skipping");
  } else {
    await createCollection(token, {
      name: "templates",
      type: "base",
      schema: [
        { name: "user", type: "relation", required: true, options: { collectionId: byName.users?.id ?? "_pb_users_auth_", cascadeDelete: false } },
        { name: "name", type: "text", required: true, options: { max: 120 } },
        { name: "department", type: "text", required: false },
        { name: "content", type: "text", required: true, options: { max: 50000 } },
      ],
      listRule: "@request.auth.id = user",
      viewRule: "@request.auth.id = user",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id = user",
      deleteRule: "@request.auth.id = user",
    });
    console.log("✓ Created templates collection");
  }

  // ── 3. businesses — add phone / emails / logo fields ─────────
  const biz = byName.businesses;
  if (!biz) {
    console.warn("  businesses collection not found — run the app and complete onboarding first, then re-run this script");
  } else {
    const existingFields = new Set(biz.schema.map((f) => f.name));
    const newFields = [];

    if (!existingFields.has("phone"))
      newFields.push({ name: "phone", type: "text", required: false });
    if (!existingFields.has("primary_email"))
      newFields.push({ name: "primary_email", type: "email", required: false });
    if (!existingFields.has("support_email"))
      newFields.push({ name: "support_email", type: "email", required: false });
    if (!existingFields.has("sales_email"))
      newFields.push({ name: "sales_email", type: "email", required: false });
    if (!existingFields.has("logo"))
      newFields.push({ name: "logo", type: "file", required: false, options: { maxSelect: 1, maxSize: 2097152, mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"] } });

    if (newFields.length === 0) {
      console.log("  businesses fields already up to date");
    } else {
      await updateCollection(token, biz.id, {
        schema: [...biz.schema, ...newFields],
      });
      console.log(`✓ Added ${newFields.map((f) => f.name).join(", ")} to businesses`);
    }
  }

  console.log("\nSetup complete. You can now use the Document Library, Templates, and expanded Vault.");
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
