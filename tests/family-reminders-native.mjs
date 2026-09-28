import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function fixture() {
  let preference = { origin: "family-a", enabled: 1 };
  let cleanup = null;
  const calls = [],
    failures = new Set();
  const scheduled = new Map(),
    presented = new Map();
  const notification = (id, familyReminder = true) => ({
    identifier: id,
    content: {
      data: {
        familyReminder,
        familyOrigin: "family-a",
        familyFingerprint: "one",
      },
    },
  });
  for (const id of ["family-one", "family-two", "personal"]) {
    scheduled.set(id, notification(id, id !== "personal"));
    presented.set(id, { request: notification(id, id !== "personal") });
  }
  const dependencies = {
    "expo-sqlite": {
      openDatabaseAsync: async () => {
        calls.push("open");
        if (failures.has("open")) throw new Error("open_failed");
        return {
          execAsync: async () => {
            calls.push("schema");
            if (failures.has("schema")) throw new Error("schema_failed");
          },
          closeAsync: async () => {
            calls.push("close");
            if (failures.has("close")) throw new Error("close_failed");
          },
          getFirstAsync: async (sql) =>
            sql.includes("pilot_accounts")
              ? { payload: "stored-family-state" }
              : sql.includes("cleanup_retry")
                ? cleanup
                : preference,
          runAsync: async (sql, ...args) => {
            if (sql.includes("cleanup_retry"))
              cleanup = sql.startsWith("DELETE")
                ? null
                : { clear_preference: args[0] };
            else {
              calls.push("savePreference");
              if (failures.has("savePreference"))
                throw new Error("disk_failed");
              preference = sql.startsWith("DELETE")
                ? null
                : { origin: args[0], enabled: args[1] };
            }
          },
        };
      },
    },
    "expo-notifications": {
      getAllScheduledNotificationsAsync: async () => {
        calls.push("listScheduled");
        if (failures.has("listScheduled")) throw new Error("native_failed");
        return [...scheduled.values()];
      },
      cancelScheduledNotificationAsync: async (id) => {
        calls.push(`cancel:${id}`);
        if (failures.has(`cancel:${id}`)) throw new Error("native_failed");
        scheduled.delete(id);
      },
      getPresentedNotificationsAsync: async () => {
        calls.push("listPresented");
        if (failures.has("listPresented")) throw new Error("native_failed");
        return [...presented.values()];
      },
      dismissNotificationAsync: async (id) => {
        calls.push(`dismiss:${id}`);
        if (failures.has(`dismiss:${id}`)) throw new Error("native_failed");
        presented.delete(id);
      },
      scheduleNotificationAsync: async () => {
        calls.push("schedule");
        return "new";
      },
    },
    "react-native": { Platform: { OS: "ios" } },
    "../i18n": { t: (value) => value },
    "./storageProtection": {
      protectFamilyStorage: async () => {
        calls.push("protect");
        if (failures.has("protect")) throw new Error("protect_failed");
      },
    },
    "./pilotState": { parseStoredPilot: (value) => value },
    "./ownerSetupDraft": {},
    "./familyReminderPlan": {
      isFamilyReminderData: (data) => data?.familyReminder === true,
      familyReminderPlans: () => [],
    },
  };
  function load(filename = "src/family/familyReminders.native.ts") {
    const cache = new Map();
    function read(filename) {
      filename = path.resolve(root, filename);
      if (cache.has(filename)) return cache.get(filename).exports;
      const module = { exports: {} };
      cache.set(filename, module);
      const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
        },
      }).outputText;
      vm.runInNewContext(source, {
        module,
        exports: module.exports,
        Error,
        Promise,
        Set,
        Map,
        require(name) {
          if (Object.hasOwn(dependencies, name)) return dependencies[name];
          if (!name.startsWith("."))
            throw new Error(`Unexpected import ${name}`);
          return read(path.resolve(path.dirname(filename), name + ".ts"));
        },
      });
      return module.exports;
    }
    return read(filename);
  }
  return {
    load,
    calls,
    failures,
    scheduled,
    presented,
    cleanup: () => cleanup,
    preference: () => preference,
  };
}

