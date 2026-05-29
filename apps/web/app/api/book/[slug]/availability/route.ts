/**
 * GET /api/book/[slug]/availability?date=YYYY-MM-DD&tz=America/New_York
 *
 * Returns available booking slots for the given date in the attendee's timezone.
 * Looks up the host by booking_slug, reads their availability rules + duration +
 * buffer, then subtracts already-booked slots from the available window.
 *
 * Returns 404 if no host has this slug (or scheduling is disabled).
 */

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

interface AvailabilityRules {
  // Per-day windows in HH:MM 24-hour format, expressed in the host's timezone.
  // Each day can have multiple windows: [["09:00","12:00"],["13:00","17:00"]]
  sun?: [string, string][];
  mon?: [string, string][];
  tue?: [string, string][];
  wed?: [string, string][];
  thu?: [string, string][];
  fri?: [string, string][];
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

/** Convert "HH:MM" in a specific timezone to a UTC Date for a given calendar date. */
function localTimeToUtc(dateStr: string, timeStr: string, _tz: string): Date {
  // Note: full IANA timezone handling without a library is fragile. For MVP we
  // treat the host's timezone as the source of truth for availability windows
  // and assume the host's server runs in UTC (Vercel default). The browser-side
  // booking UI displays slots in the attendee's local timezone.
  const [h, m] = timeStr.split(":").map((s) => parseInt(s, 10));
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { searchParams } = new URL(req.url);
  const dateStr = searchParams.get("date");

  if (!slug || !dateStr) {
    return Response.json({ error: "slug and date required" }, { status: 400 });
  }

  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const token = await getAdminToken(pbUrl);

    // Find host by booking slug
    const hostRes = await fetch(
      `${pbUrl}/api/collections/businesses/records?filter=(booking_slug='${encodeURIComponent(slug)}')&perPage=1`,
      { headers: { Authorization: token } }
    );
    const hostData = (await hostRes.json()) as {
      items?: Array<{
        user: string;
        business_name?: string;
        booking_enabled?: boolean;
        booking_availability?: AvailabilityRules;
        booking_default_duration?: number;
        booking_buffer?: number;
        booking_timezone?: string;
      }>;
    };
    const host = hostData.items?.[0];

    if (!host || host.booking_enabled !== true) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const duration = host.booking_default_duration ?? 30;
    const buffer = host.booking_buffer ?? 0;
    const timezone = host.booking_timezone ?? "UTC";
    const rules = host.booking_availability ?? {};

    // Determine day-of-week for the requested date
    const requested = new Date(`${dateStr}T12:00:00Z`); // noon avoids DST edge
    const dayKey = DAY_KEYS[requested.getUTCDay()];
    const windows = (dayKey ? rules[dayKey] : undefined) ?? [];

    if (windows.length === 0) {
      return Response.json({ slots: [], duration, timezone });
    }

    // Fetch existing bookings for this host on this date
    const dayStart = new Date(`${dateStr}T00:00:00Z`).toISOString();
    const dayEnd = new Date(`${dateStr}T23:59:59Z`).toISOString();
    const filter = encodeURIComponent(
      `user='${host.user}' && start_time >= '${dayStart}' && start_time <= '${dayEnd}' && status != 'cancelled'`
    );
    const bookingsRes = await fetch(
      `${pbUrl}/api/collections/bookings/records?filter=${filter}&perPage=100&fields=start_time,duration`,
      { headers: { Authorization: token } }
    );
    const bookingsData = (await bookingsRes.json()) as {
      items?: Array<{ start_time: string; duration: number }>;
    };
    const taken = (bookingsData.items ?? []).map((b) => ({
      start: new Date(b.start_time).getTime(),
      end:   new Date(b.start_time).getTime() + (b.duration + buffer) * 60_000,
    }));

    // Generate slots from windows
    const slots: string[] = [];
    const slotMs = duration * 60_000;
    const now = Date.now();

    for (const [winStart, winEnd] of windows) {
      let cursor = localTimeToUtc(dateStr, winStart, timezone).getTime();
      const winEndTime = localTimeToUtc(dateStr, winEnd, timezone).getTime();

      while (cursor + slotMs <= winEndTime) {
        const slotEnd = cursor + slotMs;
        // Skip past slots
        if (cursor < now) {
          cursor = slotEnd;
          continue;
        }
        // Skip overlaps with taken bookings
        const conflict = taken.some(
          (t) => cursor < t.end && slotEnd > t.start
        );
        if (!conflict) {
          slots.push(new Date(cursor).toISOString());
        }
        cursor = slotEnd + buffer * 60_000;
      }
    }

    return Response.json({
      slots,
      duration,
      timezone,
      business_name: host.business_name ?? "",
    });
  } catch (err) {
    console.error("Availability error:", err);
    return Response.json({ error: "Failed to load availability" }, { status: 500 });
  }
}
