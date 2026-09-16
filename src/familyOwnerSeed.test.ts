import test from "node:test";
import assert from "node:assert/strict";
import { Entry, State, initialState } from "./domain";
import {
  OWNER_SEED_MAX_BYTES,
  prepareOwnerSeed,
  serializeOwnerSeed,
  summarizeOwnerSeed,
} from "./family/ownerSeed";

const ownEmail = "owner@example.test";
const recipient = "family@example.test";
const start = "2026-09-01T10:00:00.000Z";
const end = "2026-09-01T10:20:00.000Z";
const allRecords = (): State => ({
  schemaVersion: 1,
  profile: { name: "宝宝", birthDate: "2026-08-18", sex: "unspecified" },
  entries: [
    {
      id: "feed-bottle",
      type: "feed",
      start,
      end,
      amount: 80.5,
      feedKind: "expressed",
      note: "Original note",
    },
    {
      id: "feed-breast",
      type: "feed",
      start,
      end,
      feedKind: "breast-left",
      note: "",
    },
    { id: "diaper", type: "diaper", start, diaperKind: "mixed", note: "" },
    { id: "sleep", type: "sleep", start, end, note: "" },
    {
      id: "growth",
      type: "growth",
      start,
      weight: 3.725,
      length: 52.5,
      head: 36.2,
      note: "",
    },
    { id: "milestone", type: "milestone", start, title: "Smile", note: "" },
  ],
  careRecords: [
    {
      id: "temperature",
      kind: "temperature",
      time: start,
      note: "",
      temperature: 36.8,
      method: "armpit",
    },
    { id: "bath", kind: "bath", time: start, note: "" },
    { id: "wash", kind: "wash", time: start, note: "" },
    { id: "oral", kind: "oral", time: start, note: "" },
    { id: "nails", kind: "nails", time: start, note: "" },
  ],
});

test("owner seed preserves every supported record, ID, profile and decimal value", () => {
  const source = allRecords();
  const draft = prepareOwnerSeed(source, recipient, ownEmail);
  assert.deepEqual(draft.source, source);
  assert.deepEqual(draft.counts, {
    feed: 2,
    diaper: 1,
    sleep: 1,
    growth: 1,
    milestone: 1,
    care: 5,
    total: 11,
  });
  assert.deepEqual(JSON.parse(serializeOwnerSeed(draft)), draft);
});

test("owner seed is a detached validated snapshot, not the editable app state", () => {
  const source = allRecords();
  const draft = prepareOwnerSeed(source, recipient, ownEmail);
  source.profile.name = "Changed locally";
  source.entries[0].amount = 90;
  source.careRecords![0].temperature = 37.2;
  assert.equal(draft.source.profile.name, "宝宝");
  assert.equal(draft.source.entries[0].amount, 80.5);
  assert.equal(draft.source.careRecords![0].temperature, 36.8);
  draft.source.entries[0].note = "Changed in draft";
  assert.equal(source.entries[0].note, "Original note");
});

test("empty valid profile history remains empty without manufacturing default records", () => {
  const draft = prepareOwnerSeed(initialState, recipient, ownEmail);
  assert.equal(draft.counts.total, 0);
  assert.deepEqual(draft.source, initialState);
  assert.equal("careRecords" in draft.source, false);
});

test("recipient parsing normalizes and deduplicates across supported separators", () => {
  const draft = prepareOwnerSeed(
    initialState,
    " FAMILY@example.test;\n two@example.test，family@example.test； THREE@example.test ",
    " OWNER@example.test ",
  );
  assert.deepEqual(draft.inviteeEmails, [
    recipient,
    "two@example.test",
    "three@example.test",
  ]);
  assert.throws(
    () => prepareOwnerSeed(initialState, "OWNER@example.test", ownEmail),
    { message: "owner_self_invite" },
  );
});

test("owner seed rejects malformed, missing, self or excess recipients with safe errors", () => {
  for (const email of [
    "",
    " , ; ",
    "not-an-email",
    "a@@example.test",
    "Display <family@example.test>",
    ".a@example.test",
    "a..b@example.test",
    "a@-bad.test",
    "a@example..test",
    "a@localhost",
    `${"a".repeat(65)}@example.test`,
  ]) {
    assert.throws(() => prepareOwnerSeed(initialState, email, ownEmail), {
      message: "owner_invalid_email",
    });
  }
  assert.throws(() => prepareOwnerSeed(initialState, recipient, ""), {
    message: "owner_invalid_email",
  });
  assert.throws(
    () =>
      prepareOwnerSeed(
        initialState,
        Array.from({ length: 6 }, (_, i) => `family${i}@example.test`).join(
          ",",
        ),
        ownEmail,
      ),
    { message: "owner_recipient_limit" },
  );
  assert.equal(
    prepareOwnerSeed(
      initialState,
      Array.from({ length: 5 }, (_, i) => `family${i}@example.test`).join(","),
      ownEmail,
    ).inviteeEmails.length,
    5,
  );
});

