import { initialState, State, validateState } from "./domain";
import {
  parseReminderSettings,
  type ReminderSettings,
} from "./reminderSettings";
import type { LanguagePreference } from "./i18n";
import { parseRecordView, type RecordView } from "./recordCalendar";
import {
  parsePlayFavorites,
  playCheckinKey,
  parsePlaySelection,
  type PlaySelection,
} from "./learning";
const KEY = "little-days-v1";
export async function loadRecordView(): Promise<RecordView> {
  return parseRecordView(localStorage.getItem(KEY + "-record-view"));
}
export async function saveRecordView(value: RecordView): Promise<void> {
  localStorage.setItem(KEY + "-record-view", parseRecordView(value));
}
export async function loadPlaySelection(): Promise<PlaySelection> {
  return parsePlaySelection(localStorage.getItem(KEY + "-play-selection"));
}
export async function savePlaySelection(value: PlaySelection): Promise<void> {
  localStorage.setItem(
    KEY + "-play-selection",
    JSON.stringify(parsePlaySelection(JSON.stringify(value))),
  );
}
export async function loadPlayCheckins(day: string): Promise<string[]> {
  return parsePlayFavorites(
    localStorage.getItem(KEY + "-" + playCheckinKey(day)),
  );
}
export async function savePlayCheckins(
  day: string,
  ids: string[],
): Promise<void> {
  localStorage.setItem(
    KEY + "-" + playCheckinKey(day),
    JSON.stringify(parsePlayFavorites(JSON.stringify(ids))),
  );
}
export async function loadPlayFavorites(): Promise<string[]> {
  return parsePlayFavorites(localStorage.getItem(KEY + "-play-favorites"));
}
export async function savePlayFavorites(ids: string[]): Promise<void> {
  localStorage.setItem(
    KEY + "-play-favorites",
    JSON.stringify(parsePlayFavorites(JSON.stringify(ids))),
  );
}
export async function loadState(): Promise<State> {
  const raw = localStorage.getItem(KEY);
  return raw ? validateState(JSON.parse(raw)) : structuredClone(initialState);
}
export async function saveState(state: State, recovery = false) {
  const data = JSON.stringify(validateState(state));
  const old = localStorage.getItem(KEY);
  if (recovery)
    localStorage.setItem(
      KEY + "-recovery",
      old ?? JSON.stringify(initialState),
    );
  localStorage.setItem(KEY, data);
}
export async function loadRecovery(): Promise<State | null> {
  const raw = localStorage.getItem(KEY + "-recovery");
  return raw ? validateState(JSON.parse(raw)) : null;
}
export async function loadTheme(): Promise<boolean | null> {
  const v = localStorage.getItem(KEY + "-dark");
  return v === "true" ? true : v === "false" ? false : null;
}
export async function saveTheme(dark: boolean | null) {
  localStorage.setItem(KEY + "-dark", String(dark));
}
export async function loadLanguage(): Promise<LanguagePreference | null> {
  const value = localStorage.getItem(KEY + "-language");
  return value === "system" || value === "zh" || value === "en" ? value : null;
}
export async function saveLanguage(language: LanguagePreference) {
  localStorage.setItem(KEY + "-language", language);
}
export async function loadReminderSettings(): Promise<ReminderSettings | null> {
  try {
    const raw = localStorage.getItem(KEY + "-reminder-settings");
    return raw ? parseReminderSettings(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
export async function saveReminderSettings(settings: ReminderSettings) {
  const checked = parseReminderSettings(settings);
  if (!checked) throw new Error("提醒设置无效");
  localStorage.setItem(KEY + "-reminder-settings", JSON.stringify(checked));
}
export async function loadAutoFeedReminder(): Promise<ReminderSettings | null> {
  try {
    const raw = localStorage.getItem(KEY + "-auto-feed-reminder");
    const settings = raw ? parseReminderSettings(JSON.parse(raw)) : null;
    return settings?.kind === "feed" && settings.mode === "after-feed"
      ? settings
      : null;
  } catch {
    return null;
  }
}
export async function saveAutoFeedReminder(settings: ReminderSettings) {
  const checked = parseReminderSettings(settings);
  if (checked?.kind !== "feed" || checked.mode !== "after-feed")
    throw new Error("跟随喂养设置无效");
  localStorage.setItem(KEY + "-auto-feed-reminder", JSON.stringify(checked));
}
export async function clearAutoFeedReminder() {
  localStorage.removeItem(KEY + "-auto-feed-reminder");
}
export async function loadAvatarUri(): Promise<string | null> {
  const uri = localStorage.getItem(KEY + "-avatar-uri");
  return uri && uri.length <= 2048 ? uri : null;
}
export async function saveAvatarUri(uri: string | null) {
  if (uri === null) {
    localStorage.removeItem(KEY + "-avatar-uri");
    return;
  }
  if (!uri || uri.length > 2048) throw new Error("头像地址无效");
  localStorage.setItem(KEY + "-avatar-uri", uri);
}
