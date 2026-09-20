import type { Entry } from "../domain";
import type { SupportedLocale } from "../locales";
import { latestFeedStart } from "../feedReminder";
import {
  parseReminderSettings,
  reminderRevision,
  reminderRuleId,
  settingsFromReminderData,
  type ReminderSettings,
} from "../reminderSettings";
import type { FamilyExtraRecord } from "./extras";

export type FamilyReminderPlan = {
  recordId: string;
  title: string;
  silent: boolean;
  locale: SupportedLocale;
  contentVersion: number;
  trigger:
    | { type: "date"; time: number }
    | { type: "daily"; hour: number; minute: number };
  fingerprint: string;
};

// Bump whenever app-generated notification copy changes so every opted-in
// device replaces stale content while retaining the shared rule.
export const familyReminderContentVersion = 1;

export function isFamilyReminderData(
  data: Record<string, unknown> | undefined,
): boolean {
  return data?.familyReminder === true;
}

// An interval from getAllScheduledNotificationsAsync is the ORIGINAL interval,
// not the remaining time. Never rebase an old notification onto Date.now().
export function absoluteReminderTime(
  data: Record<string, unknown> | undefined,
  trigger: unknown,
): string | null {
  let time = typeof data?.onceAt === "string" ? Date.parse(data.onceAt) : NaN;
  if (!Number.isFinite(time) && trigger && typeof trigger === "object") {
    const value = trigger as Record<string, unknown>;
    if (value.type === "date") {
      const date = value.value ?? value.timestamp ?? value.date;
      time =
        typeof date === "number"
          ? date
          : typeof date === "string"
            ? Date.parse(date)
            : NaN;
    }
  }
  return Number.isFinite(time) && Math.abs(time) <= 8.64e15
    ? new Date(time).toISOString()
    : null;
}

type CapturedNotification = {
  identifier: string;
  content: { title?: string | null; data?: Record<string, unknown> };
  trigger: unknown;
};

export function captureScheduledReminderRecords(
  scheduled: readonly CapturedNotification[],
  savedAutomatic: ReminderSettings | null,
): FamilyExtraRecord[] {
  const records: FamilyExtraRecord[] = [];
  let automatic = savedAutomatic;
  const canonical = new Map<string, CapturedNotification>();
  for (const notification of scheduled) {
    if (isFamilyReminderData(notification.content.data)) continue;
    const ruleId = reminderRuleId(
      notification.identifier,
      notification.content.data,
    );
    const current = canonical.get(ruleId);
    if (
      !current ||
      reminderRevision(notification.content.data) >
        reminderRevision(current.content.data)
    )
      canonical.set(ruleId, notification);
  }
  for (const [ruleId, notification] of [...canonical.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const settings = settingsFromReminderData(
      notification.content.title ?? "",
      notification.content.data,
    );
    if (!settings) throw new Error("legacy_reminder_settings_unknown");
    if (settings.mode === "after-feed") {
      automatic ??= settings;
      continue;
    }
    const onceAt =
      settings.mode === "once"
        ? absoluteReminderTime(notification.content.data, notification.trigger)
        : null;
    if (settings.mode === "once" && !onceAt)
      throw new Error("legacy_reminder_time_unknown");
    records.push({
      id: `reminder-${ruleId}`,
      kind: "reminder",
      settings,
      ...(onceAt ? { onceAt } : {}),
    });
  }
  if (automatic)
    records.push({
      id: "reminder-auto-feed",
      kind: "reminder",
      settings: automatic,
    });
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

export function familyReminderPlans(
  records: readonly FamilyExtraRecord[],
  entries: readonly Entry[],
  now = Date.now(),
  locale: SupportedLocale = "en",
): FamilyReminderPlan[] {
  const latestFeed = latestFeedStart([...entries]);
  const plans: FamilyReminderPlan[] = [];
  for (const record of records) {
    if (record.kind !== "reminder") continue;
    const settings = parseReminderSettings(record.settings);
    if (!settings) continue;
    let trigger: FamilyReminderPlan["trigger"];
    if (settings.mode === "daily") {
      const [hour, minute] = settings.dailyTime.split(":").map(Number);
      trigger = { type: "daily", hour, minute };
    } else {
      const time =
        settings.mode === "once"
          ? Date.parse(record.onceAt ?? "")
          : latestFeed === null
            ? NaN
            : latestFeed + settings.minutes * 60_000;
      // Past one-offs and overdue feed occurrences stay recorded but do not
      // repeatedly ring after refresh, reinstall, time passage, or re-enabling.
      if (!Number.isFinite(time) || time <= now) continue;
      trigger = { type: "date", time };
    }
    const plan = {
      recordId: record.id,
      title: settings.title,
      silent: settings.silent,
      locale,
      contentVersion: familyReminderContentVersion,
      trigger,
    };
    plans.push({ ...plan, fingerprint: JSON.stringify(plan) });
  }
  return plans.sort((a, b) => a.recordId.localeCompare(b.recordId));
}
