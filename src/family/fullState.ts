import {
  validateCareRecord,
  validateEntry,
  validateState,
  type Entry,
  type State,
} from "../domain";
import { finishLiveSleep } from "../sleepTimer";
import { finishFeed as finishLiveFeed } from "../feedFinish";
import type {
  FamilyCapabilities,
  FamilySnapshot,
  FeedReceipt,
  FullFamilySnapshot,
  RecordOperation,
  SharedEntryRecord,
  SharedRecord,
} from "./contracts";
import {
  isSingletonExtraId,
  validateExtraRecord,
  validateExtraRecords,
  type FamilyExtraRecord,
} from "./extras";
import {
  applySnapshot,
  matchesOrigin,
  originForSnapshot,
  type PilotState,
  type SharingOrigin,
} from "./pilotState";

export type QueuedRecord = {
  origin: SharingOrigin;
  operation: RecordOperation;
  status: "pending" | "accepted" | "failed";
  error?: string;
  // Only an authoritative 412 from a replacement-capable API sets this.
  // Snapshot drift alone is not proof that the server issued a conflict receipt.
  serverConflict?: boolean;
  receiptRevision?: string;
  // Only enqueueTimerFinish can create this marker. A fresh snapshot rechecks
  // the exact active-to-finished transition before the operation may send.
  timerCompletion?: "sleep" | "feed";
  // The original operation may already be on the server. Keep its ID and
  // payload immutable until its receipt and an authorized snapshot arrive.
  sleepFollowUp?: { operationId: string; stoppedAt: string };
  feedFollowUp?: { operationId: string; stoppedAt: string; amount?: number };
};
const revision = (value: string) => {
  if (!/^\d{1,20}$/.test(value)) throw new Error("invalid_response");
  return BigInt(value);
};
export function requireFullCapabilities(value: FamilyCapabilities) {
  if (
    value?.schemaVersion !== 2 ||
    !["feed", "diaper", "sleep", "growth", "milestone", "care"].every((k) =>
      value.recordKinds?.includes(k),
    ) ||
    value.maxSeedBytes < 10485760
  )
    throw new Error("full_sharing_unavailable");
  return value;
}
export function requireExtraCapabilities(value: FamilyCapabilities) {
  requireFullCapabilities(value);
  if (value.extrasSchemaVersion !== 1 || value.maxSeedBytes < 32 * 1024 * 1024)
    throw new Error("extras_sharing_unavailable");
  return value;
}
export function isFullSnapshot(
  snapshot: FamilySnapshot | null,
): snapshot is FullFamilySnapshot {
  return !!snapshot && (snapshot as FullFamilySnapshot).schemaVersion === 2;
}
export function validateFullSnapshot(
  value: FullFamilySnapshot,
): FullFamilySnapshot {
  if (
    !isFullSnapshot(value) ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.careRecords)
  )
    throw new Error("full_sharing_unavailable");
  revision(value.revision);
  if (
    value.careSchemaVersion !== undefined &&
    value.careSchemaVersion !== 1 &&
    value.careSchemaVersion !== 2
  )
    throw new Error("invalid_response");
  if (
    value.watchRecordingEnabled !== undefined &&
    typeof value.watchRecordingEnabled !== "boolean"
  )
    throw new Error("invalid_response");
  if (
    value.crossMemberTimerCompletionEnabled !== undefined &&
    typeof value.crossMemberTimerCompletionEnabled !== "boolean"
  )
    throw new Error("invalid_response");
  if (
    value.conflictReplacementEnabled !== undefined &&
    typeof value.conflictReplacementEnabled !== "boolean"
  )
    throw new Error("invalid_response");
  const profile = validateState({
    schemaVersion: 1,
    profile: value.profile,
    entries: [],
  }).profile;
  const metadata = (record: {
    version: string;
    recordedBy: string;
    lastEditedBy: string;
  }) => {
    if (!record.version || !record.recordedBy || !record.lastEditedBy)
      throw new Error("invalid_response");
    return {
      version: record.version,
      recordedBy: record.recordedBy,
      lastEditedBy: record.lastEditedBy,
    };
  };
  const entries = value.entries.map((item) => {
    if (
      item.endedBy !== undefined &&
      item.endedBy !== null &&
      (typeof item.endedBy !== "string" || !item.endedBy)
    )
      throw new Error("invalid_response");
    const replacement = item.replacement;
    if (replacement !== undefined && replacement !== null) {
      const previous = replacement.previousEntry;
      if (
        typeof replacement.replacedBy !== "string" ||
        !replacement.replacedBy ||
        (replacement.previousEditedBy !== undefined &&
          replacement.previousEditedBy !== null &&
          (typeof replacement.previousEditedBy !== "string" ||
            !replacement.previousEditedBy)) ||
        typeof replacement.replacedAt !== "string" ||
        !Number.isFinite(Date.parse(replacement.replacedAt)) ||
        !previous ||
        previous.id !== item.entry.id ||
        (previous.type !== "feed" && previous.type !== "sleep") ||
        previous.type !== item.entry.type ||
        typeof previous.start !== "string" ||
        !Number.isFinite(Date.parse(previous.start)) ||
        (previous.end !== undefined &&
          previous.end !== null &&
          (typeof previous.end !== "string" ||
            !Number.isFinite(Date.parse(previous.end)))) ||
        (previous.amount !== undefined &&
          previous.amount !== null &&
          (typeof previous.amount !== "number" ||
            !Number.isFinite(previous.amount) ||
            previous.amount < 0 ||
            previous.amount > 2000)) ||
        (previous.feedKind !== undefined &&
          previous.feedKind !== null &&
          ![
            "formula",
            "expressed",
            "breast-left",
            "breast-right",
            "breast-both",
          ].includes(previous.feedKind)) ||
        (previous.noteChanged !== undefined &&
          typeof previous.noteChanged !== "boolean")
      )
        throw new Error("invalid_response");
    }
    return {
      ...metadata(item),
      ...(item.endedBy ? { endedBy: item.endedBy } : {}),
      ...(replacement ? { replacement } : {}),
      entry: validateEntry(item.entry),
    };
  });
  const careRecords = value.careRecords.map((item) => ({
    ...metadata(item),
    record: validateCareRecord(item.record),
  }));
  if (
    value.careSchemaVersion !== 2 &&
    careRecords.some((item) => item.record.kind === "supplement")
  )
    throw new Error("supplement_sharing_unavailable");
  const hasExtras =
    value.extrasSchemaVersion !== undefined || value.extraRecords !== undefined;
  if (
    hasExtras &&
    (value.extrasSchemaVersion !== 1 || !Array.isArray(value.extraRecords))
  )
    throw new Error("extras_sharing_unavailable");
  const extraRecords = hasExtras
    ? value.extraRecords!.map((item) => ({
        ...metadata(item),
        record: validateExtraRecord(item.record),
      }))
    : undefined;
  if (extraRecords)
    validateExtraRecords(extraRecords.map((item) => item.record));
  if (
    new Set(entries.map((r) => r.entry.id)).size !== entries.length ||
    new Set(careRecords.map((r) => r.record.id)).size !== careRecords.length
  )
    throw new Error("invalid_response");
  return {
    ...value,
    profile,
    entries,
    careRecords,
    ...(extraRecords ? { extraRecords } : {}),
  };
}
export function canEditRecord(
  snapshot: FullFamilySnapshot,
  collection: "entry" | "care" | "extra",
  id: string,
) {
  if (
    collection === "extra" &&
    (snapshot.extrasSchemaVersion !== 1 ||
      (isSingletonExtraId(id) && snapshot.family.role !== "owner"))
  )
    return false;
  const record =
    collection === "entry"
      ? snapshot.entries.find((r) => r.entry.id === id)
      : collection === "care"
        ? snapshot.careRecords.find((r) => r.record.id === id)
        : snapshot.extraRecords?.find((r) => r.record.id === id);
  return (
    !record ||
    snapshot.family.role === "owner" ||
    record.recordedBy === originForSnapshot(snapshot).userId
  );
}
function enqueueRecordOperation(
  state: PilotState,
  operation: RecordOperation,
  timerCompletion?: "sleep" | "feed",
): PilotState {
  const snapshot = state.snapshot;
  if (!isFullSnapshot(snapshot)) throw new Error("full_sharing_unavailable");
  if (state.transition) throw new Error("transition_pending");
  if (
    operation.historyId !== snapshot.historyId ||
    operation.membershipId !== snapshot.family.membershipId
  )
    throw new Error("membership_changed");
  const record =
    operation.collection === "entry"
      ? snapshot.entries.find((r) => r.entry.id === operation.recordId)
      : operation.collection === "care"
        ? snapshot.careRecords.find((r) => r.record.id === operation.recordId)
        : snapshot.extraRecords?.find(
            (r) => r.record.id === operation.recordId,
          );
  if (operation.kind !== "create" && !record) throw new Error("record_changed");
  if (
    !timerCompletion &&
    !canEditRecord(snapshot, operation.collection, operation.recordId)
  )
    throw new Error("record_forbidden");
  if (
    (state.records ?? []).some(
      (q) =>
        q.operation.collection === operation.collection &&
        q.operation.recordId === operation.recordId &&
        q.status !== "failed",
    )
  )
    throw new Error("record_pending");
  if ((state.records ?? []).length >= 200) throw new Error("queue_full");
  if (operation.entry) validateEntry(operation.entry);
  if (operation.careRecord) validateCareRecord(operation.careRecord);
  if (
    operation.careRecord?.kind === "supplement" &&
    snapshot.careSchemaVersion !== 2
  )
    throw new Error("supplement_sharing_unavailable");
  if (operation.collection === "extra") {
    const existingExtra = snapshot.extraRecords?.find(
      (item) => item.record.id === operation.recordId,
    );
    if (
      existingExtra &&
      operation.extraRecord &&
      existingExtra.record.kind !== operation.extraRecord.kind
    )
      throw new Error("invalid_extra_record");
    if (
      operation.entry ||
      operation.careRecord ||
      (operation.kind === "delete" &&
        (operation.extraRecord || isSingletonExtraId(operation.recordId)))
    )
      throw new Error("invalid_extra_record");
    if (
      operation.kind !== "delete" &&
      validateExtraRecord(operation.extraRecord).id !== operation.recordId
    )
      throw new Error("invalid_extra_record");
  } else if (operation.extraRecord) throw new Error("invalid_extra_record");
  return {
    ...state,
    records: [
      ...(state.records ?? []),
      {
        origin: originForSnapshot(snapshot),
        operation: JSON.parse(JSON.stringify(operation)),
        status: "pending",
        ...(timerCompletion ? { timerCompletion } : {}),
      },
    ],
  };
}

