import test from "node:test";
import assert from "node:assert/strict";
import {
  FamilyReminderCoordinator,
  type FamilyReminderPreferences,
  type ScheduledFamilyReminder,
} from "./family/familyReminderCoordinator";
import type { FamilyReminderPlan } from "./family/familyReminderPlan";

const plan: FamilyReminderPlan = {
  recordId: "r1",
  title: "Care",
  silent: true,
  trigger: { type: "daily", hour: 10, minute: 0 },
  fingerprint: "version1",
};

function fixture(initial: FamilyReminderPreferences | null = null) {
  let stored = initial;
  const scheduled = new Map<string, ScheduledFamilyReminder>();
  let permissionRequests = 0;
  let scheduleCalls = 0;
  let dismissed = 0;
  let blockSchedule: (() => Promise<void>) | null = null;
  const coordinator = new FamilyReminderCoordinator({
    load: async () => stored,
    save: async (value) => {
      stored = value;
    },
    requestPermission: async () => {
      permissionRequests++;
    },
    list: async () => [...scheduled.values()],
    schedule: async (origin, value) => {
      scheduleCalls++;
      if (blockSchedule) await blockSchedule();
      const id = `notification-${scheduleCalls}`;
      scheduled.set(id, { id, origin, fingerprint: value.fingerprint });
      return id;
    },
    cancel: async (id) => {
      scheduled.delete(id);
    },
    dismiss: async () => {
      dismissed++;
    },
  });
  return {
    coordinator,
    scheduled,
    getStored: () => stored,
    requests: () => permissionRequests,
    calls: () => scheduleCalls,
    dismissed: () => dismissed,
    block: (value: () => Promise<void>) => {
      blockSchedule = value;
    },
  };
}

test("downloaded family reminders default off and only explicit enable asks for permission", async () => {
  const f = fixture();
  await f.coordinator.sync("family-a", [plan]);
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.requests(), 0);
  await f.coordinator.setOptIn("family-a", true);
  await f.coordinator.sync("family-a", [plan]);
  assert.equal(f.requests(), 1);
  assert.equal(f.scheduled.size, 1);
  assert.equal(f.coordinator.shouldShow("family-a"), true);
  assert.equal(f.coordinator.shouldShow("family-b"), false);
});

test("refresh preserves native schedule and switching family cannot inherit opt-in", async () => {
  const f = fixture({ origin: "family-a", enabled: true });
  assert.equal(f.coordinator.shouldShow("family-a"), false);
  await f.coordinator.sync("family-a", [plan]);
  await f.coordinator.sync("family-a", [plan]);
  assert.equal(f.calls(), 1);
  assert.equal(f.requests(), 0);
  await f.coordinator.sync("family-b", [plan]);
  assert.equal(f.scheduled.size, 0);
  assert.deepEqual(f.getStored(), { origin: "family-b", enabled: false });
});

test("suspension cancels visible/scheduled reminders but preserves preference for verified recovery", async () => {
  const f = fixture({ origin: "family-a", enabled: true });
  await f.coordinator.sync("family-a", [plan]);
  const pending = f.coordinator.suspend();
  assert.equal(f.coordinator.shouldShow("family-a"), false);
  await pending;
  assert.equal(f.scheduled.size, 0);
  assert.deepEqual(f.getStored(), { origin: "family-a", enabled: true });
  await f.coordinator.sync("family-a", [plan]);
  assert.equal(f.scheduled.size, 1);
  assert.equal(f.requests(), 0);
  await f.coordinator.clear();
  assert.equal(f.getStored(), null);
  assert.equal(f.scheduled.size, 0);
  assert.ok(f.dismissed() > 0);
});

test("logout invalidates a native schedule in flight before final cleanup", async () => {
  const f = fixture({ origin: "family-a", enabled: true });
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.block(() => {
    started();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const sync = f.coordinator.sync("family-a", [plan]);
  await ready;
  const clear = f.coordinator.clear();
  assert.equal(f.coordinator.shouldShow("family-a"), false);
  release();
  await Promise.all([sync, clear]);
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.getStored(), null);
});

test("edited and deleted records replace or cancel native notifications without duplicates", async () => {
  const f = fixture({ origin: "family-a", enabled: true });
  await f.coordinator.sync("family-a", [plan]);
  await f.coordinator.sync("family-a", [
    { ...plan, fingerprint: "version2", silent: false },
  ]);
  assert.equal(f.scheduled.size, 1);
  assert.equal([...f.scheduled.values()][0].fingerprint, "version2");
  await f.coordinator.sync("family-a", []);
  assert.equal(f.scheduled.size, 0);
});

test("a same-family refresh does not undo an explicit enable in progress", async () => {
  const f = fixture();
  const enable = f.coordinator.setOptIn("family-a", true);
  const refresh = f.coordinator.sync("family-a", [plan]);
  await Promise.all([enable, refresh]);
  assert.equal(f.requests(), 1);
  assert.equal(f.scheduled.size, 1);
  assert.equal(await f.coordinator.loadOptIn("family-a"), true);
});

test("changing family while enable awaits permission cannot save old-family consent", async () => {
  let preference: FamilyReminderPreferences | null = null;
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const coordinator = new FamilyReminderCoordinator({
    load: async () => preference,
    save: async (value) => {
      preference = value;
    },
    requestPermission: () => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    list: async () => [],
    schedule: async () => {
      throw new Error("must not schedule without consent");
    },
    cancel: async () => {},
    dismiss: async () => {},
  });
  const enable = coordinator.setOptIn("family-a", true);
  await ready;
  const change = coordinator.sync("family-b", [plan]);
  release();
  await Promise.all([enable, change]);
  assert.equal(coordinator.shouldShow("family-a"), false);
  assert.equal(coordinator.shouldShow("family-b"), false);
  assert.deepEqual(preference, { origin: "family-b", enabled: false });
});
