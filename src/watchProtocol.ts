import { type Entry, type State, validateEntry, validateState } from "./domain";
import { finishLiveSleep } from "./sleepTimer";
import { finishFeed } from "./feedFinish";
import type { SupportedLocale } from "./locales";

export type WatchCommand = {
  schemaVersion: 1;
  commandId: string;
  recordId: string;
  workspaceKey: string;
  generation: number;
  bridgeId?: string;
  snapshotSequence?: number;
  createdAt: string;
  kind: "create" | "finish-sleep" | "finish-feed" | "resolve-conflict";
  entry?: Entry;
  stoppedAt?: string;
  amount?: number;
  baseVersion?: string;
  expectedEntry?: Entry;
  dependsOn?: string;
  resolution?: "discard" | "replace";
  conflictOperationId?: string;
};
export type WatchConflict = {
  currentVersion: string;
  currentEditedBy: string;
  currentEntry: Entry;
  proposedEntry: Entry;
  canReplace: boolean;
};
export type WatchReceipt = {
  schemaVersion: 1;
  commandId: string;
  recordId: string;
  workspaceKey: string;
  generation: number;
  bridgeId?: string;
  status: "saved" | "pending" | "shared" | "rejected";
  error?: string;
  conflict?: WatchConflict;
};
export type WatchLedger = Record<
  string,
  { fingerprint: string; receipt: WatchReceipt }
>;
export type WatchContext = {
  schemaVersion: 1;
  workspaceKey: string;
  mode: "personal" | "family";
  status: "ready" | "unavailable";
  expiresAt: string;
  /** Legacy compatibility field consumed by older Watch/widget builds. */
  language: "zh" | "en";
  /** Canonical locale consumed by current Watch/widget builds. */
  locale?: SupportedLocale;
  /** Regional formatting locale; optional for version 1 compatibility. */
  formattingLocale?: string;
  /** New recording can be paused without hiding already-issued conflicts. */
  recordingEnabled?: boolean;
  profile: { name: string; birthDate: string };
  entries: (Entry & {
    version?: string;
    canControl?: boolean;
    pendingOperationId?: string;
  })[];
  totals: {
    feedMl: number;
    feedCount: number;
    diaperCount: number;
    sleepMinutes: number;
  };
  totalsDate: string;
  sleepRanges?: [number, number][];
  // Read-only widget access is independent from the Watch recording rollout.
  widgetTotals?: { feedMl: number; diaperCount: number; sleepMinutes: number };
  bridgeId?: string;
  generation?: number;
  sequence?: number;
  invalidate?: boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const instant = (value: unknown) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));
export function parseWatchCommand(raw: string): WatchCommand {
  if (raw.length > 16384) throw new Error("invalid_watch_command");
  const c = JSON.parse(raw) as WatchCommand;
  if (
    !c ||
    c.schemaVersion !== 1 ||
    !uuid.test(c.commandId) ||
    typeof c.recordId !== "string" ||
    !c.recordId.trim() ||
    c.recordId.length > 128 ||
    typeof c.workspaceKey !== "string" ||
    !c.workspaceKey ||
    c.workspaceKey.length > 2048 ||
    !Number.isSafeInteger(c.generation) ||
    c.generation < 1 ||
    (c.bridgeId !== undefined && !uuid.test(c.bridgeId)) ||
    !instant(c.createdAt) ||
    !["create", "finish-sleep", "finish-feed", "resolve-conflict"].includes(
      c.kind,
    ) ||
    (c.dependsOn !== undefined && !uuid.test(c.dependsOn)) ||
    (c.baseVersion !== undefined &&
      (typeof c.baseVersion !== "string" || c.baseVersion.length > 128))
  )
    throw new Error("invalid_watch_command");
  if (c.kind === "resolve-conflict") {
    if (
      !["discard", "replace"].includes(c.resolution ?? "") ||
      !c.conflictOperationId ||
      !uuid.test(c.conflictOperationId) ||
      c.conflictOperationId === c.commandId ||
      c.entry !== undefined ||
      c.stoppedAt !== undefined ||
      c.amount !== undefined ||
      c.expectedEntry !== undefined ||
      c.dependsOn !== undefined ||
      (c.resolution === "replace"
        ? !c.baseVersion
        : c.baseVersion !== undefined)
    )
      throw new Error("invalid_watch_command");
  } else if (c.resolution !== undefined || c.conflictOperationId !== undefined)
    throw new Error("invalid_watch_command");
  else if (c.kind === "create") {
    c.entry = validateEntry(c.entry);
    if (
      c.entry.id !== c.recordId ||
      !["feed", "diaper", "sleep"].includes(c.entry.type) ||
      c.entry.note !== ""
    )
      throw new Error("invalid_watch_command");
  } else if (!instant(c.stoppedAt)) throw new Error("invalid_watch_command");
  if (c.expectedEntry !== undefined)
    c.expectedEntry = validateEntry(c.expectedEntry);
  return c;
}

