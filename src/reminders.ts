import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { Entry } from "./domain";
import { feedReminderTime } from "./feedReminder";
import {
  settingsFromReminderData,
  type ReminderKind,
  type ReminderSettings,
} from "./reminderSettings";
import {
  clearAutoFeedReminder,
  loadAutoFeedReminder,
  saveAutoFeedReminder,
} from "./storage";
import { formatDate, t } from "./i18n";
import { personalStorageIsBlocked, reminderWrite } from "./personalWrites";
import type { FamilyExtraRecord } from "./family/extras";
import {
  absoluteReminderTime,
  captureScheduledReminderRecords,
  isFamilyReminderData,
} from "./family/familyReminderPlan";
import { shouldShowFamilyNotification } from "./family/familyReminders";

export type Reminder = {
  id: string;
  title: string;
  detail: string;
  settings?: ReminderSettings;
};
const autoFeedMode = "after-feed";

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data;
    const allowed = isFamilyReminderData(data)
      ? shouldShowFamilyNotification(data)
      : !personalStorageIsBlocked();
    return {
      shouldShowBanner: allowed,
      shouldShowList: allowed,
      shouldPlaySound: allowed && !!notification.request.content.sound,
      shouldSetBadge: false,
    };
  },
});

function validMinutes(minutes: number) {
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10080)
    throw new Error(t("请填写 1–10080 分钟"));
}

async function prepareChannel(silent: boolean) {
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync(silent ? "quiet" : "care", {
      name: silent ? t("安静提醒") : t("照护提醒"),
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: silent ? null : "default",
    });
  return silent ? "quiet" : "care";
}

async function requirePermission() {
  const permission = await Notifications.requestPermissionsAsync();
  if (
    !permission.granted &&
    permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL
  )
    throw new Error(t("请在手机设置中允许通知后再试"));
}

function autoFeedDetail(time: number) {
  return t("随最新喂养 · {time}", {
    time: formatDate(time, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  });
}

async function scheduleAutoFeedReminder(
  title: string,
  minutes: number,
  silent: boolean,
  time: number,
) {
  const channelId = await prepareChannel(silent);
  const detail = autoFeedDetail(time);
  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body: t("距离上次喂养已到设定间隔。"),
      sound: silent ? false : "default",
      data: {
        detail,
        reminderMode: autoFeedMode,
        reminderKind: "feed",
        minutes,
        dailyTime: "",
        silent,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(time),
      channelId,
    },
  });
}

export async function listReminders(): Promise<Reminder[]> {
  return (await Notifications.getAllScheduledNotificationsAsync())
    .filter((n) => !isFamilyReminderData(n.content.data))
    .map((n) => {
      const title = n.content.title ?? t("照护提醒");
      return {
        id: n.identifier,
        title,
        detail: String(n.content.data?.detail ?? ""),
        settings: settingsFromReminderData(title, n.content.data),
      };
    });
}

export async function captureReminderRecords(): Promise<FamilyExtraRecord[]> {
  const [scheduled, automatic] = await Promise.all([
    Notifications.getAllScheduledNotificationsAsync(),
    loadAutoFeedReminder(),
  ]);
  return captureScheduledReminderRecords(scheduled, automatic);
}

export async function cancelReminder(id: string) {
  return reminderWrite(async () => {
    const reminder = (
      await Notifications.getAllScheduledNotificationsAsync()
    ).find((item) => item.identifier === id);
    if (reminder?.content.data?.reminderMode === autoFeedMode)
      await clearAutoFeedReminder();
    await Notifications.cancelScheduledNotificationAsync(id);
  });
}

export async function updateReminderSilent(id: string, silent: boolean) {
  return reminderWrite(async () => {
    const reminder = (
      await Notifications.getAllScheduledNotificationsAsync()
    ).find((item) => item.identifier === id);
    if (!reminder || !reminder.trigger || typeof reminder.trigger !== "object")
      return;
    const channelId = await prepareChannel(silent);
    const onceAt = absoluteReminderTime(
      reminder.content.data,
      reminder.trigger,
    );
    await Notifications.cancelScheduledNotificationAsync(id);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: reminder.content.title ?? t("照护提醒"),
        body: reminder.content.body ?? t("按宝宝当下的需要安排照护。"),
        sound: silent ? false : "default",
        data: { ...(reminder.content.data ?? {}), silent },
      },
      trigger: onceAt
        ? {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(onceAt),
            channelId,
          }
        : ({
            ...reminder.trigger,
            channelId,
          } as Notifications.NotificationTriggerInput),
    });
  });
}

export async function addReminder(
  title: string,
  minutes: number,
  dailyTime?: string,
  silent = true,
  kind: ReminderKind = "feed",
) {
  return reminderWrite(async () => {
    const channelId = await prepareChannel(silent);
    await requirePermission();
    let trigger: Notifications.NotificationTriggerInput;
    let detail: string;
    let onceAt: string | undefined;
    if (dailyTime) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyTime))
        throw new Error(t("时间格式应为 HH:mm"));
      const [hour, minute] = dailyTime.split(":").map(Number);
      trigger = {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
        channelId,
      };
      detail = t("每天 {time}", { time: dailyTime });
    } else {
      validMinutes(minutes);
      const date = new Date(Date.now() + minutes * 60000);
      onceAt = date.toISOString();
      trigger = {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
        channelId,
      };
      detail = formatDate(date, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body: t("按宝宝当下的需要安排照护。"),
        sound: silent ? false : "default",
        data: {
          detail,
          reminderMode: dailyTime ? "daily" : "once",
          reminderKind: kind,
          minutes,
          dailyTime: dailyTime ?? "",
          silent,
          ...(onceAt ? { onceAt } : {}),
        },
      },
      trigger,
    });
  });
}

export async function addAutoFeedReminder(
  title: string,
  minutes: number,
  silent: boolean,
  entries: Entry[],
) {
  return reminderWrite(async () => {
    validMinutes(minutes);
    const time = feedReminderTime(entries, minutes);
    if (time === null)
      throw new Error(t("请先保存一条喂养记录，再启用自动提醒"));
    await requirePermission();
    await saveAutoFeedReminder({
      kind: "feed",
      mode: "after-feed",
      title,
      minutes,
      dailyTime: "",
      silent,
    });
    await rescheduleAutoFeedRemindersCore(entries);
  });
}

export async function rescheduleAutoFeedReminders(entries: Entry[]) {
  return reminderWrite(() => rescheduleAutoFeedRemindersCore(entries));
}

async function rescheduleAutoFeedRemindersCore(entries: Entry[]) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const automatic = scheduled.filter(
    (reminder) => reminder.content.data?.reminderMode === autoFeedMode,
  );
  const legacySettings = automatic
    .map((reminder) =>
      settingsFromReminderData(
        reminder.content.title ?? t("喂养提醒"),
        reminder.content.data,
      ),
    )
    .find((settings) => settings?.mode === "after-feed");
  const storedSettings = await loadAutoFeedReminder();
  const settings = storedSettings ?? legacySettings;
  if (!settings) return;
  if (!storedSettings && legacySettings)
    await saveAutoFeedReminder(legacySettings);
  const time = feedReminderTime(entries, settings.minutes);
  if (time !== null)
    await scheduleAutoFeedReminder(
      settings.title,
      settings.minutes,
      settings.silent,
      time,
    );
  for (const reminder of automatic)
    await Notifications.cancelScheduledNotificationAsync(reminder.identifier);
}
