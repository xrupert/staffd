/**
 * Twenty CRM integration — creates a contact and/or opportunity from Sales output.
 *
 * W91: credentials resolve via resolveCredentials(userId, "twenty") —
 * the user's own stored creds first, else operator env fallback. No env var
 * is read directly here anymore. 503 when neither resolves ("Connect your tools").
 */

import { recordDecision } from "../../_lib/vault/outcomes";
import { whoAmI } from "../../_lib/integrations/identity";
import { resolveCredentials } from "../../_lib/integrations/resolve";

const NOT_CONFIGURED = {
  error: "not_configured",
  message: "CRM isn't connected yet. Add your Twenty URL and API key in Settings → Connect Your Tools.",
};

const CREATE_PERSON = `
  mutation CreatePerson($name: String!, $email: String, $notes: String) {
    createPerson(data: {
      name: { firstName: $name, lastName: "" }
      emails: { primaryEmail: $email }
      position: $notes
    }) {
      id
      name { firstName }
    }
  }
`;

const CREATE_OPPORTUNITY = `
  mutation CreateOpportunity($name: String!, $stage: String, $notes: String) {
    createOpportunity(data: {
      name: $name
      stage: $stage
      pointOfContactAdditionalEmails: $notes
    }) {
      id
      name
    }
  }
`;

export async function POST(req: Request) {
  try {
    const { type, name, email, notes, stage, userId } = (await req.json()) as {
      type: "contact" | "opportunity";
      name: string;
      email?: string;
      notes?: string;
      stage?: string;
      userId?: string; // FC-3 — when present, the outcome is recorded to the vault
    };

    if (!name?.trim()) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }

    const creds = await resolveCredentials({ id: userId ?? "" }, "twenty");
    if (!creds) return Response.json(NOT_CONFIGURED, { status: 503 });
    const TWENTY_URL = creds.url, TWENTY_KEY = creds.key;

    const query = type === "opportunity" ? CREATE_OPPORTUNITY : CREATE_PERSON;
    const variables =
      type === "opportunity"
        ? { name, stage: stage ?? "NEW", notes: notes ?? "" }
        : { name, email: email ?? "", notes: notes ?? "" };

    // Twenty exposes GraphQL at /graphql (not /api)
    const res = await fetch(`${TWENTY_URL.replace(/\/$/, "")}/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TWENTY_KEY}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: "Twenty error", detail: text }, { status: 502 });
    }

    const data = (await res.json()) as {
      data?: Record<string, { id: string; name: string | { firstName: string } }>;
      errors?: { message: string }[];
    };

    if (data.errors?.length) {
      return Response.json({ error: data.errors[0]?.message }, { status: 502 });
    }

    const record = data.data
      ? Object.values(data.data)[0]
      : null;

    // FC-3 — close the loop: a lead/opportunity in the CRM is a real outcome
    // the CEO brief should see. Fire-and-forget; never blocks the response.
    if (userId) {
      void recordDecision({
        userId,
        decision_kind: "lead_added",
        title: `Added "${name}" to the CRM`,
        source_kind: "twenty",
        source_id: record?.id ? String(record.id) : undefined,
      });
    }

    return Response.json({
      success: true,
      id: record?.id,
      crmUrl: record?.id ? `${TWENTY_URL}/objects/${type === "opportunity" ? "opportunities" : "people"}/${record.id}` : null,
    });
  } catch (err) {
    console.error("Twenty route error:", err);
    return Response.json({ error: "Failed to create CRM record" }, { status: 500 });
  }
}

/**
 * GET /api/integrations/twenty?type=opportunities|contacts  (FC-1a)
 *
 * Read side — gives Sales specialists live pipeline / contact awareness.
 * Env is read inside the handler so configuration changes (and tests) take
 * effect without a module reload.
 */
type TwentyNode = {
  id: string;
  name: string | { firstName?: string; lastName?: string };
  stage?: string;
  createdAt?: string;
};

export async function GET(req: Request) {
  // W91 — any authenticated user; creds resolve per-user (own → operator
  // fallback). Returns 503 "Connect your tools" when neither resolves.
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  const creds = await resolveCredentials(me, "twenty");
  if (!creds) return Response.json(NOT_CONFIGURED, { status: 503 });
  const url = creds.url.replace(/\/$/, "");
  const key = creds.key;

  const type = new URL(req.url).searchParams.get("type") ?? "opportunities";
  const isOpp = type !== "contacts";
  const query = isOpp
    ? `query { opportunities(first: 25) { edges { node { id name stage createdAt } } } }`
    : `query { people(first: 25) { edges { node { id name { firstName lastName } createdAt } } } }`;

  try {
    const res = await fetch(`${url}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: "Twenty error", detail: text.slice(0, 300) }, { status: 502 });
    }
    const data = (await res.json()) as {
      data?: Record<string, { edges?: { node: TwentyNode }[] }>;
      errors?: { message: string }[];
    };
    if (data.errors?.length) {
      return Response.json({ error: data.errors[0]?.message ?? "Twenty error" }, { status: 502 });
    }
    const conn = data.data ? Object.values(data.data)[0] : null;
    const results = (conn?.edges ?? []).map(({ node }) => {
      const name =
        typeof node.name === "object"
          ? [node.name.firstName, node.name.lastName].filter(Boolean).join(" ")
          : node.name;
      return {
        id: node.id,
        name,
        stage: node.stage ?? null,
        createdAt: node.createdAt ?? null,
        url: `${url}/objects/${isOpp ? "opportunities" : "people"}/${node.id}`,
      };
    });
    return Response.json({ type: isOpp ? "opportunities" : "contacts", results });
  } catch (err) {
    console.error("Twenty read error:", err);
    return Response.json({ error: "Failed to read CRM" }, { status: 500 });
  }
}
