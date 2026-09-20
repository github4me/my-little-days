import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const onceAt = "2026-09-21T08:30:00.000Z";

function fixture({ cancelFailures: configuredCancelFailures = {} } = {}) {
  let sequence = 0;
  let uuidSequence = 0;
  const calls = [];
  const cancelFailures = new Map(Object.entries(configuredCancelFailures));
  const scheduled = new Map([
    [
      "once-old",
      {
        identifier: "once-old",
        content: {
          title: "Mum's custom nap",
          body: "old body",
          data: {
            reminderMode: "once",
            reminderKind: "sleep",
            minutes: 30,
            dailyTime: "",
            silent: true,
            onceAt,
            reminderFingerprint: "old-content",
          },
        },
        trigger: { type: "date", value: Date.parse(onceAt) },
      },
    ],
    [
      "daily-old",
      {
        identifier: "daily-old",
        content: {
          title: "Vitamin D",
          body: "old body",
          data: {
            reminderMode: "daily",
            reminderKind: "diaper",
            minutes: 15,
            dailyTime: "09:15",
            silent: false,
            reminderFingerprint: "old-content",
          },
        },
        trigger: { type: "daily", hour: 9, minute: 15 },
      },
    ],
    [
      "family",
      {
        identifier: "family",
        content: { title: "Shared", data: { familyReminder: true } },
        trigger: { type: "daily", hour: 8, minute: 0 },
      },
    ],
  ]);
  const dependencies = {
    "expo-crypto": {
      randomUUID: () => `rule-${++uuidSequence}`,
    },
    "expo-notifications": {
      SchedulableTriggerInputTypes: { DATE: "date", DAILY: "daily" },
      IosAuthorizationStatus: { PROVISIONAL: 3 },
      AndroidImportance: { DEFAULT: 3 },
      setNotificationHandler: () => {},
      setNotificationChannelAsync: async () => {},
      requestPermissionsAsync: async () => ({ granted: true }),
      getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
      scheduleNotificationAsync: async (request) => {
        const identifier = `new-${++sequence}`;
        calls.push({ kind: "schedule", identifier, request });
        scheduled.set(identifier, {
          identifier,
          content: request.content,
          trigger: request.trigger,
        });
        return identifier;
      },
      cancelScheduledNotificationAsync: async (identifier) => {
        calls.push({ kind: "cancel", identifier });
        const remaining = cancelFailures.get(identifier) ?? 0;
        if (remaining > 0) {
          cancelFailures.set(identifier, remaining - 1);
          throw new Error(`cancel failed: ${identifier}`);
        }
        scheduled.delete(identifier);
      },
    },
    "react-native": { Platform: { OS: "ios" } },
    "./feedReminder": { feedReminderTime: () => null },
    "./locales": {
      localeDefinition: (locale) => ({ locale, formattingLocale: "en-US" }),
    },
    "./storage": {
      clearAutoFeedReminder: async () => {},
      loadAutoFeedReminder: async () => null,
      saveAutoFeedReminder: async () => {},
    },
    "./i18n": {
      currentFormattingLocale: () => "en-AU",
      currentLocale: () => "en",
      formatDate: (value, _options, locale) =>
        `${locale}:date:${new Date(value).toISOString()}`,
      t: (source) => source,
      translate: (source, locale, values) =>
        `${locale}:${source}`.replace("{time}", String(values?.time ?? "")),
    },
    "./personalWrites": {
      personalStorageIsBlocked: () => false,
      reminderWrite: (work) => work(),
    },
    "./family/familyReminderPlan": {
      absoluteReminderTime: (data, trigger) =>
        data?.onceAt ??
        (trigger?.type === "date"
          ? new Date(trigger.value ?? trigger.date).toISOString()
          : null),
      captureScheduledReminderRecords: () => [],
      isFamilyReminderData: (data) => data?.familyReminder === true,
    },
    "./family/familyReminders": {
      shouldShowFamilyNotification: () => false,
    },
    "./family/familyPushPresentation": {
      shouldShowFamilyEntryPush: () => false,
    },
  };
  const modules = new Map();
  function load(filename) {
    filename = path.resolve(root, filename);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText;
    vm.runInNewContext(source, {
      module,
      exports: module.exports,
      Date,
      Promise,
      Set,
      Map,
      require(name) {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        if (!name.startsWith(".")) throw new Error(`Unexpected import ${name}`);
        return load(path.join(path.dirname(filename), `${name}.ts`));
      },
    });
    return module.exports;
  }
  return {
    reminders: load("src/reminders.ts"),
    scheduled,
    calls,
    reload() {
      modules.clear();
      return load("src/reminders.ts");
    },
  };
}

test("locale refresh preserves authored titles and exact triggers while replacing generated content", async () => {
  const f = fixture();
  await f.reminders.rescheduleAutoFeedReminders([], "ja", "ja-JP");

  assert.equal(f.scheduled.has("family"), true);
  assert.equal(f.scheduled.has("once-old"), false);
  assert.equal(f.scheduled.has("daily-old"), false);
  const personal = [...f.scheduled.values()].filter(
    (item) => !item.content.data?.familyReminder,
  );
  assert.equal(personal.length, 2);

  const once = personal.find(
    (item) => item.content.title === "Mum's custom nap",
  );
  assert.equal(once.trigger.date.getTime(), Date.parse(onceAt));
  assert.equal(once.content.data.onceAt, onceAt);
  assert.equal(once.content.data.reminderLocale, "ja");
  assert.equal(once.content.data.reminderFormattingLocale, "ja-JP");
  assert.equal(once.content.data.reminderContentVersion, 1);
  assert.match(once.content.data.detail, /^ja-JP:date:/);
  assert.match(once.content.body, /^ja:/);

  const daily = personal.find((item) => item.content.title === "Vitamin D");
  assert.equal(daily.trigger.hour, 9);
  assert.equal(daily.trigger.minute, 15);
  assert.equal(daily.content.data.reminderLocale, "ja");
  assert.ok(
    f.calls.findIndex((call) => call.kind === "schedule") <
      f.calls.findIndex((call) => call.kind === "cancel"),
    "replacement is durable before the old notification is removed",
  );

  const scheduledBefore = f.calls.filter(
    (call) => call.kind === "schedule",
  ).length;
  await f.reminders.rescheduleAutoFeedReminders([], "ja", "ja-JP");
  assert.equal(
    f.calls.filter((call) => call.kind === "schedule").length,
    scheduledBefore,
    "matching locale/content fingerprints avoid needless replacement",
  );
});