export function enqueueRecord(
  state: PilotState,
  operation: RecordOperation,
): PilotState {
  return enqueueRecordOperation(state, operation);
}

function controllableEntry(state: PilotState, id: string): Entry | undefined {
  const snapshot = state.snapshot;
  if (state.transition || !isFullSnapshot(snapshot)) return undefined;
  const queued = (state.records ?? []).find(
    (q) =>
      q.operation.collection === "entry" &&
      q.operation.recordId === id &&
      q.status !== "failed" &&
      matchesOrigin(q.origin, snapshot),
  );
  if (queued)
    return queued.operation.kind !== "delete" &&
      !queued.sleepFollowUp &&
      !queued.feedFollowUp
      ? queued.operation.entry
      : undefined;
  const record = snapshot.entries.find((item) => item.entry.id === id);
  if (
    record &&
    snapshot.family.role !== "owner" &&
    record.recordedBy !== originForSnapshot(snapshot).userId &&
    snapshot.crossMemberTimerCompletionEnabled !== true
  )
    return undefined;
  return record?.entry;
}
export function canControlSleep(state: PilotState, id: string): boolean {
  const entry = controllableEntry(state, id);
  return entry?.type === "sleep" && !entry.end;
}
export function canControlFeed(state: PilotState, id: string): boolean {
  const entry = controllableEntry(state, id);
  return entry?.type === "feed" && !!entry.feedRunning && !entry.end;
}

