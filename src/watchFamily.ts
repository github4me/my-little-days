import type { PilotState } from "./family/pilotState";
import {
  isFullSnapshot,
  projectedFullState,
  canReplaceRecordConflict,
  replaceRecordConflict,
  discardRecordConflict,
  enqueueRecord,
  enqueueSleepFinish,
  enqueueFeedFinish,
} from "./family/fullState";
import {
  addWatchReceipt,
  previousWatchReceipt,
  watchEntryChange,
  watchReceipt,
  type WatchCommand,
  type WatchReceipt,
} from "./watchProtocol";

export function enqueueFamilyWatchCommand(
  state: PilotState,
  command: WatchCommand,
  now = Date.now(),
): PilotState {
  const prior = previousWatchReceipt(state.watchLedger, command);
  if (prior) return state;
  const snapshot = state.snapshot;
  const projected = projectedFullState(state);
  if (!isFullSnapshot(snapshot) || !projected || state.transition)
    throw new Error("refresh_required");
  if (
    command.dependsOn &&
    state.watchLedger?.[command.dependsOn]?.receipt.status === "rejected"
  )
    throw new Error("watch_dependency_rejected");
  if (command.kind === "resolve-conflict") {
    const conflict = state.records?.find(
      (item) =>
        item.operation.operationId === command.conflictOperationId &&
        item.operation.recordId === command.recordId &&
        item.status === "failed",
    );
    if (!conflict) throw new Error("conflict_resolution_unavailable");
    const next =
      command.resolution === "discard"
        ? discardRecordConflict(state, conflict.operation.operationId)
        : replaceRecordConflict(
            state,
            conflict.operation.operationId,
            command.commandId,
            command.baseVersion,
          );
    return {
      ...next,
      watchLedger: addWatchReceipt(
        state.watchLedger,
        command,
        watchReceipt(
          command,
          command.resolution === "discard" ? "shared" : "pending",
        ),
      ),
    };
  }
  // A previously delivered conflict remains reviewable if new Watch recording
  // is later paused. Resolution still goes through the current family grant and
  // the server's conflict receipt; it is not permission to create a new record.
  if (snapshot.watchRecordingEnabled !== true)
    throw new Error("watch_recording_unavailable");
  watchEntryChange(projected, command, now);
  let next: PilotState;
  if (command.kind === "create")
    next = enqueueRecord(state, {
      operationId: command.commandId,
      recordId: command.recordId,
      collection: "entry",
      kind: "create",
      membershipId: snapshot.family.membershipId,
      historyId: snapshot.historyId,
      entry: command.entry,
    });
  else {
    const record = snapshot.entries.find(
      (r) => r.entry.id === command.recordId,
    );
    const pending = state.records?.find(
      (r) => r.operation.recordId === command.recordId && r.status !== "failed",
    );
    let version = command.baseVersion;
    if (!pending && !version && command.dependsOn) {
      // The Watch can stop its own offline start before it has received the
      // server version. Adopt that version only when the exact start survived.
      const dependency = state.watchLedger?.[command.dependsOn];
      const original = dependency
        ? (JSON.parse(dependency.fingerprint) as WatchCommand)
        : undefined;
      if (!dependency || dependency.receipt.status === "pending")
        throw new Error("watch_dependency_pending");
      if (
        dependency.receipt.status !== "shared" ||
        !original?.entry ||
        !record ||
        record.lastEditedBy !== record.recordedBy ||
        JSON.stringify(Object.entries(original.entry).sort()) !==
          JSON.stringify(Object.entries(record.entry).sort())
      )
        throw new Error("record_changed");
      version = record.version;
    }
    if (!pending && (!version || version !== record?.version))
      throw new Error("record_changed");
    if (pending && command.dependsOn !== pending.operation.operationId)
      throw new Error("record_changed");
    next =
      command.kind === "finish-sleep"
        ? enqueueSleepFinish(
            state,
            command.recordId,
            command.stoppedAt!,
            command.commandId,
          )
        : enqueueFeedFinish(
            state,
            command.recordId,
            command.stoppedAt!,
            command.amount,
            command.commandId,
            pending ? undefined : version,
          );
  }
  return {
    ...next,
    watchLedger: addWatchReceipt(
      state.watchLedger,
      command,
      watchReceipt(command, "pending"),
    ),
  };
}

export function familyWatchReceipts(state: PilotState): WatchReceipt[] {
  const queued = new Map<string, NonNullable<PilotState["records"]>[number]>();
  for (const item of state.records ?? []) {
    queued.set(item.operation.operationId, item);
    if (item.sleepFollowUp) queued.set(item.sleepFollowUp.operationId, item);
    if (item.feedFollowUp) queued.set(item.feedFollowUp.operationId, item);
  }
  return Object.values(state.watchLedger ?? {}).map(({ receipt }) => {
    const queue = queued.get(receipt.commandId);
    if (queue?.status === "failed")
      return {
        ...receipt,
        status: "rejected",
        error: queue.error ?? "record_changed",
        // A 412 can arrive before the fresh snapshot. Recompute (and, while
        // necessary, clear) the detail even after the receipt became terminal
        // so Watch never freezes the stale pre-conflict family version.
        conflict: undefined,
        ...watchConflict(state, queue),
      };
    if (receipt.status !== "pending") return receipt;
    if (
      queue?.operation.operationId === receipt.commandId &&
      queue.status === "accepted"
    )
      return { ...receipt, status: "shared" };
    return receipt;
  });
}

function watchConflict(
  state: PilotState,
  queue: NonNullable<PilotState["records"]>[number],
): { conflict: NonNullable<WatchReceipt["conflict"]> } | object {
  const snapshot = state.snapshot;
  const proposed = queue.operation.entry;
  if (
    !queue.serverConflict ||
    !isFullSnapshot(snapshot) ||
    snapshot.conflictReplacementEnabled !== true ||
    queue.operation.collection !== "entry" ||
    !proposed ||
    (proposed.type !== "feed" && proposed.type !== "sleep")
  )
    return {};
  const current = snapshot.entries.find(
    ({ entry }) => entry.id === queue.operation.recordId,
  );
  if (
    !current ||
    current.version === queue.operation.baseVersion ||
    current.entry.type !== proposed.type
  )
    return {};
  return {
    conflict: {
      currentVersion: current.version,
      currentEditedBy:
        snapshot.members.find((member) => member.id === current.lastEditedBy)
          ?.displayName || "—",
      currentEntry: { ...current.entry, note: "" },
      proposedEntry: { ...proposed, note: "" },
      canReplace: canReplaceRecordConflict(state, queue.operation.operationId),
    },
  };
}

export function reconcileWatchReceipts(state: PilotState): PilotState {
  if (!state.watchLedger) return state;
  return {
    ...state,
    watchLedger: Object.fromEntries(
      familyWatchReceipts(state).map((receipt) => [
        receipt.commandId,
        { ...state.watchLedger![receipt.commandId], receipt },
      ]),
    ),
  };
}
