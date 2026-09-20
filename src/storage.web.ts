import { initialState, State, validateState } from "./domain";
import type { WatchCommand } from "./watchProtocol";
export async function loadWatchWorkspace(): Promise<string> {
  throw new Error("native_required");
}
export async function savePersonalWatchCommand(
  _command: WatchCommand,
): Promise<never> {
  throw new Error("native_required");
}
import { personalWrite, personalMaintenance } from "./personalWrites";
export {
  setPersonalStorageBlocked,
  drainPersonalStorageWrites,
} from "./personalWrites";
import {
  parseReminderSettings,
  type ReminderSettings,
} from "./reminderSettings";
import {
  normalizeLanguagePreference,
  type LanguagePreference,
} from "./locales";
import { parseRecordView, type RecordView } from "./recordCalendar";
import {
  parsePlayFavorites,
  playCheckinKey,
  parsePlaySelection,
  type PlaySelection,
} from "./learning";
const KEY = "little-days-v1";
async function writePersonalValue(
  key: string,
  value: string | null,
): Promise<void> {
  return personalWrite(async () => {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  });
}
export async function loadRecordView(): Promise<RecordView> {
  return parseRecordView(localStorage.getItem(KEY + "-record-view"));
}
export async function saveRecordView(value: RecordView): Promise<void> {
  localStorage.setItem(KEY + "-record-view", parseRecordView(value));
}
export async function loadPlaySelection(): Promise<PlaySelection> {
  const raw = localStorage.getItem(KEY + "-play-selection");
  return raw === null
    ? { included: await loadPlayFavorites(), excluded: [] }
    : parsePlaySelection(raw);
}
export async function savePlaySelection(value: PlaySelection): Promise<void> {
  await writePersonalValue(
    KEY + "-play-selection",
    JSON.stringify(parsePlaySelection(JSON.stringify(value))),
  );
}
export async function loadPlayCheckins(day: string): Promise<string[]> {
  return parsePlayFavorites(
    localStorage.getItem(KEY + "-" + playCheckinKey(day)),
  );
}
export async function loadAllPlayCheckins(): Promise<
  { day: string; ids: string[] }[]
> {
  const prefix = KEY + "-play-checkins-";
  const keys = Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.key(index),
  )
    .filter((key): key is string => key !== null && key.startsWith(prefix))
    .sort();
  return keys.map((key) => {
    const day = key.slice(prefix.length);
    playCheckinKey(day);
    const ids: unknown = JSON.parse(localStorage.getItem(key)!);
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string"))
      throw new Error("Invalid play check-ins");
    return { day, ids: [...new Set(ids as string[])].sort() };
  });
}
export async function savePlayCheckins(
  day: string,
  ids: string[],
): Promise<void> {
  await writePersonalValue(
    KEY + "-" + playCheckinKey(day),
    JSON.stringify(parsePlayFavorites(JSON.stringify(ids))),
  );
}
export async function loadPlayFavorites(): Promise<string[]> {
  return parsePlayFavorites(localStorage.getItem(KEY + "-play-favorites"));
}
export async function savePlayFavorites(ids: string[]): Promise<void> {
  await writePersonalValue(
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
  return personalWrite(async () => {
    const old = localStorage.getItem(KEY);
    if (recovery)
      localStorage.setItem(
        KEY + "-recovery",
        old ?? JSON.stringify(initialState),
      );
    localStorage.setItem(KEY, data);
  });
}
export async function loadRecovery(): Promise<State | null> {
  const raw = localStorage.getItem(KEY + "-recovery");
  return raw ? validateState(JSON.parse(raw)) : null;
}

// The family activation journal remains pending until every removal succeeds.
// localStorage has no multi-key transaction; repeating this cleanup is idempotent.
export async function clearPersonalForFamilyActivation(): Promise<void> {
  return personalMaintenance(async () => {
    const keep = new Set([
      KEY + "-dark",
      KEY + "-language",
      KEY + "-record-view",
    ]);
    const keys = Array.from({ length: localStorage.length }, (_, i) =>
      localStorage.key(i),
    );
    for (const key of keys) {
      if (key && (key === KEY || key.startsWith(KEY + "-")) && !keep.has(key))
        localStorage.removeItem(key);
    }
    localStorage.setItem(KEY, JSON.stringify(initialState));
  });
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
  return normalizeLanguagePreference(value);
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
  await writePersonalValue(KEY + "-reminder-settings", JSON.stringify(checked));
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
  await writePersonalValue(
    KEY + "-auto-feed-reminder",
    JSON.stringify(checked),
  );
}
export async function clearAutoFeedReminder() {
  await writePersonalValue(KEY + "-auto-feed-reminder", null);
}
export async function loadAvatarUri(): Promise<string | null> {
  const uri = localStorage.getItem(KEY + "-avatar-uri");
  return uri && uri.length <= 2048 ? uri : null;
}
export async function saveAvatarUri(uri: string | null) {
  if (uri === null) {
    await writePersonalValue(KEY + "-avatar-uri", null);
    return;
  }
  if (!uri || uri.length > 2048) throw new Error("头像地址无效");
  await writePersonalValue(KEY + "-avatar-uri", uri);
}
