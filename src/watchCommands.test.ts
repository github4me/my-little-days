import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { initialState, type Entry } from "./domain";
import {
  applyPersonalWatchCommand,
  parseWatchCommand,
  type WatchCommand,
} from "./watchProtocol";
import {
  enqueueFamilyWatchCommand,
  familyWatchReceipts,
  reconcileWatchReceipts,
} from "./watchFamily";
import { emptyPilotState, revokeCache } from "./family/pilotState";
import {
  acceptRecordReceipt,
  applyFullSnapshot,
  projectedFullState,
  recordsForSend,
} from "./family/fullState";
import type { FullFamilySnapshot } from "./family/contracts";

const start = "2026-09-18T01:00:00.000Z";
const now = Date.parse(start) + 120000;
const commandId = "11111111-1111-4111-8111-111111111111";
const stopId = "22222222-2222-4222-8222-222222222222";
const recordId = "33333333-3333-4333-8333-333333333333";
const entry: Entry = { id: recordId, type: "sleep", start, note: "" };
function command(overrides: Partial<WatchCommand> = {}): WatchCommand {
  return {
    schemaVersion: 1,
    commandId,
    recordId,
    workspaceKey: "test-workspace",
    generation: 1,
    createdAt: start,
    kind: "create",
    entry,
    ...overrides,
  };
}
function snapshot(): FullFamilySnapshot {
  return {
    schemaVersion: 2,
    watchRecordingEnabled: true,
    conflictReplacementEnabled: true,
    historyId: "history",
    revision: "1",
    family: {
      id: "family",
      babyName: "Baby",
      role: "owner",
      membershipId: "grant",
      babyBirthDate: null,
      profileVersion: "profile",
    },
    profile: initialState.profile,
    members: [
      {
        id: "owner",
        displayName: "Parent",
        email: null,
        role: "owner",
        membershipId: "grant",
        status: "active",
        endedAt: null,
      },
    ],
    entries: [],
    careRecords: [],
    feeds: [],
    invitations: [],
    ownershipTransfer: null,
  };
}
const state = () => ({ ...emptyPilotState(), snapshot: snapshot() });
test("Swift wire fixtures satisfy the phone domain contract, including empty notes and bottle placeholder volume", () => {
  const nappy = parseWatchCommand(
    fs.readFileSync(
      path.join(process.cwd(), "watch/Fixtures/command-v1.json"),
      "utf8",
    ),
  );
  const feed = parseWatchCommand(
    fs.readFileSync(
      path.join(process.cwd(), "watch/Fixtures/feed-start-v1.json"),
      "utf8",
    ),
  );
  assert.equal(nappy.entry?.note, "");
  assert.equal(feed.entry?.feedRunning, true);
  assert.equal(feed.entry?.amount, 0);
  assert.equal(feed.entry?.note, "");
  assert.ok(feed.bridgeId);
});
test("Watch protocol restricts the record surface and preserves imported timer identities", () => {
  assert.equal(parseWatchCommand(JSON.stringify(command())).recordId, recordId);
  assert.equal(
    parseWatchCommand(
      JSON.stringify(
        command({
          recordId: "imported-timer",
          entry: { ...entry, id: "imported-timer" },
        }),
      ),
    ).recordId,
    "imported-timer",
  );
  for (const overrides of [
    { schemaVersion: 2 },
    { generation: 0 },
    { commandId: "not-uuid" },
    { entry: { ...entry, type: "milestone", title: "no" } },
    { entry: { ...entry, note: "private note" } },
  ])
    assert.throws(() =>
      parseWatchCommand(JSON.stringify({ ...command(), ...overrides })),
    );
});
test("Watch conflict resolution commands require an immutable source and reviewed version", () => {
  const valid = command({
    commandId: "44444444-4444-4444-8444-444444444444",
    kind: "resolve-conflict",
    entry: undefined,
    conflictOperationId: stopId,
    resolution: "replace",
    baseVersion: "reviewed-version",
  });
  assert.equal(parseWatchCommand(JSON.stringify(valid)).resolution, "replace");
  for (const invalid of [
    { ...valid, conflictOperationId: undefined },
    { ...valid, conflictOperationId: valid.commandId },
    { ...valid, resolution: "overwrite" },
    { ...valid, baseVersion: undefined },
    { ...valid, entry },
    {
      ...valid,
      resolution: "discard",
      baseVersion: "discard-must-not-adopt-a-version",
    },
  ])
    assert.throws(
      () => parseWatchCommand(JSON.stringify(invalid)),
      /invalid_watch_command/,
    );
});
test("personal ingestion commits a dedup receipt with exactly one record and rejects ID reuse", () => {
  const first = applyPersonalWatchCommand(initialState, {}, command(), now);
  const replay = applyPersonalWatchCommand(
    first.state,
    first.ledger,
    command(),
    now,
  );
  assert.equal(replay.state.entries.length, 1);
  assert.equal(replay.receipt.status, "saved");
  assert.throws(
    () =>
      applyPersonalWatchCommand(
        first.state,
        first.ledger,
        command({ entry: { ...entry, start: new Date(now).toISOString() } }),
        now,
      ),
    /operation_reused/,
  );
});
test("Watch live sleep obeys exact cancellation boundary and captured stop time", () => {
  for (const duration of [59999, 60000]) {
    const first = applyPersonalWatchCommand(initialState, {}, command(), now);
    const stoppedAt = new Date(Date.parse(start) + duration).toISOString();
    const stopped = applyPersonalWatchCommand(
      first.state,
      first.ledger,
      command({
        commandId: stopId,
        kind: "finish-sleep",
        entry: undefined,
        stoppedAt,
        dependsOn: commandId,
      }),
      now,
    );
    assert.equal(stopped.state.entries.length, duration < 60000 ? 0 : 1);
    if (duration === 60000)
      assert.equal(stopped.state.entries[0].end, stoppedAt);
  }
});
test("Watch rejects competing timers, future timestamps, and missing dependencies", () => {
  const first = applyPersonalWatchCommand(initialState, {}, command(), now);
  assert.throws(
    () =>
      applyPersonalWatchCommand(
        first.state,
        first.ledger,
        command({
          commandId: stopId,
          recordId: "other",
          entry: { ...entry, id: "other" },
        }),
        now,
      ),
    /running_sleep/,
  );
  assert.throws(
    () =>
      applyPersonalWatchCommand(
        initialState,
        {},
        command({ createdAt: new Date(now + 60001).toISOString() }),
        now,
      ),
    /invalid_record_time/,
  );
  assert.throws(
    () =>
      applyPersonalWatchCommand(
        initialState,
        {},
        command({
          commandId: stopId,
          kind: "finish-sleep",
          entry: undefined,
          stoppedAt: new Date(now).toISOString(),
          dependsOn: commandId,
        }),
        now,
      ),
    /watch_dependency_pending/,
  );
});
test("family command ID is the stable operation ID and a queued start can be stopped before receipt", () => {
  const created = enqueueFamilyWatchCommand(state(), command(), now);
  assert.equal(created.records?.[0].operation.operationId, commandId);
  assert.equal(enqueueFamilyWatchCommand(created, command(), now), created);
  const stopped = enqueueFamilyWatchCommand(
    created,
    command({
      commandId: stopId,
      kind: "finish-sleep",
      entry: undefined,
      stoppedAt: new Date(now).toISOString(),
      dependsOn: commandId,
    }),
    now,
  );
  assert.equal(stopped.records?.[0].sleepFollowUp?.operationId, stopId);
  assert.equal(stopped.records?.[0].operation.entry?.end, undefined);
  assert.equal(
    projectedFullState(stopped)?.entries[0].end,
    new Date(now).toISOString(),
  );
  assert.equal(familyWatchReceipts(stopped)[1].status, "pending");
});
test("server receipt updates durable Watch status, and late stop adopts only the unchanged own start", () => {
  const created = enqueueFamilyWatchCommand(state(), command(), now);
  const accepted = acceptRecordReceipt(created, commandId, {
    operationId: commandId,
    historyId: "history",
    revision: "2",
  });
  assert.equal(familyWatchReceipts(accepted)[0].status, "shared");
  const incoming = {
    ...snapshot(),
    revision: "2",
    entries: [
      { entry, version: "v1", recordedBy: "owner", lastEditedBy: "owner" },
    ],
  };
  const refreshed = applyFullSnapshot(accepted, incoming);
  const stop = command({
    commandId: stopId,
    kind: "finish-sleep",
    entry: undefined,
    stoppedAt: new Date(now).toISOString(),
    dependsOn: commandId,
  });
  const stopped = enqueueFamilyWatchCommand(refreshed, stop, now);
  assert.equal(stopped.records?.[0].operation.baseVersion, "v1");
  const edited: FullFamilySnapshot = {
    ...incoming,
    entries: [{ ...incoming.entries[0], lastEditedBy: "other" }],
  };
  assert.throws(
    () =>
      enqueueFamilyWatchCommand({ ...refreshed, snapshot: edited }, stop, now),
    /record_changed/,
  );
});
test("failed family receipt survives conflict dismissal; revocation removes its scope", () => {
  const created = enqueueFamilyWatchCommand(state(), command(), now);
  const failed = reconcileWatchReceipts({
    ...created,
    records: created.records!.map((q) => ({
      ...q,
      status: "failed",
      error: "record_changed",
    })),
  });
  assert.equal(
    familyWatchReceipts({ ...failed, records: [] })[0].status,
    "rejected",
  );
  assert.equal(revokeCache(failed).watchLedger, undefined);
});
test("Watch shows authoritative conflict details and queues replace or discard resolution", () => {
  const activeSnapshot = snapshot();
  activeSnapshot.entries = [
    {
      entry,
      version: "active-version",
      recordedBy: "owner",
      lastEditedBy: "owner",
    },
  ];
  const stop = command({
    commandId: stopId,
    kind: "finish-sleep",
    entry: undefined,
    stoppedAt: new Date(now).toISOString(),
    baseVersion: "active-version",
    expectedEntry: entry,
  });
  const pending = enqueueFamilyWatchCommand(
    { ...emptyPilotState(), snapshot: activeSnapshot },
    stop,
    now,
  );
  const currentEnd = new Date(now - 30_000).toISOString();
  const currentSnapshot: FullFamilySnapshot = {
    ...activeSnapshot,
    revision: "2",
    members: [
      ...activeSnapshot.members,
      {
        id: "other",
        displayName: "Other Parent",
        email: null,
        role: "caregiver",
        membershipId: "other-grant",
        status: "active",
        endedAt: null,
      },
    ],
    entries: [
      {
        entry: { ...entry, end: currentEnd },
        version: "current-version",
        recordedBy: "owner",
        lastEditedBy: "other",
        endedBy: "other",
      },
    ],
  };
  const staleConflict = reconcileWatchReceipts({
    ...pending,
    records: pending.records!.map((item) => ({
      ...item,
      status: "failed" as const,
      error: "timer_already_finished",
      serverConflict: true,
    })),
  });
  assert.equal(familyWatchReceipts(staleConflict)[0].conflict, undefined);
  const conflicted = reconcileWatchReceipts({
    ...staleConflict,
    snapshot: currentSnapshot,
  });
  const rejected = familyWatchReceipts(conflicted)[0];
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.conflict?.currentEditedBy, "Other Parent");
  assert.equal(rejected.conflict?.currentEntry.end, currentEnd);
  assert.equal(rejected.conflict?.proposedEntry.end, stop.stoppedAt);
  assert.equal(rejected.conflict?.canReplace, true);

  // Pausing new Watch recording must not strand an already issued conflict.
  currentSnapshot.watchRecordingEnabled = false;

  const replace = command({
    commandId: "44444444-4444-4444-8444-444444444444",
    kind: "resolve-conflict",
    entry: undefined,
    resolution: "replace",
    conflictOperationId: stopId,
    baseVersion: "current-version",
  });
  const replacing = enqueueFamilyWatchCommand(conflicted, replace, now);
  assert.equal(replacing.records![0].operation.operationId, replace.commandId);
  assert.equal(replacing.records![0].operation.replacesOperationId, stopId);
  assert.equal(recordsForSend(replacing, replacing).length, 1);
  assert.equal(
    familyWatchReceipts(replacing).find(
      (receipt) => receipt.commandId === replace.commandId,
    )?.status,
    "pending",
  );

  const discard = command({
    commandId: "55555555-5555-4555-8555-555555555555",
    kind: "resolve-conflict",
    entry: undefined,
    resolution: "discard",
    conflictOperationId: stopId,
    baseVersion: undefined,
  });
  const discarded = enqueueFamilyWatchCommand(conflicted, discard, now);
  assert.equal(discarded.records?.length, 0);
  assert.equal(
    familyWatchReceipts(discarded).find(
      (receipt) => receipt.commandId === discard.commandId,
    )?.status,
    "shared",
  );
});
test("bottle completion requires actual volume while breastfeeding keeps no estimate", () => {
  for (const feedKind of ["formula", "breast-left"] as const) {
    const feed: Entry = {
      ...entry,
      type: "feed",
      feedKind,
      feedRunning: true,
      ...(feedKind === "formula" ? { amount: 120 } : {}),
    };
    const first = applyPersonalWatchCommand(
      initialState,
      {},
      command({ entry: feed }),
      now,
    );
    const stop = command({
      commandId: stopId,
      kind: "finish-feed",
      entry: undefined,
      stoppedAt: new Date(now).toISOString(),
      amount: feedKind === "formula" ? 85 : undefined,
      dependsOn: commandId,
    });
    const result = applyPersonalWatchCommand(
      first.state,
      first.ledger,
      stop,
      now,
    );
    assert.equal(
      result.state.entries[0].amount,
      feedKind === "formula" ? 85 : undefined,
    );
    assert.equal(result.state.entries[0].feedRunning, undefined);
  }
});
