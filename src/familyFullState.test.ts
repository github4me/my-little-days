import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptRecordReceipt,
  applyFullSnapshot,
  canEditRecord,
  canControlSleep,
  canControlFeed,
  enqueueRecord,
  enqueueSleepFinish,
  enqueueFeedFinish,
  projectedFullState,
  recordsForSend,
  requireFullCapabilities,
  validateFullSnapshot,
} from "./family/fullState";
import {
  emptyPilotState,
  parseStoredPilot,
  revokeCache,
} from "./family/pilotState";
import type { FullFamilySnapshot, RecordOperation } from "./family/contracts";
import type { Entry } from "./domain";

const start = "2026-09-01T01:00:00.000Z";
const metadata = {
  version: "AAAAAAAABBB=",
  recordedBy: "owner",
  lastEditedBy: "owner",
};
function snapshot(): FullFamilySnapshot {
  return {
    schemaVersion: 2,
    crossMemberTimerCompletionEnabled: true,
    historyId: "history",
    revision: "1",
    family: {
      id: "family",
      membershipId: "grant",
      role: "owner",
      babyName: "Baby",
      babyBirthDate: "2026-08-01",
      profileVersion: "AAAAAAAABBB=",
    },
    profile: { name: "Baby", birthDate: "2026-08-01", sex: "female" },
    members: [
      {
        id: "owner",
        membershipId: "grant",
        displayName: "Parent",
        email: "parent@example.test",
        role: "owner",
        status: "active",
        endedAt: null,
      },
    ],
    invitations: [],
    feeds: [],
    ownershipTransfer: null,
    entries: [
      {
        entry: {
          id: "feed",
          type: "feed",
          start,
          feedKind: "expressed",
          amount: 87.125,
          note: "奶\nfull note",
        },
        ...metadata,
      },
      { entry: { id: "sleep", type: "sleep", start, note: "" }, ...metadata },
      {
        entry: { id: "sleep2", type: "sleep", start, note: "overlap" },
        ...metadata,
      },
      {
        entry: {
          id: "diaper",
          type: "diaper",
          start,
          diaperKind: "mixed",
          note: "",
        },
        ...metadata,
      },
      {
        entry: {
          id: "growth",
          type: "growth",
          start,
          weight: 3.725,
          length: 54.5,
          head: 35.6,
          note: "",
        },
        ...metadata,
      },
      {
        entry: {
          id: "milestone",
          type: "milestone",
          start,
          title: "Smile",
          note: "",
        },
        ...metadata,
      },
    ],
    careRecords: [
      {
        record: {
          id: "care",
          kind: "temperature",
          time: start,
          note: "🛁",
          temperature: 36.75,
          method: "ear",
        },
        ...metadata,
      },
    ],
  };
}
const operation = (entry: Entry): RecordOperation => ({
  operationId: "operation",
  recordId: entry.id,
  collection: "entry",
  kind: "update",
  baseVersion: metadata.version,
  entry,
  membershipId: "grant",
  historyId: "history",
});

