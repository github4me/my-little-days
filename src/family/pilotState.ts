import type {
  FamilySnapshot,
  FeedOperation,
  FeedReceipt,
  SharedFeed,
  SharedFeedInput,
} from "./contracts";

export type FeedDraft = {
  recordId: string;
  baseVersion?: string;
  start: string;
  end: string;
  amount: string;
  note: string;
  membershipId?: string;
  historyId?: string;
};
export type QueuedFeed = {
  operation: FeedOperation;
  status: "pending" | "failed" | "accepted";
  error?: string;
  receiptRevision?: string;
};
export type PilotFeed = SharedFeed & {
  pending?: boolean;
  pendingDelete?: boolean;
  awaitingRefresh?: boolean;
};
export type PilotState = {
  schema: 1;
  snapshot: FamilySnapshot | null;
  draft: FeedDraft | null;
  queue: QueuedFeed[];
  acknowledgedRevision: string | null;
};
export const emptyPilotState = (): PilotState => ({
  schema: 1,
  snapshot: null,
  draft: null,
  queue: [],
  acknowledgedRevision: null,
});
const revision = (value: string) => {
  if (!/^\d{1,20}$/.test(value)) throw new Error("invalid_response");
  return BigInt(value);
};
export function feedFromDraft(
  draft: FeedDraft,
  now = Date.now(),
): SharedFeedInput {
  const amount = Number(draft.amount.trim());
  const start = Date.parse(draft.start),
    end = Date.parse(draft.end);
  if (
    !/^\d+(?:\.\d{1,2})?$/.test(draft.amount.trim()) ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > 2000 ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    end > now + 60_000 ||
    start < Date.UTC(1900, 0, 1) ||
    draft.note.length > 500
  )
    throw new Error("invalid_feed");
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    amount,
    note: draft.note,
  };
}
export function enqueue(
  state: PilotState,
  operation: FeedOperation,
): PilotState {
  if (!state.snapshot) throw new Error("family_unavailable");
  if (
    operation.historyId !== state.snapshot.historyId ||
    operation.membershipId !== state.snapshot.family.membershipId
  )
    throw new Error("membership_changed");
  if (
    state.queue.some(
      (q) =>
        q.operation.recordId === operation.recordId && q.status !== "failed",
    )
  )
    throw new Error("record_pending");
  if (state.queue.length >= 200) throw new Error("queue_full");
  return {
    ...state,
    draft: null,
    queue: [
      ...state.queue,
      {
        operation: {
          ...operation,
          ...(operation.feed ? { feed: { ...operation.feed } } : {}),
        },
        status: "pending",
      },
    ],
  };
}
export function acceptReceipt(
  state: PilotState,
  operationId: string,
  receipt: FeedReceipt,
): PilotState {
  if (
    receipt.operationId !== operationId ||
    receipt.historyId !== state.snapshot?.historyId
  )
    throw new Error("history_changed");
  const next = revision(receipt.revision);
  const floor = state.acknowledgedRevision
    ? revision(state.acknowledgedRevision)
    : 0n;
  return {
    ...state,
    acknowledgedRevision:
      next > floor ? receipt.revision : state.acknowledgedRevision,
    queue: state.queue.map((q) =>
      q.operation.operationId === operationId
        ? { ...q, status: "accepted", receiptRevision: receipt.revision }
        : q,
    ),
  };
}
export function rejectOperation(
  state: PilotState,
  operationId: string,
  error: string,
): PilotState {
  return {
    ...state,
    queue: state.queue.map((q) =>
      q.operation.operationId === operationId
        ? { ...q, status: "failed", error }
        : q,
    ),
  };
}
// Optimistic UI state is not a durable outbox. Network eligibility is the
// intersection of committed work and still-valid visible work.
export function pendingForSend(
  durable: PilotState,
  visible: PilotState,
): QueuedFeed[] {
  const context = visible.snapshot;
  if (
    !context ||
    durable.snapshot?.family.id !== context.family.id ||
    durable.snapshot.historyId !== context.historyId ||
    durable.snapshot.family.membershipId !== context.family.membershipId
  )
    return [];
  return durable.queue.filter(
    (q) =>
      q.status === "pending" &&
      q.operation.historyId === context.historyId &&
      q.operation.membershipId === context.family.membershipId &&
      visible.queue.some(
        (v) =>
          v.operation.operationId === q.operation.operationId &&
          v.status === "pending",
      ),
  );
}
export function revokeCache(state: PilotState): PilotState {
  return {
    ...state,
    snapshot: null,
    acknowledgedRevision: null,
    queue: state.queue.map((q) => ({
      ...q,
      status: "failed",
      error: "membership_revoked",
    })),
  };
}
export function applySnapshot(
  state: PilotState,
  snapshot: FamilySnapshot,
): PilotState {
  const incoming = revision(snapshot.revision);
  if (
    !snapshot.historyId ||
    !snapshot.family.membershipId ||
    !Array.isArray(snapshot.feeds) ||
    !Array.isArray(snapshot.members) ||
    !Array.isArray(snapshot.invitations)
  )
    throw new Error("invalid_response");
  const sameHistory =
    state.snapshot?.historyId === snapshot.historyId &&
    state.snapshot.family.id === snapshot.family.id;
  const sameGrant =
    sameHistory &&
    state.snapshot?.family.membershipId === snapshot.family.membershipId;
  if (
    sameGrant &&
    (incoming < revision(state.snapshot!.revision) ||
      (state.acknowledgedRevision &&
        incoming < revision(state.acknowledgedRevision)))
  )
    return state;
  const queue = state.queue.flatMap<QueuedFeed>((q) => {
    const error =
      q.operation.historyId !== snapshot.historyId
        ? "history_changed"
        : q.operation.membershipId !== snapshot.family.membershipId
          ? "membership_changed"
          : null;
    if (error) return [{ ...q, status: "failed", error }];
    if (
      q.status === "accepted" &&
      q.receiptRevision &&
      incoming >= revision(q.receiptRevision)
    )
      return [];
    return [q];
  });
  // Never overwrite a private editor with network data. Old grant/history drafts
  // remain readable but require explicit review before they can be submitted.
  return {
    ...state,
    snapshot,
    queue,
    acknowledgedRevision: sameGrant ? state.acknowledgedRevision : null,
  };
}
export function projectedFeeds(state: PilotState, author: string): PilotFeed[] {
  const feeds = new Map<string, PilotFeed>(
    state.snapshot?.feeds.map((f) => [f.id, f]) ?? [],
  );
  for (const q of state.queue) {
    const op = q.operation;
    if (
      q.status === "failed" ||
      op.historyId !== state.snapshot?.historyId ||
      op.membershipId !== state.snapshot.family.membershipId
    )
      continue;
    if (op.kind === "delete") {
      const current = feeds.get(op.recordId);
      if (current)
        feeds.set(op.recordId, {
          ...current,
          pendingDelete: true,
          pending: q.status === "pending",
          awaitingRefresh: q.status === "accepted",
        });
    } else if (op.feed) {
      const current = feeds.get(op.recordId);
      feeds.set(op.recordId, {
        ...op.feed,
        id: op.recordId,
        version: op.baseVersion ?? "",
        recordedBy: current?.recordedBy ?? author,
        lastEditedBy: author,
        pending: q.status === "pending",
        awaitingRefresh: q.status === "accepted",
      });
    }
  }
  return [...feeds.values()].sort(
    (a, b) => Date.parse(b.start) - Date.parse(a.start),
  );
}

export function parseStoredPilot(raw: string | null): PilotState {
  if (!raw) return emptyPilotState();
  const state = JSON.parse(raw) as PilotState;
  if (
    state.schema !== 1 ||
    !Array.isArray(state.queue) ||
    state.queue.length > 200 ||
    !("snapshot" in state) ||
    !("draft" in state)
  )
    throw new Error("local_data_invalid");
  for (const q of state.queue)
    if (
      !q.operation?.operationId ||
      !q.operation.membershipId ||
      !q.operation.historyId ||
      !["pending", "accepted", "failed"].includes(q.status)
    )
      throw new Error("local_data_invalid");
  if (state.snapshot) revision(state.snapshot.revision);
  return state;
}
