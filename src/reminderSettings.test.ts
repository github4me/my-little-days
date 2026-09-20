import test from "node:test";
import assert from "node:assert/strict";
import {
  parseReminderSettings,
  reminderContentVersion,
  reminderNotificationFingerprint,
  reminderRevision,
  reminderRuleId,
  settingsFromReminderData,
  type ReminderSettings,
} from "./reminderSettings";

const automatic: ReminderSettings = {
  kind: "feed",
  mode: "after-feed",
  title: "喂养提醒",
  minutes: 120,
  dailyTime: "",
  silent: true,
};

test("reminder settings round-trip only supported configurations", () => {
  assert.deepEqual(parseReminderSettings(automatic), automatic);
  assert.deepEqual(
    parseReminderSettings({
      ...automatic,
      kind: "sleep",
      mode: "daily",
      dailyTime: "21:30",
    }),
    { ...automatic, kind: "sleep", mode: "daily", dailyTime: "21:30" },
  );
  assert.deepEqual(
    parseReminderSettings({ ...automatic, kind: "喂养" }),
    automatic,
  );
  assert.deepEqual(
    settingsFromReminderData("喂养提醒", {
      reminderMode: "after-feed",
      minutes: 120,
      silent: true,
    }),
    automatic,
  );
});

test("notification fingerprints version localized content without changing user rules", () => {
  const trigger = {
    type: "date",
    time: Date.parse("2026-09-20T12:00:00Z"),
  } as const;
  const english = reminderNotificationFingerprint(
    automatic,
    trigger,
    "en",
    "en-AU",
  );
  const japanese = reminderNotificationFingerprint(
    automatic,
    trigger,
    "ja",
    "ja-JP",
  );
  assert.notEqual(english, japanese);
  assert.equal(reminderContentVersion, 1);
  assert.match(japanese, /喂养提醒/);
  assert.deepEqual(JSON.parse(japanese).trigger, trigger);
  assert.equal(JSON.parse(japanese).formattingLocale, "ja-JP");
  assert.notEqual(
    reminderNotificationFingerprint(automatic, trigger, "en", "en-AU"),
    reminderNotificationFingerprint(automatic, trigger, "en", "en-US"),
  );
});

test("reminder settings reject incomplete, invalid, and incompatible values", () => {
  for (const value of [
    null,
    { ...automatic, minutes: 0 },
    { ...automatic, silent: "yes" },
    { ...automatic, kind: "sleep" },
    { ...automatic, mode: "daily", dailyTime: "9:30" },
  ])
    assert.equal(parseReminderSettings(value), null);
});

test("logical reminder metadata is stable and rejects malformed stored values", () => {
  assert.equal(reminderRuleId("native", undefined), "native");
  assert.equal(
    reminderRuleId("replacement", { reminderRuleId: "stable" }),
    "stable",
  );
  assert.equal(
    reminderRuleId("auto-native", {
      reminderMode: "after-feed",
      reminderRuleId: "unexpected",
    }),
    "auto-feed",
  );
  assert.equal(reminderRuleId("native", { reminderRuleId: "" }), "native");
  assert.equal(
    reminderRuleId("native", { reminderRuleId: "auto-feed" }),
    "native",
  );
  assert.equal(
    reminderRuleId("native", { reminderRuleId: "not safe" }),
    "native",
  );
  assert.equal(reminderRevision({ reminderRevision: 2 }), 2);
  for (const value of [-1, 1.5, Number.NaN, "2"])
    assert.equal(reminderRevision({ reminderRevision: value }), 0);
});