export function enqueueSleepFinish(
  state: PilotState,
  id: string,
  stoppedAt: string,
  operationId: string,
): PilotState {
  return enqueueTimerFinish(state, id, stoppedAt, operationId, "sleep");
}

export function enqueueFeedFinish(
  state: PilotState,
  id: string,
  stoppedAt: string,
  amount: number | undefined,
  operationId: string,
  baseVersion?: string,
  expectedEntry?: Entry,
): PilotState {
  return enqueueTimerFinish(
    state,
    id,
    stoppedAt,
    operationId,
    "feed",
    amount,
    baseVersion,
    expectedEntry,
  );
}

function enqueueTimerFinish(
  state: PilotState,
  id: string,
  stoppedAt: string,
  operationId: string,
  type: "sleep" | "feed",
  amount?: number,
  baseVersion?: string,
  expectedEntry?: Entry,
): PilotState {
  const snapshot = state.snapshot;
  if (!isFullSnapshot(snapshot)) throw new Error("full_sharing_unavailable");
  if (state.transition) throw new Error("transition_pending");
  const queued = (state.records ?? []).find(
    (q) =>
      q.operation.collection === "entry" &&
      q.operation.recordId === id &&
      q.status !== "failed" &&
      matchesOrigin(q.origin, snapshot),
  );
  if (
    queued?.sleepFollowUp ||
    queued?.feedFollowUp ||
    queued?.operation.kind === "delete"
  )
    throw new Error("record_pending");
  const record = snapshot.entries.find((r) => r.entry.id === id);
  const entry = queued?.operation.entry ?? record?.entry;
  if (
    !entry ||
    (type === "sleep"
      ? entry.type !== "sleep" || !!entry.end
      : entry.type !== "feed" || !entry.feedRunning || !!entry.end)
  )
    throw new Error("record_changed");
  if (
    !(type === "sleep" ? canControlSleep(state, id) : canControlFeed(state, id))
  )
    throw new Error("record_forbidden");
  if (
    (baseVersion !== undefined && record?.version !== baseVersion) ||
    (expectedEntry && !sameEntry(entry, expectedEntry)) ||
    (type === "feed" &&
      !queued &&
      baseVersion === undefined &&
      record?.lastEditedBy !== originForSnapshot(snapshot).userId)
  )
    throw new Error("record_changed");
  const crossMember =
    !!record && record.recordedBy !== originForSnapshot(snapshot).userId;
  const finished =
    type === "sleep"
      ? (finishLiveSleep(entry, stoppedAt) ??
        (crossMember ? validateEntry({ ...entry, end: stoppedAt }) : null))
      : finishLiveFeed(entry, stoppedAt, amount);
  if (
    !operationId ||
    (state.records ?? []).some(
      (q) =>
        q.operation.operationId === operationId ||
        q.sleepFollowUp?.operationId === operationId ||
        q.feedFollowUp?.operationId === operationId,
    )
  )
    throw new Error("invalid_operation");
  if (queued) {
    return {
      ...state,
      records: state.records!.map((q) =>
        q === queued
          ? {
              ...q,
              ...(type === "sleep"
                ? { sleepFollowUp: { operationId, stoppedAt } }
                : {
                    feedFollowUp: {
                      operationId,
                      stoppedAt,
                      ...(finished?.amount !== undefined
                        ? { amount: finished.amount }
                        : {}),
                    },
                  }),
            }
          : q,
      ),
    };
  }
  return enqueueRecordOperation(
    state,
    {
      operationId,
      recordId: id,
      collection: "entry",
      kind: finished ? "update" : "delete",
      baseVersion: record!.version,
      membershipId: snapshot.family.membershipId,
      historyId: snapshot.historyId,
      ...(finished ? { entry: finished } : {}),
      ...(finished && snapshot.conflictReplacementEnabled === true
        ? { timerCompletion: type }
        : {}),
    },
    finished ? type : undefined,
  );
}

