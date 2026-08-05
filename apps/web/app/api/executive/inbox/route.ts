import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import {
  bookingInboxItem,
  buildBusinessInbox,
  missionInboxItem,
} from "../../_lib/orchestrator/business-inbox";
import { integrationHealthInboxItems } from "../../_lib/orchestrator/integration-health-inbox";
import { liveIntegrationInboxItems } from "../../_lib/orchestrator/live-inbox-sources";
import {
  groupMissionEvents,
  listMissionEventsForUser,
  summarizeMissionTimeline,
} from "../../_lib/orchestrator/mission-events";
import type { MissionRecord } from "../../_lib/orchestrator/mission-repository";
import {
  dispatchEmailDigest,
  dispatchImmediateEmailNotifications,
  dispatchImmediatePushNotifications,
} from "../../_lib/orchestrator/notification-dispatch";
import { buildNotificationDigest } from "../../_lib/orchestrator/notification-digest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
} from "../../_lib/orchestrator/notification-policy";

type BookingRecord = {
  id: string;
  attendee_name?: string;
  start_time: string;
  status?: string;
  duration?: number;
};

type NotificationPreferenceRecord = {
  preferences?: unknown;
};

async function listOwnerRecords<T>(collection: string, userId: string, sort = "-updated"): Promise<T[]> {
  const token = await getAdminToken();
  const params = new URLSearchParams({
    filter: `user = '${pbEscape(userId)}'`,
    sort,
    perPage: "100",
  });
  const response = await fetch(`${pbUrl()}/api/collections/${collection}/records?${params}`, {
    headers: adminHeaders(token),
    cache: "no-store",
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`${collection} listing failed (${response.status})`);
  const payload = (await response.json()) as { items?: T[] };
  return payload.items ?? [];
}

export async function GET(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  try {
    const [missions, bookings, missionEvents, integrationItems, integrationIncidents, preferenceRecords] = await Promise.all([
      listOwnerRecords<MissionRecord>("missions", user.id),
      listOwnerRecords<BookingRecord>("bookings", user.id, "start_time"),
      listMissionEventsForUser(user.id).catch(() => []),
      liveIntegrationInboxItems(user),
      integrationHealthInboxItems(user).catch(() => []),
      listOwnerRecords<NotificationPreferenceRecord>("notification_preferences", user.id).catch(() => []),
    ]);
    const eventsByMission = groupMissionEvents(missionEvents);

    const missionItems = missions.map((mission) => {
      const timeline = summarizeMissionTimeline(
        mission.plan.steps.length,
        mission.status,
        eventsByMission.get(mission.id) ?? [],
      );
      return missionInboxItem({
        id: mission.id,
        goal: mission.goal,
        status: mission.status,
        updated: mission.updated,
        progress: {
          percent: timeline.progressPercent,
          latestMessage: timeline.events.at(-1)?.message ?? null,
        },
      });
    });

    const bookingItems = bookings.map((booking) => bookingInboxItem(booking));
    const items = buildBusinessInbox([
      ...missionItems,
      ...bookingItems,
      ...integrationItems,
      ...integrationIncidents,
    ]);
    const preferences = normalizeNotificationPreferences(preferenceRecords[0]?.preferences)
      ?? DEFAULT_NOTIFICATION_PREFERENCES;
    const notifications = buildNotificationDigest(items, preferences);
    const [push, email, digestEmail] = await Promise.all([
      dispatchImmediatePushNotifications(user.id, notifications).catch(() => ({
        attempted: 0,
        sent: 0,
        skipped: notifications.immediate.filter((entry) => entry.channels.includes("push")).length,
        failed: 0,
      })),
      dispatchImmediateEmailNotifications(user.id, user.email, notifications).catch(() => ({
        attempted: 0,
        sent: 0,
        skipped: notifications.immediate.filter((entry) => entry.channels.includes("email")).length,
        failed: 0,
      })),
      dispatchEmailDigest(user.id, user.email, notifications).catch(() => ({
        attempted: 0,
        sent: 0,
        skipped: notifications.digestItems.length ? 1 : 0,
        failed: 0,
      })),
    ]);

    return Response.json({
      items,
      summary: {
        total: items.length,
        critical: items.filter((item) => item.priority === "critical").length,
        high: items.filter((item) => item.priority === "high").length,
      },
      notifications,
      delivery: { push, email, digestEmail },
    });
  } catch (error) {
    console.error("business inbox failed:", error);
    return Response.json({ error: "business_inbox_failed" }, { status: 500 });
  }
}
