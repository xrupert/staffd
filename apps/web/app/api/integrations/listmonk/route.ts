/**
 * Listmonk integration — creates a draft email campaign from generated content.
 * Requires LISTMONK_URL + LISTMONK_USERNAME + LISTMONK_PASSWORD env vars.
 * Returns 503 with setup instructions when not yet configured.
 */

const LISTMONK_URL = process.env.LISTMONK_URL ?? "";
const LISTMONK_USER = process.env.LISTMONK_USERNAME ?? "listmonk";
const LISTMONK_PASS = process.env.LISTMONK_PASSWORD ?? "";

export async function POST(req: Request) {
  if (!LISTMONK_URL || !LISTMONK_PASS) {
    return Response.json(
      {
        error: "not_configured",
        message:
          "Email sending is not set up yet. Deploy Listmonk and add LISTMONK_URL, LISTMONK_USERNAME, and LISTMONK_PASSWORD to your environment variables.",
      },
      { status: 503 }
    );
  }

  try {
    const { subject, body, listIds } = (await req.json()) as {
      subject: string;
      body: string;
      listIds?: number[];
    };

    if (!subject?.trim() || !body?.trim()) {
      return Response.json({ error: "subject and body are required" }, { status: 400 });
    }

    const auth = Buffer.from(`${LISTMONK_USER}:${LISTMONK_PASS}`).toString("base64");

    // Create a draft campaign in Listmonk
    const res = await fetch(`${LISTMONK_URL}/api/campaigns`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        name: subject,
        subject,
        lists: listIds ?? [],
        type: "regular",
        content_type: "richtext",
        body,
        status: "draft",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: "Listmonk error", detail: text }, { status: 502 });
    }

    const data = (await res.json()) as { data?: { id: number; uuid: string } };
    return Response.json({
      success: true,
      campaignId: data.data?.id,
      campaignUrl: `${LISTMONK_URL}/campaigns/${data.data?.id}`,
    });
  } catch (err) {
    console.error("Listmonk route error:", err);
    return Response.json({ error: "Failed to create campaign" }, { status: 500 });
  }
}