test("supplement sharing requires explicit capability and survives offline queue/reload", () => {
  const value = snapshot();
  const op: RecordOperation = {
    operationId: "supp-op",
    recordId: "supp-record",
    collection: "care",
    kind: "create",
    membershipId: "grant",
    historyId: "history",
    careRecord: {
      id: "supp-record",
      kind: "supplement",
      time: start,
      note: "",
      supplements: ["vitamin-d", "probiotics"],
    },
  };
  assert.throws(
    () => enqueueRecord(applyFullSnapshot(emptyPilotState(), value), op),
    /supplement_sharing_unavailable/,
  );
  value.careSchemaVersion = 2;
  const queued = enqueueRecord(applyFullSnapshot(emptyPilotState(), value), op);
  const restored = parseStoredPilot(JSON.stringify(queued));
  assert.deepEqual(
    projectedFullState(restored)?.careRecords?.find(
      (r) => r.id === "supp-record",
    ),
    op.careRecord,
  );
  value.careRecords.push({ ...metadata, record: op.careRecord! });
  assert.deepEqual(
    validateFullSnapshot(value).careRecords[1].record,
    op.careRecord,
  );
  delete value.careSchemaVersion;
  assert.throws(
    () => validateFullSnapshot(value),
    /supplement_sharing_unavailable/,
  );
});
test("full snapshot preserves all domain fields, numeric precision, source IDs and independent running sleeps", () => {
  const result = validateFullSnapshot(snapshot());
  assert.deepEqual(result, snapshot());
  assert.equal(
    projectedFullState(applyFullSnapshot(emptyPilotState(), result))?.entries
      .length,
    6,
  );
});
test("full snapshot preserves timer end attribution and rejects malformed attribution", () => {
  const value = snapshot();
  value.entries[0].endedBy = "caregiver";
  assert.equal(validateFullSnapshot(value).entries[0].endedBy, "caregiver");
  (value.entries[0] as { endedBy?: unknown }).endedBy = "";
  assert.throws(() => validateFullSnapshot(value), /invalid_response/);
  (value.entries[0] as { endedBy?: unknown }).endedBy = 42;
  assert.throws(() => validateFullSnapshot(value), /invalid_response/);
  (
    value as { crossMemberTimerCompletionEnabled?: unknown }
  ).crossMemberTimerCompletionEnabled = "yes";
  assert.throws(() => validateFullSnapshot(value), /invalid_response/);
});
test("full capability and snapshot gate rejects legacy or partial domains", () => {
  assert.throws(
    () =>
      requireFullCapabilities({
        schemaVersion: 2,
        recordKinds: ["feed"],
        maxSeedBytes: 10485760,
      }),
    /full_sharing_unavailable/,
  );
  assert.throws(
    () =>
      validateFullSnapshot({
        ...snapshot(),
        schemaVersion: undefined,
      } as unknown as FullFamilySnapshot),
    /full_sharing_unavailable/,
  );
  assert.throws(
    () =>
      validateFullSnapshot({
        ...snapshot(),
        careRecords: undefined,
      } as unknown as FullFamilySnapshot),
    /full_sharing_unavailable/,
  );
});
test("saved full operation is detached, durable before send and retains same ID across restart", () => {
  const base = applyFullSnapshot(emptyPilotState(), snapshot());
  const edit = { ...snapshot().entries[0].entry, amount: 100.125 };
  const next = enqueueRecord(base, operation(edit));
  edit.amount = 999;
  assert.equal(recordsForSend(base, next).length, 0);
  const restarted = parseStoredPilot(JSON.stringify(next));
  assert.equal(
    recordsForSend(restarted, restarted)[0].operation.operationId,
    "operation",
  );
  assert.equal(
    projectedFullState(restarted)?.entries.find((e) => e.id === "feed")?.amount,
    100.125,
  );
  assert.equal(base.snapshot?.feeds.length, 0);
});
test("receipt acknowledgement requires a full snapshot at least as recent before clearing outbox", () => {
  const base = applyFullSnapshot(emptyPilotState(), snapshot());
  const queued = enqueueRecord(
    base,
    operation({ ...snapshot().entries[0].entry, amount: 101 }),
  );
  const accepted = acceptRecordReceipt(queued, "operation", {
    operationId: "operation",
    historyId: "history",
    revision: "3",
  });
  assert.equal(
    applyFullSnapshot(accepted, { ...snapshot(), revision: "2" }),
    accepted,
  );
  assert.equal(
    applyFullSnapshot(accepted, { ...snapshot(), revision: "3" }).records
      ?.length,
    0,
  );
  assert.throws(
    () =>
      acceptRecordReceipt(queued, "operation", {
        operationId: "operation",
        historyId: "other",
        revision: "3",
      }),
    /history_changed/,
  );
});
test("new membership and new family discard old full outbox and revocation leaves no recoverable payload", () => {
  const base = enqueueRecord(
    applyFullSnapshot(emptyPilotState(), snapshot()),
    operation(snapshot().entries[0].entry),
  );
  const next = snapshot();
  next.family.membershipId = "replacement";
  next.members[0].membershipId = "replacement";
  assert.equal(applyFullSnapshot(base, next).records?.length, 0);
  assert.equal(
    recordsForSend(base, applyFullSnapshot(emptyPilotState(), next)).length,
    0,
  );
  assert.equal(JSON.stringify(revokeCache(base)).includes("full note"), false);
  assert.equal(revokeCache(base).records?.length, 0);
});
test("member may edit own entries and care only, original author survives admin edits", () => {
  const value = snapshot();
  value.family.role = "caregiver";
  value.members[0].role = "caregiver";
  value.entries[0].recordedBy = "someone-else";
  value.careRecords[0].recordedBy = "someone-else";
  assert.equal(canEditRecord(value, "entry", "feed"), false);
  assert.equal(canEditRecord(value, "care", "care"), false);
  assert.throws(
    () =>
      enqueueRecord(
        applyFullSnapshot(emptyPilotState(), value),
        operation(value.entries[0].entry),
      ),
    /record_forbidden/,
  );
  value.family.role = "owner";
  assert.equal(canEditRecord(value, "entry", "feed"), true);
  assert.equal(
    validateFullSnapshot(value).entries[0].recordedBy,
    "someone-else",
  );
});
test("an unresolved lifecycle operation hides full records and blocks record submission", () => {
  const base = applyFullSnapshot(emptyPilotState(), snapshot());
  base.transition = {
    operationId: "create",
    kind: "join",
    path: "/v1/invitations/id/accept",
    body: {},
    userId: "owner",
    phase: "pending",
  };
  assert.equal(projectedFullState(base), null);
  assert.equal(recordsForSend(base, base).length, 0);
  assert.throws(
    () => enqueueRecord(base, operation(snapshot().entries[0].entry)),
    /transition_pending/,
  );
});

