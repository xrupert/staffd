/**
 * Twenty CRM integration — creates a contact and/or opportunity from Sales output.
 * Requires TWENTY_API_URL + TWENTY_API_KEY env vars.
 * Returns 503 with setup instructions when not yet configured.
 */

const TWENTY_URL = process.env.TWENTY_API_URL ?? "";
const TWENTY_KEY = process.env.TWENTY_API_KEY ?? "";

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
  if (!TWENTY_URL || !TWENTY_KEY) {
    return Response.json(
      {
        error: "not_configured",
        message:
          "CRM is not set up yet. Deploy Twenty and add TWENTY_API_URL and TWENTY_API_KEY to your environment variables.",
      },
      { status: 503 }
    );
  }

  try {
    const { type, name, email, notes, stage } = (await req.json()) as {
      type: "contact" | "opportunity";
      name: string;
      email?: string;
      notes?: string;
      stage?: string;
    };

    if (!name?.trim()) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }

    const query = type === "opportunity" ? CREATE_OPPORTUNITY : CREATE_PERSON;
    const variables =
      type === "opportunity"
        ? { name, stage: stage ?? "NEW", notes: notes ?? "" }
        : { name, email: email ?? "", notes: notes ?? "" };

    const res = await fetch(`${TWENTY_URL}/api`, {
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
