/**
 * POST /api/book/[slug]
 * Body: { attendee_name, attendee_email, attendee_phone?, start_time (ISO), notes?, timezone? }
 *
 * Creates a confirmed booking against the host identified by the URL slug.
 * Re-validates the slot is still available (race condition guard) before saving.
 * Optionally fires a confirmation email via Listmonk if configured.
 *
 * GET /api/book/[slug]
 * Returns the host's public booking metadata for the booking page header.
 */

import { pbEscape } from "../../_lib/pb";

interface AvailabilityRules {
  sun?: [string, string][]; mon?: [string, string][]; tue?: [string, string][];
  wed?: [string, string][]; thu?: [string, string][]; fri?: [string, string][];
  sat?: [string, string][];
}

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

async function findHostBySlug(pbUrl: string, token: string, slug: string) {
  const filter = `(booking_slug='${pbEscape(slug)}')`;
  const res = await fetch(
    `${pbUrl}/api/collections/businesses/records?filter=${encodeURIComponent(filter)}&perPage=1`,
    { headers: { Authorization: token } }
  );
  const data = (await res.json()) as {
    items?: Array<{
      user: string;
      business_name?: string;
      booking_enabled?: boolean;
      booking_availability?: AvailabilityRules;
      booking_default_duration?: number;
      booking_buffer?: number;
      booking_timezone?: string;
      primary_email?: string;
    }>;
  };
  return data.items?.[0];
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const token = await getAdminToken(pbUrl);
    const host = await findHostBySlug(pbUrl, token, slug);
    if (!host || host.booking_enabled !== true) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({
      business_name: host.business_name ?? "",
      duration: host.booking_default_duration ?? 30,
      timezone: host.booking_timezone ?? "UTC",
    });
  } catch (err) {
    console.error("Booking GET error:", err);
    return Response.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = (await req.json()) as {
    attendee_name: string;
    attendee_email: string;
    attendee_phone?: string;
    start_time: string;
    notes?: string;
    timezone?: string;
    source?: string;
  };

  if (!body.attendee_name?.trim() || !body.attendee_email?.trim() || !body.start_time) {
    return Response.json({ error: "Name, email, and start time are required" }, { status: 400 });
  }

  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const token = await getAdminToken(pbUrl);
    const headers = { Authorization: token, "Content-Type": "application/json" };

    const host = await findHostBySlug(pbUrl, token, slug);
    if (!host || host.booking_enabled !== true) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const duration = host.booking_default_duration ?? 30;
    const buffer = host.booking_buffer ?? 0;

    // Race condition guard — re-check that this exact slot isn't taken
    const slotStart = new Date(body.start_time).getTime();
    if (isNaN(slotStart)) {
      return Response.json({ error: "Invalid start_time" }, { status: 400 });
    }
    const slotEnd = slotStart + duration * 60_000;

    const dayStart = new Date(body.start_time);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(body.start_time);
    dayEnd.setUTCHours(23, 59, 59, 999);
    const filter = encodeURIComponent(
      `user='${pbEscape(host.user)}' && start_time >= '${dayStart.toISOString()}' && start_time <= '${dayEnd.toISOString()}' && status != 'cancelled'`
    );
    const existRes = await fetch(
      `${pbUrl}/api/collections/bookings/records?filter=${filter}&perPage=100&fields=start_time,duration`,
      { headers: { Authorization: token } }
    );
    const existData = (await existRes.json()) as { items?: Array<{ start_time: string; duration: number }> };
    const conflict = (existData.items ?? []).some((b) => {
      const bStart = new Date(b.start_time).getTime();
      const bEnd   = bStart + (b.duration + buffer) * 60_000;
      return slotStart < bEnd && slotEnd > bStart;
    });
    if (conflict) {
      return Response.json({ error: "Slot no longer available" }, { status: 409 });
    }

    // Create the booking
    const createRes = await fetch(`${pbUrl}/api/collections/bookings/records`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user:           host.user,
        attendee_name:  body.attendee_name.trim(),
        attendee_email: body.attendee_email.trim(),
        attendee_phone: body.attendee_phone?.trim() ?? "",
        start_time:     new Date(body.start_time).toISOString(),
        duration,
        timezone:       body.timezone ?? host.booking_timezone ?? "UTC",
        notes:          body.notes?.trim() ?? "",
        status:         "confirmed",
        source:         body.source ?? "public",
      }),
    });

    if (!createRes.ok) {
      const detail = await createRes.text();
      return Response.json({ error: "Failed to save booking", detail }, { status: 500 });
    }

    const booking = (await createRes.json()) as { id: string };

    // Look up host user email (for notification to the host)
    let hostEmail = host.primary_email ?? "";
    if (!hostEmail) {
      try {
        const userRes = await fetch(
          `${pbUrl}/api/collections/users/records/${host.user}`,
          { headers: { Authorization: token } }
        );
        if (userRes.ok) {
          const userRec = (await userRes.json()) as { email?: string };
          hostEmail = userRec.email ?? "";
        }
      } catch { /* proceed without host notification */ }
    }

    // Optional: fire confirmation emails via Listmonk (best effort).
    // Sends to BOTH the attendee and the host so neither has to chase information.
    const listmonkUrl = process.env.LISTMONK_URL;
    const listmonkUser = process.env.LISTMONK_USERNAME ?? "listmonk";
    const listmonkPass = process.env.LISTMONK_PASSWORD;
    if (listmonkUrl && listmonkPass) {
      try {
        const auth = Buffer.from(`${listmonkUser}:${listmonkPass}`).toString("base64");
        const attendeeTz = body.timezone ?? host.booking_timezone ?? "UTC";
        const startDisplayAttendee = new Date(body.start_time).toLocaleString("en-US", {
          weekday: "long", month: "long", day: "numeric",
          hour: "numeric", minute: "2-digit",
          timeZone: attendeeTz,
        });
        const startDisplayHost = new Date(body.start_time).toLocaleString("en-US", {
          weekday: "long", month: "long", day: "numeric",
          hour: "numeric", minute: "2-digit",
          timeZone: host.booking_timezone ?? "UTC",
        });
        const businessName = host.business_name?.trim() || "STAFFD";

        const sendTx = async (to: string, payload: Record<string, unknown>) => {
          return fetch(`${listmonkUrl}/api/tx`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
            body: JSON.stringify({
              subscriber_email: to,
              template_id: 0,
              from_email: "noreply@urstaffd.com",
              data: payload,
              content_type: "html",
            }),
          });
        };

        // Attendee confirmation
        await sendTx(body.attendee_email.trim(), {
          recipient: "attendee",
          business_name: businessName,
          start_display: startDisplayAttendee,
          duration,
          notes: body.notes ?? "",
        });

        // Host notification
        if (hostEmail) {
          await sendTx(hostEmail, {
            recipient: "host",
            attendee_name: body.attendee_name.trim(),
            attendee_email: body.attendee_email.trim(),
            attendee_phone: body.attendee_phone?.trim() ?? "",
            start_display: startDisplayHost,
            duration,
            notes: body.notes ?? "",
          });
        }
      } catch {
        // best effort — do not fail the booking if email fails
      }
    }

    return Response.json({
      ok: true,
      booking_id: booking.id,
      business_name: host.business_name ?? "",
      start_time: body.start_time,
      duration,
    });
  } catch (err) {
    console.error("Booking POST error:", err);
    return Response.json({ error: "Failed to create booking" }, { status: 500 });
  }
}
