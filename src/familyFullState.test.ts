import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptRecordReceipt,
  applyFullSnapshot,
  canEditRecord,
  enqueueRecord,
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
test("full snapshot preserves all domain fields, numeric precision, source IDs and independent running sleeps", () => {
  const result = validateFullSnapshot(snapshot());
  assert.deepEqual(result, snapshot());
  assert.equal(
    projectedFullState(applyFullSnapshot(emptyPilotState(), result))?.entries
      .length,
    6,
  );
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
