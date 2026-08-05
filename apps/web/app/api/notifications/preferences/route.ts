import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
  type NotificationPreferences,
} from "../../_lib/orchestrator/notification-policy";

type PreferenceRecord = {
  id: string;
  user: string;
  preferences: NotificationPreferences;
};

async function findPreferenceRecord(userId: string): Promise<PreferenceRecord | null> {
  const token = await getAdminToken();
  const filter = encodeURIComponent(`user = "${pbEscape(userId)}"`);
  const response = await fetch(
    `${pbUrl()}/api/collections/notification_preferences/records?filter=${filter}&perPage=1`,
    { headers: adminHeaders(token), cache: "no-store" },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Notification preference lookup failed (${response.status})`);
  const payload = (await response.json()) as { items?: PreferenceRecord[] };
  return payload.items?.[0] ?? null;
}

export async function GET(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const record = await findPreferenceRecord(user.id);
    const normalized = normalizeNotificationPreferences(record?.preferences);
    return Response.json({ preferences: normalized ?? DEFAULT_NOTIFICATION_PREFERENCES });
  } catch (error) {
    console.error("notification preference read failed:", error);
    return Response.json({ error: "notification_preferences_failed" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const preferences = normalizeNotificationPreferences(body?.preferences);
  if (!preferences) {
    return Response.json({ error: "invalid_notification_preferences" }, { status: 400 });
  }

  try {
    const token = await getAdminToken();
    const existing = await findPreferenceRecord(user.id);
    const response = await fetch(
      existing
        ? `${pbUrl()}/api/collections/notification_preferences/records/${encodeURIComponent(existing.id)}`
        : `${pbUrl()}/api/collections/notification_preferences/records`,
      {
        method: existing ? "PATCH" : "POST",
        headers: adminHeaders(token),
        body: JSON.stringify(existing ? { preferences } : { user: user.id, preferences }),
      },
    );
    if (!response.ok) throw new Error(`Notification preference write failed (${response.status})`);
    return Response.json({ ok: true, preferences });
  } catch (error) {
    console.error("notification preference write failed:", error);
    return Response.json({ error: "notification_preferences_failed" }, { status: 500 });
  }
}
