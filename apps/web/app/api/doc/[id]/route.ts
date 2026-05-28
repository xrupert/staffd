/**
 * Public document fetch — uses PB admin credentials server-side.
 * No auth required to call; the document ID acts as the access token.
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  const adminEmail = process.env.PB_ADMIN_EMAIL;
  const adminPassword = process.env.PB_ADMIN_PASSWORD;

  if (!pbUrl) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }

  try {
    // Get admin token
    let token = "";
    if (adminEmail && adminPassword) {
      const authRes = await fetch(
        `${pbUrl}/api/collections/_superusers/auth-with-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
        }
      );
      if (authRes.ok) {
        const data = (await authRes.json()) as { token?: string };
        token = data.token ?? "";
      }
    }

    // Fetch the document
    const docRes = await fetch(
      `${pbUrl}/api/collections/documents/records/${id}?expand=user`,
      token ? { headers: { Authorization: token } } : {}
    );

    if (!docRes.ok) {
      return Response.json({ error: "Document not found" }, { status: 404 });
    }

    const doc = (await docRes.json()) as {
      id: string;
      department: string;
      agent_name: string;
      prompt: string;
      output: string;
      created: string;
      user: string;
    };

    // Fetch the business name for this user
    let businessName = "";
    let logoUrl = "";
    try {
      const bizRes = await fetch(
        `${pbUrl}/api/collections/businesses/records?filter=(user='${doc.user}')&perPage=1`,
        token ? { headers: { Authorization: token } } : {}
      );
      if (bizRes.ok) {
        const bizData = (await bizRes.json()) as {
          items?: Array<{ business_name?: string; logo?: string; id?: string; collectionId?: string }>;
        };
        const biz = bizData.items?.[0];
        businessName = biz?.business_name ?? "";
        if (biz?.logo && biz?.id && biz?.collectionId) {
          logoUrl = `${pbUrl}/api/files/${biz.collectionId}/${biz.id}/${biz.logo}`;
        }
      }
    } catch { /* proceed without business info */ }

    return Response.json({
      id: doc.id,
      department: doc.department,
      agent_name: doc.agent_name,
      prompt: doc.prompt,
      output: doc.output,
      created: doc.created,
      businessName,
      logoUrl,
    });
  } catch (err) {
    console.error("Doc fetch error:", err);
    return Response.json({ error: "Failed to load document" }, { status: 500 });
  }
}
