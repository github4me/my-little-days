import * as SQLite from "expo-sqlite";
import {
  personalWrite,
  personalMaintenance,
  setPersonalStorageBlocked,
  drainReminderWrites,
} from "./personalWrites";
export {
  setPersonalStorageBlocked,
  drainPersonalStorageWrites,
} from "./personalWrites";
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
let database: ReturnType<typeof SQLite.openDatabaseAsync> | undefined;
async function db() {
  if (!database)
    database = (async () => {
      const d = await SQLite.openDatabaseAsync("little-days.db");
      await d.execAsync(
        "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS app_data (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);",
      );
      return d;
    })();
  return database;
}
export async function loadState(): Promise<State> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>(
    "SELECT value FROM app_data WHERE key = ?",
    "state",
  );
  return row
    ? validateState(JSON.parse(row.value))
    : { ...initialState, profile: { ...initialState.profile }, entries: [] };
}
export async function loadRecordView(): Promise<RecordView> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>(
    "SELECT value FROM app_data WHERE key = ?",
    "record-view",
  );
  return parseRecordView(row?.value);
}
export async function saveRecordView(value: RecordView): Promise<void> {
  await (
    await db()
  ).runAsync(
    "INSERT OR REPLACE INTO app_data (key,value) VALUES (?,?)",
    "record-view",
    parseRecordView(value),
  );
}
export async function saveState(state: State, recovery = false): Promise<void> {
  const data = JSON.stringify(validateState(state));
  return personalWrite(async () => {
    const d = await db();
    await d.withExclusiveTransactionAsync(async (tx) => {
      if (recovery) {
        const previous = await tx.getFirstAsync<{ value: string }>(
          "SELECT value FROM app_data WHERE key = ?",
          "state",
        );
        await tx.runAsync(
          "INSERT OR REPLACE INTO app_data (key,value) VALUES (?,?)",
          "recovery",
          previous?.value ?? JSON.stringify(initialState),
        );
      }
      await tx.runAsync(
        "INSERT OR REPLACE INTO app_data (key,value) VALUES (?,?)",
        "state",
        data,
      );
    });
  });
}
export async function loadRecovery(): Promise<State | null> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>(
    "SELECT value FROM app_data WHERE key = ?",
    "recovery",
  );
  return row ? validateState(JSON.parse(row.value)) : null;
}

// Called only after explicit create/join consent AND a verified full server snapshot
// has been durably installed behind the family activation journal. Retry is safe.
// Never store family content in this personal database or leave a recovery copy.
export async function clearPersonalForFamilyActivation(): Promise<void> {
  setPersonalStorageBlocked(true);
  await drainReminderWrites();
  return personalMaintenance(async () => {
    const d = await db();
    const avatar = await loadAvatarUri();
    const notifications = await import("expo-notifications");
    await notifications.cancelAllScheduledNotificationsAsync();
    await notifications.dismissAllNotificationsAsync();
    const { deleteAvatarFile } = await import("./avatar");
    await deleteAvatarFile(avatar);
    await d.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        "DELETE FROM app_data WHERE key NOT IN (?,?,?)",
        "dark",
        "language",
        "record-view",
      );
      await tx.runAsync(
        "INSERT OR REPLACE INTO app_data (key,value) VALUES (?,?)",
        "state",
        JSON.stringify(initialState),
      );
    });
  });
}

async function writePersonalValue(
  key: string,
  value: string | null,
): Promise<void> {
  return personalWrite(async () => {
    const d = await db();
    if (value === null)
      await d.runAsync("DELETE FROM app_data WHERE key = ?", key);
    else
      await d.runAsync(
        "INSERT OR REPLACE INTO app_data (key,value) VALUES (?,?)",
        key,
        value,
      );
  });
}
export async function loadTheme(): Promise<boolean | null> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>(
    "SELECT value FROM app_data WHERE key = ?",
    "dark",
  );
  return row?.value === "true" ? true : row?.value === "false" ? false : null;
}
export async function loadPlaySelection(): Promise<PlaySelection> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>(
    "SELECT value FROM app_data WHERE key = ?",
    "play-selection",
  );
  return parsePlaySelection(row?.value ?? null);
}
export async function savePlaySelection(value: PlaySelection): Promise<void> {
  await writePersonalValue(
    "play-selection",
    JSON.stringify(parsePlaySelection(JSON.stringify(value))),
  );
}
export async function loadPlayFavorites(): Promise<string[]> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>(
    "SELECT value FROM app_data WHERE key = ?",
    "play-favorites",
  );
  return parsePlayFavorites(row?.value ?? null);
}
export async function loadPlayCheckins(day: string): Promise<string[]> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>(
    "SELECT value FROM app_data WHERE key = ?",
    playCheckinKey(day),
  );
  return parsePlayFavorites(row?.value ?? null);
}
export async function savePlayCheckins(
  day: string,
  ids: string[],
): Promise<void> {
  await writePersonalValue(
    playCheckinKey(day),
    JSON.stringify(parsePlayFavorites(JSON.stringify(ids))),
  );
}
export async function savePlayFavorites(ids: string[]): Promise<void> {
  const value = JSON.stringify(parsePlayFavorites(JSON.stringify(ids)));
  await writePersonalValue("play-favorites", value);
}
export async function saveTheme(dark: boolean | null) {
  await (
    await db()
  ).runAsync(
    "INSERT OR REPLACE INTO app_data (key,value) VALUES (?,?)",
    "dark",
    String(dark),
  );
}
export async function loadLanguage(): Promise<LanguagePreference | null> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>(
    "SELECT value FROM app_data WHERE key = ?",
    "language",
  );
  return row && ["system", "zh", "en"].includes(row.value)
    ? (row.value as LanguagePreference)
    : null;
}
export async function saveLanguage(language: LanguagePreference) {
  await (
    await db()
  ).runAsync(
    "INSERT OR REPLACE INTO app_data (key,value) VALUES (?,?)",
    "language",
    language,
  );
}
export async function loadReminderSettings(): Promise<ReminderSettings | null> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>(
    "SELECT value FROM app_data WHERE key = ?",
    "reminder-settings",
  );
  try {
    return row ? parseReminderSettings(JSON.parse(row.value)) : null;
  } catch {
    return null;
  }
}
export async function saveReminderSettings(settings: ReminderSettings) {
  const checked = parseReminderSettings(settings);
  if (!checked) throw new Error("提醒设置无效");
  await writePersonalValue("reminder-settings", JSON.stringify(checked));
}
export async function loadAutoFeedReminder(): Promise<ReminderSettings | null> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>(
    "SELECT value FROM app_data WHERE key = ?",
    "auto-feed-reminder",
  );
  try {
    const settings = row ? parseReminderSettings(JSON.parse(row.value)) : null;
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
  await writePersonalValue("auto-feed-reminder", JSON.stringify(checked));
}
export async function clearAutoFeedReminder() {
  await writePersonalValue("auto-feed-reminder", null);
}
export async function loadAvatarUri(): Promise<string | null> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>(
    "SELECT value FROM app_data WHERE key = ?",
    "avatar-uri",
  );
  return row && row.value.length <= 2048 ? row.value : null;
}
export async function saveAvatarUri(uri: string | null) {
  if (uri !== null && (!uri || uri.length > 2048))
    throw new Error("头像地址无效");
  await writePersonalValue("avatar-uri", uri);
}
