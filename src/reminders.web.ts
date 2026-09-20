import type { Entry } from "./domain";
import type { SupportedLocale } from "./locales";
import type { ReminderSettings } from "./reminderSettings";
import { t } from "./i18n";
import type { FamilyExtraRecord } from "./family/extras";
import { loadAutoFeedReminder } from "./storage";
import { captureScheduledReminderRecords } from "./family/familyReminderPlan";

export async function captureReminderRecords(): Promise<FamilyExtraRecord[]> {
  return captureScheduledReminderRecords([], await loadAutoFeedReminder());
}

export type Reminder = {
  id: string;
  title: string;
  detail: string;
  settings?: ReminderSettings;
};

export async function listReminders(): Promise<Reminder[]> {
  return [];
}

export async function cancelReminder(_id: string) {}

export async function updateReminderSilent(_id: string, _silent: boolean) {}

export async function addReminder(
  _title: string,
  _minutes: number,
  _dailyTime?: string,
  _silent = true,
) {
  throw new Error(
    t("本地提醒需要在 iPhone 或 Android 真机中设置，网页预览不支持。"),
  );
}

export async function addAutoFeedReminder(
  _title: string,
  _minutes: number,
  _silent: boolean,
  _entries: Entry[],
) {
  throw new Error(
    t("本地提醒需要在 iPhone 或 Android 真机中设置，网页预览不支持。"),
  );
}

export async function rescheduleAutoFeedReminders(
  _entries: Entry[],
  _locale?: SupportedLocale,
  _formattingLocale?: string,
  _shouldContinue?: () => boolean,
) {}