function validateWatchConflict(value: unknown): WatchConflict {
  const conflict = value as WatchConflict;
  if (
    !conflict ||
    typeof conflict !== "object" ||
    typeof conflict.currentVersion !== "string" ||
    !conflict.currentVersion ||
    conflict.currentVersion.length > 128 ||
    typeof conflict.currentEditedBy !== "string" ||
    !conflict.currentEditedBy ||
    conflict.currentEditedBy.length > 80 ||
    typeof conflict.canReplace !== "boolean"
  )
    throw new Error("local_data_invalid");
  const currentEntry = validateEntry(conflict.currentEntry);
  const proposedEntry = validateEntry(conflict.proposedEntry);
  if (
    (currentEntry.type !== "feed" && currentEntry.type !== "sleep") ||
    currentEntry.type !== proposedEntry.type ||
    currentEntry.id !== proposedEntry.id
  )
    throw new Error("local_data_invalid");
  return { ...conflict, currentEntry, proposedEntry };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const watchFingerprint = (command: WatchCommand) =>
  JSON.stringify(canonical(command));
export function watchReceipt(
  command: WatchCommand,
  status: WatchReceipt["status"],
  error?: string,
): WatchReceipt {
  return {
    schemaVersion: 1,
    commandId: command.commandId,
    recordId: command.recordId,
    workspaceKey: command.workspaceKey,
    generation: command.generation,
    ...(command.bridgeId ? { bridgeId: command.bridgeId } : {}),
    status,
    ...(error ? { error } : {}),
  };
}
export function previousWatchReceipt(
  ledger: WatchLedger | undefined,
  command: WatchCommand,
): WatchReceipt | undefined {
  const previous = ledger?.[command.commandId];
  if (previous && previous.fingerprint !== watchFingerprint(command))
    throw new Error("operation_reused");
  return previous?.receipt;
}
export function addWatchReceipt(
  ledger: WatchLedger | undefined,
  command: WatchCommand,
  receipt: WatchReceipt,
): WatchLedger {
  previousWatchReceipt(ledger, command);
  if (!ledger?.[command.commandId] && Object.keys(ledger ?? {}).length >= 10000)
    throw new Error("watch_ledger_full");
  return {
    ...ledger,
    [command.commandId]: { fingerprint: watchFingerprint(command), receipt },
  };
}
export function validateWatchLedger(value: unknown): WatchLedger | undefined {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 10000
  )
    throw new Error("local_data_invalid");
  for (const [id, item] of Object.entries(value as WatchLedger)) {
    if (!item || typeof item.fingerprint !== "string")
      throw new Error("local_data_invalid");
    const command = parseWatchCommand(item.fingerprint);
    const receipt = item.receipt;
    if (
      command.commandId !== id ||
      !receipt ||
      receipt.commandId !== id ||
      receipt.schemaVersion !== 1 ||
      receipt.recordId !== command.recordId ||
      receipt.workspaceKey !== command.workspaceKey ||
      receipt.generation !== command.generation ||
      receipt.bridgeId !== command.bridgeId ||
      !["saved", "pending", "shared", "rejected"].includes(receipt.status) ||
      (receipt.conflict !== undefined && receipt.status !== "rejected")
    )
      throw new Error("local_data_invalid");
    if (receipt.conflict !== undefined)
      receipt.conflict = validateWatchConflict(receipt.conflict);
  }
  return value as WatchLedger;
}
export function checkWatchTime(
  command: WatchCommand,
  state: State,
  now = Date.now(),
) {
  const timestamps = [
    command.createdAt,
    command.entry?.start,
    command.entry?.end,
    command.stoppedAt,
  ].filter((v): v is string => !!v);
  if (
    timestamps.some(
      (v) => !Number.isFinite(Date.parse(v)) || Date.parse(v) > now + 60000,
    )
  )
    throw new Error("invalid_record_time");
  const start = command.entry?.start;
  if (start && state.profile.birthDate) {
    const date = new Date(start);
    const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (localDate < state.profile.birthDate)
      throw new Error("before_birth_date");
  }
}
export function watchEntryChange(
  state: State,
  command: WatchCommand,
  now = Date.now(),
): Entry | null {
  checkWatchTime(command, state, now);
  if (command.kind === "resolve-conflict")
    throw new Error("invalid_watch_command");
  const entry = state.entries.find((e) => e.id === command.recordId);
  if (command.kind === "create") {
    if (entry) throw new Error("record_changed");
    const created = validateEntry(command.entry);
    if (
      created.type === "sleep" &&
      !created.end &&
      state.entries.some((e) => e.type === "sleep" && !e.end)
    )
      throw new Error("running_sleep");
    if (created.feedRunning && state.entries.some((e) => e.feedRunning))
      throw new Error("running_feed");
    return created;
  }
  if (!entry)
    throw new Error(
      command.dependsOn ? "watch_dependency_pending" : "record_changed",
    );
  if (
    entry.end ||
    (command.kind === "finish-sleep"
      ? entry.type !== "sleep"
      : entry.type !== "feed" || !entry.feedRunning)
  )
    throw new Error("record_changed");
  if (
    command.expectedEntry &&
    (command.expectedEntry.id !== entry.id ||
      command.expectedEntry.start !== entry.start ||
      command.expectedEntry.type !== entry.type ||
      command.expectedEntry.feedKind !== entry.feedKind)
  )
    throw new Error("record_changed");
  return command.kind === "finish-sleep"
    ? finishLiveSleep(entry, command.stoppedAt!)
    : finishFeed(entry, command.stoppedAt!, command.amount);
}
export function applyPersonalWatchCommand(
  state: State,
  ledger: WatchLedger | undefined,
  command: WatchCommand,
  now = Date.now(),
) {
  const prior = previousWatchReceipt(ledger, command);
  if (prior) return { state, ledger: ledger!, receipt: prior };
  const entry = watchEntryChange(state, command, now);
  const next = validateState({
    ...state,
    entries: [
      ...state.entries.filter((e) => e.id !== command.recordId),
      ...(entry ? [entry] : []),
    ],
  });
  const receipt = watchReceipt(command, "saved");
  return {
    state: next,
    ledger: addWatchReceipt(ledger, command, receipt),
    receipt,
  };
}
