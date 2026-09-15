import assert from "node:assert/strict";
import test from "node:test";
import { initialState } from "./domain";
import {
  personalWrite,
  personalMaintenance,
  setPersonalStorageBlocked,
  drainPersonalStorageWrites,
  reminderWrite,
  drainReminderWrites,
} from "./personalWrites";
import {
  clearPersonalForFamilyActivation,
  loadState,
  saveState,
} from "./storage.web";

test("activation drains earlier personal writes and rejects writes started after the barrier", async () => {
  setPersonalStorageBlocked(false);
  const events: string[] = [];
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const oldWrite = personalWrite(async () => {
    await paused;
    events.push("old write");
  });
  setPersonalStorageBlocked(true);
  await assert.rejects(
    personalWrite(async () => {
      events.push("late write");
    }),
    /locked/,
  );
  const cleanup = personalMaintenance(async () => {
    events.push("clear");
  });
  release();
  await Promise.all([oldWrite, cleanup]);
  await drainPersonalStorageWrites();
  assert.deepEqual(events, ["old write", "clear"]);
  await assert.rejects(
    personalWrite(async () => {}),
    /locked/,
  );
  setPersonalStorageBlocked(false);
});

test("failed maintenance remains locked and can be retried without poisoning the queue", async () => {
  setPersonalStorageBlocked(false);
  await assert.rejects(
    personalMaintenance(async () => {
      throw new Error("disk");
    }),
    /disk/,
  );
  await assert.rejects(
    personalWrite(async () => {}),
    /locked/,
  );
  let retried = false;
  await personalMaintenance(async () => {
    retried = true;
  });
  assert.equal(retried, true);
  setPersonalStorageBlocked(false);
});

test("native reminders finish before activation cancellation; their nested storage writes cannot deadlock or repopulate", async () => {
  setPersonalStorageBlocked(false);
  const events: string[] = [];
  let release!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reminder = reminderWrite(async () => {
    await personalWrite(async () => {
      events.push("save settings");
    });
    await paused;
    events.push("native scheduled");
  });
  // Let the reminder begin and queue its settings before the activation barrier.
  await new Promise((resolve) => setImmediate(resolve));
  setPersonalStorageBlocked(true);
  await assert.rejects(
    reminderWrite(async () => {}),
    /locked/,
  );
  const cleanup = (async () => {
    await drainReminderWrites();
    await personalMaintenance(async () => {
      events.push("cancel and clear");
    });
  })();
  release();
  await Promise.all([reminder, cleanup]);
  assert.deepEqual(events, [
    "save settings",
    "native scheduled",
    "cancel and clear",
  ]);
  setPersonalStorageBlocked(false);
});

test("activation removes all personal content including recovery, but not family journal or app preferences", async () => {
  const data = new Map<string, string>([
    ["little-days-v1-recovery", "old baby"],
    ["little-days-v1-avatar-uri", "old photo"],
    ["little-days-v1-play-selection", "old selections"],
    ["little-days-v1-reminder-settings", "old reminders"],
    ["little-days-v1-unknown-future-content", "old content"],
    ["little-days-v1-dark", "true"],
    ["little-days-v1-language", "zh"],
    ["little-days-v1-record-view", "calendar"],
    ["little-days-family-activation", "pending journal"],
    ["unrelated-application", "untouched"],
  ]);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return data.size;
      },
      key(index: number) {
        return [...data.keys()][index] ?? null;
      },
      getItem(key: string) {
        return data.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        data.set(key, value);
      },
      removeItem(key: string) {
        data.delete(key);
      },
    },
  });
  try {
    setPersonalStorageBlocked(false);
    await saveState({
      ...initialState,
      profile: { ...initialState.profile, name: "Private source" },
    });
    await clearPersonalForFamilyActivation();
    assert.deepEqual(await loadState(), initialState);
    assert.equal(data.size, 6);
    assert.equal(data.get("little-days-v1-dark"), "true");
    assert.equal(data.get("little-days-family-activation"), "pending journal");
    assert.equal(data.get("unrelated-application"), "untouched");
    await assert.rejects(saveState(initialState), /locked/);
    await clearPersonalForFamilyActivation();
    assert.deepEqual(await loadState(), initialState);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
    setPersonalStorageBlocked(false);
  }
});