test("five distinct recipients remain valid when entered more than once", () => {
  const emails = Array.from({ length: 5 }, (_, i) => `family${i}@example.test`);
  const draft = prepareOwnerSeed(
    initialState,
    [...emails, emails[0].toUpperCase(), emails[4]].join(";"),
    ownEmail,
  );
  assert.deepEqual(draft.inviteeEmails, emails);
});

test("legacy committed seed serialization preserves recipients for identical receipt retries", () => {
  const draft = prepareOwnerSeed(initialState, recipient, ownEmail);
  draft.inviteeEmails = Array.from(
    { length: 19 },
    (_, i) => `family${i}@example.test`,
  );
  assert.deepEqual(JSON.parse(serializeOwnerSeed(draft)), draft);
  assert.throws(
    () =>
      prepareOwnerSeed(draft.source, draft.inviteeEmails.join(","), ownEmail),
    { message: "owner_recipient_limit" },
  );
});

test("running feed and sleep are visible in summary but block preparation", () => {
  const running: Entry[] = [
    {
      id: "running-feed",
      type: "feed",
      start,
      feedRunning: true,
      feedKind: "formula",
      amount: 60,
      note: "",
    },
    { id: "running-sleep", type: "sleep", start, note: "" },
  ];
  for (const entries of [running.slice(0, 1), running.slice(1), running]) {
    const source = { ...initialState, entries };
    assert.equal(summarizeOwnerSeed(source).runningCount, entries.length);
    assert.throws(() => prepareOwnerSeed(source, recipient, ownEmail), {
      message: "owner_active_timer",
    });
    assert.equal(source.entries.length, entries.length);
  }
});

test("completed legacy feeds without an end or running flag remain valid", () => {
  const source = allRecords();
  delete source.entries[0].end;
  assert.equal(summarizeOwnerSeed(source).runningCount, 0);
  assert.equal(prepareOwnerSeed(source, recipient, ownEmail).counts.feed, 2);
});

test("invalid or unexpected data is rejected instead of silently lost or uploaded", () => {
  const source = allRecords();
  for (const value of [
    { ...source, extraPrivateData: "secret" },
    { ...source, profile: { ...source.profile, photoUri: "file:///private" } },
    { ...source, profile: { ...source.profile, birthDate: "2026-02-30" } },
    { ...source, entries: [source.entries[0], source.entries[0]] },
    { ...source, entries: [{ ...source.entries[0], amount: NaN }] },
    {
      ...source,
      careRecords: [{ ...source.careRecords![0], temperature: 99 }],
    },
    { ...source, entries: [{ ...source.entries[0], serverToken: "secret" }] },
  ]) {
    assert.throws(() => prepareOwnerSeed(value as State, recipient, ownEmail), {
      message: "owner_invalid_data",
    });
  }
});

test("canonical serialization is deterministic and only emits the source contract", () => {
  const source = allRecords();
  const draft = prepareOwnerSeed(source, recipient, ownEmail);
  const differentlyOrdered = {
    careRecords: source.careRecords,
    entries: source.entries,
    profile: source.profile,
    schemaVersion: 1 as const,
  };
  assert.equal(
    serializeOwnerSeed(draft),
    serializeOwnerSeed(
      prepareOwnerSeed(differentlyOrdered, recipient, ownEmail),
    ),
  );
  assert.equal(
    serializeOwnerSeed({
      ...draft,
      secret: "not part of payload",
    } as typeof draft),
    serializeOwnerSeed(draft),
  );
  draft.counts.total = 999;
  assert.equal(JSON.parse(serializeOwnerSeed(draft)).counts.total, 11);
  draft.source.entries[0].feedRunning = true;
  delete draft.source.entries[0].end;
  assert.throws(() => serializeOwnerSeed(draft), {
    message: "owner_active_timer",
  });
});

test("owner seed size limit measures UTF-8 bytes rather than characters", () => {
  const source: State = {
    ...initialState,
    entries: Array.from({ length: 400 }, (_, index) => ({
      id: `note-${index}`,
      type: "milestone",
      start,
      title: "Note",
      note: "a".repeat(10000),
    })),
  };
  const draft = prepareOwnerSeed(source, recipient, ownEmail);
  assert.ok(
    Buffer.byteLength(serializeOwnerSeed(draft), "utf8") < OWNER_SEED_MAX_BYTES,
  );
  for (const entry of source.entries) entry.note = "中".repeat(10000);
  assert.ok(JSON.stringify(source).length < OWNER_SEED_MAX_BYTES);
  assert.throws(() => prepareOwnerSeed(source, recipient, ownEmail), {
    message: "owner_data_too_large",
  });
  for (const entry of draft.source.entries) entry.note = "😀".repeat(5000);
  assert.doesNotThrow(() => serializeOwnerSeed(draft));
  draft.source.entries.push(
    ...source.entries.map((entry, index) => ({
      ...entry,
      id: `more-${index}`,
    })),
  );
  assert.throws(() => serializeOwnerSeed(draft), {
    message: "owner_data_too_large",
  });
});