function sameEntry(left: Entry, right: Entry) {
  // Domain entries have only scalar fields; ignore JSON property order.
  const fields = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...fields].every(
    (field) => left[field as keyof Entry] === right[field as keyof Entry],
  );
}

function activeTimerKind(entry: Entry): "sleep" | "feed" | null {
  if (entry.type === "sleep" && !entry.end) return "sleep";
  if (entry.type === "feed" && entry.feedRunning === true && !entry.end)
    return "feed";
  return null;
}

function timerStartKind(operation: RecordOperation): "sleep" | "feed" | null {
  if (operation.kind === "delete" || operation.collection !== "entry")
    return null;
  return operation.entry ? activeTimerKind(operation.entry) : null;
}

function hasOtherActiveTimer(
  snapshot: FullFamilySnapshot,
  operation: RecordOperation,
  preceding: readonly QueuedRecord[],
) {
  const kind = timerStartKind(operation);
  return (
    !!kind &&
    snapshot.entries.some(
      ({ entry }) =>
        entry.id !== operation.recordId &&
        activeTimerKind(entry) === kind &&
        !preceding.some((item) => resolvesActiveTimer(item, entry.id, kind)),
    )
  );
}

function resolvesActiveTimer(
  item: QueuedRecord,
  recordId: string,
  kind: "sleep" | "feed",
) {
  return (
    item.status !== "failed" &&
    item.operation.collection === "entry" &&
    item.operation.recordId === recordId &&
    (item.timerCompletion === kind || item.operation.kind === "delete")
  );
}

