/**
 * Cal.diy integration — creates a one-off booking link or schedules a meeting.
 * Requires CAL_API_URL + CAL_API_KEY env vars (from your self-hosted Cal instance).
 * Returns 503 with setup instructions when not yet configured.
 */

const CAL_URL = process.env.CAL_API_URL ?? "";
const CAL_KEY = process.env.CAL_API_KEY ?? "";

export async function POST(req: Request) {
  if (!CAL_URL || !CAL_KEY) {
    return Response.json(
      {
        error: "not_configured",
        message:
          "Meeting scheduling is not set up yet. Deploy Cal.diy and add CAL_API_URL and CAL_API_KEY to your environment variables.",
      },
      { status: 503 }
    );
  }

  try {
    const { eventTypeId, attendeeEmail, attendeeName, notes } =
      (await req.json()) as {
        eventTypeId?: number;
        attendeeEmail: string;
        attendeeName?: string;
        notes?: string;
      };

    if (!attendeeEmail?.trim()) {
      return Response.json({ error: "attendeeEmail is required" }, { status: 400 });
    }

    // Create a booking link via Cal API v2
    const res = await fetch(`${CAL_URL}/v2/bookings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CAL_KEY}`,
        "cal-api-version": "2024-08-13",
      },
      body: JSON.stringify({
        eventTypeId: eventTypeId ?? 1,
        attendee: {
          name: attendeeName ?? attendeeEmail,
          email: attendeeEmail,
          timeZone: "America/New_York",
          language: "en",
        },
        metadata: { notes: notes ?? "" },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: "Cal error", detail: text }, { status: 502 });
    }

    const data = (await res.json()) as {
      data?: { uid?: string; meetingUrl?: string };
    };

    return Response.json({
      success: true,
      bookingUid: data.data?.uid,
      meetingUrl: data.data?.meetingUrl,
      bookingUrl: data.data?.uid
        ? `${CAL_URL}/booking/${data.data.uid}`
        : null,
    });
  } catch (err) {
    console.error("Cal route error:", err);
    return Response.json({ error: "Failed to create booking" }, { status: 500 });
  }
}
