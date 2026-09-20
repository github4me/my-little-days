import type { SupportedLocale } from "./locales";

export type ReminderKind = "feed" | "diaper" | "sleep";
export type ReminderMode = "once" | "daily" | "after-feed";
export type ReminderSettings = {
  kind: ReminderKind;
  mode: ReminderMode;
  title: string;
  minutes: number;
  dailyTime: string;
  silent: boolean;
};
export type ReminderSchedule =
  | { type: "date"; time: number }
  | { type: "daily"; hour: number; minute: number };

// Bump whenever app-generated notification copy changes so existing schedules
// are replaced without changing the user's title or timing rule.
export const reminderContentVersion = 1;
export const autoFeedReminderRuleId = "auto-feed";

type ReminderIdentityData = Record<string, unknown> | undefined;

export function reminderRuleId(
  identifier: string,
  data: ReminderIdentityData,
): string {
  if (data?.reminderMode === "after-feed") return autoFeedReminderRuleId;
  const stored = data?.reminderRuleId;
  return typeof stored === "string" &&
    stored !== autoFeedReminderRuleId &&
    stored.length > 0 &&
    stored.length <= 100 &&
    /^[A-Za-z0-9._:-]+$/.test(stored)
    ? stored
    : identifier;
}

export function reminderRevision(data: ReminderIdentityData): number {
  const stored = data?.reminderRevision;
  return typeof stored === "number" &&
    Number.isSafeInteger(stored) &&
    stored >= 0
    ? stored
    : 0;
}

export function reminderNotificationFingerprint(
  settings: ReminderSettings,
  trigger: ReminderSchedule,
  locale: SupportedLocale,
  formattingLocale: string,
) {
  return JSON.stringify({
    contentVersion: reminderContentVersion,
    locale,
    formattingLocale,
    settings: {
      kind: settings.kind,
      mode: settings.mode,
      title: settings.title,
      minutes: settings.minutes,
      dailyTime: settings.dailyTime,
      silent: settings.silent,
    },
    trigger,
  });
}

function normalizeKind(value: unknown): ReminderKind | null {
  if (value === "feed" || value === "喂养") return "feed";
  if (value === "diaper" || value === "换尿布") return "diaper";
  if (value === "sleep" || value === "睡眠") return "sleep";
  return null;
}

export function parseReminderSettings(value: unknown): ReminderSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const kind = normalizeKind(input.kind);
  if (
    !kind ||
    !["once", "daily", "after-feed"].includes(input.mode as string) ||
    typeof input.title !== "string" ||
    input.title.length > 100 ||
    typeof input.minutes !== "number" ||
    !Number.isFinite(input.minutes) ||
    input.minutes < 1 ||
    input.minutes > 10080 ||
    typeof input.dailyTime !== "string" ||
    typeof input.silent !== "boolean"
  )
    return null;
  if (input.mode === "after-feed" && kind !== "feed") return null;
  if (
    input.mode === "daily" &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.dailyTime)
  )
    return null;
  if (input.mode !== "daily" && input.dailyTime !== "") return null;
  return { ...input, kind } as ReminderSettings;
}

export function settingsFromReminderData(
  title: string,
  data: Record<string, unknown> | undefined,
): ReminderSettings | undefined {
  const mode = data?.reminderMode;
  const kind = data?.reminderKind ?? (mode === "after-feed" ? "feed" : "");
  return (
    parseReminderSettings({
      kind,
      mode,
      title,
      minutes: Number(data?.minutes),
      dailyTime: typeof data?.dailyTime === "string" ? data.dailyTime : "",
      silent: data?.silent === true,
    }) ?? undefined
  );
}
