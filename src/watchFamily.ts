import type { PilotState } from "./family/pilotState";
import {
  isFullSnapshot,
  projectedFullState,
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
  if (snapshot.watchRecordingEnabled !== true)
    throw new Error("watch_recording_unavailable");
  if (
    command.dependsOn &&
    state.watchLedger?.[command.dependsOn]?.receipt.status === "rejected"
  )
    throw new Error("watch_dependency_rejected");
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
    if (receipt.status !== "pending") return receipt;
    const queue = queued.get(receipt.commandId);
    if (queue?.status === "failed")
      return {
        ...receipt,
        status: "rejected",
        error: queue.error ?? "record_changed",
      };
    if (
      queue?.operation.operationId === receipt.commandId &&
      queue.status === "accepted"
    )
      return { ...receipt, status: "shared" };
    return receipt;
  });
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
