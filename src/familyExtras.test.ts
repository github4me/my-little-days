import test from "node:test";
import assert from "node:assert/strict";
import * as fullState from "./family/fullState";
import { initialState } from "./domain";
import { prepareOwnerSeed, serializeOwnerSeed } from "./family/ownerSeed";
import {
  FAMILY_AVATAR_MAX_BYTES,
  extraRecordCounts,
  validateAvatarDataUrl,
  validateExtraRecord,
  validateExtraRecords,
  type FamilyExtraRecord,
} from "./family/extras";
import type { FullFamilySnapshot, RecordOperation } from "./family/contracts";
import {
  emptyPilotState,
  revokeCache,
  parseStoredPilot,
} from "./family/pilotState";

test("new activation seed preserves reviewed shared extras without changing legacy seed bytes", () => {
  const extras: FamilyExtraRecord[] = [
    { id: "avatar", kind: "avatar", dataUrl: null },
  ];
  const legacy = prepareOwnerSeed(
    initialState,
    "family@example.test",
    "owner@example.test",
  );
  const current = prepareOwnerSeed(
    initialState,
    "family@example.test",
    "owner@example.test",
    extras,
  );
  assert.equal(current.extrasSchemaVersion, 1);
  assert.deepEqual(current.extraRecords, extras);
  assert.equal(serializeOwnerSeed(legacy), JSON.stringify(legacy));
  assert.deepEqual(
    JSON.parse(serializeOwnerSeed(current)).extraRecords,
    extras,
  );
});

test("new activation requires explicit extras capability before clearing personal data", () => {
  const capabilities = {
    schemaVersion: 2 as const,
    recordKinds: ["feed", "diaper", "sleep", "growth", "milestone", "care"],
    maxSeedBytes: 33554432,
  };
  assert.throws(
    () => fullState.requireExtraCapabilities(capabilities),
    /extras_sharing_unavailable/,
  );
  assert.equal(
    fullState.requireExtraCapabilities({
      ...capabilities,
      extrasSchemaVersion: 1,
    }).extrasSchemaVersion,
    1,
  );
});

const settings = {
  kind: "feed" as const,
  mode: "once" as const,
  title: "Milk",
  minutes: 20,
  dailyTime: "",
  silent: false,
};
const png = "data:image/png;base64,iVBORw0KGgo=";
const metadata = {
  version: "AAAAAAAAAAA=",
  recordedBy: "other",
  lastEditedBy: "other",
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
      babyBirthDate: null,
      profileVersion: "AAAA",
    },
    profile: initialState.profile,
    members: [
      {
        id: "me",
        membershipId: "grant",
        displayName: "Owner",
        email: "me@example.test",
        role: "owner",
        status: "active",
        endedAt: null,
      },
    ],
    invitations: [],
    feeds: [],
    ownershipTransfer: null,
    entries: [],
    careRecords: [],
    extrasSchemaVersion: 1,
    extraRecords: [
      {
        ...metadata,
        record: {
          id: "play-existing",
          kind: "play-checkin",
          day: "2026-09-16",
          activityId: "look-at-faces",
        },
      },
    ],
  };
}
function operation(record: FamilyExtraRecord): RecordOperation {
  return {
    operationId: "op",
    recordId: record.id,
    membershipId: "grant",
    historyId: "history",
    kind: "create",
    collection: "extra",
    extraRecord: record,
  };
}

test("avatar upload accepts only bounded supported image bytes, never references to local or remote files", () => {
  assert.equal(validateAvatarDataUrl(png), png);
  for (const invalid of [
    "file:///private.jpg",
    "https://example.test/avatar.jpg",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/jpeg;base64,iVBORw0KGgo=",
    "data:image/png;base64,iVBORw0KGgo==",
    "data:image/png;base64,iVBORw0KGgp=",
  ]) {
    assert.throws(() => validateAvatarDataUrl(invalid), /invalid_extra_record/);
  }
  const large = Buffer.alloc(FAMILY_AVATAR_MAX_BYTES + 1);
  Buffer.from([255, 216, 255]).copy(large);
  assert.throws(
    () =>
      validateAvatarDataUrl(
        `data:image/jpeg;base64,${large.toString("base64")}`,
      ),
    /invalid_extra_record/,
  );
});

