/**
 * PATCH  /api/clients/[id]   Update a client's profile / vault
 * DELETE /api/clients/[id]   Archive a client (sets status='archived')
 *
 * Restricted to the agency user who owns the client.
 */

async function getAdminToken(pbUrl: string): Promise<string> {
  const res = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identity: process.env.PB_ADMIN_EMAIL ?? "",
      password: process.env.PB_ADMIN_PASSWORD ?? "",
    }),
  });
  if (!res.ok) throw new Error("Admin auth failed");
  const { token } = (await res.json()) as { token: string };
  return token;
}

async function verifyOwner(
  pbUrl: string,
  token: string,
  clientId: string,
  userId: string
): Promise<boolean> {
  const res = await fetch(`${pbUrl}/api/collections/clients/records/${clientId}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) return false;
  const client = (await res.json()) as { agency_user?: string };
  return client.agency_user === userId;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown> & { userId: string };
  const { userId, ...updates } = body;

  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const token = await getAdminToken(pbUrl);
    if (!(await verifyOwner(pbUrl, token, id, userId))) {
      return Response.json({ error: "Not authorized" }, { status: 403 });
    }

    // Strip protected fields — agency_user can never be changed via the API
    delete (updates as Record<string, unknown>).agency_user;
    delete (updates as Record<string, unknown>).id;
    delete (updates as Record<string, unknown>).collectionId;
    delete (updates as Record<string, unknown>).collectionName;

    const patchRes = await fetch(`${pbUrl}/api/collections/clients/records/${id}`, {
      method: "PATCH",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!patchRes.ok) {
      const detail = await patchRes.text();
      return Response.json({ error: "Failed to update", detail }, { status: 500 });
    }
    return Response.json({ ok: true, client: await patchRes.json() });
  } catch (err) {
    console.error("Client PATCH error:", err);
    return Response.json({ error: "Failed to update client" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");

  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const token = await getAdminToken(pbUrl);
    if (!(await verifyOwner(pbUrl, token, id, userId))) {
      return Response.json({ error: "Not authorized" }, { status: 403 });
    }

    // Soft delete — archive rather than destroy so we don't orphan their documents
    const patchRes = await fetch(`${pbUrl}/api/collections/clients/records/${id}`, {
      method: "PATCH",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    if (!patchRes.ok) {
      return Response.json({ error: "Failed to archive" }, { status: 500 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Client DELETE error:", err);
    return Response.json({ error: "Failed to archive client" }, { status: 500 });
  }
}