function completedTimerRecord(
  snapshot: FullFamilySnapshot,
  operation: RecordOperation,
  type: "sleep" | "feed",
) {
  const record = snapshot.entries.find(
    ({ entry }) => entry.id === operation.recordId,
  );
  if (!record || record.entry.type !== type) return undefined;
  if (type === "sleep") return record.entry.end ? record : undefined;
  return record.entry.end && !record.entry.feedRunning ? record : undefined;
}

function timerCompletionAlreadyApplied(
  snapshot: FullFamilySnapshot,
  item: QueuedRecord,
) {
  const record = snapshot.entries.find(
    ({ entry }) => entry.id === item.operation.recordId,
  );
  const intended = item.operation.entry;
  if (!record || !intended || !item.timerCompletion || !intended.end)
    return false;
  const sameCompletion =
    record.entry.type === item.timerCompletion &&
    intended.type === item.timerCompletion &&
    record.entry.end === intended.end &&
    (item.timerCompletion === "sleep" || record.entry.feedRunning !== true);
  if (!sameCompletion) return false;
  // Newer APIs preserve the identity of the member who stopped the timer even
  // if somebody edits notes or amounts later. Older snapshots do not include
  // endedBy, so retain the exact-entry fallback for compatibility.
  return record.endedBy
    ? record.endedBy === item.origin.userId
    : record.lastEditedBy === item.origin.userId &&
        sameEntry(record.entry, intended);
}

function promoteTimerFinish(
  q: QueuedRecord,
  snapshot: FullFamilySnapshot,
): QueuedRecord[] {
  const followUp = q.sleepFollowUp ?? q.feedFollowUp;
  if (!followUp) return [];
  const record = snapshot.entries.find(
    (r) => r.entry.id === q.operation.recordId,
  );
  if (!canEditRecord(snapshot, "entry", q.operation.recordId))
    return [{ ...q, status: "failed", error: "record_forbidden" }];
  // A receipt only gives the family revision, not the record's row version.
  // Never adopt a newer version if somebody changed the original result.
  if (
    !record ||
    !q.operation.entry ||
    record.lastEditedBy !== q.origin.userId ||
    !sameEntry(record.entry, q.operation.entry)
  )
    return [{ ...q, status: "failed", error: "record_changed" }];
  const finished = q.sleepFollowUp
    ? finishLiveSleep(q.operation.entry, q.sleepFollowUp.stoppedAt)
    : finishLiveFeed(
        q.operation.entry,
        q.feedFollowUp!.stoppedAt,
        q.feedFollowUp!.amount,
      );
  return [
    {
      origin: q.origin,
      status: "pending",
      ...(finished
        ? {
            timerCompletion: q.sleepFollowUp
              ? ("sleep" as const)
              : ("feed" as const),
          }
        : {}),
      operation: {
        operationId: followUp.operationId,
        recordId: q.operation.recordId,
        collection: "entry",
        kind: finished ? "update" : "delete",
        baseVersion: record.version,
        membershipId: q.origin.membershipId,
        historyId: q.origin.historyId,
        ...(finished ? { entry: finished } : {}),
        ...(finished && snapshot.conflictReplacementEnabled === true
          ? {
              timerCompletion: q.sleepFollowUp
                ? ("sleep" as const)
                : ("feed" as const),
            }
          : {}),
      },
    },
  ];
}

