import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// Run the real account-scoped wrapper and native persistence at deterministic
// React/SQLite boundaries. No HTTP, credentials or physical device are used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const plain = (value) => JSON.parse(JSON.stringify(value));
const account = "https://pilot.example.invalid|tenant|owner";
const owner = "owner@example.test";
const recipient = "member@example.test";
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function loader(overrides = {}) {
  const modules = new Map();
  function load(relative) {
    const full = path.resolve(root, relative);
    if (modules.has(full)) return modules.get(full).exports;
    const result = { exports: {} };
    modules.set(full, result);
    const code = ts.transpileModule(fs.readFileSync(full, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(code, {
      module: result,
      exports: result.exports,
      Date,
      JSON,
      Number,
      String,
      Map,
      Set,
      require(name) {
        if (name === "./storageProtection")
          return { protectFamilyStorage: async () => {} };
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (!name.startsWith("."))
          throw new Error(`Unexpected dependency: ${name}`);
        const base = path.resolve(path.dirname(full), name);
        const resolved = [base + ".ts", base + ".tsx"].find(fs.existsSync);
        if (!resolved) throw new Error(`Missing test dependency: ${name}`);
        return load(resolved);
      },
    });
    return result.exports;
  }
  return load;
}

function sourceFixture() {
  const start = "2026-09-01T10:00:00.000Z";
  const end = "2026-09-01T10:20:00.000Z";
  return {
    schemaVersion: 1,
    profile: { name: "宝宝", birthDate: "2026-08-18", sex: "unspecified" },
    entries: [
      {
        id: "feed",
        type: "feed",
        start,
        end,
        feedKind: "expressed",
        amount: 80.5,
        note: "Original",
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
        id: "temp",
        kind: "temperature",
        time: start,
        temperature: 36.8,
        method: "armpit",
        note: "",
      },
      ...["bath", "wash", "oral", "nails"].map((kind) => ({
        id: kind,
        kind,
        time: start,
        note: "",
      })),
    ],
  };
}

function wrapperWorld() {
  const values = new Map();
  const refs = new Map();
  const effects = new Map();
  let active = "";
  let slot = 0;
  let visited = new Set();
  let scheduled = [];
  let nodes = [];
  const world = {
    source: sourceFixture(),
    extras: [
      {
        id: "play-selection",
        kind: "play-selection",
        selection: { included: ["face"], excluded: [] },
      },
    ],
    captureError: null,
    pilot: {
      user: { id: "owner", email: owner },
      authStatus: "authenticated",
      snapshot: null,
      inbox: [],
      transitionPending: false,
      accountDeletion: null,
      busy: false,
      syncing: false,
      createFamilyFromSeed: async (draft) => {
        world.saves.push({ key: account, draft: plain(draft) });
      },
    },
    stored: null,
    loads: [],
    saves: [],
    clears: [],
    loadError: false,
  };
  const react = {
    createElement(type, props, ...children) {
      return {
        type,
        props: {
          ...props,
          ...(children.length
            ? { children: children.length === 1 ? children[0] : children }
            : {}),
        },
      };
    },
    useRef(value) {
      const key = `${active}:${slot++}`;
      if (!refs.has(key)) refs.set(key, { current: value });
      return refs.get(key);
    },
    useState(value) {
      const key = `${active}:${slot++}`;
      if (!values.has(key))
        values.set(key, typeof value === "function" ? value() : value);
      return [
        values.get(key),
        (next) =>
          values.set(
            key,
            typeof next === "function" ? next(values.get(key)) : next,
          ),
      ];
    },
    useEffect(effect, deps) {
      const key = `${active}:${slot++}`;
      visited.add(key);
      const previous = effects.get(key);
      if (
        !previous ||
        deps.some((dep, index) => !Object.is(dep, previous.deps[index]))
      ) {
        scheduled.push(() => {
          previous?.cleanup?.();
          effects.set(key, { deps, cleanup: effect() });
        });
      }
    },
  };
  const load = loader({
    react,
    "react-native": { ActivityIndicator: "ActivityIndicator" },
    "../i18n": {
      useI18n: () => ({
        locale: "en",
        formattingLocale: "en-US",
        localize: (_zh, en) => en,
      }),
    },
    "../ui": { Button: "Button", Card: "Card", T: "T" },
    "./config": {
      familyConfig: {
        apiUrl: "https://pilot.example.invalid",
        tenantId: "tenant",
      },
    },
    "./OwnerSetupCard": { __esModule: true, default: "OwnerSetupCard" },
    "./personalExtras": {
      loadPersonalExtras: async () => {
        if (world.captureError) throw world.captureError;
        return plain(world.extras);
      },
    },
    "./pilotStorage": {
      async loadOwnerSetup(key, email) {
        world.loads.push({ key, email });
        if (world.loadError) throw new Error("owner_invalid_data");
        return world.stored;
      },
      async saveOwnerSetup(key, draft) {
        world.saves.push({ key, draft: plain(draft) });
        world.stored = draft;
      },
      async clearOwnerSetup(key) {
        world.clears.push(key);
        world.stored = null;
      },
    },
  });
  const Wrapper = load("src/family/OwnerSetup.tsx").default;
  function visit(element, position = "0") {
    if (element == null || typeof element === "boolean") return;
    if (Array.isArray(element))
      return element.forEach((child, index) =>
        visit(child, `${position}.${index}`),
      );
    if (typeof element !== "object") return;
    if (typeof element.type === "function") {
      const previous = [active, slot];
      active = `${position}:${element.type.name}:${element.props?.key ?? ""}`;
      slot = 0;
      visit(element.type(element.props), `${active}.component`);
      [active, slot] = previous;
    } else {
      nodes.push(element);
      visit(element.props?.children, `${position}.children`);
    }
  }
  world.render = () => {
    nodes = [];
    visited = new Set();
    scheduled = [];
    visit(
      react.createElement(Wrapper, {
        pilot: world.pilot,
        source: world.source,
      }),
    );
    for (const [key, effect] of effects) {
      if (!visited.has(key)) {
        effect.cleanup?.();
        effects.delete(key);
      }
    }
    scheduled.forEach((effect) => effect());
    return nodes;
  };
  world.card = () =>
    nodes.find((node) => node.type === "OwnerSetupCard")?.props;
  world.ready = async () => {
    world.render();
    await tick();
    world.render();
    return world.card();
  };
  return world;
}

test("owner mobile preparation submits the exact detached full snapshot only after explicit confirmation", async () => {
  const world = wrapperWorld();
  const original = plain(world.source);
  const card = await world.ready();
  assert.equal(card.mode, "full");
  const draft = await card.onPrepare(recipient);
  assert.equal(world.saves.length, 0);
  await card.onSave(draft);
  assert.deepEqual(world.saves, [{ key: account, draft: plain(draft) }]);
  assert.deepEqual(world.saves[0].draft.source, original);
  assert.equal(world.saves[0].draft.counts.total, 10);
  assert.deepEqual(world.source, original);
  assert.equal(world.pilot.snapshot, null);
  assert.equal(world.loads.length, 0);
  assert.equal(world.clears.length, 0);
  assert.deepEqual(world.source, original);
});

test("owner mobile Save rejects records or profile changed since review", async () => {
  for (const change of [
    (world) => {
      world.source.entries[0].amount = 90;
    },
    (world) => {
      world.source.profile.name = "Updated baby";
    },
    (world) => {
      world.source.careRecords[0].temperature = 37.1;
    },
  ]) {
    const world = wrapperWorld();
    const card = await world.ready();
    const draft = await card.onPrepare(recipient);
    change(world);
    world.render();
    await assert.rejects(card.onSave(draft), {
      message: "owner_source_changed",
    });
    assert.equal(world.saves.length, 0);
  }
});

test("owner review includes detached extra data and rejects changes before creation", async () => {
  const world = wrapperWorld();
  const card = await world.ready();
  const draft = await card.onPrepare(recipient);
  assert.equal(draft.extrasSchemaVersion, 1);
  assert.deepEqual(plain(draft.extraRecords), world.extras);
  world.extras[0].selection.included.push("changed");
  assert.equal(draft.extraRecords[0].selection.included.length, 1);
  await assert.rejects(card.onSave(draft), /owner_source_changed/);
  assert.equal(world.saves.length, 0);
});

test("an unreadable personal photo or reminder never silently disappears from review", async () => {
  const world = wrapperWorld();
  const card = await world.ready();
  world.captureError = new Error("owner_extra_read_failed");
  await assert.rejects(card.onPrepare(recipient), /owner_extra_read_failed/);
  assert.equal(world.saves.length, 0);
});

test("owner mobile stale callbacks cannot save after account, session or family lifecycle changes", async () => {
  for (const change of [
    (world) => {
      world.pilot.authStatus = "reauth_required";
    },
    (world) => {
      world.pilot.authStatus = "unverified";
    },
    (world) => {
      world.pilot.user = { id: "different", email: "different@example.test" };
    },
    (world) => {
      world.pilot.user = null;
    },
    (world) => {
      world.pilot.snapshot = { family: { id: "joined" } };
    },
    (world) => {
      world.pilot.transitionPending = true;
    },
    (world) => {
      world.pilot.accountDeletion = { status: "pending" };
    },
    (world) => {
      world.pilot.busy = true;
    },
    (world) => {
      world.pilot.syncing = true;
    },
  ]) {
    const world = wrapperWorld();
    const card = await world.ready();
    const draft = await card.onPrepare(recipient);
    change(world);
    world.render();
    await assert.rejects(card.onSave(draft), {
      message: "owner_setup_changed",
    });
    assert.equal(world.saves.length, 0);
  }
});

test("owner full setup always reviews current source without replaying a stale saved setup", async () => {
  const world = wrapperWorld();
  world.stored = { corrupt: true };
  world.loadError = true;
  await world.ready();
  assert.equal(world.card().mode, "full");
  assert.equal(world.saves.length, 0);
  assert.equal(world.loads.length, 0);
  assert.equal(world.card().pending, undefined);
  assert.deepEqual(world.stored, { corrupt: true });
  assert.equal(world.clears.length, 0);
});

function storageWorld() {
  const world = {
    tables: { pilot_accounts: new Map(), owner_setup_drafts: new Map() },
    sql: [],
    failDelete: false,
    beforeCommit: async () => {},
  };
  function write(tables, query, key, payload) {
    world.sql.push(query);
    const table = query.match(/(?:INTO|FROM) (\w+)/)?.[1];
    assert.ok(tables[table], `Unexpected table ${table}`);
    assert.ok(query.includes("?"), "Values must be parameterized");
    if (query.startsWith("DELETE")) {
      if (world.failDelete && table === "owner_setup_drafts")
        throw new Error("simulated SQLite failure");
      tables[table].delete(key);
    } else {
      assert.match(query, /^INSERT OR REPLACE/);
      tables[table].set(key, payload);
    }
  }
  const database = {
    async execAsync(query) {
      world.sql.push(query);
    },
    async getFirstAsync(query, key) {
      world.sql.push(query);
      const table = query.match(/FROM (\w+)/)[1];
      const payload = world.tables[table].get(key);
      return payload === undefined ? null : { payload };
    },
    async runAsync(...args) {
      write(world.tables, ...args);
    },
    async withExclusiveTransactionAsync(callback) {
      const staged = Object.fromEntries(
        Object.entries(world.tables).map(([name, rows]) => [
          name,
          new Map(rows),
        ]),
      );
      await callback({ runAsync: async (...args) => write(staged, ...args) });
      await world.beforeCommit();
      world.tables = staged;
    },
  };
  const load = loader({
    "expo-sqlite": { openDatabaseAsync: async () => database },
  });
  world.storage = load("src/family/pilotStorage.native.ts");
  world.emptyPilot = load("src/family/pilotState.ts").emptyPilotState();
  world.draft = load("src/family/ownerSeed.ts").prepareOwnerSeed(
    sourceFixture(),
    recipient,
    owner,
  );
  return world;
}

test("native owner setup storage serializes Save then clears both account tables without affecting another account", async () => {
  const world = storageWorld();
  world.tables.pilot_accounts.set(account, "pilot data");
  world.tables.pilot_accounts.set("other", "other pilot");
  world.tables.owner_setup_drafts.set("other", "other setup");
  const gate = deferred();
  let commits = 0;
  world.beforeCommit = async () => {
    if (++commits === 1) await gate.promise;
  };
  const save = world.storage.saveOwnerSetup(account, world.draft);
  const clear = world.storage.clearPilot(account);
  await tick();
  assert.equal(commits, 1);
  assert.equal(world.tables.pilot_accounts.has(account), true);
  gate.resolve();
  await Promise.all([save, clear]);
  assert.equal(world.tables.pilot_accounts.has(account), false);
  assert.equal(world.tables.owner_setup_drafts.has(account), false);
  assert.equal(world.tables.pilot_accounts.get("other"), "other pilot");
  assert.equal(world.tables.owner_setup_drafts.get("other"), "other setup");
  assert.equal(await world.storage.loadOwnerSetup(account, owner), null);
  assert.ok(
    world.sql.some((query) =>
      query.includes("CREATE TABLE IF NOT EXISTS owner_setup_drafts"),
    ),
  );
});

test("native owner setup clear failure rolls back both rows and permits a later retry", async () => {
  const world = storageWorld();
  world.tables.pilot_accounts.set(account, "pilot data");
  await world.storage.saveOwnerSetup(account, world.draft);
  const payload = world.tables.owner_setup_drafts.get(account);
  world.failDelete = true;
  await assert.rejects(
    world.storage.clearPilot(account),
    /simulated SQLite failure/,
  );
  assert.equal(world.tables.pilot_accounts.get(account), "pilot data");
  assert.equal(world.tables.owner_setup_drafts.get(account), payload);
  world.failDelete = false;
  assert.deepEqual(
    plain(await world.storage.loadOwnerSetup(account, owner)),
    plain(world.draft),
  );
  await world.storage.clearPilot(account);
  assert.equal(world.tables.pilot_accounts.has(account), false);
  assert.equal(world.tables.owner_setup_drafts.has(account), false);
});

test("native owner setup corrupt or cross-self draft load rejects without modifying stored content", async () => {
  const world = storageWorld();
  world.tables.owner_setup_drafts.set(account, "corrupt");
  await assert.rejects(world.storage.loadOwnerSetup(account, owner), {
    message: "owner_invalid_data",
  });
  assert.equal(world.tables.owner_setup_drafts.get(account), "corrupt");
  await world.storage.saveOwnerSetup(account, world.draft);
  const payload = world.tables.owner_setup_drafts.get(account);
  await assert.rejects(world.storage.loadOwnerSetup(account, recipient), {
    message: "owner_invalid_data",
  });
  assert.equal(world.tables.owner_setup_drafts.get(account), payload);
  await world.storage.clearOwnerSetup(account);
  assert.equal(await world.storage.loadOwnerSetup(account, owner), null);
});

test("native pre-auth logout discard durably empties pilot and purges owner setup in one transaction", async () => {
  const world = storageWorld();
  world.tables.pilot_accounts.set(account, "previous pilot");
  await world.storage.saveOwnerSetup(account, world.draft);
  world.tables.owner_setup_drafts.set("other", "other account setup");
  const gate = deferred();
  world.beforeCommit = () => gate.promise;
  const discard = world.storage.savePilot(account, world.emptyPilot, {
    discardOwnerSetup: true,
  });
  await tick();
  assert.equal(world.tables.pilot_accounts.get(account), "previous pilot");
  assert.equal(world.tables.owner_setup_drafts.has(account), true);
  gate.resolve();
  await discard;
  assert.deepEqual(
    JSON.parse(world.tables.pilot_accounts.get(account)),
    plain(world.emptyPilot),
  );
  assert.equal(world.tables.owner_setup_drafts.has(account), false);
  assert.equal(
    world.tables.owner_setup_drafts.get("other"),
    "other account setup",
  );
});

test("native pre-auth discard rollback preserves both old rows and queue remains usable", async () => {
  const world = storageWorld();
  world.tables.pilot_accounts.set(account, "previous pilot");
  await world.storage.saveOwnerSetup(account, world.draft);
  const payload = world.tables.owner_setup_drafts.get(account);
  world.failDelete = true;
  await assert.rejects(
    world.storage.savePilot(account, world.emptyPilot, {
      discardOwnerSetup: true,
    }),
    /simulated SQLite failure/,
  );
  assert.equal(world.tables.pilot_accounts.get(account), "previous pilot");
  assert.equal(world.tables.owner_setup_drafts.get(account), payload);
  world.failDelete = false;
  await world.storage.savePilot(account, world.emptyPilot);
  assert.equal(world.tables.owner_setup_drafts.get(account), payload);
  await world.storage.savePilot(account, world.emptyPilot, {
    discardOwnerSetup: true,
  });
  assert.equal(world.tables.owner_setup_drafts.has(account), false);
  assert.deepEqual(
    JSON.parse(world.tables.pilot_accounts.get(account)),
    plain(world.emptyPilot),
  );
});