test("regional formatting changes replace reminders and render dates with the exact locale", async () => {
  const f = fixture();
  await f.reminders.rescheduleAutoFeedReminders([], "en", "en-US");
  const schedulesBefore = f.calls.filter(
    (call) => call.kind === "schedule",
  ).length;

  await f.reminders.rescheduleAutoFeedReminders([], "en", "en-GB");

  const replacementSchedules = f.calls.filter(
    (call) => call.kind === "schedule",
  ).length;
  assert.equal(replacementSchedules, schedulesBefore + 2);
  const personal = [...f.scheduled.values()].filter(
    (item) => !item.content.data?.familyReminder,
  );
  assert.equal(personal.length, 2);
  assert.ok(
    personal.every(
      (item) => item.content.data.reminderFormattingLocale === "en-GB",
    ),
  );
  const once = personal.find(
    (item) => item.content.title === "Mum's custom nap",
  );
  assert.match(once.content.data.detail, /^en-GB:date:/);
});

test("a stale locale refresh stops before changing native schedules", async () => {
  const f = fixture();
  let checks = 0;
  await f.reminders.rescheduleAutoFeedReminders(
    [],
    "fr",
    "fr-FR",
    () => ++checks === 1,
  );
  assert.equal(checks, 2, "the refresh became stale after entering its queue");
  assert.deepEqual(f.calls, []);
  assert.equal(f.scheduled.has("once-old"), true);
  assert.equal(f.scheduled.has("daily-old"), true);
  assert.equal(f.scheduled.has("family"), true);
});

test("locale replacement reuses its target after cancellation failure and module restart", async () => {
  const f = fixture({ cancelFailures: { "once-old": 1 } });
  await assert.rejects(
    f.reminders.rescheduleAutoFeedReminders([], "ja", "ja-JP"),
    /cancel failed: once-old/,
  );

  const mumSchedules = () =>
    f.calls.filter(
      (call) =>
        call.kind === "schedule" &&
        call.request.content.title === "Mum's custom nap",
    );
  assert.equal(mumSchedules().length, 1);
  assert.equal(
    (await f.reminders.listReminders()).filter(
      (item) => item.title === "Mum's custom nap",
    ).length,
    1,
    "transient native duplicates stay one logical row",
  );

  const restarted = f.reload();
  await restarted.rescheduleAutoFeedReminders([], "ja", "ja-JP");
  assert.equal(
    mumSchedules().length,
    1,
    "retry reuses the already scheduled target fingerprint",
  );
  const remaining = [...f.scheduled.values()].filter(
    (item) => item.content.title === "Mum's custom nap",
  );
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].content.data.reminderLocale, "ja");
  assert.equal(remaining[0].content.data.reminderRuleId, "once-old");
});

test("silent update is idempotent after cancellation failure", async () => {
  const f = fixture({ cancelFailures: { "daily-old": 1 } });
  await assert.rejects(
    f.reminders.updateReminderSilent("daily-old", true),
    /cancel failed: daily-old/,
  );

  const dailySchedules = () =>
    f.calls.filter(
      (call) =>
        call.kind === "schedule" && call.request.content.title === "Vitamin D",
    );
  assert.equal(dailySchedules().length, 1);
  const visible = (await f.reminders.listReminders()).find(
    (item) => item.title === "Vitamin D",
  );
  assert.equal(visible.settings.silent, true);

  const restarted = f.reload();
  await restarted.updateReminderSilent("daily-old", true);
  assert.equal(dailySchedules().length, 1);
  const remaining = [...f.scheduled.values()].filter(
    (item) => item.content.title === "Vitamin D",
  );
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].content.data.silent, true);
});

test("locale refresh keeps the newest silent edit after failed cleanup", async () => {
  const f = fixture({ cancelFailures: { "daily-old": 1 } });
  await assert.rejects(
    f.reminders.updateReminderSilent("daily-old", true),
    /cancel failed: daily-old/,
  );

  await f.reminders.rescheduleAutoFeedReminders([], "ja", "ja-JP");
  const remaining = [...f.scheduled.values()].filter(
    (item) => item.content.title === "Vitamin D",
  );
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].content.data.silent, true);
  assert.equal(remaining[0].content.data.reminderLocale, "ja");
  assert.equal(remaining[0].content.data.reminderRevision, 2);
});

test("identical user-created reminders keep separate logical rule IDs", async () => {
  const f = fixture();
  const duplicate = structuredClone(f.scheduled.get("daily-old"));
  duplicate.identifier = "daily-copy";
  f.scheduled.set(duplicate.identifier, duplicate);

  await f.reminders.rescheduleAutoFeedReminders([], "ja", "ja-JP");
  const remaining = [...f.scheduled.values()].filter(
    (item) => item.content.title === "Vitamin D",
  );
  assert.equal(remaining.length, 2);
  assert.deepEqual(
    new Set(remaining.map((item) => item.content.data.reminderRuleId)),
    new Set(["daily-old", "daily-copy"]),
  );
});