function activeEntryRecord(
  snapshot: FullFamilySnapshot,
  operation: RecordOperation,
): SharedEntryRecord | undefined {
  if (operation.collection !== "entry") return undefined;
  const record = snapshot.entries.find(
    (item) => item.entry.id === operation.recordId,
  );
  if (!record || record.version !== operation.baseVersion) return undefined;
  if (
    snapshot.family.role !== "owner" &&
    record.recordedBy !== originForSnapshot(snapshot).userId &&
    snapshot.crossMemberTimerCompletionEnabled !== true
  )
    return undefined;
  return record;
}

function sameTimerFields(previous: Entry, next: Entry, type: "sleep" | "feed") {
  if (
    previous.id !== next.id ||
    previous.type !== type ||
    next.type !== type ||
    previous.start !== next.start ||
    previous.note !== next.note
  )
    return false;
  return type === "sleep" || previous.feedKind === next.feedKind;
}

function isTimerCompletionOperation(
  snapshot: FullFamilySnapshot,
  operation: RecordOperation,
  type: "sleep" | "feed",
) {
  const record = activeEntryRecord(snapshot, operation);
  const previous = record?.entry;
  if (!previous || previous.type !== type || previous.end) return false;
  const next = operation.entry;
  if (
    operation.kind !== "update" ||
    !next?.end ||
    next.feedRunning ||
    !sameTimerFields(previous, next, type)
  )
    return false;
  return type === "sleep" || previous.feedRunning === true;
}

function isCompletedTimer(entry: Entry, type: "sleep" | "feed") {
  return (
    entry.type === type &&
    !!entry.end &&
    (type === "sleep" || entry.feedRunning !== true)
  );
}

export function canReplaceRecordConflict(
  state: PilotState,
  operationId: string,
): boolean {
  const snapshot = state.snapshot;
  if (
    state.transition ||
    !isFullSnapshot(snapshot) ||
    snapshot.conflictReplacementEnabled !== true
  )
    return false;
  const item = (state.records ?? []).find(
    (record) =>
      record.operation.operationId === operationId &&
      record.status === "failed" &&
      record.serverConflict === true &&
      matchesOrigin(record.origin, snapshot),
  );
  const intended = item?.operation.entry;
  if (
    !item ||
    item.operation.kind !== "update" ||
    item.operation.collection !== "entry" ||
    !intended ||
    (intended.type !== "feed" && intended.type !== "sleep")
  )
    return false;
  const current = snapshot.entries.find(
    ({ entry }) => entry.id === item.operation.recordId,
  );
  if (
    !current ||
    current.version === item.operation.baseVersion ||
    current.entry.type !== intended.type ||
    (state.records ?? []).some(
      (record) =>
        record !== item &&
        record.status !== "failed" &&
        record.operation.collection === "entry" &&
        record.operation.recordId === item.operation.recordId,
    )
  )
    return false;
  if (canEditRecord(snapshot, "entry", item.operation.recordId)) return true;
  return (
    item.timerCompletion === intended.type &&
    item.operation.timerCompletion === intended.type &&
    isCompletedTimer(current.entry, intended.type) &&
    isCompletedTimer(intended, intended.type) &&
    sameTimerFields(current.entry, intended, intended.type)
  );
}

