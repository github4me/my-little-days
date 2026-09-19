import type {
  FamilySnapshot,
  FeedOperation,
  FeedReceipt,
  SharedFeed,
  SharedFeedInput,
} from "./contracts";
import type { QueuedRecord } from "./fullState";
import { finishLiveSleep } from "../sleepTimer";
import { finishFeed } from "../feedFinish";
import { validateWatchLedger, type WatchLedger } from "../watchProtocol";

export type FeedDraft = {
  recordId: string;
  baseVersion?: string;
  start: string;
  end: string;
  amount: string;
  note: string;
  membershipId?: string;
  historyId?: string;
  origin?: SharingOrigin;
};
export type SharingOrigin = {
  familyId: string;
  userId: string;
  membershipId: string;
  historyId: string;
};
export type PilotTransition = {
  operationId: string;
  kind: "create" | "join" | "leave" | "close" | "delete-account" | "manage";
  path: string;
  body: Record<string, unknown>;
  userId: string;
  familyId?: string;
  origin?: SharingOrigin;
  phase: "pending" | "committed" | "rejected";
  error?: string;
  dispatched?: boolean;
  activation?: {
    familyId: string;
    membershipId: string;
    historyId?: string;
    extrasSchemaVersion?: 1;
  };
};
export type QueuedFeed = {
  origin: SharingOrigin;
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
  schema: 2;
  snapshot: FamilySnapshot | null;
  draft: FeedDraft | null;
  queue: QueuedFeed[];
  acknowledgedRevision: string | null;
  transition: PilotTransition | null;
  records?: QueuedRecord[];
  watchLedger?: WatchLedger;
  watchVerifiedAt?: string;
};
export const emptyPilotState = (): PilotState => ({
  schema: 2,
  snapshot: null,
  draft: null,
  queue: [],
  acknowledgedRevision: null,
  transition: null,
  records: [],
});
export function originForSnapshot(snapshot: FamilySnapshot): SharingOrigin {
  const member = snapshot.members.find(
    (m) => m.membershipId === snapshot.family.membershipId,
  );
  if (!member) throw new Error("invalid_response");
  return {
    familyId: snapshot.family.id,
    userId: member.id,
    membershipId: snapshot.family.membershipId,
    historyId: snapshot.historyId,
  };
}
export function matchesOrigin(
  origin: SharingOrigin | undefined,
  snapshot: FamilySnapshot | null,
): boolean {
  if (!origin || !snapshot) return false;
  const expected = originForSnapshot(snapshot);
  return Object.keys(expected).every(
    (key) =>
      origin[key as keyof SharingOrigin] ===
      expected[key as keyof SharingOrigin],
  );
}
export function canEditSharedFeed(snapshot: FamilySnapshot, feed: SharedFeed) {
  return (
    snapshot.family.role === "owner" ||
    feed.recordedBy === originForSnapshot(snapshot).userId
  );
}
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
  if (state.transition) throw new Error("transition_pending");
  if (
    operation.historyId !== state.snapshot.historyId ||
    operation.membershipId !== state.snapshot.family.membershipId
  )
    throw new Error("membership_changed");
  if (operation.kind !== "create") {
    const record = state.snapshot.feeds.find(
      (f) => f.id === operation.recordId,
    );
    if (!record) throw new Error("record_changed");
    if (!canEditSharedFeed(state.snapshot, record))
      throw new Error("record_forbidden");
  }
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
        origin: originForSnapshot(state.snapshot),
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
    durable.transition ||
    visible.transition ||
    !context ||
    durable.snapshot?.family.id !== context.family.id ||
    durable.snapshot.historyId !== context.historyId ||
    durable.snapshot.family.membershipId !== context.family.membershipId
  )
    return [];
  return durable.queue.filter(
    (q) =>
      q.status === "pending" &&
      matchesOrigin(q.origin, context) &&
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
    ...emptyPilotState(),
    transition: state.transition,
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
    if (!sameGrant || !matchesOrigin(q.origin, snapshot)) return [];
    const record = snapshot.feeds.find(
      (feed) => feed.id === q.operation.recordId,
    );
    if (
      record &&
      q.operation.kind !== "create" &&
      !canEditSharedFeed(snapshot, record)
    )
      return [{ ...q, status: "failed", error: "record_forbidden" }];
    if (
      q.status === "accepted" &&
      q.receiptRevision &&
      incoming >= revision(q.receiptRevision)
    )
      return [];
    return [q];
  });
  // A private editor survives only inside its immutable original grant. Old
  // family data must never become a new family's editable recovery payload.
  return {
    ...state,
    snapshot,
    queue,
    draft:
      sameGrant && matchesOrigin(state.draft?.origin, snapshot)
        ? state.draft
        : null,
    acknowledgedRevision: sameGrant ? state.acknowledgedRevision : null,
    watchLedger: sameGrant ? state.watchLedger : undefined,
    watchVerifiedAt: sameGrant ? state.watchVerifiedAt : undefined,
  };
}
export function projectedFeeds(state: PilotState, author: string): PilotFeed[] {
  if (state.transition) return [];
  const feeds = new Map<string, PilotFeed>(
    state.snapshot?.feeds.map((f) => [f.id, f]) ?? [],
  );
  for (const q of state.queue) {
    const op = q.operation;
    if (
      q.status === "failed" ||
      !matchesOrigin(q.origin, state.snapshot) ||
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
  const parsed = JSON.parse(raw);
  // The previous pilot did not bind drafts/outbox payloads to their source
  // family and author. Those payloads cannot be safely migrated or recovered.
  if (parsed.schema === 1) {
    const migrated = emptyPilotState();
    if (parsed.snapshot) {
      revision(parsed.snapshot.revision);
      originForSnapshot(parsed.snapshot);
      migrated.snapshot = parsed.snapshot;
    }
    return migrated;
  }
  const state = parsed as PilotState;
  validateWatchLedger(state.watchLedger);
  if (
    state.schema !== 2 ||
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
      !q.origin ||
      !["pending", "accepted", "failed"].includes(q.status)
    )
      throw new Error("local_data_invalid");
  if (
    state.records !== undefined &&
    (!Array.isArray(state.records) || state.records.length > 200)
  )
    throw new Error("local_data_invalid");
  for (const q of state.records ?? [])
    if (
      !q.operation?.operationId ||
      !q.operation.recordId ||
      !q.operation.membershipId ||
      !q.operation.historyId ||
      !q.origin ||
      !["entry", "care", "extra"].includes(q.operation.collection) ||
      !["create", "update", "delete"].includes(q.operation.kind) ||
      !["pending", "accepted", "failed"].includes(q.status)
    )
      throw new Error("local_data_invalid");
  for (const q of state.records ?? [])
    if (
      q.timerCompletion !== undefined &&
      (!["sleep", "feed"].includes(q.timerCompletion) ||
        q.operation.collection !== "entry" ||
        q.operation.kind !== "update" ||
        q.operation.entry?.type !== q.timerCompletion)
    )
      throw new Error("local_data_invalid");
  for (const q of state.records ?? []) {
    if (q.sleepFollowUp === undefined && q.feedFollowUp === undefined) continue;
    try {
      const followUp = q.sleepFollowUp ?? q.feedFollowUp;
      if (
        !followUp ||
        (q.sleepFollowUp !== undefined && q.feedFollowUp !== undefined) ||
        typeof followUp.operationId !== "string" ||
        !followUp.operationId ||
        followUp.operationId === q.operation.operationId ||
        typeof followUp.stoppedAt !== "string" ||
        q.operation.collection !== "entry" ||
        q.operation.kind === "delete" ||
        !q.operation.entry ||
        q.operation.entry.id !== q.operation.recordId
      )
        throw new Error("local_data_invalid");
      if (q.sleepFollowUp)
        finishLiveSleep(q.operation.entry, followUp.stoppedAt);
      else
        finishFeed(
          q.operation.entry,
          followUp.stoppedAt,
          q.feedFollowUp!.amount,
        );
    } catch {
      throw new Error("local_data_invalid");
    }
  }
  if (state.snapshot) revision(state.snapshot.revision);
  if (
    state.transition &&
    (!state.transition.operationId ||
      !state.transition.userId ||
      !/^\/v[12]\//.test(state.transition.path ?? "") ||
      !["pending", "committed", "rejected"].includes(state.transition.phase))
  )
    throw new Error("local_data_invalid");
  return {
    ...state,
    records: (state.records ?? []).filter((q) =>
      matchesOrigin(q.origin, state.snapshot),
    ),
    transition: state.transition ?? null,
    draft: matchesOrigin(state.draft?.origin, state.snapshot)
      ? state.draft
      : null,
    queue: state.queue.filter((q) => matchesOrigin(q.origin, state.snapshot)),
  };
}