test("extra validation preserves future activity IDs but rejects duplicates, impossible dates, collisions and unexpected private fields", () => {
  assert.deepEqual(
    validateExtraRecord({
      id: "play-selection",
      kind: "play-selection",
      selection: { included: ["future-activity"], excluded: [] },
    }),
    {
      id: "play-selection",
      kind: "play-selection",
      selection: { included: ["future-activity"], excluded: [] },
    },
  );
  for (const record of [
    {
      id: "play-selection",
      kind: "play-selection",
      selection: { included: ["a", "a"], excluded: [] },
    },
    {
      id: "play-selection",
      kind: "play-selection",
      selection: { included: ["a"], excluded: ["a"] },
    },
    { id: "x", kind: "play-checkin", day: "2026-02-30", activityId: "look" },
    {
      id: "avatar",
      kind: "play-checkin",
      day: "2026-02-28",
      activityId: "look",
    },
    { id: "avatar", kind: "avatar", dataUrl: null, fileUri: "private" },
    {
      id: "x".repeat(129),
      kind: "play-checkin",
      day: "2026-02-28",
      activityId: "look",
    },
  ])
    assert.throws(() => validateExtraRecord(record), /invalid_extra_record/);
  assert.throws(
    () =>
      validateExtraRecords([
        { id: "avatar", kind: "avatar", dataUrl: null },
        { id: "avatar", kind: "avatar", dataUrl: null },
      ]),
    /invalid_extra_record/,
  );
});

test("one-time reminders preserve absolute due dates and cannot silently rebase on another phone", () => {
  const record = {
    id: "reminder-1",
    kind: "reminder",
    settings,
    onceAt: "2026-09-16T07:00:00.000Z",
  };
  assert.deepEqual(validateExtraRecord(record), record);
  for (const invalid of [
    { ...record, onceAt: undefined },
    { ...record, onceAt: "2026-02-30T07:00:00Z" },
    { ...record, onceAt: "not-a-date" },
    { ...record, settings: { ...settings, mode: "daily", dailyTime: "07:00" } },
    { ...record, settings: { ...settings, accessToken: "private" } },
    {
      id: "reminder-1",
      kind: "reminder",
      settings: { ...settings, mode: "after-feed", kind: "diaper" },
    },
  ])
    assert.throws(() => validateExtraRecord(invalid), /invalid_extra_record/);
});

test("extras are detached from the review and legacy reserialization keeps absent optional fields absent", () => {
  const records: FamilyExtraRecord[] = [
    {
      id: "play-selection",
      kind: "play-selection",
      selection: { included: ["future"], excluded: [] },
    },
  ];
  const draft = prepareOwnerSeed(
    initialState,
    "person@example.test",
    "me@example.test",
    records,
  );
  (
    records[0] as Extract<FamilyExtraRecord, { kind: "play-selection" }>
  ).selection.included.push("later");
  assert.deepEqual(
    JSON.parse(serializeOwnerSeed(draft)).extraRecords[0].selection.included,
    ["future"],
  );
  const old = prepareOwnerSeed(
    initialState,
    "person@example.test",
    "me@example.test",
  );
  assert.equal("extraRecords" in JSON.parse(serializeOwnerSeed(old)), false);
  assert.throws(
    () => serializeOwnerSeed({ ...old, extrasSchemaVersion: 1 }),
    /owner_invalid_data/,
  );
  assert.deepEqual(extraRecordCounts(draft.extraRecords!), {
    avatar: 0,
    reminders: 0,
    playCheckins: 0,
    playSelection: 1,
    reminderSettings: 0,
    total: 1,
  });
});