export function replaceRecordConflict(
  state: PilotState,
  operationId: string,
  replacementOperationId: string,
  expectedVersion?: string,
): PilotState {
  if (!replacementOperationId) throw new Error("invalid_operation");
  if (!canReplaceRecordConflict(state, operationId))
    throw new Error("conflict_resolution_unavailable");
  const snapshot = state.snapshot as FullFamilySnapshot;
  const item = state.records!.find(
    (record) => record.operation.operationId === operationId,
  )!;
  const current = snapshot.entries.find(
    ({ entry }) => entry.id === item.operation.recordId,
  )!;
  if (expectedVersion !== undefined && current.version !== expectedVersion)
    throw new Error("conflict_resolution_changed");
  if (
    (state.records ?? []).some(
      (record) =>
        record.operation.operationId === replacementOperationId ||
        record.sleepFollowUp?.operationId === replacementOperationId ||
        record.feedFollowUp?.operationId === replacementOperationId,
    )
  )
    throw new Error("invalid_operation");
  return {
    ...state,
    records: [
      ...(state.records ?? []).filter((record) => record !== item),
      {
        origin: item.origin,
        operation: {
          ...item.operation,
          operationId: replacementOperationId,
          baseVersion: current.version,
          replacesOperationId: item.operation.operationId,
        },
        status: "pending",
        ...(item.timerCompletion
          ? { timerCompletion: item.timerCompletion }
          : {}),
      },
    ],
  };
}

