import * as Notifications from "expo-notifications";
import { randomUUID } from "expo-crypto";
import { Platform } from "react-native";
import type { Entry } from "./domain";
import { feedReminderTime } from "./feedReminder";
import type { SupportedLocale } from "./locales";
import {
  autoFeedReminderRuleId,
  reminderContentVersion,
  reminderNotificationFingerprint,
  reminderRevision,
  reminderRuleId,
  settingsFromReminderData,
  type ReminderKind,
  type ReminderSchedule,
  type ReminderSettings,
} from "./reminderSettings";
import {
  clearAutoFeedReminder,
  loadAutoFeedReminder,
  saveAutoFeedReminder,
} from "./storage";
import {
  currentFormattingLocale,
  currentLocale,
  formatDate,
  t,
  translate,
} from "./i18n";
import { personalStorageIsBlocked, reminderWrite } from "./personalWrites";
import type { FamilyExtraRecord } from "./family/extras";
import {
  absoluteReminderTime,
  captureScheduledReminderRecords,
  isFamilyReminderData,
} from "./family/familyReminderPlan";
import { shouldShowFamilyNotification } from "./family/familyReminders";
import { shouldShowFamilyEntryPush } from "./family/familyPushPresentation";

export type Reminder = {
  id: string;
  title: string;
  detail: string;
  settings?: ReminderSettings;
};
const autoFeedMode = "after-feed";
type ScheduledReminder = Awaited<
  ReturnType<typeof Notifications.getAllScheduledNotificationsAsync>
>[number];

function isPersonalReminder(reminder: ScheduledReminder) {
  return !isFamilyReminderData(reminder.content.data);
}

function logicalReminderGroup(
  scheduled: readonly ScheduledReminder[],
  ruleId: string,
) {
  return scheduled.filter(
    (reminder) =>
      isPersonalReminder(reminder) &&
      reminderRuleId(reminder.identifier, reminder.content.data) === ruleId,
  );
}

