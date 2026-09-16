import {
  parseReminderSettings,
  type ReminderSettings,
} from "../reminderSettings";
import type { PlaySelection } from "../learning";

export const FAMILY_AVATAR_MAX_BYTES = 12 * 1024 * 1024;
export const FAMILY_EXTRAS_SCHEMA_VERSION = 1;
export type FamilyExtraRecord =
  | { id: "avatar"; kind: "avatar"; dataUrl: string | null }
  | { id: "play-selection"; kind: "play-selection"; selection: PlaySelection }
  | { id: string; kind: "play-checkin"; day: string; activityId: string }
  | {
      id: string;
      kind: "reminder";
      settings: ReminderSettings;
      onceAt?: string;
    }
  | {
      id: "reminder-settings";
      kind: "reminder-settings";
      settings: ReminderSettings | null;
    };

function invalid(): never {
  throw new Error("invalid_extra_record");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}
function identifier(value: unknown, max = 128): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value)
  )
    return invalid();
  return value;
}
function activityId(value: unknown): string {
  const id = identifier(value, 200);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return invalid();
  return id;
}
function activityIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1000) return invalid();
  const ids = value.map(activityId);
  if (new Set(ids).size !== ids.length) return invalid();
  return ids;
}
export function validateExtraDay(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return invalid();
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.getUTCFullYear() < 1900 ||
    parsed.toISOString().slice(0, 10) !== value
  )
    return invalid();
  return value;
}
export function isSingletonExtraId(id: string): boolean {
  return ["avatar", "play-selection", "reminder-settings"].includes(id);
}
function reminderSettings(value: unknown): ReminderSettings {
  const input = object(value);
  fields(input, ["kind", "mode", "title", "minutes", "dailyTime", "silent"]);
  const result = parseReminderSettings(input);
  if (!result || result.kind !== input.kind) return invalid();
  return {
    kind: result.kind,
    mode: result.mode,
    title: result.title,
    minutes: result.minutes,
    dailyTime: result.dailyTime,
    silent: result.silent,
  };
}

const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
// Decode only enough bytes to validate the image container, not a second 12 MiB copy.
function imagePrefix(encoded: string): number[] {
  let bits = 0,
    count = 0;
  const result: number[] = [];
  for (const character of encoded.slice(0, 64)) {
    if (character === "=") break;
    bits = (bits << 6) | alphabet.indexOf(character);
    count += 6;
    if (count >= 8) {
      count -= 8;
      result.push((bits >>> count) & 255);
    }
  }
  return result;
}
export function validateAvatarDataUrl(value: unknown): string {
  if (typeof value !== "string") return invalid();
  const match = /^data:image\/(jpeg|png|heic|webp);base64,/.exec(value);
  if (!match) return invalid();
  const encoded = value.slice(match[0].length);
  if (!encoded.length || encoded.length % 4 || /[^A-Za-z0-9+/=]/.test(encoded))
    return invalid();
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  if (encoded.indexOf("=") !== (padding ? encoded.length - padding : -1))
    return invalid();
  const bytes = (encoded.length / 4) * 3 - padding;
  if (bytes > FAMILY_AVATAR_MAX_BYTES || bytes < 3) return invalid();
  if (
    padding &&
    alphabet.indexOf(encoded[encoded.length - padding - 1]) &
      (padding === 2 ? 15 : 3)
  )
    return invalid();
  const prefix = imagePrefix(encoded);
  const at = (offset: number, chars: string) =>
    chars.split("").every((c, i) => prefix[offset + i] === c.charCodeAt(0));
  const valid =
    match[1] === "jpeg"
      ? prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255
      : match[1] === "png"
        ? [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => prefix[i] === v)
        : match[1] === "webp"
          ? at(0, "RIFF") && at(8, "WEBP")
          : at(4, "ftyp") &&
            ["heic", "heix", "hevc", "hevx"].some((brand) => at(8, brand));
  if (!valid) return invalid();
  return value;
}

export function validateExtraRecord(value: unknown): FamilyExtraRecord {
  const input = object(value);
  const id = identifier(input.id);
  if (input.kind !== "avatar" && JSON.stringify(input).length * 2 > 131072)
    return invalid();
  if (isSingletonExtraId(id) && input.kind !== id) return invalid();
  switch (input.kind) {
    case "avatar":
      fields(input, ["id", "kind", "dataUrl"]);
      if (id !== "avatar") return invalid();
      return {
        id,
        kind: "avatar",
        dataUrl:
          input.dataUrl === null ? null : validateAvatarDataUrl(input.dataUrl),
      };
    case "play-selection": {
      fields(input, ["id", "kind", "selection"]);
      if (id !== "play-selection") return invalid();
      const selection = object(input.selection);
      fields(selection, ["included", "excluded"]);
      const included = activityIds(selection.included),
        excluded = activityIds(selection.excluded);
      if (included.some((key) => excluded.includes(key))) return invalid();
      return { id, kind: "play-selection", selection: { included, excluded } };
    }
    case "play-checkin":
      fields(input, ["id", "kind", "day", "activityId"]);
      return {
        id,
        kind: "play-checkin",
        day: validateExtraDay(input.day),
        activityId: activityId(input.activityId),
      };
    case "reminder": {
      fields(input, ["id", "kind", "settings", "onceAt"]);
      const settings = reminderSettings(input.settings);
      if (settings.mode !== "once") {
        if (input.onceAt !== undefined) return invalid();
        return { id, kind: "reminder", settings };
      }
      if (
        typeof input.onceAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
          input.onceAt,
        ) ||
        !Number.isFinite(Date.parse(input.onceAt))
      )
        return invalid();
      validateExtraDay(input.onceAt.slice(0, 10));
      return { id, kind: "reminder", settings, onceAt: input.onceAt };
    }
    case "reminder-settings":
      fields(input, ["id", "kind", "settings"]);
      if (id !== "reminder-settings") return invalid();
      return {
        id,
        kind: "reminder-settings",
        settings:
          input.settings === null ? null : reminderSettings(input.settings),
      };
    default:
      return invalid();
  }
}
export function validateExtraRecords(value: unknown): FamilyExtraRecord[] {
  if (!Array.isArray(value) || value.length > 100000) return invalid();
  const records = value.map(validateExtraRecord);
  if (new Set(records.map((r) => r.id)).size !== records.length)
    return invalid();
  return records;
}
export function extraRecordCounts(records: readonly FamilyExtraRecord[]) {
  return {
    avatar: records.filter((r) => r.kind === "avatar" && r.dataUrl !== null)
      .length,
    reminders: records.filter((r) => r.kind === "reminder").length,
    playCheckins: records.filter((r) => r.kind === "play-checkin").length,
    playSelection: records.filter((r) => r.kind === "play-selection").length,
    reminderSettings: records.filter(
      (r) => r.kind === "reminder-settings" && r.settings !== null,
    ).length,
    total: records.length,
  };
}