const stopped = (milliseconds: number) =>
  new Date(Date.parse(start) + milliseconds).toISOString();
function pendingSleep() {
  const base = applyFullSnapshot(emptyPilotState(), snapshot());
  return enqueueRecord(base, {
    ...operation({ id: "new-sleep", type: "sleep", start, note: "" }),
    kind: "create",
    baseVersion: undefined,
  });
}
function committedSleep(state: ReturnType<typeof pendingSleep>) {
  const incoming = snapshot();
  incoming.revision = "2";
  incoming.entries.push({
    ...metadata,
    version: "created-version",
    entry: state.records![0].operation.entry!,
  });
  return incoming;
}
test("pending sleep can stop immediately without changing the original operation, including restart", () => {
  const pending = pendingSleep();
  const original = JSON.stringify(pending.records![0].operation);
  assert.equal(canControlSleep(pending, "new-sleep"), true);
  const finished = enqueueSleepFinish(
    pending,
    "new-sleep",
    stopped(59_999),
    "stop-id",
  );
  assert.equal(canControlSleep(finished, "new-sleep"), false);
  assert.equal(
    projectedFullState(finished)?.entries.some((e) => e.id === "new-sleep"),
    false,
  );
  assert.equal(JSON.stringify(finished.records![0].operation), original);
  const restarted = parseStoredPilot(JSON.stringify(finished));
  assert.deepEqual(restarted.records, finished.records);
  assert.equal(
    JSON.stringify(recordsForSend(restarted, restarted)[0].operation),
    original,
  );
  assert.throws(
    () =>
      enqueueSleepFinish(restarted, "new-sleep", stopped(60_000), "another"),
    /record_pending/,
  );
});
test("accepted sleep create promotes a stable delete only after a sufficiently fresh snapshot", () => {
  const pending = pendingSleep();
  const stoppedState = enqueueSleepFinish(
    pending,
    "new-sleep",
    stopped(10_000),
    "stop-id",
  );
  const accepted = acceptRecordReceipt(stoppedState, "operation", {
    operationId: "operation",
    historyId: "history",
    revision: "2",
  });
  assert.equal(applyFullSnapshot(accepted, snapshot()), accepted);
  assert.equal(recordsForSend(accepted, accepted).length, 0);
  const promoted = applyFullSnapshot(accepted, committedSleep(pending));
  assert.equal(promoted.records?.length, 1);
  assert.deepEqual(promoted.records![0].operation, {
    operationId: "stop-id",
    recordId: "new-sleep",
    collection: "entry",
    kind: "delete",
    baseVersion: "created-version",
    membershipId: "grant",
    historyId: "history",
  });
  assert.equal(promoted.records![0].timerCompletion, undefined);
  assert.equal(promoted.records![0].sleepFollowUp, undefined);
  assert.equal(
    projectedFullState(promoted)?.entries.some((e) => e.id === "new-sleep"),
    false,
  );
});
test("a full minute queues a finished sleep and ordinary saved sleeps use their current row version", () => {
  const pending = pendingSleep();
  const finished = enqueueSleepFinish(
    pending,
    "new-sleep",
    stopped(60_000),
    "stop-id",
  );
  assert.equal(
    projectedFullState(finished)?.entries.find((e) => e.id === "new-sleep")
      ?.end,
    stopped(60_000),
  );
  const accepted = acceptRecordReceipt(finished, "operation", {
    operationId: "operation",
    historyId: "history",
    revision: "2",
  });
  const promoted = applyFullSnapshot(accepted, committedSleep(pending));
  assert.equal(promoted.records![0].operation.kind, "update");
  assert.equal(promoted.records![0].operation.entry?.end, stopped(60_000));
  const direct = enqueueSleepFinish(
    applyFullSnapshot(emptyPilotState(), snapshot()),
    "sleep",
    stopped(120_000),
    "direct-id",
  );
  assert.equal(direct.records![0].operation.baseVersion, metadata.version);
  assert.equal(direct.records![0].operation.entry?.end, stopped(120_000));
});
test("sleep completion never overwrites an intervening remote edit or deletion", () => {
  for (const change of ["edit", "delete", "author"] as const) {
    const pending = pendingSleep();
    const stoppedState = enqueueSleepFinish(
      pending,
      "new-sleep",
      stopped(10_000),
      "stop-id",
    );
    const accepted = acceptRecordReceipt(stoppedState, "operation", {
      operationId: "operation",
      historyId: "history",
      revision: "2",
    });
    const incoming = committedSleep(pending);
    const record = incoming.entries.at(-1)!;
    if (change === "edit")
      record.entry = { ...record.entry, note: "remote edit" };
    if (change === "delete") incoming.entries.pop();
    if (change === "author") record.lastEditedBy = "other-admin";
    const result = applyFullSnapshot(accepted, incoming);
    assert.equal(result.records![0].status, "failed");
    assert.equal(result.records![0].error, "record_changed");
    assert.equal(recordsForSend(result, result).length, 0);
  }
});
test("sleep follow-up is rejected across grants and on malformed local data", () => {
  const pending = enqueueSleepFinish(
    pendingSleep(),
    "new-sleep",
    stopped(1000),
    "stop-id",
  );
  const other = committedSleep(pending);
  other.family.membershipId = "other-grant";
  other.members[0].membershipId = "other-grant";
  assert.equal(applyFullSnapshot(pending, other).records?.length, 0);
  assert.equal(revokeCache(pending).records?.length, 0);
  const forbidden = snapshot();
  forbidden.family.role = "caregiver";
  forbidden.members[0].role = "caregiver";
  forbidden.entries[1].recordedBy = "someone-else";
  assert.equal(
    canControlSleep(applyFullSnapshot(emptyPilotState(), forbidden), "sleep"),
    true,
  );
  const crossMember = enqueueSleepFinish(
    applyFullSnapshot(emptyPilotState(), forbidden),
    "sleep",
    stopped(120_000),
    "cross-member-stop",
  );
  assert.equal(crossMember.records![0].timerCompletion, "sleep");
  assert.equal(crossMember.records![0].operation.entry?.end, stopped(120_000));
  const crossMemberQuickStop = enqueueSleepFinish(
    applyFullSnapshot(emptyPilotState(), forbidden),
    "sleep",
    stopped(30_000),
    "cross-member-quick-stop",
  );
  assert.equal(crossMemberQuickStop.records![0].operation.kind, "update");
  assert.equal(
    crossMemberQuickStop.records![0].operation.entry?.end,
    stopped(30_000),
  );
  const olderApi = { ...forbidden };
  delete olderApi.crossMemberTimerCompletionEnabled;
  const olderState = applyFullSnapshot(emptyPilotState(), olderApi);
  assert.equal(canControlSleep(olderState, "sleep"), false);
  assert.throws(
    () =>
      enqueueSleepFinish(
        olderState,
        "sleep",
        stopped(120_000),
        "unsupported-cross-member-stop",
      ),
    /record_forbidden/,
  );
  assert.throws(
    () =>
      enqueueRecord(
        applyFullSnapshot(emptyPilotState(), forbidden),
        operation({ ...forbidden.entries[1].entry, note: "not allowed" }),
      ),
    /record_forbidden/,
  );
  assert.throws(
    () =>
      parseStoredPilot(
        JSON.stringify({
          ...pending,
          records: [
            {
              ...pending.records![0],
              sleepFollowUp: { operationId: "stop-id", stoppedAt: "bad" },
            },
          ],
        }),
      ),
    /local_data_invalid/,
  );
});

