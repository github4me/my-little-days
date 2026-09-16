import * as Notifications from "expo-notifications";
import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";
import type { Entry } from "../domain";
import { t } from "../i18n";
import type { FamilyExtraRecord } from "./extras";
import {
  FamilyReminderCoordinator,
  type FamilyReminderPreferences,
} from "./familyReminderCoordinator";
import {
  familyReminderPlans,
  isFamilyReminderData,
} from "./familyReminderPlan";

let database: Promise<SQLite.SQLiteDatabase> | undefined;
async function db() {
  return (database ??= (async () => {
    const value = await SQLite.openDatabaseAsync(
      "little-days-family-notifications.db",
    );
    // Only a device preference, never a copy of family care/record payloads.
    await value.execAsync(
      "CREATE TABLE IF NOT EXISTS device_opt_in (id INTEGER PRIMARY KEY CHECK(id = 1), origin TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0, 1))); ",
    );
    return value;
  })());
}

const coordinator = new FamilyReminderCoordinator({
  async load() {
    const row = await (
      await db()
    ).getFirstAsync<{ origin: string; enabled: number }>(
      "SELECT origin, enabled FROM device_opt_in WHERE id = 1",
    );
    return row ? { origin: row.origin, enabled: row.enabled === 1 } : null;
  },
  async save(value: FamilyReminderPreferences | null) {
    if (value)
      await (
        await db()
      ).runAsync(
        "INSERT OR REPLACE INTO device_opt_in(id, origin, enabled) VALUES (1, ?, ?)",
        value.origin,
        value.enabled ? 1 : 0,
      );
    else await (await db()).runAsync("DELETE FROM device_opt_in WHERE id = 1");
  },
  async requestPermission() {
    const permission = await Notifications.requestPermissionsAsync();
    if (
      !permission.granted &&
      permission.ios?.status !==
        Notifications.IosAuthorizationStatus.PROVISIONAL
    )
      throw new Error(t("请在手机设置中允许通知后再试"));
  },
  async list() {
    return (await Notifications.getAllScheduledNotificationsAsync())
      .filter((notification) => isFamilyReminderData(notification.content.data))
      .map((notification) => ({
        id: notification.identifier,
        origin: String(notification.content.data?.familyOrigin ?? ""),
        fingerprint: String(notification.content.data?.familyFingerprint ?? ""),
      }));
  },
  async cancel(id) {
    await Notifications.cancelScheduledNotificationAsync(id);
  },
  async dismiss() {
    for (const notification of await Notifications.getPresentedNotificationsAsync())
      if (isFamilyReminderData(notification.request.content.data))
        await Notifications.dismissNotificationAsync(
          notification.request.identifier,
        );
  },
  async schedule(origin, plan) {
    const channelId = plan.silent ? "family-quiet" : "family-care";
    if (Platform.OS === "android")
      await Notifications.setNotificationChannelAsync(channelId, {
        name: plan.silent ? t("安静提醒") : t("照护提醒"),
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: plan.silent ? null : "default",
      });
    return Notifications.scheduleNotificationAsync({
      content: {
        title: plan.title,
        body: t("按宝宝当下的需要安排照护。"),
        sound: plan.silent ? false : "default",
        data: {
          familyReminder: true,
          familyOrigin: origin,
          familyFingerprint: plan.fingerprint,
          familyRecordId: plan.recordId,
        },
      },
      trigger:
        plan.trigger.type === "daily"
          ? {
              type: Notifications.SchedulableTriggerInputTypes.DAILY,
              hour: plan.trigger.hour,
              minute: plan.trigger.minute,
              channelId,
            }
          : {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: new Date(plan.trigger.time),
              channelId,
            },
    });
  },
});

export const loadFamilyReminderOptIn = (origin: string) =>
  coordinator.loadOptIn(origin);
export const setFamilyReminderOptIn = (origin: string, enabled: boolean) =>
  coordinator.setOptIn(origin, enabled);
export const clearFamilyReminders = () => coordinator.clear();
export const suspendFamilyReminders = () => coordinator.suspend();
export function syncFamilyReminders(
  origin: string,
  records: readonly FamilyExtraRecord[],
  entries: readonly Entry[],
) {
  return coordinator.sync(origin, familyReminderPlans(records, entries));
}
export function shouldShowFamilyNotification(
  data: Record<string, unknown> | undefined,
): boolean {
  return (
    isFamilyReminderData(data) && coordinator.shouldShow(data?.familyOrigin)
  );
}