export function discardRecordConflict(
  state: PilotState,
  operationId: string,
): PilotState {
  return {
    ...state,
    records: (state.records ?? []).filter(
      (record) =>
        record.operation.operationId !== operationId ||
        record.status !== "failed",
    ),
  };
}
export function applyFullSnapshot(
  state: PilotState,
  incoming: FullFamilySnapshot,
): PilotState {
  const snapshot = validateFullSnapshot(incoming);
  const next = applySnapshot(state, snapshot);
  if (next === state) return state;
  const records: QueuedRecord[] = [];
  for (const queued of state.records ?? []) {
    if (!matchesOrigin(queued.origin, snapshot)) continue;
    let q = queued;
    if (
      q.status === "accepted" &&
      q.receiptRevision &&
      revision(snapshot.revision) >= revision(q.receiptRevision)
    ) {
      records.push(...promoteTimerFinish(q, snapshot));
      continue;
    }
    if (
      q.status === "pending" &&
      hasOtherActiveTimer(snapshot, q.operation, records)
    ) {
      records.push({
        ...q,
        status: "failed",
        error: "active_timer_conflict",
      });
      continue;
    }
    if (q.timerCompletion) {
      if (timerCompletionAlreadyApplied(snapshot, q)) continue;
      const completed = completedTimerRecord(
        snapshot,
        q.operation,
        q.timerCompletion,
      );
      if (completed) {
        // Let the immutable stale completion reach only a replacement-capable
        // API. Its authoritative 412 creates the conflict receipt required for
        // a safe overwrite. Legacy APIs keep the previous local-only behavior.
        if (
          q.status === "pending" &&
          snapshot.conflictReplacementEnabled === true
        ) {
          records.push(q);
          continue;
        }
        records.push({
          ...q,
          status: "failed",
          error: "timer_already_finished",
        });
        continue;
      }
      if (!isTimerCompletionOperation(snapshot, q.operation, q.timerCompletion))
        q = { ...q, status: "failed", error: "record_changed" };
      records.push(q);
      continue;
    }
    if (!canEditRecord(snapshot, q.operation.collection, q.operation.recordId))
      q = { ...q, status: "failed", error: "record_forbidden" };
    records.push(q);
  }
  return { ...next, records };
}
export function acceptRecordReceipt(
  state: PilotState,
  id: string,
  receipt: FeedReceipt,
): PilotState {
  if (
    receipt.operationId !== id ||
    receipt.historyId !== state.snapshot?.historyId
  )
    throw new Error("history_changed");
  const floor = state.acknowledgedRevision
    ? revision(state.acknowledgedRevision)
    : 0n;
  return {
    ...state,
    acknowledgedRevision:
      revision(receipt.revision) > floor
        ? receipt.revision
        : state.acknowledgedRevision,
    records: (state.records ?? []).map((q) =>
      q.operation.operationId === id
        ? { ...q, status: "accepted", receiptRevision: receipt.revision }
        : q,
    ),
    watchLedger: state.watchLedger?.[id]
      ? {
          ...state.watchLedger,
          [id]: {
            ...state.watchLedger[id],
            receipt: { ...state.watchLedger[id].receipt, status: "shared" },
          },
        }
      : state.watchLedger,
  };
}
export function recordsForSend(durable: PilotState, visible: PilotState) {
  if (
    visible.transition ||
    durable.transition ||
    !isFullSnapshot(visible.snapshot) ||
    !isFullSnapshot(durable.snapshot)
  )
    return [];
  const snapshot = visible.snapshot;
  const watchRecordingEnabled = snapshot.watchRecordingEnabled === true;
  const visibleRecords = visible.records ?? [];
  return (durable.records ?? []).filter((q) => {
    if (
      q.status !== "pending" ||
      (durable.watchLedger?.[q.operation.operationId] &&
        !watchRecordingEnabled &&
        !q.operation.replacesOperationId) ||
      !matchesOrigin(q.origin, snapshot)
    )
      return false;
    const index = visibleRecords.findIndex(
      (v) =>
        v.operation.operationId === q.operation.operationId &&
        v.status === "pending",
    );
    if (index < 0) return false;
    const kind = timerStartKind(q.operation);
    if (!kind) return true;
    const preceding = visibleRecords.slice(0, index);
    // A later start of the same timer kind must wait until the earlier start
    // and its optional stop have reached the service in order.
    if (
      preceding.some(
        (item) =>
          item.status !== "failed" && timerStartKind(item.operation) === kind,
      )
    )
      return false;
    return !hasOtherActiveTimer(snapshot, q.operation, preceding);
  });
}
export function projectedFullState(state: PilotState): State | null {
  if (state.transition || !isFullSnapshot(state.snapshot)) return null;
  const snapshot = state.snapshot;
  const entries = new Map(snapshot.entries.map((r) => [r.entry.id, r.entry]));
  const care = new Map(
    snapshot.careRecords.map((r) => [r.record.id, r.record]),
  );
  for (const q of state.records ?? []) {
    if (q.status === "failed" || !matchesOrigin(q.origin, snapshot)) continue;
    const op = q.operation;
    // A conflict replacement is intentionally non-optimistic. Keep charts and
    // records on the reviewed family version until a fresh authoritative
    // snapshot contains the accepted replacement.
    if (op.replacesOperationId) continue;
    if (op.collection === "entry") {
      if (op.kind === "delete") entries.delete(op.recordId);
      else if (op.entry) entries.set(op.recordId, op.entry);
      if (q.sleepFollowUp && op.entry) {
        const finished = finishLiveSleep(op.entry, q.sleepFollowUp.stoppedAt);
        if (finished) entries.set(op.recordId, finished);
        else entries.delete(op.recordId);
      }
      if (q.feedFollowUp && op.entry)
        entries.set(
          op.recordId,
          finishLiveFeed(
            op.entry,
            q.feedFollowUp.stoppedAt,
            q.feedFollowUp.amount,
          ),
        );
    } else if (op.collection === "care") {
      if (op.kind === "delete") care.delete(op.recordId);
      else if (op.careRecord) care.set(op.recordId, op.careRecord);
    }
  }
  return {
    schemaVersion: 1,
    profile: snapshot.profile,
    entries: [...entries.values()],
    careRecords: [...care.values()],
  };
}

export function projectedExtraRecords(
  state: PilotState,
): SharedRecord<{ record: FamilyExtraRecord }>[] {
  if (
    state.transition ||
    !isFullSnapshot(state.snapshot) ||
    state.snapshot.extrasSchemaVersion !== 1
  )
    return [];
  const snapshot = state.snapshot;
  const records = new Map(
    (snapshot.extraRecords ?? []).map((item) => [item.record.id, item]),
  );
  for (const queued of state.records ?? []) {
    if (
      queued.status === "failed" ||
      !matchesOrigin(queued.origin, snapshot) ||
      queued.operation.collection !== "extra"
    )
      continue;
    const operation = queued.operation;
    if (operation.kind === "delete") records.delete(operation.recordId);
    else if (operation.extraRecord) {
      const previous = records.get(operation.recordId);
      records.set(operation.recordId, {
        version: previous?.version ?? `pending:${operation.operationId}`,
        recordedBy: previous?.recordedBy ?? queued.origin.userId,
        lastEditedBy: queued.origin.userId,
        record: operation.extraRecord,
      });
    }
  }
  return [...records.values()];
}