test("native family cleanup protects storage and independently cancels/dismisses every family item", async () => {
  const f = fixture(),
    reminders = f.load();
  f.failures.add("savePreference");
  f.failures.add("cancel:family-one");
  f.failures.add("dismiss:family-one");
  await assert.rejects(
    reminders.clearFamilyReminders(),
    /reminder_cleanup_failed/,
  );
  assert.ok(f.calls.indexOf("protect") < f.calls.indexOf("open"));
  assert.ok(f.calls.includes("cancel:family-two"));
  assert.ok(f.calls.includes("dismiss:family-two"));
  assert.equal(f.scheduled.has("personal"), true);
  assert.equal(f.presented.has("personal"), true);
  assert.equal(f.cleanup().clear_preference, 1);
  const restarted = f.load();
  await assert.rejects(
    restarted.syncFamilyReminders("family-a", [], []),
    /reminder_cleanup_failed/,
  );
  assert.equal(
    restarted.shouldShowFamilyNotification({
      familyReminder: true,
      familyOrigin: "family-a",
    }),
    false,
  );
  f.failures.clear();
  await restarted.syncFamilyReminders("family-a", [], []);
  assert.equal(f.cleanup(), null);
  assert.equal(f.preference()?.enabled ?? 0, 0);
  assert.deepEqual([...f.scheduled.keys()], ["personal"]);
  assert.deepEqual([...f.presented.keys()], ["personal"]);
  assert.equal(f.calls.includes("schedule"), false);
});
test("native presented-list failure cannot prevent scheduled cancellation and vice versa", async () => {
  for (const failure of ["listPresented", "listScheduled"]) {
    const f = fixture();
    f.failures.add(failure);
    await assert.rejects(
      f.load().clearFamilyReminders(),
      /reminder_cleanup_failed/,
    );
    assert.ok(f.calls.includes("listPresented"));
    assert.ok(f.calls.includes("listScheduled"));
    if (failure === "listPresented")
      assert.ok(f.calls.includes("cancel:family-two"));
    else assert.ok(f.calls.includes("dismiss:family-two"));
    assert.equal(f.cleanup().clear_preference, 1);
  }
});

test("native reminder initialization can retry in the same process after protection, open or schema failure", async () => {
  for (const failure of ["protect", "open", "schema"]) {
    const f = fixture(),
      reminders = f.load();
    f.failures.add(failure);
    f.failures.add("close"); // Failed cleanup must not hide initialization failure.
    await assert.rejects(
      reminders.clearFamilyReminders(),
      /reminder_cleanup_failed/,
    );
    assert.equal(
      reminders.shouldShowFamilyNotification({
        familyReminder: true,
        familyOrigin: "family-a",
      }),
      false,
    );
    assert.ok(f.calls.includes("cancel:family-two"));
    if (failure === "schema") assert.ok(f.calls.includes("close"));
    const attempts = f.calls.filter((call) => call === "protect").length;
    f.failures.clear();
    await reminders.clearFamilyReminders();
    assert.equal(
      f.calls.filter((call) => call === "protect").length,
      attempts + 1,
    );
    assert.equal(f.cleanup(), null);
    assert.equal(f.preference(), null);
    await reminders.loadFamilyReminderOptIn("family-a");
    assert.equal(
      f.calls.filter((call) => call === "protect").length,
      attempts + 1,
    );
  }
});

test("native family storage retries a failed initializer and closes schema failures before retry", async () => {
  for (const failure of ["protect", "open", "schema"]) {
    const f = fixture(),
      storage = f.load("src/family/pilotStorage.native.ts");
    f.failures.add(failure);
    f.failures.add("close");
    await assert.rejects(
      storage.loadPilot("user"),
      new RegExp(`${failure}_failed`),
    );
    assert.equal(f.calls.filter((call) => call === "protect").length, 1);
    assert.equal(
      f.calls.filter((call) => call === "close").length,
      failure === "schema" ? 1 : 0,
    );
    f.failures.clear();
    assert.equal(await storage.loadPilot("user"), "stored-family-state");
    assert.equal(await storage.loadPilot("user"), "stored-family-state");
    assert.equal(f.calls.filter((call) => call === "protect").length, 2);
    assert.ok(f.calls.indexOf("protect") < f.calls.indexOf("open"));
  }
});