function latestReminder(group: readonly ScheduledReminder[]) {
  return [...group].sort((left, right) => {
    const revision =
      reminderRevision(right.content.data) -
      reminderRevision(left.content.data);
    return revision || left.identifier.localeCompare(right.identifier);
  })[0];
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data;
    const allowed =
      data?.kind === "family-entry"
        ? shouldShowFamilyEntryPush(data)
        : isFamilyReminderData(data)
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

async function prepareChannel(silent: boolean, locale: SupportedLocale) {
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync(silent ? "quiet" : "care", {
      name: silent
        ? translate("安静提醒", locale)
        : translate("照护提醒", locale),
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: silent ? null : "default",
    });
  return silent ? "quiet" : "care";
}

async function requirePermission(locale: SupportedLocale) {
  const permission = await Notifications.requestPermissionsAsync();
  if (
    !permission.granted &&
    permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL
  )
    throw new Error(translate("请在手机设置中允许通知后再试", locale));
}

function dateDetail(time: number, formattingLocale: string) {
  return formatDate(
    time,
    {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
    formattingLocale,
  );
}

function reminderSchedule(
  settings: ReminderSettings,
  data: Record<string, unknown> | undefined,
  trigger: unknown,
): ReminderSchedule | null {
  if (settings.mode === "daily") {
    const [hour, minute] = settings.dailyTime.split(":").map(Number);
    return { type: "daily", hour, minute };
  }
  const onceAt = absoluteReminderTime(data, trigger);
  return onceAt ? { type: "date", time: Date.parse(onceAt) } : null;
}

async function scheduleReminder(
  settings: ReminderSettings,
  trigger: ReminderSchedule,
  locale: SupportedLocale,
  formattingLocale: string,
  ruleId: string,
  revision: number,
) {
  const channelId = await prepareChannel(settings.silent, locale);
  const time = trigger.type === "date" ? trigger.time : null;
  const detail =
    settings.mode === "after-feed" && time !== null
      ? translate("随最新喂养 · {time}", locale, {
          time: dateDetail(time, formattingLocale),
        })
      : settings.mode === "daily"
        ? translate("每天 {time}", locale, { time: settings.dailyTime })
        : time !== null
          ? dateDetail(time, formattingLocale)
          : "";
  const fingerprint = reminderNotificationFingerprint(
    settings,
    trigger,
    locale,
    formattingLocale,
  );
  return Notifications.scheduleNotificationAsync({
    content: {
      title: settings.title,
      body:
        settings.mode === "after-feed"
          ? translate("距离上次喂养已到设定间隔。", locale)
          : translate("按宝宝当下的需要安排照护。", locale),
      sound: settings.silent ? false : "default",
      data: {
        detail,
        reminderMode: settings.mode,
        reminderKind: settings.kind,
        minutes: settings.minutes,
        dailyTime: settings.dailyTime,
        silent: settings.silent,
        reminderLocale: locale,
        reminderFormattingLocale: formattingLocale,
        reminderContentVersion,
        reminderFingerprint: fingerprint,
        reminderRuleId: ruleId,
        reminderRevision: revision,
        ...(time !== null ? { onceAt: new Date(time).toISOString() } : {}),
      },
    },
    trigger:
      trigger.type === "daily"
        ? {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            hour: trigger.hour,
            minute: trigger.minute,
            channelId,
          }
        : {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(trigger.time),
            channelId,
          },
  });
}

async function reconcileReminderGroup(
  group: readonly ScheduledReminder[],
  settings: ReminderSettings,
  trigger: ReminderSchedule,
  locale: SupportedLocale,
  formattingLocale: string,
  shouldContinue: () => boolean = () => true,
) {
  if (group.length === 0) return null;
  const authority = latestReminder(group);
  const ruleId = reminderRuleId(authority.identifier, authority.content.data);
  const fingerprint = reminderNotificationFingerprint(
    settings,
    trigger,
    locale,
    formattingLocale,
  );
  const matching = group
    .filter(
      (reminder) => reminder.content.data?.reminderFingerprint === fingerprint,
    )
    .sort((left, right) => {
      const revision =
        reminderRevision(right.content.data) -
        reminderRevision(left.content.data);
      return revision || left.identifier.localeCompare(right.identifier);
    });
  let keep = matching[0]?.identifier ?? null;
  if (!keep) {
    if (!shouldContinue()) return null;
    const nextRevision =
      Math.max(...group.map((item) => reminderRevision(item.content.data))) + 1;
    keep = await scheduleReminder(
      settings,
      trigger,
      locale,
      formattingLocale,
      ruleId,
      nextRevision,
    );
  }

  // Keep the authoritative source until last. If an earlier cancellation
  // fails, a retry can recover the group and reuse the new native schedule.
  const obsolete = group
    .filter((reminder) => reminder.identifier !== keep)
    .sort((left, right) => {
      if (left.identifier === authority.identifier) return 1;
      if (right.identifier === authority.identifier) return -1;
      return left.identifier.localeCompare(right.identifier);
    });
  for (const reminder of obsolete) {
    if (!shouldContinue()) return keep;
    await Notifications.cancelScheduledNotificationAsync(reminder.identifier);
  }
  return keep;
}

export async function listReminders(): Promise<Reminder[]> {
  const scheduled = (
    await Notifications.getAllScheduledNotificationsAsync()
  ).filter(isPersonalReminder);
  const canonical = new Map<string, ScheduledReminder>();
  for (const reminder of scheduled) {
    const ruleId = reminderRuleId(reminder.identifier, reminder.content.data);
    const current = canonical.get(ruleId);
    if (
      !current ||
      reminderRevision(reminder.content.data) >
        reminderRevision(current.content.data)
    )
      canonical.set(ruleId, reminder);
  }
  return [...canonical.values()].map((n) => {
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
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const reminder = scheduled.find((item) => item.identifier === id);
    if (!reminder) {
      await Notifications.cancelScheduledNotificationAsync(id);
      return;
    }
    const ruleId = reminderRuleId(id, reminder.content.data);
    const group = logicalReminderGroup(scheduled, ruleId);
    for (const item of group)
      await Notifications.cancelScheduledNotificationAsync(item.identifier);
    if (reminder.content.data?.reminderMode === autoFeedMode)
      await clearAutoFeedReminder();
  });
}

export async function updateReminderSilent(id: string, silent: boolean) {
  return reminderWrite(async () => {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const reminder = scheduled.find((item) => item.identifier === id);
    if (!reminder) return;
    const ruleId = reminderRuleId(id, reminder.content.data);
    const group = logicalReminderGroup(scheduled, ruleId);
    const authority = latestReminder(group);
    const title = authority.content.title ?? t("照护提醒");
    const settings = settingsFromReminderData(title, authority.content.data);
    if (!settings) return;
    const trigger = reminderSchedule(
      settings,
      authority.content.data,
      authority.trigger,
    );
    if (!trigger) return;
    const next = { ...settings, silent };
    if (next.mode === "after-feed") await saveAutoFeedReminder(next);
    await reconcileReminderGroup(
      group,
      next,
      trigger,
      currentLocale(),
      currentFormattingLocale(),
    );
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
    const locale = currentLocale();
    await requirePermission(locale);
    let trigger: ReminderSchedule;
    if (dailyTime) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyTime))
        throw new Error(t("时间格式应为 HH:mm"));
      const [hour, minute] = dailyTime.split(":").map(Number);
      trigger = { type: "daily", hour, minute };
    } else {
      validMinutes(minutes);
      trigger = { type: "date", time: Date.now() + minutes * 60000 };
    }
    await scheduleReminder(
      {
        kind,
        mode: dailyTime ? "daily" : "once",
        title,
        minutes,
        dailyTime: dailyTime ?? "",
        silent,
      },
      trigger,
      locale,
      currentFormattingLocale(),
      randomUUID(),
      0,
    );
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
    const locale = currentLocale();
    await requirePermission(locale);
    await saveAutoFeedReminder({
      kind: "feed",
      mode: "after-feed",
      title,
      minutes,
      dailyTime: "",
      silent,
    });
    await rescheduleAutoFeedRemindersCore(
      entries,
      locale,
      currentFormattingLocale(),
    );
  });
}

