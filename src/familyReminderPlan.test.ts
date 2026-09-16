import test from "node:test";
import assert from "node:assert/strict";
import {
  familyReminderPlans,
  absoluteReminderTime,
  captureScheduledReminderRecords,
} from "./family/familyReminderPlan";
import type { FamilyExtraRecord } from "./family/extras";
import type { Entry } from "./domain";

const settings = {
  kind: "feed",
  mode: "once",
  title: "Feed",
  minutes: 30,
  dailyTime: "",
  silent: true,
} as const;
const now = Date.parse("2026-09-16T01:00:00Z");

test("family reminders retain absolute once time and never replay an expired occurrence", () => {
  const records: FamilyExtraRecord[] = [
    {
      id: "future",
      kind: "reminder",
      settings,
      onceAt: "2026-09-16T01:30:00Z",
    },
    { id: "past", kind: "reminder", settings, onceAt: "2026-09-16T00:30:00Z" },
  ];
  const plans = familyReminderPlans(records, [], now);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].recordId, "future");
  assert.deepEqual(plans[0].trigger, {
    type: "date",
    time: Date.parse("2026-09-16T01:30:00Z"),
  });
  assert.equal(familyReminderPlans(records, [], now + 30 * 60_000).length, 0);
});

test("shared daily reminders use local clock and after-feed uses the latest family feed only once", () => {
  const records: FamilyExtraRecord[] = [
    {
      id: "daily",
      kind: "reminder",
      settings: { ...settings, mode: "daily", dailyTime: "21:45" },
    },
    {
      id: "auto",
      kind: "reminder",
      settings: { ...settings, mode: "after-feed" },
    },
  ];
  const feeds = [
    { id: "f", type: "feed", start: "2026-09-16T00:45:00Z" },
  ] as Entry[];
  const plans = familyReminderPlans(records, feeds, now);
  assert.deepEqual(plans.find((p) => p.recordId === "daily")?.trigger, {
    type: "daily",
    hour: 21,
    minute: 45,
  });
  assert.deepEqual(plans.find((p) => p.recordId === "auto")?.trigger, {
    type: "date",
    time: Date.parse("2026-09-16T01:15:00Z"),
  });
  assert.deepEqual(
    familyReminderPlans(records, feeds, now + 30 * 60_000).map(
      (p) => p.recordId,
    ),
    ["daily"],
  );
  assert.deepEqual(
    familyReminderPlans(records, [], now).map((p) => p.recordId),
    ["daily"],
  );
});

test("notification comparison fingerprints are stable across refresh and detect edits", () => {
  const record: FamilyExtraRecord = {
    id: "d",
    kind: "reminder",
    settings: { ...settings, mode: "daily", dailyTime: "10:00" },
  };
  const first = familyReminderPlans([record], [], now)[0];
  const refresh = familyReminderPlans([record], [], now + 60_000)[0];
  assert.equal(first.fingerprint, refresh.fingerprint);
  assert.notEqual(
    first.fingerprint,
    familyReminderPlans(
      [{ ...record, settings: { ...record.settings, silent: false } }],
      [],
      now,
    )[0].fingerprint,
  );
});

test("capture extracts real due dates but never invents an absolute time from a relative legacy interval", () => {
  assert.equal(
    absoluteReminderTime(
      { onceAt: "2026-09-16T01:30:00Z" },
      { type: "timeInterval", seconds: 1800 },
    ),
    "2026-09-16T01:30:00.000Z",
  );
  assert.equal(
    absoluteReminderTime(
      {},
      { type: "date", value: Date.parse("2026-09-16T01:30:00Z") },
    ),
    "2026-09-16T01:30:00.000Z",
  );
  assert.equal(
    absoluteReminderTime({}, { type: "timeInterval", seconds: 1800 }),
    null,
  );
  assert.equal(
    absoluteReminderTime({}, { type: "daily", hour: 10, minute: 30 }),
    null,
  );
});

test("migration captures stable reminder rules, ignores family schedules and deduplicates auto-feed occurrences", () => {
  const dailyData = {
    reminderKind: "feed",
    reminderMode: "daily",
    minutes: 30,
    dailyTime: "10:00",
    silent: true,
  };
  const scheduled = [
    {
      identifier: "z",
      content: { title: "Daily", data: dailyData },
      trigger: { type: "daily", hour: 10, minute: 0 },
    },
    {
      identifier: "once",
      content: {
        title: "Once",
        data: {
          ...dailyData,
          reminderMode: "once",
          dailyTime: "",
          onceAt: "2026-09-16T01:30:00Z",
        },
      },
      trigger: { type: "timeInterval", seconds: 1800 },
    },
    {
      identifier: "old-auto",
      content: {
        title: "Old",
        data: { ...dailyData, reminderMode: "after-feed", dailyTime: "" },
      },
      trigger: { type: "timeInterval", seconds: 1800 },
    },
    {
      identifier: "family",
      content: { title: "Private family", data: { familyReminder: true } },
      trigger: null,
    },
  ];
  const automatic = {
    ...settings,
    mode: "after-feed" as const,
    title: "Current auto",
  };
  const records = captureScheduledReminderRecords(scheduled, automatic);
  assert.deepEqual(
    records.map((record) => record.id),
    ["reminder-auto-feed", "reminder-once", "reminder-z"],
  );
  assert.deepEqual(records[0], {
    id: "reminder-auto-feed",
    kind: "reminder",
    settings: automatic,
  });
  assert.deepEqual(
    captureScheduledReminderRecords([...scheduled].reverse(), automatic),
    records,
  );
  assert.equal(
    (records[1] as { onceAt: string }).onceAt,
    "2026-09-16T01:30:00.000Z",
  );
});

test("migration blocks unknown legacy once time instead of losing or delaying that reminder", () => {
  assert.throws(
    () =>
      captureScheduledReminderRecords(
        [
          {
            identifier: "old",
            content: {
              title: "Old reminder",
              data: {
                reminderKind: "feed",
                reminderMode: "once",
                minutes: 30,
                dailyTime: "",
                silent: true,
              },
            },
            trigger: { type: "timeInterval", seconds: 1800 },
          },
        ],
        null,
      ),
    /legacy_reminder_time_unknown/,
  );
});