test("shared extra operations preserve medical records, author metadata and family isolation", () => {
  const state = fullState.applyFullSnapshot(emptyPilotState(), snapshot());
  const next = fullState.enqueueRecord(
    state,
    operation({
      id: "new-checkin",
      kind: "play-checkin",
      day: "2026-09-16",
      activityId: "future",
    }),
  );
  assert.equal(fullState.projectedFullState(next)?.careRecords?.length, 0);
  const extras = fullState.projectedExtraRecords(next);
  assert.equal(extras.length, 2);
  assert.equal(
    extras.find((r) => r.record.id === "new-checkin")?.recordedBy,
    "me",
  );
  assert.equal(fullState.recordsForSend(state, next).length, 0);
  const durable = parseStoredPilot(JSON.stringify(next));
  assert.equal(
    fullState.recordsForSend(durable, durable)[0].operation.operationId,
    "op",
  );
  assert.deepEqual(fullState.projectedExtraRecords(revokeCache(next)), []);
  const switched = snapshot();
  switched.family.id = "another-family";
  const replaced = fullState.applyFullSnapshot(next, switched);
  assert.equal(replaced.records?.length, 0);
  assert.equal(fullState.projectedExtraRecords(replaced).length, 1);
});

test("members may add their own reminders/check-ins, but not edit other members or owner-only shared settings", () => {
  const shared = snapshot();
  shared.family.role = "caregiver";
  shared.members[0].role = "caregiver";
  const state = fullState.applyFullSnapshot(emptyPilotState(), shared);
  assert.equal(
    fullState.canEditRecord(shared, "extra", "play-existing"),
    false,
  );
  assert.throws(
    () =>
      fullState.enqueueRecord(state, {
        ...operation({
          id: "play-existing",
          kind: "play-checkin",
          day: "2026-09-16",
          activityId: "look",
        }),
        kind: "update",
        baseVersion: metadata.version,
      }),
    /record_forbidden/,
  );
  for (const record of [
    { id: "avatar", kind: "avatar", dataUrl: null },
    {
      id: "play-selection",
      kind: "play-selection",
      selection: { included: [], excluded: [] },
    },
    { id: "reminder-settings", kind: "reminder-settings", settings: null },
  ] as FamilyExtraRecord[])
    assert.throws(
      () => fullState.enqueueRecord(state, operation(record)),
      /record_forbidden/,
    );
  assert.equal(
    fullState.enqueueRecord(
      state,
      operation({
        id: "mine",
        kind: "play-checkin",
        day: "2026-09-16",
        activityId: "look",
      }),
    ).records?.length,
    1,
  );
});

test("partial extras snapshots fail before activation and singleton deletion cannot prevent future updates", () => {
  for (const value of [
    { ...snapshot(), extraRecords: undefined },
    { ...snapshot(), extrasSchemaVersion: undefined },
  ])
    assert.throws(
      () => fullState.validateFullSnapshot(value),
      /extras_sharing_unavailable/,
    );
  const legacy = snapshot();
  delete legacy.extrasSchemaVersion;
  delete legacy.extraRecords;
  assert.equal(fullState.validateFullSnapshot(legacy).extraRecords, undefined);
  const owner = snapshot();
  owner.extraRecords!.push({
    ...metadata,
    record: { id: "avatar", kind: "avatar", dataUrl: png },
  });
  const state = fullState.applyFullSnapshot(emptyPilotState(), owner);
  assert.throws(
    () =>
      fullState.enqueueRecord(state, {
        ...operation({ id: "avatar", kind: "avatar", dataUrl: null }),
        kind: "delete",
        baseVersion: metadata.version,
        extraRecord: undefined,
      }),
    /invalid_extra_record/,
  );
});

test("an existing extra cannot change collection kind while preserving its author and record id", () => {
  const state = fullState.applyFullSnapshot(emptyPilotState(), snapshot());
  assert.throws(
    () =>
      fullState.enqueueRecord(state, {
        ...operation({
          id: "play-existing",
          kind: "reminder",
          settings,
          onceAt: "2026-09-16T07:00:00Z",
        }),
        kind: "update",
        baseVersion: metadata.version,
      }),
    /invalid_extra_record/,
  );
});

test("an extras-capable snapshot replaces a legacy snapshot at the same family revision", () => {
  const previous = snapshot();
  delete previous.extrasSchemaVersion;
  delete previous.extraRecords;
  const stored = fullState.applyFullSnapshot(emptyPilotState(), previous);
  const upgraded = fullState.applyFullSnapshot(stored, snapshot());
  assert.equal(
    (upgraded.snapshot as FullFamilySnapshot).extrasSchemaVersion,
    1,
  );
  assert.equal(
    fullState.projectedExtraRecords(upgraded)[0].record.id,
    "play-existing",
  );
});