export async function rescheduleAutoFeedReminders(
  entries: Entry[],
  locale: SupportedLocale = currentLocale(),
  formattingLocale: string = currentFormattingLocale(),
  shouldContinue: () => boolean = () => true,
) {
  return reminderWrite(() =>
    shouldContinue()
      ? rescheduleAutoFeedRemindersCore(
          entries,
          locale,
          formattingLocale,
          shouldContinue,
        )
      : Promise.resolve(),
  );
}

async function rescheduleAutoFeedRemindersCore(
  entries: Entry[],
  locale: SupportedLocale,
  formattingLocale: string,
  shouldContinue: () => boolean = () => true,
) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  if (!shouldContinue()) return;
  const personal = scheduled.filter(
    (reminder) => !isFamilyReminderData(reminder.content.data),
  );
  const automatic = personal.filter(
    (reminder) => reminder.content.data?.reminderMode === autoFeedMode,
  );
  const legacySettings = automatic
    .map((reminder) =>
      settingsFromReminderData(
        reminder.content.title ?? translate("喂养提醒", locale),
        reminder.content.data,
      ),
    )
    .find((settings) => settings?.mode === "after-feed");
  const storedSettings = await loadAutoFeedReminder();
  if (!shouldContinue()) return;
  const settings = storedSettings ?? legacySettings;
  if (!storedSettings && legacySettings)
    await saveAutoFeedReminder(legacySettings);
  if (!shouldContinue()) return;
  if (settings) {
    const time = feedReminderTime(entries, settings.minutes);
    let keep: string | null = null;
    if (time !== null) {
      const trigger = { type: "date", time } as const;
      const fingerprint = reminderNotificationFingerprint(
        settings,
        trigger,
        locale,
        formattingLocale,
      );
      keep =
        latestReminder(
          automatic.filter(
            (reminder) =>
              reminder.content.data?.reminderFingerprint === fingerprint,
          ),
        )?.identifier ?? null;
      if (!keep) {
        if (!shouldContinue()) return;
        keep = await scheduleReminder(
          settings,
          trigger,
          locale,
          formattingLocale,
          autoFeedReminderRuleId,
          Math.max(
            -1,
            ...automatic.map((item) => reminderRevision(item.content.data)),
          ) + 1,
        );
      }
    }
    for (const reminder of automatic) {
      if (!shouldContinue()) return;
      if (reminder.identifier !== keep)
        await Notifications.cancelScheduledNotificationAsync(
          reminder.identifier,
        );
    }
  }

  const groups = new Map<string, ScheduledReminder[]>();
  for (const reminder of personal) {
    if (!shouldContinue()) return;
    if (reminder.content.data?.reminderMode === autoFeedMode) continue;
    const ruleId = reminderRuleId(reminder.identifier, reminder.content.data);
    const group = groups.get(ruleId) ?? [];
    group.push(reminder);
    groups.set(ruleId, group);
  }
  for (const group of groups.values()) {
    if (!shouldContinue()) return;
    const authority = latestReminder(group);
    const title = authority.content.title ?? translate("照护提醒", locale);
    const rule = settingsFromReminderData(title, authority.content.data);
    if (!rule) continue;
    const trigger = reminderSchedule(
      rule,
      authority.content.data,
      authority.trigger,
    );
    if (!trigger) continue;
    await reconcileReminderGroup(
      group,
      rule,
      trigger,
      locale,
      formattingLocale,
      shouldContinue,
    );
  }
}
