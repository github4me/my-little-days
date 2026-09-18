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
  receiptRevision?: string;
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
    value.watchRecordingEnabled !== undefined &&
    typeof value.watchRecordingEnabled !== "boolean"
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
  const entries = value.entries.map((item) => ({
    ...metadata(item),
    entry: validateEntry(item.entry),
  }));
  const careRecords = value.careRecords.map((item) => ({
    ...metadata(item),
    record: validateCareRecord(item.record),
  }));
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
export function enqueueRecord(
  state: PilotState,
  operation: RecordOperation,
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
  if (!canEditRecord(snapshot, operation.collection, operation.recordId))
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
      },
    ],
  };
}

function controllableEntry(state: PilotState, id: string): Entry | undefined {
  const snapshot = state.snapshot;
  if (
    state.transition ||
    !isFullSnapshot(snapshot) ||
    !canEditRecord(snapshot, "entry", id)
  )
    return undefined;
  const queued = (state.records ?? []).find(
    (q) =>
      q.operation.collection === "entry" &&
      q.operation.recordId === id &&
      q.status !== "failed" &&
      matchesOrigin(q.origin, snapshot),
  );
  return queued
    ? queued.operation.kind !== "delete" &&
      !queued.sleepFollowUp &&
      !queued.feedFollowUp
      ? queued.operation.entry
      : undefined
    : snapshot.entries.find((r) => r.entry.id === id)?.entry;
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
  if (!canEditRecord(snapshot, "entry", id))
    throw new Error("record_forbidden");
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
    !(type === "sleep" ? canControlSleep(state, id) : canControlFeed(state, id))
  )
    throw new Error("record_changed");
  if (
    (baseVersion !== undefined && record?.version !== baseVersion) ||
    (expectedEntry && !sameEntry(entry, expectedEntry)) ||
    (type === "feed" &&
      !queued &&
      baseVersion === undefined &&
      record?.lastEditedBy !== originForSnapshot(snapshot).userId)
  )
    throw new Error("record_changed");
  const finished =
    type === "sleep"
      ? finishLiveSleep(entry, stoppedAt)
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
  return enqueueRecord(state, {
    operationId,
    recordId: id,
    collection: "entry",
    kind: finished ? "update" : "delete",
    baseVersion: record!.version,
    membershipId: snapshot.family.membershipId,
    historyId: snapshot.historyId,
    ...(finished ? { entry: finished } : {}),
  });
}

function sameEntry(left: Entry, right: Entry) {
  // Domain entries have only scalar fields; ignore JSON property order.
  const fields = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...fields].every(
    (field) => left[field as keyof Entry] === right[field as keyof Entry],
  );
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
      operation: {
        operationId: followUp.operationId,
        recordId: q.operation.recordId,
        collection: "entry",
        kind: finished ? "update" : "delete",
        baseVersion: record.version,
        membershipId: q.origin.membershipId,
        historyId: q.origin.historyId,
        ...(finished ? { entry: finished } : {}),
      },
    },
  ];
}
export function applyFullSnapshot(
  state: PilotState,
  incoming: FullFamilySnapshot,
): PilotState {
  const snapshot = validateFullSnapshot(incoming);
  const next = applySnapshot(state, snapshot);
  if (next === state) return state;
  const records = (state.records ?? [])
    .filter((q) => matchesOrigin(q.origin, snapshot))
    .flatMap<QueuedRecord>((q) => {
      if (
        q.status === "accepted" &&
        q.receiptRevision &&
        revision(snapshot.revision) >= revision(q.receiptRevision)
      )
        return promoteTimerFinish(q, snapshot);
      if (
        !canEditRecord(snapshot, q.operation.collection, q.operation.recordId)
      )
        return [{ ...q, status: "failed", error: "record_forbidden" }];
      return [q];
    });
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
  const watchRecordingEnabled = visible.snapshot.watchRecordingEnabled === true;
  return (durable.records ?? []).filter(
    (q) =>
      q.status === "pending" &&
      (!durable.watchLedger?.[q.operation.operationId] ||
        watchRecordingEnabled) &&
      matchesOrigin(q.origin, visible.snapshot) &&
      (visible.records ?? []).some(
        (v) =>
          v.operation.operationId === q.operation.operationId &&
          v.status === "pending",
      ),
  );
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
