import test from "node:test";
import assert from "node:assert/strict";
import { createFamilyBackup } from "./family/backup";
import type { FullFamilySnapshot } from "./family/contracts";
import { validateState } from "./domain";

function snapshot(): FullFamilySnapshot {
  return {
    schemaVersion: 2,
    careSchemaVersion: 2,
    historyId: "history-1",
    revision: "42",
    family: {
      id: "family-1",
      membershipId: "grant-1",
      role: "caregiver",
      babyName: "Baby",
      babyBirthDate: "2026-08-01",
      profileVersion: "AAAA",
    },
    profile: { name: "Baby", birthDate: "2026-08-01", sex: "female" },
    members: [
      {
        id: "member-1",
        membershipId: "grant-1",
        displayName: "Family member",
        email: "private@example.test",
        role: "caregiver",
        status: "active",
        endedAt: null,
      },
    ],
    invitations: [
      {
        id: "invitation-1",
        email: "invitee@example.test",
        expiresAt: "2026-10-01T00:00:00Z",
        status: "pending",
      },
    ],
    ownershipTransfer: null,
    feeds: [],
    entries: [
      {
        version: "AAAB",
        recordedBy: "member-1",
        lastEditedBy: "member-1",
        entry: {
          id: "feed-1",
          type: "feed",
          start: "2026-09-20T01:00:00Z",
          end: "2026-09-20T01:15:00Z",
          feedKind: "expressed",
          amount: 87.125,
          note: "",
        },
      },
    ],
    careRecords: [
      {
        version: "AAAC",
        recordedBy: "member-1",
        lastEditedBy: "member-1",
        record: {
          id: "care-1",
          kind: "bath",
          time: "2026-09-20T02:00:00Z",
          note: "",
        },
      },
    ],
    extrasSchemaVersion: 1,
    extraRecords: [
      {
        version: "AAAD",
        recordedBy: "member-1",
        lastEditedBy: "member-1",
        record: {
          id: "avatar",
          kind: "avatar",
          dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        },
      },
      {
        version: "AAAE",
        recordedBy: "member-1",
        lastEditedBy: "member-1",
        record: {
          id: "reminder-1",
          kind: "reminder",
          settings: {
            kind: "feed",
            mode: "once",
            title: "Milk",
            minutes: 20,
            dailyTime: "",
            silent: false,
          },
          onceAt: "2026-09-20T03:00:00Z",
        },
      },
    ],
  };
}

test("family backup preserves confirmed records and provenance without account roster", () => {
  const current = snapshot();
  const document = createFamilyBackup(current, "2026-09-22T00:00:00.000Z");
  assert.deepEqual(document.family, {
    id: "family-1",
    historyId: "history-1",
    revision: "42",
  });
  assert.equal(document.format, "my-little-days-family-backup");
  assert.equal(document.formatVersion, 1);
  assert.equal(document.entries[0].entry.amount, 87.125);
  assert.deepEqual(document.careRecords, current.careRecords);
  assert.deepEqual(document.extraRecords, current.extraRecords);
  assert.equal(document.extraRecords.length, 2);
  const json = JSON.stringify(document);
  assert.doesNotMatch(json, /private@example\.test|invitee@example\.test/);
  assert.equal("members" in document, false);
  assert.equal("invitations" in document, false);
  // Family exports must not accidentally enter the personal replacement path.
  assert.throws(() => validateState(JSON.parse(json)));
});

test("family backup refuses partial legacy projections and corrupt records", () => {
  const current = snapshot();
  assert.throws(
    () => createFamilyBackup({ ...current, careSchemaVersion: 1 }),
    /supplement_sharing_unavailable/,
  );
  assert.throws(
    () =>
      createFamilyBackup({
        ...current,
        extrasSchemaVersion: undefined,
        extraRecords: undefined,
      }),
    /extras_sharing_unavailable/,
  );
  assert.throws(() =>
    createFamilyBackup({
      ...current,
      entries: [
        {
          ...current.entries[0],
          entry: { ...current.entries[0].entry, amount: 3000 },
        },
      ],
    }),
  );
});