function pendingFeed(breast = false) {
  const entry: Entry = {
    id: "new-feed",
    type: "feed",
    start,
    note: "Feed note",
    feedRunning: true,
    feedKind: breast ? "breast-left" : "formula",
    ...(breast ? {} : { amount: 120 }),
  };
  return enqueueRecord(applyFullSnapshot(emptyPilotState(), snapshot()), {
    ...operation(entry),
    kind: "create",
    baseVersion: undefined,
  });
}
test("pending feed completion keeps the chosen amount immediately and the original start immutable", () => {
  const pending = pendingFeed();
  const original = JSON.stringify(pending.records![0].operation);
  assert.equal(canControlFeed(pending, "new-feed"), true);
  const finished = enqueueFeedFinish(
    pending,
    "new-feed",
    stopped(20_000),
    85,
    "feed-stop",
  );
  const entry = projectedFullState(finished)?.entries.find(
    (e) => e.id === "new-feed",
  );
  assert.equal(entry?.amount, 85);
  assert.equal(entry?.end, stopped(20_000));
  assert.equal(entry?.feedRunning, undefined);
  assert.equal(canControlFeed(finished, "new-feed"), false);
  assert.equal(JSON.stringify(finished.records![0].operation), original);
  assert.deepEqual(
    parseStoredPilot(JSON.stringify(finished)).records,
    finished.records,
  );
  assert.equal(
    JSON.stringify(recordsForSend(finished, finished)[0].operation),
    original,
  );
  assert.throws(
    () =>
      enqueueFeedFinish(finished, "new-feed", stopped(30_000), 90, "duplicate"),
    /record_pending/,
  );
});
test("feed follow-up becomes a fresh versioned update after the original receipt and snapshot", () => {
  for (const breast of [false, true]) {
    const pending = pendingFeed(breast);
    const finished = enqueueFeedFinish(
      pending,
      "new-feed",
      stopped(120_000),
      breast ? undefined : 123.5,
      "feed-stop",
    );
    const accepted = acceptRecordReceipt(finished, "operation", {
      operationId: "operation",
      historyId: "history",
      revision: "2",
    });
    const promoted = applyFullSnapshot(accepted, committedSleep(pending));
    const op = promoted.records![0].operation;
    assert.equal(op.operationId, "feed-stop");
    assert.equal(op.kind, "update");
    assert.equal(op.baseVersion, "created-version");
    assert.equal(op.entry?.amount, breast ? undefined : 123.5);
    assert.equal(op.entry?.feedRunning, undefined);
    assert.equal(promoted.records![0].feedFollowUp, undefined);
  }
});
test("feed finish rejects stale dialog versions and malformed durable follow-ups", () => {
  const value = snapshot();
  value.entries[0].entry = { ...value.entries[0].entry, feedRunning: true };
  const base = applyFullSnapshot(emptyPilotState(), value);
  assert.throws(
    () =>
      enqueueFeedFinish(
        base,
        "feed",
        stopped(120_000),
        85,
        "stop",
        "old-version",
      ),
    /record_changed/,
  );
  const finished = enqueueFeedFinish(
    base,
    "feed",
    stopped(120_000),
    85,
    "stop",
    metadata.version,
  );
  assert.equal(finished.records![0].operation.baseVersion, metadata.version);
  assert.equal(finished.records![0].operation.entry?.amount, 85);
  value.family.role = "caregiver";
  value.members[0].role = "caregiver";
  value.entries[0].recordedBy = "other";
  assert.equal(
    canControlFeed(applyFullSnapshot(emptyPilotState(), value), "feed"),
    true,
  );
  const crossMember = enqueueFeedFinish(
    applyFullSnapshot(emptyPilotState(), value),
    "feed",
    stopped(120_000),
    90,
    "cross-member-feed-stop",
    metadata.version,
  );
  assert.equal(crossMember.records![0].timerCompletion, "feed");
  assert.equal(crossMember.records![0].operation.entry?.amount, 90);
  const followUp = enqueueFeedFinish(
    pendingFeed(),
    "new-feed",
    stopped(1000),
    85,
    "stop",
  );
  assert.throws(
    () =>
      parseStoredPilot(
        JSON.stringify({
          ...followUp,
          records: [
            {
              ...followUp.records![0],
              feedFollowUp: {
                operationId: "stop",
                stoppedAt: stopped(1000),
                amount: -5,
              },
            },
          ],
        }),
      ),
    /local_data_invalid/,
  );
});
test("feed completion preserves a remote winner and is never rebound to a replacement grant", () => {
  const pending = pendingFeed();
  const stoppedState = enqueueFeedFinish(
    pending,
    "new-feed",
    stopped(120_000),
    85,
    "stop",
  );
  const accepted = acceptRecordReceipt(stoppedState, "operation", {
    operationId: "operation",
    historyId: "history",
    revision: "2",
  });
  const edited = committedSleep(pending);
  edited.entries.at(-1)!.entry = {
    ...edited.entries.at(-1)!.entry,
    amount: 95,
  };
  const conflicted = applyFullSnapshot(accepted, edited);
  assert.equal(conflicted.records![0].status, "failed");
  assert.equal(conflicted.records![0].error, "record_changed");
  assert.equal(
    projectedFullState(conflicted)?.entries.find((e) => e.id === "new-feed")
      ?.amount,
    95,
  );
  edited.family.membershipId = "replacement";
  edited.members[0].membershipId = "replacement";
  assert.equal(applyFullSnapshot(stoppedState, edited).records?.length, 0);
  assert.equal(revokeCache(stoppedState).records?.length, 0);
});
test("Stop-captured feed content guards both pending and acknowledged starts with no captured version", () => {
  const pending = pendingFeed();
  const original = pending.records![0].operation.entry!;
  assert.throws(
    () =>
      enqueueFeedFinish(
        pending,
        "new-feed",
        stopped(120_000),
        85,
        "stop",
        undefined,
        { ...original, note: "older dialog" },
      ),
    /record_changed/,
  );
  const acknowledged = applyFullSnapshot(
    emptyPilotState(),
    committedSleep(pending),
  );
  const finished = enqueueFeedFinish(
    acknowledged,
    "new-feed",
    stopped(120_000),
    85,
    "stop",
    undefined,
    original,
  );
  assert.equal(finished.records![0].operation.entry?.amount, 85);
  const sameContentNewAuthor = committedSleep(pending);
  sameContentNewAuthor.entries.at(-1)!.lastEditedBy = "another-admin";
  assert.throws(
    () =>
      enqueueFeedFinish(
        applyFullSnapshot(emptyPilotState(), sameContentNewAuthor),
        "new-feed",
        stopped(120_000),
        85,
        "stop",
        undefined,
        original,
      ),
    /record_changed/,
  );
});
