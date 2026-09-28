import * as Notifications from "expo-notifications";
import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";
import type { Entry } from "../domain";
import { t, translate } from "../i18n";
import type { SupportedLocale } from "../locales";
import type { FamilyExtraRecord } from "./extras";
import { protectFamilyStorage } from "./storageProtection";
import {
  FamilyReminderCoordinator,
  type FamilyReminderPreferences,
  type FamilyReminderCleanup,
} from "./familyReminderCoordinator";
import {
  familyReminderPlans,
  isFamilyReminderData,
} from "./familyReminderPlan";

let database: Promise<SQLite.SQLiteDatabase> | undefined;
function db(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  const opening = (async () => {
    await protectFamilyStorage();
    const value = await SQLite.openDatabaseAsync(
      "little-days-family-notifications.db",
    );
    try {
      // Only a device preference, never a copy of family care/record payloads.
      await value.execAsync(
        "CREATE TABLE IF NOT EXISTS device_opt_in (id INTEGER PRIMARY KEY CHECK(id = 1), origin TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0, 1))); CREATE TABLE IF NOT EXISTS cleanup_retry (id INTEGER PRIMARY KEY CHECK(id = 1), clear_preference INTEGER NOT NULL CHECK(clear_preference IN (0, 1)));",
      );
      return value;
    } catch (error) {
      await value.closeAsync().catch(() => undefined);
      throw error;
    }
  })();
  database = opening;
  // A transient protection/disk failure must not poison every later cleanup.
  void opening.catch(() => {
    if (database === opening) database = undefined;
  });
  return opening;
}

const coordinator = new FamilyReminderCoordinator({
  async loadCleanup() {
    const row = await (
      await db()
    ).getFirstAsync<{ clear_preference: number }>(
      "SELECT clear_preference FROM cleanup_retry WHERE id = 1",
    );
    return row ? { clearPreference: row.clear_preference === 1 } : null;
  },
  async saveCleanup(value: FamilyReminderCleanup | null) {
    if (value)
      await (
        await db()
      ).runAsync(
        "INSERT OR REPLACE INTO cleanup_retry(id, clear_preference) VALUES (1, ?)",
        value.clearPreference ? 1 : 0,
      );
    else await (await db()).runAsync("DELETE FROM cleanup_retry WHERE id = 1");
  },
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
    let failed = false;
    for (const notification of await Notifications.getPresentedNotificationsAsync())
      if (isFamilyReminderData(notification.request.content.data)) {
        try {
          await Notifications.dismissNotificationAsync(
            notification.request.identifier,
          );
        } catch {
          failed = true;
        }
      }
    if (failed) throw new Error("reminder_cleanup_failed");
  },
  async schedule(origin, plan) {
    const channelId = plan.silent ? "family-quiet" : "family-care";
    if (Platform.OS === "android")
      await Notifications.setNotificationChannelAsync(channelId, {
        name: plan.silent
          ? translate("安静提醒", plan.locale)
          : translate("照护提醒", plan.locale),
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: plan.silent ? null : "default",
      });
    return Notifications.scheduleNotificationAsync({
      content: {
        title: plan.title,
        body: translate("按宝宝当下的需要安排照护。", plan.locale),
        sound: plan.silent ? false : "default",
        data: {
          familyReminder: true,
          familyOrigin: origin,
          familyFingerprint: plan.fingerprint,
          familyRecordId: plan.recordId,
          familyLocale: plan.locale,
          familyContentVersion: plan.contentVersion,
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
  locale: SupportedLocale = "en",
) {
  return coordinator.sync(
    origin,
    familyReminderPlans(records, entries, Date.now(), locale),
  );
}
export function shouldShowFamilyNotification(
  data: Record<string, unknown> | undefined,
): boolean {
  return (
    isFamilyReminderData(data) && coordinator.shouldShow(data?.familyOrigin)
  );
}
