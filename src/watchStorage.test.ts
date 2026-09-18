import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import type { WatchCommand, WatchContext } from "./watchProtocol";

// Execute the real persistence/bridge code against a transactional SQLite fault
// boundary. This checks the commit boundary, not just the pure entry reducer.
function harness() {
  let rows = new Map<string, string>();
  let failKey: string | null = null;
  let counter = 0;
  const table = (store: Map<string, string>) => ({
    getFirstAsync: async (_sql: string, key: string) =>
      store.has(key) ? { value: store.get(key) } : null,
    runAsync: async (sql: string, ...args: string[]) => {
      if (args[0] === failKey) throw new Error("disk_full");
      if (sql.startsWith("DELETE")) args.forEach((key) => store.delete(key));
      else store.set(args[0], args[1]);
    },
  });
  const db = {
    execAsync: async () => {},
    getFirstAsync: async (sql: string, key: string) =>
      table(rows).getFirstAsync(sql, key),
    withExclusiveTransactionAsync: async (
      operation: (tx: ReturnType<typeof table>) => Promise<void>,
    ) => {
      const pending = new Map(rows);
      await operation(table(pending));
      rows = pending;
    },
  };
  const native = {
    publications: [] as string[],
    invalidations: 0,
    publishContext: async (json: string) => {
      native.publications.push(json);
      return JSON.stringify({
        ...JSON.parse(json),
        generation: 1,
        sequence: native.publications.length,
      });
    },
    suspendContext: async () => {},
    invalidateContext: async () => {
      native.invalidations++;
    },
  };
  const mocks: Record<string, unknown> = {
    "./family/storageProtection": { protectFamilyStorage: async () => {} },
    "expo-sqlite": { openDatabaseAsync: async () => db },
    "expo-crypto": {
      randomUUID: () =>
        `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    },
    "react-native": { Platform: { OS: "ios" } },
    expo: { requireOptionalNativeModule: () => native },
    "./personalWrites": {
      personalWrite: async (operation: () => Promise<unknown>) => operation(),
      personalMaintenance: async (operation: () => Promise<unknown>) =>
        operation(),
      setPersonalStorageBlocked: () => {},
      drainReminderWrites: async () => {},
    },
    "./i18n": {},
  };
  const cache = new Map<string, { exports: any }>();
  function load(file: string): any {
    if (cache.has(file)) return cache.get(file)!.exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    vm.runInNewContext(
      code,
      {
        module,
        exports: module.exports,
        Date,
        Map,
        Set,
        Promise,
        JSON,
        require: (specifier: string) => {
          if (specifier in mocks) return mocks[specifier];
          if (specifier.startsWith("."))
            return load(path.resolve(path.dirname(file), `${specifier}.ts`));
          throw new Error(`Unstubbed module ${specifier}`);
        },
      },
      { filename: file },
    );
    return module.exports;
  }
  return {
    load,
    native,
    read: () => rows,
    fail: (key: string | null) => {
      failKey = key;
    },
  };
}
const source = (file: string) => path.join(process.cwd(), "src", file);
const command = (workspaceKey: string): WatchCommand => ({
  schemaVersion: 1,
  commandId: "81111111-1111-4111-8111-111111111111",
  recordId: "82222222-2222-4222-8222-222222222222",
  workspaceKey,
  generation: 1,
  createdAt: new Date().toISOString(),
  kind: "create",
  entry: {
    id: "82222222-2222-4222-8222-222222222222",
    type: "diaper",
    start: new Date().toISOString(),
    diaperKind: "wet",
    note: "",
  },
});

test("native personal ingestion rolls back record if receipt write fails and lost acknowledgement retries once", async () => {
  const h = harness();
  const storage = h.load(source("storage.ts"));
  const c = command(await storage.loadWatchWorkspace());
  h.fail("watch-ledger");
  await assert.rejects(storage.savePersonalWatchCommand(c), /disk_full/);
  assert.equal(h.read().has("state"), false);
  assert.equal(h.read().has("watch-ledger"), false);
  h.fail(null);
  await storage.savePersonalWatchCommand(c);
  await storage.savePersonalWatchCommand(c);
  assert.equal(JSON.parse(h.read().get("state")!).entries.length, 1);
  assert.equal(
    Object.keys(JSON.parse(h.read().get("watch-ledger")!)).length,
    1,
  );
});
test("personal replacement rotates workspace with data transaction and rejects delayed old Watch work", async () => {
  const h = harness();
  const storage = h.load(source("storage.ts"));
  const old = await storage.loadWatchWorkspace();
  const c = command(old);
  await storage.savePersonalWatchCommand(c);
  await storage.saveState(
    {
      schemaVersion: 1,
      profile: { name: "Baby", birthDate: "", sex: "unspecified" },
      entries: [],
    },
    true,
  );
  const fresh = await storage.loadWatchWorkspace();
  assert.notEqual(fresh, old);
  assert.equal(h.read().has("watch-ledger"), false);
  await assert.rejects(
    storage.savePersonalWatchCommand(c),
    /membership_changed/,
  );
  assert.equal(JSON.parse(h.read().get("state")!).entries.length, 0);
});
test("in-flight stale context cannot publish after a confirmed native invalidation", async () => {
  const h = harness();
  const bridge = h.load(source("watchBridge.ts"));
  const oldEpoch = bridge.watchAccessEpoch();
  const context: WatchContext = {
    schemaVersion: 1,
    workspaceKey: "family",
    mode: "family",
    status: "ready",
    expiresAt: new Date().toISOString(),
    language: "en",
    profile: { name: "Baby", birthDate: "" },
    entries: [],
    totals: { feedMl: 0, feedCount: 0, diaperCount: 0, sleepMinutes: 0 },
    totalsDate: "2026-09-18",
  };
  await bridge.invalidateWatchContext();
  assert.equal(await bridge.publishWatchContext(context, oldEpoch), null);
  assert.equal(h.native.invalidations, 1);
  assert.equal(h.native.publications.length, 0);
});
