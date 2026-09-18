import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createHash } from "node:crypto";

// Exercise the real hook and native persistence module with deterministic React,
// identity, HTTP and SQLite boundaries. No network, secrets or device are used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function until(predicate, description) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail(`Timed out waiting for ${description}`);
}

function fixture() {
  const member = {
    id: "user-a",
    displayName: "Test caregiver",
    email: "test-a@example.invalid",
    role: "owner",
    membershipId: "grant-a",
    status: "active",
    endedAt: null,
  };
  const family = {
    id: "family-a",
    babyName: "Fictional baby",
    role: "owner",
    membershipId: "grant-a",
    babyBirthDate: null,
    profileVersion: "0",
  };
  const end = new Date(Date.now() - 60_000).toISOString();
  const start = new Date(Date.now() - 1_260_000).toISOString();
  return {
    identity: {
      user: member,
      families: [family],
      pendingInvitations: [
        {
          id: "invite-b",
          familyId: "family-b",
          ownerDisplayName: "Owner",
          expiresAt: "2027-01-01T00:00:00Z",
        },
      ],
      accountDeletion: null,
    },
    state: {
      schema: 2,
      snapshot: {
        schemaVersion: 2,
        profile: { name: "Baby", birthDate: "", sex: "unspecified" },
        entries: [],
        careRecords: [],
        extrasSchemaVersion: 1,
        extraRecords: [],
        family,
        historyId: "history-a",
        revision: "0",
        members: [member],
        invitations: [],
        feeds: [],
        ownershipTransfer: null,
      },
      draft: {
        recordId: "draft-a",
        start,
        end,
        amount: "120",
        note: "",
        membershipId: "grant-a",
        historyId: "history-a",
        origin: {
          familyId: "family-a",
          userId: "user-a",
          membershipId: "grant-a",
          historyId: "history-a",
        },
      },
      queue: [],
      acknowledgedRevision: null,
      transition: null,
    },
  };
}

function makeWorld({ offline = true, queued = false } = {}) {
  const data = fixture();
  if (queued)
    data.state.queue.push({
      status: "pending",
      origin: structuredClone(data.state.draft.origin),
      operation: {
        operationId: "saved-operation-a",
        recordId: "saved-record-a",
        kind: "create",
        historyId: "history-a",
        membershipId: "grant-a",
        feed: {
          start: data.state.draft.start,
          end: data.state.draft.end,
          amount: 90,
          note: "Previously saved",
        },
      },
    });
  const account = "https://pilot.example.invalid|tenant-a|user-a";
  const world = {
    account,
    data,
    disk: new Map([[account, JSON.stringify(data.state)]]),
    ownerSetupDisk: new Map(),
    identity: structuredClone(data.identity),
    cachedIdentity: structuredClone(data.identity),
    cacheGuard: null,
    server: structuredClone(data.state.snapshot),
    session: true,
    offline,
    snapshotOffline: false,
    transactions: [],
    http: [],
    feedsSent: [],
    authSignOutCalls: 0,
    authSignInCalls: 0,
    deleteCalls: 0,
    readCalls: 0,
    beforeCommit: async () => {},
    beforeRead: async () => {},
    beforeDelete: async () => {},
    beforeAuthSignOut: async () => {},
    beforeAuthSignIn: async () => {},
    beforeSessionRead: async () => {},
    beforeIdentityLoad: async () => {},
    beforeIdentify: async () => {},
    beforeRecognize: async () => {},
    tokenSession: null,
    tokenSessionError: null,
    beforeSnapshot: async () => {},
    beforeMutation: async () => {},
    mutationReceipts: new Map(),
    deletionReceipt: null,
    beforeReceiptSave: async () => {},
    personalClears: 0,
    notificationCalls: [],
    notificationOptIn: new Map(),
    beforeNotificationEnable: async () => {},
    beforeNotificationClear: async () => {},
    beforeIdentitySave: async () => {},
    beforeCacheOriginSave: async () => {},
    personalExtras: [],
    beforeReminderDrain: async () => {},
    beforePersonalClear: async () => {},
    recordsSent: [],
    beforeRecord: async () => {},
    recordReceipts: new Map(),
    personalSource: {
      schemaVersion: 1,
      profile: { name: "Baby", birthDate: "", sex: "unspecified" },
      entries: [],
    },
  };
  let timerClock = 0;
  let timerSequence = 0;
  world.timers = new Map();
  world.intervals = new Map();
  world.runIntervals = () => {
    for (const callback of world.intervals.values()) callback();
  };
  world.advanceTimers = (milliseconds) => {
    timerClock += milliseconds;
    for (const [id, timer] of world.timers) {
      if (timer.at <= timerClock) {
        world.timers.delete(id);
        timer.callback();
      }
    }
  };
  const contexts = new Map();
  const appStateListeners = new Set();
  world.changeAppState = (value) => {
    overrides["react-native"].AppState.currentState = value;
    for (const listener of appStateListeners) listener(value);
  };
  let activeReact;
  let operationSequence = 0;
  const ownerSetupDisk = world.ownerSetupDisk;
  class PilotApiError extends Error {
    constructor(code, status = 0) {
      super(code);
      this.code = code;
      this.status = status;
    }
  }
  const database = {
    execAsync: async () => {},
    getFirstAsync: async (query, key) => {
      world.readCalls++;
      await world.beforeRead();
      const payload = (
        query.includes("owner_setup_drafts") ? ownerSetupDisk : world.disk
      ).get(key);
      return payload === undefined ? null : { payload };
    },
    withExclusiveTransactionAsync: async (callback) => {
      const transaction = {
        number: world.transactions.length + 1,
        writes: [],
        deletes: [],
      };
      world.transactions.push(transaction);
      await callback({
        runAsync: async (query, key, payload) => {
          if (query.startsWith("DELETE ")) {
            assert.match(
              query,
              /^DELETE FROM (pilot_accounts|owner_setup_drafts) WHERE account_id = \?$/,
            );
            if (query.includes("pilot_accounts")) {
              world.deleteCalls++;
              await world.beforeDelete();
            }
            transaction.deletes.push([query, key]);
          } else {
            assert.match(query, /^INSERT OR REPLACE INTO pilot_accounts/);
            transaction.writes.push([key, payload]);
          }
        },
      });
      await world.beforeCommit(transaction);
      for (const [key, payload] of transaction.writes)
        world.disk.set(key, payload);
      for (const [query, key] of transaction.deletes)
        (query.includes("owner_setup_drafts")
          ? ownerSetupDisk
          : world.disk
        ).delete(key);
    },
    runAsync: async (query, key) => {
      assert.match(query, /^DELETE /);
      world.deleteCalls++;
      await world.beforeDelete();
      world.disk.delete(key);
    },
  };
  const overrides = {
    "./familyPush": { prepareFamilyPushLogout: async () => {} },
    "../watchBridge": {
      suspendWatchContext: async () => {
        world.watchSuspends = (world.watchSuspends ?? 0) + 1;
      },
      invalidateWatchContext: async () => {
        world.watchInvalidations = (world.watchInvalidations ?? 0) + 1;
      },
      pendingWatchCommands: async () => world.watchInbox ?? [],
    },
    "./storageProtection": { protectFamilyStorage: async () => {} },
    storage: {
      clearPersonalForFamilyActivation: async () => {
        await world.beforePersonalClear();
        world.personalClears++;
      },
      setPersonalStorageBlocked: (value) => {
        world.personalBlocked = value;
      },
      drainPersonalStorageWrites: async () => {},
      loadState: async () => structuredClone(world.personalSource),
    },
    react: {
      useState: (...args) => activeReact.useState(...args),
      useRef: (...args) => activeReact.useRef(...args),
      useCallback: (...args) => activeReact.useCallback(...args),
      useEffect: (...args) => activeReact.useEffect(...args),
    },
    "react-native": {
      Platform: { OS: "ios" },
      AppState: {
        currentState: "active",
        addEventListener: (event, listener) => {
          assert.equal(event, "change");
          appStateListeners.add(listener);
          return { remove: () => appStateListeners.delete(listener) };
        },
      },
    },
    "expo-crypto": {
      CryptoDigestAlgorithm: { SHA256: "sha256" },
      digestStringAsync: async (_, value) =>
        createHash("sha256").update(value).digest("hex"),
      randomUUID: () =>
        `00000000-0000-4000-8000-${String(++operationSequence).padStart(12, "0")}`,
    },
    "expo-sqlite": { openDatabaseAsync: async () => database },
    "./personalExtras": {
      loadPersonalExtras: async () => {
        if (world.personalCaptureError)
          throw new Error(world.personalCaptureError);
        return structuredClone(world.personalExtras);
      },
    },
    "../personalWrites": {
      drainReminderWrites: async () => world.beforeReminderDrain(),
    },
    "./familyReminders": {
      loadFamilyReminderOptIn: async (origin) =>
        world.notificationOptIn.get(origin) ?? false,
      setFamilyReminderOptIn: async (origin, enabled) => {
        world.notificationCalls.push({ kind: "permission", origin, enabled });
        await world.beforeNotificationEnable();
        world.notificationOptIn.set(origin, enabled);
      },
      syncFamilyReminders: async (origin, records) => {
        world.notificationCalls.push({
          kind: "sync",
          origin,
          records: structuredClone(records),
        });
      },
      suspendFamilyReminders: async () => {
        world.notificationCalls.push({ kind: "suspend" });
      },
      clearFamilyReminders: async () => {
        world.notificationCalls.push({ kind: "clear" });
        await world.beforeNotificationClear();
        world.notificationOptIn.clear();
      },
    },
    config: {
      familyConfig: {
        apiUrl: "https://pilot.example.invalid",
        tenantId: "tenant-a",
      },
    },
    auth: {
      hasSession: async () => {
        await world.beforeSessionRead();
        return world.session;
      },
      loadIdentity: async () => {
        const cached = structuredClone(world.cachedIdentity);
        await world.beforeIdentityLoad();
        return cached;
      },
      loadCacheGuard: async () => structuredClone(world.cacheGuard),
      markReauthenticationRequired: async (userId) => {
        world.cacheGuard = {
          userId,
          reauthRequired: true,
          origin: world.cacheGuard?.origin ?? null,
        };
      },
      saveCacheOrigin: async (origin) => {
        await world.beforeCacheOriginSave(origin);
        if (world.cacheGuard?.reauthRequired)
          throw new Error("sign_in_required");
        world.cacheGuard = {
          userId: origin.userId,
          reauthRequired: false,
          origin: structuredClone(origin),
        };
      },
      saveIdentity: async (identity) => {
        await world.beforeIdentitySave();
        world.cachedIdentity = structuredClone(identity);
      },
      signIn: async () => {
        world.authSignInCalls++;
        await world.beforeAuthSignIn();
        world.session = true;
        world.cachedIdentity = null;
        world.cacheGuard = null;
      },
      signOut: async () => {
        world.authSignOutCalls++;
        await world.beforeAuthSignOut();
        world.session = false;
        world.cachedIdentity = null;
        world.cacheGuard = null;
      },
    },
    deletionReceipt: {
      loadDeletionReceipt: async () => structuredClone(world.deletionReceipt),
      saveDeletionReceipt: async (receipt) => {
        await world.beforeReceiptSave(receipt);
        world.deletionReceipt = structuredClone(receipt);
      },
      clearDeletionReceipt: async () => {
        world.deletionReceipt = null;
      },
    },
    api: {
      PilotApiError,
      familyRequest: async (url, operation, signal) => {
        world.http.push({ url, operation });
        if (world.offline) throw new PilotApiError("network_unavailable");
        if (url === "/v1/session") {
          await world.beforeRecognize(signal);
          if (world.tokenSessionError)
            throw new PilotApiError(
              world.tokenSessionError.code,
              world.tokenSessionError.status,
            );
          if (!world.tokenSession)
            throw new PilotApiError("request_failed", 404);
          return structuredClone(world.tokenSession);
        }
        if (url === "/v1/me") {
          await world.beforeIdentify(signal);
          if (world.identityError)
            throw new PilotApiError(
              world.identityError.code,
              world.identityError.status,
            );
          if (world.identityDenied)
            throw new PilotApiError("identity_not_supported", 403);
          return structuredClone(world.identity);
        }
        if (url === "/v2/capabilities")
          return (
            world.capabilities ?? {
              schemaVersion: 2,
              recordKinds: [
                "feed",
                "diaper",
                "sleep",
                "growth",
                "milestone",
                "care",
              ],
              maxSeedBytes: 33554432,
              extrasSchemaVersion: 1,
            }
          );
        if (url.endsWith("/record-operations")) {
          const durable = JSON.parse(world.disk.get(account));
          world.recordsSent.push({
            operation: structuredClone(operation),
            durablySaved: durable.records.some(
              (q) => q.operation.operationId === operation.operationId,
            ),
          });
          if (world.recordReceipts.has(operation.operationId))
            return structuredClone(
              world.recordReceipts.get(operation.operationId),
            );
          const collection =
              operation.collection === "entry"
                ? "entries"
                : operation.collection === "extra"
                  ? "extraRecords"
                  : "careRecords",
            field = collection === "entries" ? "entry" : "record";
          const found = world.server[collection].find(
            (r) => r[field].id === operation.recordId,
          );
          if (
            operation.kind !== "create" &&
            found?.version !== operation.baseVersion
          )
            throw new PilotApiError("record_changed", 412);
          world.server[collection] = world.server[collection].filter(
            (r) => r[field].id !== operation.recordId,
          );
          world.server.revision = String(Number(world.server.revision) + 1);
          if (operation.kind !== "delete")
            world.server[collection].push({
              [field]:
                operation.entry ??
                operation.careRecord ??
                operation.extraRecord,
              version: world.server.revision,
              recordedBy: found?.recordedBy ?? world.identity.user.id,
              lastEditedBy: world.identity.user.id,
            });
          const receipt = {
            operationId: operation.operationId,
            historyId: world.server.historyId,
            revision: world.server.revision,
          };
          world.recordReceipts.set(operation.operationId, receipt);
          await world.beforeRecord(operation);
          return receipt;
        }
        if (url.endsWith("/snapshot")) {
          await world.beforeSnapshot(signal);
          if (world.snapshotOffline)
            throw new PilotApiError("network_unavailable");
          if (world.snapshotUnsupported)
            throw new PilotApiError("family_schema_unsupported", 409);
          return structuredClone(world.server);
        }
        if (url.endsWith("/feed-operations")) {
          const committed = JSON.parse(world.disk.get(account));
          world.feedsSent.push({
            operation: structuredClone(operation),
            durablySaved: committed.queue.some(
              (item) => item.operation.operationId === operation.operationId,
            ),
          });
          world.server.revision = String(Number(world.server.revision) + 1);
          if (operation.kind === "delete")
            world.server.feeds = world.server.feeds.filter(
              (feed) => feed.id !== operation.recordId,
            );
          else {
            world.server.feeds = world.server.feeds.filter(
              (feed) => feed.id !== operation.recordId,
            );
            world.server.feeds.push({
              ...operation.feed,
              id: operation.recordId,
              version: world.server.revision,
              recordedBy: world.identity.user.id,
              lastEditedBy: world.identity.user.id,
            });
          }
          return {
            operationId: operation.operationId,
            historyId: world.server.historyId,
            revision: world.server.revision,
          };
        }
        if (operation?.operationId) {
          const previous = world.mutationReceipts.get(operation.operationId);
          if (previous) return structuredClone(previous);
          const committed = JSON.parse(world.disk.get(account));
          assert.equal(
            committed.transition?.operationId,
            operation.operationId,
            "Lifecycle mutation was sent before its durable intent",
          );
          if (url.endsWith("/leave") || url.endsWith("/close"))
            world.identity.families = [];
          else if (
            url.endsWith("/accept") &&
            url.startsWith("/v1/invitations/")
          ) {
            world.identity.families = [structuredClone(world.server.family)];
          } else if (url === "/v2/families") {
            world.server.extraRecords = (operation.seed.extraRecords ?? []).map(
              (record) => ({
                record: structuredClone(record),
                version: "1",
                recordedBy: "user-a",
                lastEditedBy: "user-a",
              }),
            );
            world.server.profile = structuredClone(
              operation.seed.source.profile,
            );
            world.server.entries = operation.seed.source.entries.map(
              (entry) => ({
                entry: structuredClone(entry),
                version: "1",
                recordedBy: "user-a",
                lastEditedBy: "user-a",
              }),
            );
            world.server.careRecords = (
              operation.seed.source.careRecords ?? []
            ).map((record) => ({
              record: structuredClone(record),
              version: "1",
              recordedBy: "user-a",
              lastEditedBy: "user-a",
            }));
            world.identity.families = [structuredClone(world.server.family)];
          } else if (url === "/v1/account/delete") {
            world.identity.families = [];
            world.identity.accountDeletion = {
              status: "pending",
              requestedAt: new Date().toISOString(),
            };
          }
          const receipt =
            url === "/v1/account/delete"
              ? {
                  deletionId: operation.operationId,
                  ...world.identity.accountDeletion,
                }
              : url === "/v2/families"
                ? {
                    operationId: operation.operationId,
                    familyId: world.server.family.id,
                    membershipId: world.server.family.membershipId,
                    historyId: world.server.historyId,
                    seedDigest: createHash("sha256")
                      .update(JSON.stringify(operation.seed))
                      .digest("hex"),
                    snapshot: structuredClone(world.server),
                  }
                : url.startsWith("/v1/invitations/") && url.endsWith("/accept")
                  ? structuredClone(world.server.family)
                  : { ok: true };
          world.mutationReceipts.set(operation.operationId, receipt);
          await world.beforeMutation(url, operation);
          return world.corruptMutationResponse ? {} : receipt;
        }
        throw new Error(`Unexpected request ${url}`);
      },
    },
  };
  function loadModule(filename) {
    if (contexts.has(filename)) return contexts.get(filename).exports;
    const module = { exports: {} };
    contexts.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const require = (specifier) => {
      if (overrides[specifier]) return overrides[specifier];
      if (specifier.startsWith(".")) {
        const basename = path.basename(specifier);
        if (
          ["auth", "api", "config", "deletionReceipt", "storage"].includes(
            basename,
          )
        )
          return overrides[basename];
        const base = path.resolve(path.dirname(filename), specifier);
        const next = [".native.ts", ".ts"]
          .map((extension) => base + extension)
          .find((candidate) => fs.existsSync(candidate));
        assert.ok(next, `Unknown module ${specifier}`);
        return loadModule(next);
      }
      throw new Error(`Unstubbed module ${specifier}`);
    };
    vm.runInNewContext(
      code,
      {
        module,
        exports: module.exports,
        require,
        Date,
        Map,
        Set,
        BigInt,
        Promise,
        Error,
        AbortController,
        structuredClone,
        setTimeout: (callback, delay) => {
          const id = ++timerSequence;
          world.timers.set(id, { callback, at: timerClock + delay });
          return id;
        },
        clearTimeout: (id) => world.timers.delete(id),
        fetch: async (url, request) => {
          assert.equal(
            url,
            "https://pilot.example.invalid/v1/account-deletion-status",
          );
          const body = JSON.parse(request.body);
          assert.equal(body.receiptSecret, world.deletionReceipt.receiptSecret);
          return {
            ok: true,
            json: async () => ({
              deletionId: body.deletionId,
              status: "completed",
              requestedAt: world.deletionReceipt.requestedAt,
            }),
          };
        },
        setInterval: (callback) => {
          const id = ++timerSequence;
          world.intervals.set(id, callback);
          return id;
        },
        clearInterval: (id) => world.intervals.delete(id),
      },
      { filename },
    );
    return module.exports;
  }
  const { useFamilyPilot } = loadModule(
    path.join(root, "src/family/useFamilyPilot.ts"),
  );
  world.mount = () => {
    const slots = [];
    const effects = [];
    let cursor = 0;
    const sameDeps = (left, right) =>
      left?.length === right?.length &&
      left.every((item, index) => Object.is(item, right[index]));
    const react = {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots))
          slots[index] = typeof initial === "function" ? initial() : initial;
        return [
          slots[index],
          (next) => {
            slots[index] =
              typeof next === "function" ? next(slots[index]) : next;
            world.onStateChange?.(slots[index]);
          },
        ];
      },
      useRef(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { current: initial };
        return slots[index];
      },
      useCallback(callback, dependencies) {
        const index = cursor++;
        if (
          !(index in slots) ||
          !sameDeps(slots[index].dependencies, dependencies)
        )
          slots[index] = { callback, dependencies };
        return slots[index].callback;
      },
      useEffect(callback, dependencies) {
        const index = cursor++;
        if (
          !(index in slots) ||
          !sameDeps(slots[index].dependencies, dependencies)
        ) {
          slots[index] = { dependencies };
          effects.push(callback);
        }
      },
    };
    function result() {
      cursor = 0;
      activeReact = react;
      const value = useFamilyPilot();
      activeReact = undefined;
      return value;
    }
    result();
    const cleanups = effects.splice(0).map((effect) => effect());
    return {
      result,
      flushEffects: () => {
        cleanups.push(...effects.splice(0).map((effect) => effect()));
      },
      unmount: () => cleanups.forEach((cleanup) => cleanup?.()),
    };
  };
  world.read = () => {
    const payload = world.disk.get(account);
    return payload ? JSON.parse(payload) : null;
  };
  return world;
}

async function boot(world) {
  const controller = world.mount();
  await until(
    () =>
      controller.result().user?.id === "user-a" &&
      world.http.length > 0 &&
      !controller.result().syncing,
    "cached offline bootstrap",
  );
  return controller;
}

const recognizedUserId = "11111111-1111-4111-8111-111111111111";
const otherRecognizedUserId = "22222222-2222-4222-8222-222222222222";
function recognitionWorld() {
  const world = ownerWorld();
  world.identity.user.id = recognizedUserId;
  world.identity.pendingInvitations = [];
  world.cachedIdentity = null;
  world.session = false;
  world.tokenSession = {
    status: "token_valid",
    userId: recognizedUserId,
    accountAccess: "pending",
    familyAccess: "pending",
  };
  return world;
}
async function signedOutController(world) {
  const controller = world.mount();
  await until(() => !controller.result().booting, "signed-out initialization");
  return controller;
}

test("fresh sign-in recognizes its token promptly while SQL-backed identity remains pending", async () => {
  const world = recognitionWorld();
  const controller = await signedOutController(world);
  const me = deferred();
  world.beforeIdentify = () => me.promise;
  try {
    await controller.result().signIn();
    assert.equal(controller.result().authStatus, "token_confirmed");
    assert.equal(controller.result().tokenRecognized, true);
    assert.equal(controller.result().busy, false);
    assert.equal(controller.result().syncing, true);
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().ready, false);
    assert.equal(controller.result().sharedState, null);
    assert.equal(controller.result().sharedMode, true);
    assert.equal(world.cachedIdentity, null);
    await assert.rejects(
      controller.result().createFamily("New baby"),
      /refresh_required/,
    );
    assert.equal(
      world.http.some((request) => request.operation),
      false,
    );
    me.resolve();
    await until(
      () => !controller.result().syncing,
      "authoritative account completion",
    );
    assert.equal(controller.result().authStatus, "authenticated");
    assert.equal(controller.result().user.id, recognizedUserId);
    assert.equal(world.cachedIdentity.user.id, recognizedUserId);
    const probes = world.http.filter(
      (request) => request.url === "/v1/session",
    ).length;
    await controller.result().refresh();
    assert.equal(
      world.http.filter((request) => request.url === "/v1/session").length,
      probes,
    );
  } finally {
    me.resolve();
    controller.unmount();
  }
});

for (const code of [
  "identity_unavailable",
  "service_unavailable",
  "network_unavailable",
])
  test(`recognized sign-in survives ${code} and retains bounded background retry`, async () => {
    const world = recognitionWorld();
    const controller = await signedOutController(world);
    let attempts = 0;
    world.beforeIdentify = async () => {
      attempts++;
    };
    world.identityError = {
      code,
      status: code === "network_unavailable" ? 0 : 503,
    };
    try {
      await controller.result().signIn();
      await until(() => !controller.result().syncing, "failed account check");
      assert.equal(attempts, 2);
      assert.equal(controller.result().authStatus, "token_confirmed");
      assert.equal(controller.result().tokenRecognized, true);
      assert.equal(controller.result().error, code);
      assert.equal(controller.result().user, null);
      assert.equal(controller.result().ready, false);
      assert.equal(world.authSignOutCalls, 0);
      world.identityError = null;
      await controller.result().refresh();
      assert.equal(controller.result().authStatus, "authenticated");
    } finally {
      controller.unmount();
    }
  });

for (const field of ["status", "userId", "accountAccess", "familyAccess"])
  test(`malformed session ${field} cannot create an authoritative identity`, async () => {
    const world = recognitionWorld();
    world.tokenSession[field] = "forged";
    const controller = await signedOutController(world);
    try {
      await assert.rejects(controller.result().signIn(), /invalid_response/);
      assert.equal(controller.result().tokenRecognized, false);
      assert.equal(controller.result().user, null);
      assert.equal(controller.result().ready, false);
      assert.equal(world.cachedIdentity, null);
      assert.equal(
        world.http.some((request) => request.url === "/v1/me"),
        false,
      );
    } finally {
      controller.unmount();
    }
  });

test("authoritative identity must match the recognized token subject", async () => {
  const world = recognitionWorld();
  const controller = await signedOutController(world);
  world.identity.user.id = otherRecognizedUserId;
  try {
    await controller.result().signIn();
    await until(() => !world.session, "wrong-subject logout");
    assert.equal(controller.result().authStatus, "signed_out");
    assert.equal(controller.result().tokenRecognized, false);
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().ready, false);
    assert.equal(controller.result().error, "account_mismatch");
    assert.equal(world.cachedIdentity, null);
  } finally {
    controller.unmount();
  }
});

test("a different recognized account cannot expose or overwrite the previous account's private work", async () => {
  const world = makeWorld({ queued: true });
  const controller = await boot(world);
  const original = world.disk.get(world.account);
  world.offline = false;
  world.tokenSession = recognitionWorld().tokenSession;
  try {
    await assert.rejects(controller.result().signIn(), /account_mismatch/);
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().sharedState, null);
    assert.equal(controller.result().tokenRecognized, false);
    assert.equal(world.disk.get(world.account), original);
    assert.equal(world.feedsSent.length, 0);
  } finally {
    controller.unmount();
  }
});

test("logout cancels pending authoritative identity without losing recognized-state controls", async () => {
  const world = recognitionWorld();
  const controller = await signedOutController(world);
  let signal;
  world.beforeIdentify = (value) => {
    signal = value;
    return new Promise((_, reject) =>
      value.addEventListener(
        "abort",
        () => reject(new Error("network_unavailable")),
        { once: true },
      ),
    );
  };
  try {
    await controller.result().signIn();
    await until(() => signal, "pending account request");
    await controller.result().signOut();
    assert.equal(signal.aborted, true);
    assert.equal(controller.result().authStatus, "signed_out");
    assert.equal(controller.result().tokenRecognized, false);
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().ready, false);
    assert.equal(world.session, false);
  } finally {
    controller.unmount();
  }
});

test("replacement sign-in and duplicate taps cannot wait for or invalidate a SQL request", async () => {
  const world = recognitionWorld();
  world.session = true;
  const oldMe = deferred();
  let attempts = 0;
  world.beforeIdentify = () =>
    ++attempts === 1 ? oldMe.promise : Promise.resolve();
  const controller = world.mount();
  const browser = deferred();
  world.beforeAuthSignIn = () => browser.promise;
  try {
    await until(() => attempts === 1, "stalled startup identity");
    const login = controller.result().signIn();
    await until(
      () => world.authSignInCalls === 1,
      "browser launched without waiting for SQL",
    );
    await assert.rejects(controller.result().signIn(), /action_busy/);
    browser.resolve();
    await login;
    await until(
      () => controller.result().authStatus === "authenticated",
      "accepted login completes",
    );
    oldMe.resolve();
    await tick();
    assert.equal(world.authSignInCalls, 1);
    assert.equal(controller.result().user.id, recognizedUserId);
  } finally {
    browser.resolve();
    oldMe.resolve();
    controller.unmount();
  }
});

test("cancelled browser login never calls token recognition or erases cached private work", async () => {
  const world = makeWorld({ queued: true });
  const controller = await boot(world);
  const original = world.disk.get(world.account);
  const requests = world.http.length;
  world.beforeAuthSignIn = async () => {
    throw new Error("sign_in_cancelled");
  };
  try {
    await assert.rejects(controller.result().signIn(), /sign_in_cancelled/);
    assert.equal(world.http.length, requests);
    assert.equal(world.disk.get(world.account), original);
    assert.equal(controller.result().user.id, "user-a");
    assert.equal(controller.result().notice, "sign_in_cancelled");
  } finally {
    controller.unmount();
  }
});

test("an older API without session recognition safely waits for authoritative sign-in", async () => {
  const world = recognitionWorld();
  world.tokenSession = null;
  const controller = await signedOutController(world);
  const me = deferred();
  world.beforeIdentify = () => me.promise;
  try {
    const login = controller.result().signIn();
    await until(
      () => world.http.some((request) => request.url === "/v1/me"),
      "legacy API identity",
    );
    assert.equal(controller.result().tokenRecognized, false);
    assert.equal(controller.result().ready, false);
    assert.equal(controller.result().user, null);
    me.resolve();
    await login;
    assert.equal(controller.result().authStatus, "authenticated");
  } finally {
    me.resolve();
    controller.unmount();
  }
});

test("authoritative account deletion outranks a delayed token-only response", async () => {
  const world = recognitionWorld();
  world.session = true;
  world.identity.accountDeletion = {
    deletionId: "delete-a",
    status: "pending",
    requestedAt: "2026-09-01T00:00:00Z",
  };
  const recognition = deferred();
  world.beforeRecognize = () => recognition.promise;
  const controller = world.mount();
  try {
    await until(
      () =>
        controller.result().authStatus === "authenticated" &&
        !controller.result().syncing,
      "authoritative deletion",
    );
    recognition.resolve();
    await tick();
    assert.equal(controller.result().authStatus, "authenticated");
    assert.equal(controller.result().accountDeletion.status, "pending");
    assert.equal(controller.result().sharedState, null);
  } finally {
    recognition.resolve();
    controller.unmount();
  }
});

test("healthy foreground recognition preserves verified account controls while the authoritative refresh runs", async () => {
  const world = recognitionWorld();
  const controller = await signedOutController(world);
  const me = deferred();
  try {
    await controller.result().signIn();
    await until(
      () => !controller.result().syncing,
      "initial authoritative verification",
    );
    world.beforeIdentify = () => me.promise;
    const probes = world.http.filter(
      (request) => request.url === "/v1/session",
    ).length;
    world.changeAppState("background");
    world.changeAppState("active");
    await until(
      () =>
        world.http.filter((request) => request.url === "/v1/session").length ===
        probes + 1,
      "foreground token check",
    );
    await tick();
    assert.equal(controller.result().authStatus, "authenticated");
    assert.equal(controller.result().user.id, recognizedUserId);
    assert.equal(controller.result().ready, true);
    me.resolve();
    await until(
      () => !controller.result().syncing,
      "foreground authority complete",
    );
    assert.equal(controller.result().authStatus, "authenticated");
  } finally {
    me.resolve();
    controller.unmount();
  }
});

test("saved credentials remain recoverable when session recognition and account services are temporarily unavailable", async () => {
  const world = recognitionWorld();
  const controller = await signedOutController(world);
  world.tokenSessionError = { code: "service_unavailable", status: 503 };
  world.identityError = { code: "identity_unavailable", status: 503 };
  try {
    await controller.result().signIn();
    await until(
      () => !controller.result().syncing,
      "unavailable initial verification",
    );
    assert.equal(controller.result().sessionAvailable, true);
    assert.equal(controller.result().tokenRecognized, false);
    assert.equal(controller.result().authStatus, "unverified");
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().ready, false);
    world.tokenSessionError = null;
    world.identityError = null;
    world.changeAppState("background");
    world.changeAppState("active");
    await until(
      () => controller.result().authStatus === "authenticated",
      "automatic recovery without another browser login",
    );
    assert.equal(world.authSignInCalls, 1);
    assert.equal(controller.result().user.id, recognizedUserId);
  } finally {
    controller.unmount();
  }
});

test("successful browser reauthentication resumes account verification after a transient session probe failure", async () => {
  const world = makeWorld({ queued: true });
  const controller = await boot(world);
  const me = deferred();
  try {
    world.offline = false;
    world.identityError = { code: "sign_in_required", status: 401 };
    await controller.result().refresh();
    assert.equal(controller.result().authStatus, "reauth_required");
    world.identityError = null;
    world.tokenSessionError = { code: "service_unavailable", status: 503 };
    const requests = world.http.filter(
      (request) => request.url === "/v1/me",
    ).length;
    world.beforeIdentify = () => me.promise;
    await controller.result().signIn();
    await until(
      () =>
        world.http.filter((request) => request.url === "/v1/me").length >
        requests,
      "fresh account verification after browser reauth",
    );
    assert.equal(controller.result().authStatus, "unverified");
    assert.equal(controller.result().sessionAvailable, true);
    assert.equal(controller.result().tokenRecognized, false);
    assert.equal(controller.result().ready, false);
    assert.equal(controller.result().sharedState, null);
    assert.equal(world.feedsSent.length, 0);
    world.identityError = { code: "sign_in_required", status: 401 };
    me.resolve();
    await until(() => !controller.result().syncing, "fresh account denial");
    assert.equal(controller.result().authStatus, "reauth_required");
    assert.equal(controller.result().ready, false);
    const deniedRequests = world.http.length;
    world.changeAppState("background");
    world.changeAppState("active");
    world.runIntervals();
    await tick();
    assert.equal(
      world.http.length,
      deniedRequests,
      "a new 401 reinstates the retry barrier",
    );
  } finally {
    me.resolve();
    controller.unmount();
  }
});

test("a repeated explicit sign-in preserves the original account binding after the first probe is denied", async () => {
  const world = makeWorld({ queued: true });
  const controller = await boot(world);
  const original = world.disk.get(world.account);
  try {
    world.offline = false;
    world.tokenSessionError = { code: "sign_in_required", status: 401 };
    await assert.rejects(controller.result().signIn(), /sign_in_required/);
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().authStatus, "reauth_required");
    world.tokenSessionError = null;
    world.tokenSession = {
      ...recognitionWorld().tokenSession,
      userId: otherRecognizedUserId,
    };
    await assert.rejects(controller.result().signIn(), /account_mismatch/);
    assert.equal(controller.result().authStatus, "signed_out");
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().ready, false);
    assert.equal(world.disk.get(world.account), original);
    assert.equal(world.feedsSent.length, 0);
  } finally {
    controller.unmount();
  }
});

for (const blockedRead of ["identity", "workspace"])
  test(`foreground and timer checks wait for the initial local ${blockedRead} restore before checking authority`, async () => {
    const world = makeWorld({ offline: false, queued: true });
    const local = deferred();
    let entered = false;
    const block = async () => {
      entered = true;
      await local.promise;
    };
    if (blockedRead === "identity") world.beforeIdentityLoad = block;
    else world.beforeRead = block;
    world.identity.families = [];
    const controller = world.mount();
    try {
      await until(() => entered, "blocked local bootstrap");
      world.changeAppState("background");
      world.changeAppState("active");
      world.runIntervals();
      await tick();
      assert.equal(
        world.http.length,
        0,
        "authority requests cannot race an unfinished cache restore",
      );
      assert.equal(controller.result().ready, false);
      local.resolve();
      await until(
        () =>
          controller.result().authStatus === "authenticated" &&
          !controller.result().syncing,
        "authoritative revocation after local restore",
      );
      assert.equal(controller.result().user.id, "user-a");
      assert.equal(controller.result().snapshot, null);
      assert.equal(controller.result().sharedState, null);
      assert.equal(controller.result().pending.length, 0);
      assert.equal(world.feedsSent.length, 0);
      world.runIntervals();
      await tick();
      assert.equal(
        controller.result().snapshot,
        null,
        "the old local grant cannot overwrite revocation later",
      );
    } finally {
      local.resolve();
      controller.unmount();
    }
  });

test("foreground recognition after a transient probe failure cannot replace the bound previous account", async () => {
  const world = makeWorld({ queued: true });
  const controller = await boot(world);
  const original = world.disk.get(world.account);
  world.offline = false;
  world.tokenSessionError = { code: "service_unavailable", status: 503 };
  world.beforeIdentify = (signal) =>
    new Promise((_, reject) =>
      signal.addEventListener(
        "abort",
        () => reject(new Error("network_unavailable")),
        { once: true },
      ),
    );
  try {
    await controller.result().signIn();
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().tokenRecognized, false);
    world.tokenSessionError = null;
    world.tokenSession = {
      ...recognitionWorld().tokenSession,
      userId: otherRecognizedUserId,
    };
    world.identity.user.id = otherRecognizedUserId;
    world.changeAppState("background");
    world.changeAppState("active");
    await until(() => !world.session, "foreground subject mismatch logout");
    assert.equal(controller.result().authStatus, "signed_out");
    assert.equal(controller.result().tokenRecognized, false);
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().sharedState, null);
    assert.equal(controller.result().error, "account_mismatch");
    assert.equal(world.disk.get(world.account), original);
    assert.equal(world.feedsSent.length, 0);
  } finally {
    controller.unmount();
  }
});

test("session forbidden persists the cached-access guard before a stalled authoritative request can finish", async () => {
  const world = makeWorld({ offline: false, queued: true });
  world.tokenSessionError = { code: "forbidden", status: 403 };
  const me = deferred();
  world.beforeIdentify = () => me.promise;
  const controller = world.mount();
  let reopened;
  try {
    await until(
      () =>
        controller.result().error === "forbidden" &&
        world.cacheGuard?.reauthRequired,
      "durable session denial guard",
    );
    assert.equal(controller.result().sharedState, null);
    controller.unmount();
    world.tokenSessionError = null;
    reopened = world.mount();
    await until(() => !reopened.result().booting, "guarded restart");
    assert.equal(reopened.result().ready, false);
    assert.equal(reopened.result().sharedState, null);
    assert.equal(world.read().queue.length, 1);
  } finally {
    reopened?.unmount();
    controller.unmount();
    me.resolve();
  }
});

for (const recognized of [true, false])
  test(`logout during ${recognized ? "recognized" : "unverified"} reauthentication durably discards the bound old workspace`, async () => {
    const world = makeWorld({ queued: true });
    const replaceSubject = (value) =>
      JSON.parse(JSON.stringify(value).replaceAll("user-a", recognizedUserId));
    const previousAccount = world.account;
    world.account = previousAccount.replace("user-a", recognizedUserId);
    world.identity = replaceSubject(world.identity);
    world.cachedIdentity = replaceSubject(world.cachedIdentity);
    world.server = replaceSubject(world.server);
    world.disk.set(
      world.account,
      JSON.stringify(replaceSubject(world.data.state)),
    );
    world.disk.delete(previousAccount);
    const controller = world.mount();
    try {
      await until(
        () =>
          controller.result().user?.id === recognizedUserId &&
          !controller.result().syncing,
        "bound cached workspace",
      );
      world.offline = false;
      world.tokenSession = recognitionWorld().tokenSession;
      if (!recognized)
        world.tokenSessionError = { code: "service_unavailable", status: 503 };
      world.beforeIdentify = (signal) =>
        new Promise((_, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("network_unavailable")),
            { once: true },
          ),
        );
      await controller.result().signIn();
      assert.equal(controller.result().user, null);
      assert.equal(controller.result().tokenRecognized, recognized);
      assert.equal(
        JSON.parse(world.disk.get(world.account)).queue.length,
        1,
        "reauthentication alone retains private work",
      );
      await controller.result().signOut();
      assert.equal(controller.result().sessionAvailable, false);
      assert.equal(world.disk.has(world.account), false);
      world.beforeIdentify = async () => {};
      world.tokenSessionError = null;
      world.identity.families = [];
      await controller.result().signIn();
      await until(
        () => !controller.result().syncing,
        "new login after explicit discard",
      );
      assert.equal(controller.result().pending.length, 0);
      assert.equal(controller.result().draft, null);
      assert.equal(world.feedsSent.length, 0);
    } finally {
      controller.unmount();
    }
  });

test("sign-in requested during an accepted lifecycle command does not abort that command", async () => {
  const world = ownerWorld();
  const controller = await boot(world);
  const mutation = deferred();
  world.beforeMutation = () => mutation.promise;
  try {
    const deleting = controller.result().deleteAccount();
    await until(
      () => world.http.some((request) => request.url === "/v1/account/delete"),
      "accepted deletion command",
    );
    await assert.rejects(controller.result().signIn(), /action_busy/);
    assert.equal(world.authSignInCalls, 0);
    mutation.resolve();
    await deleting;
    assert.ok(controller.result().accountDeletion);
    assert.equal(controller.result().transitionPending, false);
  } finally {
    mutation.resolve();
    controller.unmount();
  }
});

for (const status of [401, 403])
  test(`session ${status} cannot be hidden by a later in-flight identity success`, async () => {
    const world = recognitionWorld();
    world.session = true;
    world.tokenSessionError = {
      code: status === 401 ? "sign_in_required" : "forbidden",
      status,
    };
    const me = deferred();
    world.beforeIdentify = () => me.promise;
    const controller = world.mount();
    try {
      await until(() => controller.result().error, "visible token denial");
      me.resolve();
      await until(
        () => !controller.result().syncing,
        "stale successful account response",
      );
      assert.equal(controller.result().tokenRecognized, false);
      assert.equal(controller.result().ready, false);
      assert.equal(controller.result().user, null);
      assert.equal(
        controller.result().error,
        status === 401 ? "sign_in_required" : "forbidden",
      );
    } finally {
      me.resolve();
      controller.unmount();
    }
  });

test("idle refresh downloads one snapshot and coalesces repeated refresh taps", async () => {
  const world = makeWorld({ offline: false });
  const c = await boot(world);
  const gate = deferred();
  try {
    world.http.length = 0;
    world.beforeSnapshot = () => gate.promise;
    const first = c.result().refresh();
    await until(
      () => world.http.some((r) => r.url.endsWith("/snapshot")),
      "refresh snapshot",
    );
    const second = c.result().refresh();
    assert.ok(
      c.result().sharedState,
      "cached UI remains visible during refresh",
    );
    gate.resolve();
    await Promise.all([first, second]);
    assert.equal(world.http.filter((r) => r.url === "/v1/me").length, 1);
    assert.equal(
      world.http.filter((r) => r.url.endsWith("/snapshot")).length,
      1,
    );
  } finally {
    gate.resolve();
    c.unmount();
  }
});

test("a save included in an in-flight refresh does not schedule an empty second sync", async () => {
  const world = makeWorld({ offline: false });
  const c = await boot(world);
  const gate = deferred();
  try {
    world.http.length = 0;
    world.beforeSnapshot = () => gate.promise;
    const refresh = c.result().refresh();
    await until(
      () => world.http.some((r) => r.url.endsWith("/snapshot")),
      "pre-write snapshot",
    );
    const entry = {
      id: "responsive-diaper",
      type: "diaper",
      start: new Date().toISOString(),
      diaperKind: "wet",
      note: "",
    };
    await c.result().saveRecord("entry", entry);
    assert.equal(c.result().sharedState.entries[0].id, entry.id);
    assert.equal(world.recordsSent.length, 0);
    gate.resolve();
    await refresh;
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(world.recordsSent.length, 1);
    assert.equal(world.http.filter((r) => r.url === "/v1/me").length, 1);
    assert.equal(
      world.http.filter((r) => r.url.endsWith("/snapshot")).length,
      2,
      "grants before write and authoritative result after write",
    );
    assert.equal(world.read().records.length, 0);
  } finally {
    gate.resolve();
    c.unmount();
  }
});

for (const failDiscard of [false, true]) {
  test(`logout cancels a stalled API snapshot${failDiscard ? " and a failed local discard permits later refresh" : " without waiting for timeout"}`, async () => {
    const world = makeWorld({ offline: false });
    const c = await boot(world);
    let requestSignal;
    let release;
    world.beforeSnapshot = (signal) =>
      new Promise((resolve, reject) => {
        requestSignal = signal;
        release = resolve;
        signal.addEventListener(
          "abort",
          () => reject(new Error("network_unavailable")),
          { once: true },
        );
      });
    try {
      const refresh = c.result().refresh();
      await until(() => requestSignal, "blocked cancellable snapshot");
      if (failDiscard)
        world.beforeCommit = async () => {
          throw new Error("disk full");
        };
      const logout = c.result().signOut();
      // Attach before yielding so a deliberate local failure is handled.
      const result = logout.then(
        () => null,
        (error) => error,
      );
      await until(
        () => requestSignal.aborted,
        "logout abort without server reply",
      );
      const error = await result;
      await refresh;
      if (failDiscard) {
        assert.match(error.message, /local_save_failed/);
        assert.equal(world.authSignOutCalls, 0);
        assert.ok(c.result().user);
        world.beforeCommit = async () => {};
        world.beforeSnapshot = async (signal) =>
          assert.equal(signal.aborted, false);
        await c.result().refresh();
        assert.equal(c.result().error, null);
      } else {
        assert.equal(error, null);
        assert.equal(c.result().user, null);
        assert.equal(c.result().sharedState, null);
        assert.equal(world.read(), null);
      }
    } finally {
      release?.();
      c.unmount();
    }
  });
}

test("quiet resume retries an interrupted identity check without flashing offline or repeating queued writes", async () => {
  const world = makeWorld({ offline: false });
  const controller = await boot(world);
  const interrupted = deferred();
  const fresh = deferred();
  const states = [];
  let attempts = 0;
  let activeRequests = 0;
  let maxActiveRequests = 0;
  world.http.length = 0;
  world.beforeIdentify = async () => {
    const attempt = ++attempts;
    maxActiveRequests = Math.max(maxActiveRequests, ++activeRequests);
    try {
      await (attempt === 1 ? interrupted.promise : fresh.promise);
    } finally {
      activeRequests--;
    }
  };
  world.onStateChange = (value) => states.push(value);
  try {
    const refresh = controller.result().refresh();
    await until(() => attempts === 1, "identity check before backgrounding");
    world.changeAppState("background");
    world.changeAppState("active");
    interrupted.reject(new Error("network_unavailable"));
    await until(() => attempts === 2, "fresh foreground identity retry");
    assert.equal(controller.result().ready, true);
    assert.equal(controller.result().sharedState.profile.name, "Baby");
    assert.equal(controller.result().error, null);
    assert.notEqual(controller.result().authStatus, "unverified");
    await controller.result().saveRecord("entry", {
      id: "quiet-resume-diaper",
      type: "diaper",
      start: new Date().toISOString(),
      diaperKind: "wet",
      note: "Saved while reconnecting",
    });
    assert.equal(world.read().records.length, 1);
    assert.equal(world.recordsSent.length, 0);
    fresh.resolve();
    await refresh;
    await until(
      () => !controller.result().syncing && world.recordsSent.length === 1,
      "verified retry and durable queued write",
    );
    assert.equal(maxActiveRequests, 1, "identity checks must not overlap");
    assert.equal(attempts, 2, "only one fresh foreground retry is needed");
    assert.equal(world.recordsSent[0].durablySaved, true);
    assert.equal(world.read().records.length, 0);
    assert.equal(states.includes("network_unavailable"), false);
    assert.equal(states.includes("unverified"), false);
    assert.equal(controller.result().sharedState.profile.name, "Baby");
    assert.equal(controller.result().authStatus, "authenticated");
  } finally {
    world.onStateChange = null;
    interrupted.resolve();
    fresh.resolve();
    controller.unmount();
  }
});

test("quiet resume reports a continuing outage after its one fresh identity retry fails", async () => {
  const world = makeWorld({ offline: false });
  const controller = await boot(world);
  const interrupted = deferred();
  const fresh = deferred();
  let attempts = 0;
  world.beforeIdentify = () =>
    ++attempts === 1 ? interrupted.promise : fresh.promise;
  try {
    const refresh = controller.result().refresh();
    await until(() => attempts === 1, "identity request before suspension");
    world.changeAppState("background");
    world.changeAppState("active");
    interrupted.reject(new Error("network_unavailable"));
    await until(() => attempts === 2, "one immediate foreground retry");
    assert.equal(controller.result().error, null);
    assert.notEqual(controller.result().authStatus, "unverified");
    fresh.reject(new Error("network_unavailable"));
    await refresh;
    await until(() => !controller.result().syncing, "confirmed outage");
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(attempts, 2, "persistent outage must not create a retry loop");
    assert.equal(controller.result().error, "network_unavailable");
    assert.equal(controller.result().authStatus, "token_confirmed");
    assert.equal(controller.result().tokenRecognized, true);
    assert.equal(controller.result().ready, true);
    assert.equal(controller.result().sharedState.profile.name, "Baby");
    assert.equal(world.authSignOutCalls, 0);
  } finally {
    interrupted.resolve();
    fresh.resolve();
    controller.unmount();
  }
});

test("quiet resume retries its first new connectivity failure without an old in-flight request", async () => {
  const world = makeWorld({ offline: false });
  const controller = await boot(world);
  const fresh = deferred();
  const states = [];
  let attempts = 0;
  world.onStateChange = (value) => states.push(value);
  world.beforeIdentify = async () => {
    if (++attempts === 1) throw new Error("network_unavailable");
    await fresh.promise;
  };
  try {
    assert.equal(controller.result().syncing, false);
    world.changeAppState("background");
    world.changeAppState("active");
    await until(() => attempts === 2, "fresh resume retry without old request");
    assert.equal(controller.result().error, null);
    assert.equal(controller.result().ready, true);
    assert.equal(controller.result().sharedState.profile.name, "Baby");
    fresh.resolve();
    await until(() => !controller.result().syncing, "successful resume");
    assert.equal(attempts, 2);
    assert.equal(states.includes("network_unavailable"), false);
    assert.equal(states.includes("unverified"), false);
    assert.equal(controller.result().authStatus, "authenticated");
  } finally {
    world.onStateChange = null;
    fresh.resolve();
    controller.unmount();
  }
});

test("quiet resume defers a background failure only until one fresh foreground attempt fails", async () => {
  const world = makeWorld({ offline: false });
  const controller = await boot(world);
  const interrupted = deferred();
  const fresh = deferred();
  let attempts = 0;
  world.beforeIdentify = () =>
    ++attempts === 1 ? interrupted.promise : fresh.promise;
  try {
    const refresh = controller.result().refresh();
    await until(() => attempts === 1, "request before entering background");
    world.changeAppState("background");
    interrupted.reject(new Error("network_unavailable"));
    await refresh;
    assert.equal(attempts, 1, "do not retry while backgrounded");
    assert.equal(controller.result().syncing, false);
    assert.equal(controller.result().error, null);
    assert.notEqual(controller.result().authStatus, "unverified");
    assert.equal(controller.result().ready, true);
    world.changeAppState("active");
    await until(() => attempts === 2, "one foreground check after old failure");
    assert.equal(controller.result().error, null);
    fresh.reject(new Error("network_unavailable"));
    await until(
      () => !controller.result().syncing,
      "confirmed foreground outage",
    );
    assert.equal(
      attempts,
      2,
      "the background failure already used the grace attempt",
    );
    assert.equal(controller.result().error, "network_unavailable");
    assert.equal(controller.result().authStatus, "token_confirmed");
    assert.equal(controller.result().tokenRecognized, true);
    assert.equal(controller.result().sharedState.profile.name, "Baby");
  } finally {
    interrupted.resolve();
    fresh.resolve();
    controller.unmount();
  }
});

test("quiet resume keeps reminder delivery suspended across local saves and renders until identity succeeds", async () => {
  const world = makeWorld({ offline: false });
  const controller = await boot(world);
  const interrupted = deferred();
  const fresh = deferred();
  let attempts = 0;
  world.beforeIdentify = () =>
    ++attempts === 1 ? interrupted.promise : fresh.promise;
  try {
    controller.flushEffects();
    await tick();
    const enable = controller.result().setNotificationsEnabled;
    await enable(true);
    const before = world.notificationCalls.length;
    const refresh = controller.result().refresh();
    await until(() => attempts === 1, "identity check before suspend");
    world.changeAppState("background");
    world.changeAppState("active");
    interrupted.reject(new Error("network_unavailable"));
    await until(() => attempts === 2, "quiet foreground retry");
    assert.ok(
      world.notificationCalls
        .slice(before)
        .some((call) => call.kind === "suspend"),
      "connectivity uncertainty suspends notifications even while the UI stays quiet",
    );
    await assert.rejects(enable(true), /refresh_required|session_changed/);
    await controller.result().saveRecord("entry", {
      id: "quiet-resume-reminder-guard",
      type: "diaper",
      start: new Date().toISOString(),
      diaperKind: "wet",
      note: "Saved offline while identity is pending",
    });
    controller.result();
    controller.flushEffects();
    await tick();
    assert.equal(controller.result().ready, true);
    assert.equal(controller.result().authStatus, "authenticated");
    assert.equal(world.recordsSent.length, 0);
    assert.equal(world.read().records.length, 1);
    assert.equal(
      world.notificationCalls
        .slice(before)
        .some((call) => ["permission", "sync"].includes(call.kind)),
      false,
      "neither a stale enable callback nor queued-record effects may restart reminders",
    );
    fresh.resolve();
    await refresh;
    await until(() => !controller.result().syncing, "fresh verified identity");
    controller.result();
    controller.flushEffects();
    await tick();
    await controller.result().setNotificationsEnabled(true);
    assert.ok(
      world.notificationCalls
        .slice(before)
        .some((call) => call.kind === "sync"),
      "delivery can resume only after fresh identity succeeds",
    );
  } finally {
    interrupted.resolve();
    fresh.resolve();
    controller.unmount();
  }
});

test("quiet resume cannot retry or restore cached history after logout during its fresh check", async () => {
  const world = makeWorld({ offline: false });
  const controller = await boot(world);
  const interrupted = deferred();
  let attempts = 0;
  let retrySignal;
  let releaseRetry;
  world.beforeIdentify = (signal) => {
    if (++attempts === 1) return interrupted.promise;
    retrySignal = signal;
    return new Promise((resolve, reject) => {
      releaseRetry = resolve;
      signal.addEventListener(
        "abort",
        () => reject(new Error("network_unavailable")),
        {
          once: true,
        },
      );
    });
  };
  try {
    const refresh = controller.result().refresh();
    await until(() => attempts === 1, "identity request before background");
    world.changeAppState("background");
    world.changeAppState("active");
    interrupted.reject(new Error("network_unavailable"));
    await until(() => retrySignal, "fresh cancellable identity request");
    await controller.result().signOut();
    await refresh;
    assert.equal(retrySignal.aborted, true);
    releaseRetry();
    world.changeAppState("background");
    world.changeAppState("active");
    await controller.result().refresh();
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(attempts, 2);
    assert.equal(controller.result().authStatus, "signed_out");
    assert.equal(controller.result().ready, false);
    assert.equal(controller.result().sharedState, null);
    assert.equal(controller.result().error, null);
    assert.equal(world.read(), null);
    assert.equal(world.cachedIdentity, null);
    assert.equal(world.authSignOutCalls, 1);
    assert.equal(world.recordsSent.length, 0);
  } finally {
    interrupted.resolve();
    releaseRetry?.();
    controller.unmount();
  }
});

for (const failure of [
  { code: "unauthorized", status: 401, expected: "sign_in_required" },
  { code: "network_unavailable", status: 401, expected: "sign_in_required" },
  { code: "sign_in_required", status: 0, expected: "sign_in_required" },
  { code: "membership_revoked", status: 403, expected: "membership_revoked" },
])
  test(`quiet resume never suppresses ${failure.code} or exposes its cached family`, async () => {
    const world = makeWorld({ offline: false });
    const controller = await boot(world);
    const gate = deferred();
    let attempts = 0;
    world.beforeIdentify = () => {
      attempts++;
      return gate.promise;
    };
    try {
      const refresh = controller.result().refresh();
      await until(() => attempts === 1, "pending identity verification");
      world.changeAppState("background");
      world.changeAppState("active");
      world.identityError = failure;
      gate.resolve();
      await refresh;
      for (let i = 0; i < 5; i++) await tick();
      assert.equal(
        attempts,
        1,
        "security rejection is not a connectivity retry",
      );
      assert.equal(controller.result().error, failure.expected);
      assert.equal(controller.result().ready, false);
      assert.equal(controller.result().sharedState, null);
      assert.equal(world.recordsSent.length, 0);
      if (failure.expected === "sign_in_required") {
        assert.equal(controller.result().authStatus, "reauth_required");
        assert.equal(world.cacheGuard.reauthRequired, true);
      } else {
        assert.equal(controller.result().snapshot, null);
        assert.equal(world.cachedIdentity.families.length, 0);
      }
    } finally {
      gate.resolve();
      controller.unmount();
    }
  });

test("quiet resume does not silence an explicit invitation action failure", async () => {
  const world = makeWorld({ offline: false });
  const controller = await boot(world);
  const gate = deferred();
  let attempted = false;
  world.beforeMutation = async () => {
    attempted = true;
    await gate.promise;
  };
  try {
    const action = controller
      .result()
      .createInvitation("guest@example.invalid");
    const result = assert.rejects(action, /network_unavailable/);
    await until(() => attempted, "explicit invitation request");
    world.changeAppState("background");
    world.changeAppState("active");
    gate.reject(new Error("network_unavailable"));
    await result;
    assert.equal(controller.result().error, "network_unavailable");
    assert.equal(controller.result().transitionPending, true);
    assert.ok(
      world.read().transition,
      "uncertain action intent remains durable",
    );
  } finally {
    gate.resolve();
    controller.unmount();
  }
});

test("quiet cold startup retries its first connection failure while keeping only validated cached data visible", async () => {
  const world = makeWorld({ offline: false, queued: true });
  const initial = deferred();
  const retry = deferred();
  const states = [];
  let attempts = 0;
  let active = 0;
  let maxActive = 0;
  world.beforeIdentify = async () => {
    const attempt = ++attempts;
    maxActive = Math.max(maxActive, ++active);
    try {
      await (attempt === 1 ? initial.promise : retry.promise);
    } finally {
      active--;
    }
  };
  world.onStateChange = (value) => states.push(value);
  const controller = world.mount();
  try {
    await until(() => attempts === 1, "first cold identity check");
    initial.reject(new Error("network_unavailable"));
    await until(() => attempts === 2, "quiet cold identity retry");
    assert.equal(controller.result().booting, false);
    assert.equal(controller.result().authStatus, "checking");
    assert.equal(controller.result().error, null);
    assert.equal(controller.result().ready, true);
    assert.equal(controller.result().sharedState.profile.name, "Baby");
    assert.equal(world.feedsSent.length, 0);
    await controller.result().saveRecord("entry", {
      id: "cold-start-diaper",
      type: "diaper",
      start: new Date().toISOString(),
      diaperKind: "wet",
      note: "Saved during quiet cold verification",
    });
    assert.equal(world.read().records.length, 1);
    assert.equal(world.recordsSent.length, 0);
    const firstRefresh = controller.result().refresh();
    const secondRefresh = controller.result().refresh();
    retry.resolve();
    await Promise.all([firstRefresh, secondRefresh]);
    await until(() => !controller.result().syncing, "cold retry settlement");
    assert.equal(attempts, 2);
    assert.equal(maxActive, 1);
    assert.equal(world.feedsSent.length, 1);
    assert.equal(world.recordsSent.length, 1);
    assert.equal(world.recordsSent[0].durablySaved, true);
    assert.equal(world.read().records.length, 0);
    assert.equal(world.read().queue.length, 0);
    assert.equal(controller.result().authStatus, "authenticated");
    assert.equal(controller.result().error, null);
    assert.equal(states.includes("network_unavailable"), false);
    assert.equal(states.includes("unverified"), false);
  } finally {
    world.onStateChange = null;
    initial.resolve();
    retry.resolve();
    controller.unmount();
  }
});

test("quiet cold startup also retries a cached account that has not joined a family", async () => {
  const world = makeWorld({ offline: false });
  world.identity.families = [];
  world.cachedIdentity.families = [];
  world.data.state.snapshot = null;
  world.data.state.draft = null;
  world.disk.set(world.account, JSON.stringify(world.data.state));
  const retry = deferred();
  let attempts = 0;
  world.beforeIdentify = async () => {
    if (++attempts === 1) throw new Error("network_unavailable");
    await retry.promise;
  };
  const controller = world.mount();
  try {
    await until(() => attempts === 2, "cached no-family identity retry");
    assert.equal(controller.result().booting, false);
    assert.equal(controller.result().authStatus, "checking");
    assert.equal(controller.result().error, null);
    assert.equal(controller.result().user.id, "user-a");
    assert.equal(controller.result().sharedState, null);
    retry.resolve();
    await until(() => !controller.result().syncing, "verified no-family retry");
    assert.equal(attempts, 2);
    assert.equal(controller.result().authStatus, "authenticated");
    assert.equal(controller.result().sharedMode, false);
    assert.equal(controller.result().error, null);
  } finally {
    retry.resolve();
    controller.unmount();
  }
});

test("quiet cold startup surfaces a persistent connection failure after exactly one retry", async () => {
  const world = makeWorld({ offline: false, queued: true });
  const retry = deferred();
  let attempts = 0;
  world.beforeIdentify = async () => {
    if (++attempts === 1) throw new Error("network_unavailable");
    await retry.promise;
  };
  const controller = world.mount();
  try {
    await until(() => attempts === 2, "bounded cold retry");
    assert.equal(controller.result().authStatus, "checking");
    assert.equal(controller.result().error, null);
    retry.reject(new Error("network_unavailable"));
    await until(() => !controller.result().syncing, "persistent cold outage");
    for (let index = 0; index < 5; index++) await tick();
    assert.equal(attempts, 2);
    assert.equal(controller.result().authStatus, "unverified");
    assert.equal(controller.result().error, "network_unavailable");
    assert.equal(controller.result().sharedState.profile.name, "Baby");
    assert.equal(world.read().queue.length, 1);
    assert.equal(world.feedsSent.length, 0);
    assert.equal(world.authSignOutCalls, 0);
  } finally {
    retry.resolve();
    controller.unmount();
  }
});

for (const failure of [
  { code: "unauthorized", status: 401, expected: "sign_in_required" },
  { code: "network_unavailable", status: 401, expected: "sign_in_required" },
  { code: "membership_revoked", status: 403, expected: "membership_revoked" },
])
  test(`quiet cold startup never retries or hides ${failure.code} (${failure.status})`, async () => {
    const world = makeWorld({ offline: false, queued: true });
    world.identityError = failure;
    const controller = await boot(world);
    try {
      assert.equal(
        world.http.filter((request) => request.url === "/v1/me").length,
        1,
      );
      assert.equal(controller.result().error, failure.expected);
      assert.equal(controller.result().ready, false);
      assert.equal(controller.result().sharedState, null);
      assert.equal(world.feedsSent.length, 0);
      if (failure.expected === "sign_in_required") {
        assert.equal(controller.result().authStatus, "reauth_required");
        assert.equal(world.cacheGuard.reauthRequired, true);
      } else {
        assert.equal(controller.result().snapshot, null);
        assert.equal(world.cachedIdentity.families.length, 0);
      }
    } finally {
      controller.unmount();
    }
  });

test("quiet cold startup cannot restore data after logout interrupts its retry", async () => {
  const world = makeWorld({ offline: false, queued: true });
  let attempts = 0;
  let retrySignal;
  let release;
  world.beforeIdentify = (signal) => {
    if (++attempts === 1) throw new Error("network_unavailable");
    retrySignal = signal;
    return new Promise((resolve, reject) => {
      release = resolve;
      signal.addEventListener(
        "abort",
        () => reject(new Error("network_unavailable")),
        {
          once: true,
        },
      );
    });
  };
  const controller = world.mount();
  try {
    await until(() => retrySignal, "cancellable cold retry");
    await controller.result().signOut();
    assert.equal(retrySignal.aborted, true);
    release();
    await controller.result().refresh();
    for (let index = 0; index < 5; index++) await tick();
    assert.equal(attempts, 2);
    assert.equal(controller.result().authStatus, "signed_out");
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().sharedState, null);
    assert.equal(controller.result().error, null);
    assert.equal(world.read(), null);
    assert.equal(world.cachedIdentity, null);
    assert.equal(world.feedsSent.length, 0);
  } finally {
    release?.();
    controller.unmount();
  }
});

test("cold startup local storage errors are reported without a connectivity retry", async () => {
  const world = makeWorld({ offline: false });
  world.beforeRead = async () => {
    throw new Error("local_data_invalid");
  };
  const controller = world.mount();
  try {
    await until(
      () => !controller.result().booting,
      "failed local cache restore",
    );
    assert.equal(world.http.length, 0);
    assert.equal(controller.result().error, "local_data_invalid");
    assert.equal(controller.result().authStatus, "unverified");
    assert.equal(controller.result().ready, false);
    assert.equal(controller.result().sharedState, null);
  } finally {
    controller.unmount();
  }
});

test("cold startup without a cached identity retains recovery after a connection failure", async () => {
  const world = makeWorld({ offline: false });
  world.cachedIdentity = null;
  world.identityError = { code: "network_unavailable", status: 0 };
  const controller = world.mount();
  try {
    await until(
      () => world.http.length > 0 && !controller.result().syncing,
      "uncached identity failure",
    );
    assert.equal(
      world.http.filter((request) => request.url === "/v1/me").length,
      1,
    );
    assert.equal(controller.result().sharedMode, true);
    assert.equal(controller.result().sharedState, null);
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().authStatus, "unverified");
    assert.equal(controller.result().error, "network_unavailable");
  } finally {
    controller.unmount();
  }
});

test("cached bootstrap stays checking until identity is verified, and offline stays unverified", async () => {
  const world = makeWorld({ offline: false, queued: true });
  const identityGate = deferred();
  world.beforeIdentify = () => identityGate.promise;
  const controller = world.mount();
  try {
    await until(() => controller.result().user, "cached identity");
    assert.equal(controller.result().authStatus, "checking");
    assert.equal(controller.result().ready, true);
    world.identityError = { code: "network_unavailable", status: 0 };
    identityGate.resolve();
    await until(() => !controller.result().syncing, "offline identity check");
    assert.equal(controller.result().authStatus, "unverified");
    assert.equal(world.read().queue.length, 1);
    assert.notEqual(world.read().draft, null);
    assert.equal(world.personalClears, 0);
    assert.equal(world.authSignOutCalls, 0);
    world.identityError = null;
    await controller.result().refresh();
    assert.equal(controller.result().authStatus, "authenticated");
    assert.equal(controller.result().error, null);
  } finally {
    identityGate.resolve();
    controller.unmount();
  }
});

test("startup exposes validated cached history and extras while identity refresh is still pending", async () => {
  const world = makeWorld({ offline: false });
  const gate = deferred();
  const entry = {
    id: "cached-growth",
    type: "growth",
    start: "2026-09-01T01:00:00Z",
    weight: 3.725,
    note: "Cached history",
  };
  world.data.state.snapshot.entries = [
    { entry, version: "1", recordedBy: "user-a", lastEditedBy: "user-a" },
  ];
  world.data.state.snapshot.extraRecords = [
    {
      record: { id: "avatar", kind: "avatar", dataUrl: null },
      version: "1",
      recordedBy: "user-a",
      lastEditedBy: "user-a",
    },
  ];
  world.disk.set(world.account, JSON.stringify(world.data.state));
  world.server = structuredClone(world.data.state.snapshot);
  world.server.profile.name = "Refreshed baby";
  world.beforeIdentify = () => gate.promise;
  const controller = world.mount();
  try {
    await until(() => world.http.length > 0, "background identity request");
    const local = controller.result();
    assert.equal(local.booting, false);
    assert.equal(local.authStatus, "checking");
    assert.equal(local.ready, true);
    assert.equal(local.sharedState.profile.name, "Baby");
    assert.equal(local.sharedState.entries[0].note, "Cached history");
    assert.equal(local.fullSnapshot.historyId, "history-a");
    assert.equal(local.sharedExtras[0].record.kind, "avatar");
    await local.saveRecord("entry", {
      ...entry,
      id: "new-growth",
      note: "Saved during refresh",
    });
    assert.equal(world.read().records.length, 1);
    assert.equal(world.recordsSent.length, 0);
    assert.equal(controller.result().sharedState.entries.length, 2);
    gate.resolve();
    await until(
      () => !controller.result().syncing && world.recordsSent.length === 1,
      "background snapshot and queued save",
    );
    assert.equal(controller.result().authStatus, "authenticated");
    assert.equal(
      controller.result().sharedState.profile.name,
      "Refreshed baby",
    );
  } finally {
    gate.resolve();
    controller.unmount();
  }
});

for (const cache of [
  "missing-snapshot",
  "missing-row",
  "corrupt-row",
  "invalid-profile",
])
  test(`startup releases local loading without exposing ${cache} family data`, async () => {
    const world = makeWorld({ offline: false });
    const gate = deferred();
    world.beforeIdentify = () => gate.promise;
    if (cache === "missing-row") world.disk.delete(world.account);
    else if (cache === "corrupt-row") world.disk.set(world.account, "not-json");
    else {
      if (cache === "missing-snapshot") world.data.state.snapshot = null;
      else world.data.state.snapshot.profile.sex = "invalid";
      world.disk.set(world.account, JSON.stringify(world.data.state));
    }
    const controller = world.mount();
    try {
      await until(
        () => !controller.result().booting,
        "local bootstrap complete",
      );
      assert.equal(controller.result().ready, false);
      assert.equal(controller.result().sharedState, null);
      assert.equal(
        controller.result().sharedMode,
        true,
        "Known family must stay in recovery instead of falling back to personal data",
      );
      assert.equal(world.recordsSent.length, 0);
    } finally {
      controller.unmount();
      gate.resolve();
    }
  });

test("startup with a session but no cached identity remains in recovery until background identity resolves", async () => {
  const world = makeWorld({ offline: false });
  world.cachedIdentity = null;
  world.identity.families = [];
  const gate = deferred();
  world.beforeIdentify = () => gate.promise;
  const controller = world.mount();
  try {
    await until(() => world.http.length > 0, "uncached identity request");
    assert.equal(controller.result().booting, false);
    assert.equal(controller.result().sharedMode, true);
    assert.equal(controller.result().sharedState, null);
    assert.equal(controller.result().user, null);
    gate.resolve();
    await until(
      () => !controller.result().syncing,
      "verified no-family account",
    );
    assert.equal(controller.result().authStatus, "authenticated");
    assert.equal(controller.result().sharedMode, false);
  } finally {
    gate.resolve();
    controller.unmount();
  }
});

for (const mismatch of ["user", "membership", "inactive"])
  test(`cached family does not expose an active grant with a ${mismatch} member mismatch`, async () => {
    const world = makeWorld({ offline: false });
    const member = world.data.state.snapshot.members[0];
    if (mismatch === "user") member.id = "user-b";
    if (mismatch === "membership") member.membershipId = "other-grant";
    if (mismatch === "inactive") member.status = "removed";
    world.disk.set(world.account, JSON.stringify(world.data.state));
    const gate = deferred();
    world.beforeIdentify = () => gate.promise;
    const controller = world.mount();
    try {
      await until(() => !controller.result().booting, "member validation");
      assert.equal(controller.result().ready, false);
      assert.equal(controller.result().sharedState, null);
      assert.equal(controller.result().fullSnapshot, null);
      assert.equal(world.feedsSent.length, 0);
    } finally {
      controller.unmount();
      gate.resolve();
    }
  });

for (const blocked of [
  "transition",
  "deletion",
  "revoked",
  "expired",
  "old-origin",
])
  test(`startup keeps ${blocked} cached family hidden without waiting for the API`, async () => {
    const world = makeWorld({ offline: false });
    if (blocked === "transition")
      world.data.state.transition = {
        operationId: "pending-join",
        path: "/v2/invitations/invite-b/accept",
        body: {},
        kind: "join",
        userId: "user-a",
        phase: "pending",
      };
    if (blocked === "deletion")
      world.cachedIdentity.accountDeletion = {
        deletionId: "deletion",
        status: "pending",
        requestedAt: "2026-09-01T01:00:00Z",
      };
    if (blocked === "revoked") world.cachedIdentity.families = [];
    if (blocked === "expired" || blocked === "old-origin")
      world.cacheGuard = {
        userId: "user-a",
        reauthRequired: blocked === "expired",
        origin: { ...world.data.state.draft.origin, historyId: "new-history" },
      };
    world.disk.set(world.account, JSON.stringify(world.data.state));
    const gate = deferred();
    world.beforeIdentify = () => gate.promise;
    const controller = world.mount();
    try {
      await until(() => !controller.result().booting, "guarded bootstrap");
      assert.equal(controller.result().sharedState, null);
      assert.equal(controller.result().fullSnapshot, null);
      assert.equal(controller.result().ready, false);
      assert.equal(world.feedsSent.length, 0);
      if (blocked === "expired")
        assert.equal(controller.result().authStatus, "reauth_required");
      if (blocked === "transition")
        await assert.rejects(
          controller.result().signOut(),
          /transition_pending/,
        );
    } finally {
      controller.unmount();
      gate.resolve();
    }
  });

test("a different background identity immediately hides the restored account and never sends its pending work", async () => {
  const world = makeWorld({ offline: false, queued: true });
  world.identity.user.id = "user-b";
  const gate = deferred();
  world.beforeIdentify = () => gate.promise;
  const controller = world.mount();
  try {
    await until(() => world.http.length > 0, "pending account verification");
    assert.equal(controller.result().sharedState.profile.name, "Baby");
    gate.resolve();
    await until(
      () => !controller.result().syncing,
      "mismatched identity rejection",
    );
    assert.equal(controller.result().authStatus, "reauth_required");
    assert.equal(controller.result().ready, false);
    assert.equal(controller.result().sharedState, null);
    assert.equal(controller.result().fullSnapshot, null);
    assert.equal(world.feedsSent.length, 0);
    assert.equal(world.recordsSent.length, 0);
    assert.equal(
      world.read().queue[0].operation.operationId,
      "saved-operation-a",
    );
    assert.equal(world.cachedIdentity.user.id, "user-a");
    assert.equal(world.cacheGuard.reauthRequired, true);
    assert.equal(
      world.http.filter((request) => request.url === "/v1/me").length,
      1,
    );
  } finally {
    gate.resolve();
    controller.unmount();
  }
});

test("an unmounted startup refresh cannot replace its cached data or send queued work", async () => {
  const world = makeWorld({ offline: false, queued: true });
  const gate = deferred();
  world.beforeIdentify = () => gate.promise;
  const controller = world.mount();
  await until(() => world.http.length > 0, "startup request before unmount");
  const before = world.disk.get(world.account);
  controller.unmount();
  gate.resolve();
  for (let index = 0; index < 10; index++) await tick();
  assert.equal(world.disk.get(world.account), before);
  assert.equal(world.feedsSent.length, 0);
  assert.equal(world.recordsSent.length, 0);
});

test("native session-read failure leaves a responsive recovery screen instead of personal data", async () => {
  const world = makeWorld({ offline: false });
  world.beforeSessionRead = async () => {
    throw new Error("local_data_invalid");
  };
  const controller = world.mount();
  try {
    await until(
      () => !controller.result().booting,
      "failed secure session read",
    );
    assert.equal(controller.result().sharedMode, true);
    assert.equal(controller.result().sharedState, null);
    assert.equal(controller.result().user, null);
    assert.equal(world.http.length, 0);
    await controller.result().signOut();
    assert.equal(controller.result().sharedMode, false);
    assert.equal(controller.result().authStatus, "signed_out");
  } finally {
    controller.unmount();
  }
});

test("sign out during startup refresh remains signed out after the pending response settles", async () => {
  const world = makeWorld({ offline: false });
  const gate = deferred();
  world.beforeIdentify = () => gate.promise;
  const controller = world.mount();
  try {
    await until(() => world.http.length > 0, "startup request before sign out");
    assert.equal(controller.result().booting, false);
    const signingOut = controller.result().signOut();
    gate.resolve();
    await signingOut;
    assert.equal(controller.result().authStatus, "signed_out");
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().sharedState, null);
    assert.equal(controller.result().sharedMode, false);
    assert.equal(world.read(), null);
    const requests = world.http.length;
    await controller.result().refresh();
    for (let index = 0; index < 5; index++) await tick();
    assert.equal(world.http.length, requests);
    assert.equal(controller.result().sharedState, null);
  } finally {
    gate.resolve();
    controller.unmount();
  }
});

test("known family without a cache can leave local loading while the first snapshot is pending", async () => {
  const world = makeWorld({ offline: false });
  world.disk.delete(world.account);
  const gate = deferred();
  world.beforeSnapshot = () => gate.promise;
  const controller = world.mount();
  try {
    await until(
      () => world.http.some((request) => request.url.endsWith("/snapshot")),
      "first snapshot request",
    );
    assert.equal(controller.result().booting, false);
    assert.equal(controller.result().sharedMode, true);
    assert.equal(controller.result().ready, false);
    assert.equal(controller.result().sharedState, null);
    gate.resolve();
    await until(() => !controller.result().syncing, "first snapshot completes");
    assert.equal(controller.result().sharedState.profile.name, "Baby");
  } finally {
    gate.resolve();
    controller.unmount();
  }
});

test("cached account owner status cannot elevate a caregiver snapshot before verification", async () => {
  const world = makeWorld({ offline: false });
  world.data.state.snapshot.family.role = "caregiver";
  world.data.state.snapshot.members[0].role = "caregiver";
  world.disk.set(world.account, JSON.stringify(world.data.state));
  const gate = deferred();
  world.beforeIdentify = () => gate.promise;
  const controller = world.mount();
  try {
    await until(() => !controller.result().booting, "conservative cache roles");
    assert.equal(controller.result().ready, true);
    assert.equal(controller.result().fullSnapshot.family.role, "caregiver");
    assert.equal(controller.result().canEditRecord("extra", "avatar"), false);
  } finally {
    controller.unmount();
    gate.resolve();
  }
});

test("a fresh identity downgrade hides cached admin permissions while the replacement snapshot is pending", async () => {
  const world = makeWorld({ offline: false, queued: true });
  world.identity.families[0].role = "caregiver";
  world.server.family.role = "caregiver";
  world.server.members[0].role = "caregiver";
  const gate = deferred();
  world.beforeSnapshot = () => gate.promise;
  const controller = world.mount();
  try {
    await until(
      () => world.http.some((request) => request.url.endsWith("/snapshot")),
      "snapshot after identity downgrade",
    );
    assert.equal(controller.result().booting, false);
    assert.equal(controller.result().authStatus, "authenticated");
    assert.equal(controller.result().ready, false);
    assert.equal(controller.result().fullSnapshot, null);
    assert.equal(controller.result().canEditRecord("extra", "avatar"), false);
    assert.equal(world.feedsSent.length, 0);
    assert.equal(world.read().queue.length, 1);
    gate.resolve();
    await until(
      () => !controller.result().syncing,
      "replacement caregiver snapshot",
    );
    assert.equal(controller.result().ready, true);
    assert.equal(controller.result().fullSnapshot.family.role, "caregiver");
  } finally {
    gate.resolve();
    controller.unmount();
  }
});

test("a newly confirmed account deletion hides cache before identity persistence can stall", async () => {
  const world = makeWorld({ offline: false });
  world.identity.accountDeletion = {
    deletionId: "deletion",
    status: "pending",
    requestedAt: "2026-09-01T01:00:00Z",
  };
  const gate = deferred();
  let savingIdentity = false;
  world.beforeIdentitySave = () => {
    savingIdentity = true;
    return gate.promise;
  };
  const controller = world.mount();
  try {
    await until(() => savingIdentity, "deleting identity write");
    assert.equal(controller.result().booting, false);
    assert.equal(controller.result().ready, false);
    assert.equal(controller.result().sharedState, null);
    assert.equal(controller.result().fullSnapshot, null);
    assert.equal(world.read().snapshot.family.id, "family-a");
    gate.resolve();
    await until(() => !controller.result().syncing, "deletion cache cleanup");
    assert.equal(controller.result().sharedState, null);
    assert.equal(world.read().snapshot, null);
  } finally {
    gate.resolve();
    controller.unmount();
  }
});

test("a local read failure preserves unknown activation recovery and reloads its journal on refresh", async () => {
  const world = joinWorld();
  const intent = {
    operationId: "pending-join",
    path: "/v2/invitations/invite-b/accept",
    body: {
      declineOtherInvitations: true,
      requiredSchemaVersion: 2,
      requiredExtrasSchemaVersion: 1,
    },
    kind: "join",
    userId: "user-a",
    phase: "pending",
  };
  world.data.state.transition = intent;
  world.disk.set(world.account, JSON.stringify(world.data.state));
  world.beforeRead = async () => {
    throw new Error("local_data_invalid");
  };
  const controller = world.mount();
  const gate = deferred();
  try {
    await until(() => !controller.result().booting, "failed local read");
    assert.equal(controller.result().sharedMode, true);
    assert.equal(controller.result().ready, false);
    world.beforeRead = async () => {};
    world.beforeMutation = () => gate.promise;
    const refresh = controller.result().refresh();
    await until(
      () => controller.result().activationPending,
      "reloaded activation journal",
    );
    assert.equal(controller.result().sharedMode, true);
    assert.equal(controller.result().sharedState, null);
    assert.equal(world.personalClears, 0);
    controller.unmount();
    gate.resolve();
    await refresh;
  } finally {
    controller.unmount();
    gate.resolve();
  }
});

test("a verified role downgrade hides old admin permissions before cache guard persistence can fail", async () => {
  const world = makeWorld({ offline: false });
  const controller = await boot(world);
  world.server.family.role = "caregiver";
  world.server.members[0].role = "caregiver";
  world.beforeCacheOriginSave = async () => {
    throw new Error("local_save_failed");
  };
  try {
    await controller.result().refresh();
    assert.equal(controller.result().ready, false);
    assert.equal(controller.result().sharedState, null);
    assert.equal(controller.result().canEditRecord("extra", "avatar"), false);
  } finally {
    controller.unmount();
  }
});

test("a snapshot role downgrade survives failed SQLite persistence and restart of an older admin cache", async () => {
  const world = makeWorld({ offline: false });
  const first = await boot(world);
  world.server.family.role = "caregiver";
  world.server.members[0].role = "caregiver";
  world.beforeCommit = async () => {
    throw new Error("disk_full");
  };
  await first.result().refresh();
  assert.equal(world.cachedIdentity.families[0].role, "caregiver");
  assert.equal(world.read().snapshot.family.role, "owner");
  first.unmount();
  const gate = deferred();
  world.beforeIdentify = () => gate.promise;
  const reopened = world.mount();
  try {
    await until(
      () => !reopened.result().booting,
      "narrowed cached role restart",
    );
    assert.equal(reopened.result().ready, true);
    assert.equal(reopened.result().fullSnapshot.family.role, "caregiver");
    assert.equal(reopened.result().canEditRecord("extra", "avatar"), false);
  } finally {
    reopened.unmount();
    gate.resolve();
  }
});

test("known expired authentication stays hidden on restart without a network response", async () => {
  const world = makeWorld({ offline: false });
  const first = await boot(world);
  world.identityError = { code: "sign_in_required", status: 401 };
  await first.result().refresh();
  assert.equal(world.cacheGuard.reauthRequired, true);
  first.unmount();
  world.identityError = null;
  const gate = deferred();
  world.beforeIdentify = () => gate.promise;
  const reopened = world.mount();
  try {
    await until(() => !reopened.result().booting, "expired local restart");
    assert.equal(reopened.result().authStatus, "reauth_required");
    assert.equal(reopened.result().sharedState, null);
    assert.equal(reopened.result().ready, false);
  } finally {
    reopened.unmount();
    gate.resolve();
  }
});

test("a newer verified history guard keeps an older SQLite cache hidden after failed persistence and restart", async () => {
  const world = makeWorld({ offline: false });
  const first = await boot(world);
  world.server.historyId = "new-history";
  world.beforeCommit = async () => {
    throw new Error("disk_full");
  };
  await first.result().refresh();
  assert.equal(world.read().snapshot.historyId, "history-a");
  assert.equal(world.cacheGuard.origin.historyId, "new-history");
  first.unmount();
  const gate = deferred();
  world.beforeIdentify = () => gate.promise;
  const reopened = world.mount();
  try {
    await until(() => !reopened.result().booting, "history guard restart");
    assert.equal(reopened.result().ready, false);
    assert.equal(reopened.result().sharedState, null);
  } finally {
    reopened.unmount();
    gate.resolve();
  }
});

test("expired session survives cancelled reauthentication without changing cached work", async () => {
  const world = makeWorld({ queued: true });
  const controller = await boot(world);
  world.offline = false;
  world.identityError = { code: "sign_in_required", status: 401 };
  try {
    await controller.result().refresh();
    const before = world.disk.get(world.account);
    assert.equal(controller.result().authStatus, "reauth_required");
    world.beforeAuthSignIn = async () => {
      throw new Error("sign_in_cancelled");
    };
    await assert.rejects(controller.result().signIn(), /sign_in_cancelled/);
    assert.equal(controller.result().authStatus, "reauth_required");
    assert.equal(controller.result().error, "sign_in_required");
    assert.equal(controller.result().notice, "sign_in_cancelled");
    assert.equal(world.disk.get(world.account), before);
    assert.equal(world.personalClears, 0);
    assert.equal(world.authSignOutCalls, 0);
    world.advanceTimers(4999);
    assert.equal(controller.result().notice, "sign_in_cancelled");
    world.advanceTimers(1);
    assert.equal(controller.result().notice, null);
    assert.equal(controller.result().error, "sign_in_required");
    assert.equal(controller.result().authStatus, "reauth_required");
  } finally {
    controller.unmount();
  }
});

test("failed browser reauthentication preserves expiry while fresh credentials with an unavailable old API remain unverified", async () => {
  const world = ownerWorld();
  const controller = await boot(world);
  try {
    world.identityError = { code: "unauthorized", status: 401 };
    await controller.result().refresh();
    world.beforeAuthSignIn = async () => {
      throw new Error("sign_in_failed");
    };
    await assert.rejects(controller.result().signIn(), /sign_in_failed/);
    assert.equal(controller.result().authStatus, "reauth_required");
    assert.equal(controller.result().error, "sign_in_required");
    world.advanceTimers(5000);
    assert.equal(controller.result().error, "sign_in_required");
    world.beforeAuthSignIn = async () => {};
    world.identityError = { code: "network_unavailable", status: 0 };
    await assert.rejects(controller.result().signIn(), /network_unavailable/);
    assert.equal(controller.result().authStatus, "unverified");
    assert.equal(controller.result().ready, false);
  } finally {
    controller.unmount();
  }
});

test("successful reauthentication without a family clears the expired error", async () => {
  const world = ownerWorld();
  const controller = await boot(world);
  try {
    world.identityError = { code: "unauthorized", status: 401 };
    await controller.result().refresh();
    assert.equal(controller.result().authStatus, "reauth_required");
    world.identityError = null;
    await controller.result().signIn();
    assert.equal(controller.result().authStatus, "authenticated");
    assert.equal(controller.result().error, null);
    assert.equal(controller.result().snapshot, null);
    assert.equal(controller.result().user.id, "user-a");
  } finally {
    controller.unmount();
  }
});

test("successful no-family refresh clears an obsolete sign-in error", async () => {
  const world = ownerWorld();
  const controller = await boot(world);
  try {
    world.beforeAuthSignIn = async () => {
      throw new Error("sign_in_failed");
    };
    await assert.rejects(controller.result().signIn(), /sign_in_failed/);
    assert.equal(controller.result().error, "sign_in_failed");
    await controller.result().refresh();
    assert.equal(controller.result().authStatus, "authenticated");
    assert.equal(controller.result().error, null);
  } finally {
    controller.unmount();
  }
});

test("feedback dismissal survives controller renders but not a later sign-out event or stale close", async () => {
  const world = makeWorld({ offline: false });
  const controller = await boot(world);
  try {
    await controller.result().signOut();
    const first = controller.result();
    assert.equal(first.notice, "signed_out");
    first.dismissFeedback("sign-out-banner");
    assert.equal(controller.result().dismissedFeedback, "sign-out-banner");
    assert.equal(controller.result().notice, "signed_out");
    assert.equal(controller.result().authStatus, "signed_out");

    await controller.result().signIn();
    assert.equal(controller.result().dismissedFeedback, null);
    await controller.result().signOut();
    assert.equal(controller.result().notice, "signed_out");
    assert.equal(controller.result().dismissedFeedback, null);
    first.dismissFeedback("sign-out-banner");
    assert.equal(controller.result().dismissedFeedback, null);
    controller.result().dismissFeedback("new-sign-out-banner");
    first.dismissFeedback("sign-out-banner");
    assert.equal(controller.result().dismissedFeedback, "new-sign-out-banner");
  } finally {
    controller.unmount();
  }
});

test("dismissed errors survive unchanged polling without clearing work and reappear after recovery", async () => {
  const world = makeWorld({ offline: true, queued: true });
  const controller = await boot(world);
  try {
    const before = controller.result();
    assert.equal(before.error, "network_unavailable");
    const disk = world.disk.get(world.account);
    before.dismissFeedback("network-banner");
    assert.equal(controller.result().dismissedFeedback, "network-banner");
    assert.equal(controller.result().error, "network_unavailable");
    assert.equal(controller.result().authStatus, before.authStatus);
    assert.equal(
      controller.result().transitionPending,
      before.transitionPending,
    );
    assert.equal(world.disk.get(world.account), disk);
    await controller.result().refresh();
    assert.equal(controller.result().dismissedFeedback, "network-banner");

    world.offline = false;
    await controller.result().refresh();
    assert.equal(controller.result().error, null);
    assert.equal(controller.result().dismissedFeedback, null);
    world.offline = true;
    await controller.result().refresh();
    assert.equal(controller.result().error, "network_unavailable");
    assert.equal(controller.result().dismissedFeedback, null);
  } finally {
    controller.unmount();
  }
});

test("first cancelled login stays signed out and uses a temporary notice", async () => {
  const world = ownerWorld();
  world.session = false;
  world.cachedIdentity = null;
  const controller = world.mount();
  try {
    await until(() => !controller.result().booting, "signed-out bootstrap");
    world.beforeAuthSignIn = async () => {
      throw new Error("sign_in_cancelled");
    };
    await assert.rejects(controller.result().signIn(), /sign_in_cancelled/);
    assert.equal(controller.result().authStatus, "signed_out");
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().error, null);
    assert.equal(controller.result().notice, "sign_in_cancelled");
    world.advanceTimers(5000);
    assert.equal(controller.result().notice, null);
    assert.equal(world.session, false);
    assert.equal(world.personalClears, 0);
  } finally {
    controller.unmount();
  }
});

test("cancelling login preserves a verified session and an old timer cannot clear a newer notice", async () => {
  const world = makeWorld({ offline: false });
  const controller = await boot(world);
  try {
    const before = world.disk.get(world.account);
    world.beforeAuthSignIn = async () => {
      throw new Error("sign_in_cancelled");
    };
    await assert.rejects(controller.result().signIn(), /sign_in_cancelled/);
    assert.equal(controller.result().authStatus, "authenticated");
    assert.equal(controller.result().error, null);
    assert.equal(controller.result().snapshot.family.id, "family-a");
    assert.equal(world.disk.get(world.account), before);
    const oldTimer = [...world.timers.values()][0].callback;
    world.advanceTimers(2500);
    await assert.rejects(controller.result().signIn(), /sign_in_cancelled/);
    oldTimer();
    assert.equal(controller.result().notice, "sign_in_cancelled");
    world.advanceTimers(2500);
    assert.equal(controller.result().notice, "sign_in_cancelled");
    world.advanceTimers(2500);
    assert.equal(controller.result().notice, null);
    await assert.rejects(controller.result().signIn(), /sign_in_cancelled/);
    const cancelledTimer = [...world.timers.values()][0].callback;
    await controller.result().signOut();
    cancelledTimer();
    assert.equal(controller.result().notice, "signed_out");
    assert.equal(controller.result().authStatus, "signed_out");
  } finally {
    controller.unmount();
  }
});

test("cancellation notice expiry does not dismiss an unresolved local-save failure", async () => {
  const world = makeWorld({ offline: false });
  const controller = await boot(world);
  try {
    world.beforeCommit = async () => {
      throw new Error("disk_full");
    };
    await assert.rejects(
      controller
        .result()
        .setDraft({ ...controller.result().draft, amount: "150" }),
      /local_save_failed/,
    );
    world.beforeAuthSignIn = async () => {
      throw new Error("sign_in_cancelled");
    };
    await assert.rejects(controller.result().signIn(), /sign_in_cancelled/);
    assert.equal(controller.result().error, "local_save_failed");
    world.advanceTimers(5000);
    assert.equal(controller.result().notice, null);
    assert.equal(controller.result().error, "local_save_failed");
  } finally {
    controller.unmount();
  }
});

test("identity-only no-family verification does not clear a failed local write", async () => {
  const world = ownerWorld();
  const controller = await boot(world);
  try {
    world.beforeCommit = async () => {
      throw new Error("disk_full");
    };
    await assert.rejects(
      controller.result().discardDraft(),
      /local_save_failed/,
    );
    await controller.result().refresh();
    assert.equal(controller.result().authStatus, "authenticated");
    assert.equal(controller.result().error, "local_save_failed");
    world.advanceTimers(5000);
    assert.equal(controller.result().error, "local_save_failed");
  } finally {
    controller.unmount();
  }
});

test("unmount cancels transient notice cleanup without letting stale callbacks update state", async () => {
  const world = ownerWorld();
  const controller = await boot(world);
  world.beforeAuthSignIn = async () => {
    throw new Error("sign_in_cancelled");
  };
  await assert.rejects(controller.result().signIn(), /sign_in_cancelled/);
  const staleTimer = [...world.timers.values()][0].callback;
  controller.unmount();
  assert.equal(world.timers.size, 0);
  staleTimer();
  assert.equal(controller.result().notice, "sign_in_cancelled");
});

test("known expired authentication blocks destructive intent and receipt writes", async () => {
  const world = ownerWorld();
  world.ownerSetupDisk.set(world.account, "private-personal-history");
  const controller = await boot(world);
  try {
    world.identityError = { code: "token_expired", status: 401 };
    await controller.result().refresh();
    assert.equal(controller.result().authStatus, "reauth_required");
    const before = world.disk.get(world.account);
    const mutations = world.http.filter((request) => request.operation).length;
    await assert.rejects(
      controller.result().deleteAccount(),
      /sign_in_required/,
    );
    await assert.rejects(
      controller.result().declineInvitation("invite-b"),
      /sign_in_required/,
    );
    assert.equal(world.deletionReceipt, null);
    assert.equal(world.read().transition, null);
    assert.equal(world.disk.get(world.account), before);
    assert.equal(
      world.http.filter((request) => request.operation).length,
      mutations,
    );
    assert.equal(
      world.ownerSetupDisk.get(world.account),
      "private-personal-history",
    );
    assert.equal(world.personalClears, 0);
    await controller.result().signOut();
    assert.equal(controller.result().authStatus, "signed_out");
  } finally {
    controller.unmount();
  }
});

test("an action auth rejection pauses authentication and retains its unresolved transition", async () => {
  const world = ownerWorld();
  const controller = await boot(world);
  try {
    world.beforeMutation = async () => {
      throw new Error("sign_in_required");
    };
    await assert.rejects(
      controller.result().deleteAccount(),
      /sign_in_required/,
    );
    assert.equal(controller.result().authStatus, "reauth_required");
    assert.equal(controller.result().transitionPending, true);
    world.advanceTimers(5000);
    assert.equal(controller.result().error, "sign_in_required");
    assert.equal(controller.result().transitionPending, true);
  } finally {
    controller.unmount();
  }
});

test("a stale server action after explicit logout cannot turn signed out into expired", async () => {
  const world = ownerWorld();
  const controller = await boot(world);
  const deleteAccount = controller.result().deleteAccount;
  try {
    await controller.result().signOut();
    await assert.rejects(deleteAccount(), /sign_in_required/);
    assert.equal(controller.result().authStatus, "signed_out");
    assert.equal(world.deletionReceipt, null);
    assert.equal(world.read(), null);
  } finally {
    controller.unmount();
  }
});

test("full record offline save survives restart and sends exactly the durably saved operation", async () => {
  const world = makeWorld();
  const first = await boot(world);
  const entry = {
    id: "growth-full",
    type: "growth",
    start: "2026-09-01T01:00:00.000Z",
    weight: 3.725,
    note: "Original precise value",
  };
  await first.result().saveRecord("entry", entry);
  assert.equal(world.recordsSent.length, 0);
  const op = world.read().records[0].operation;
  first.unmount();
  world.offline = false;
  const next = world.mount();
  await until(
    () => world.recordsSent.length === 1 && !next.result().syncing,
    "full record restart sync",
  );
  assert.equal(world.recordsSent[0].durablySaved, true);
  assert.deepEqual(world.recordsSent[0].operation, op);
  assert.equal(next.result().sharedState.entries[0].weight, 3.725);
  assert.equal(world.read().records.length, 0);
  next.unmount();
});

const liveSleep = {
  id: "live-sleep",
  type: "sleep",
  start: "2026-09-01T01:00:00.000Z",
  note: "",
};
test("live sleep controls project start and quick discard without waiting for the API", async () => {
  const world = makeWorld({ offline: false });
  const receipt = deferred();
  world.beforeRecord = async (operation) => {
    if (operation.kind === "create") await receipt.promise;
  };
  const c = await boot(world);
  try {
    await c.result().saveRecord("entry", liveSleep);
    await until(() => world.recordsSent.length === 1, "in-flight sleep create");
    assert.equal(c.result().canEditRecord("entry", liveSleep.id), false);
    assert.equal(c.result().canControlSleep(liveSleep.id), true);
    const original = structuredClone(world.recordsSent[0].operation);
    await c.result().finishSleep(liveSleep.id, "2026-09-01T01:00:10.000Z");
    assert.equal(c.result().sharedState.entries.length, 0);
    assert.equal(c.result().canControlSleep(liveSleep.id), false);
    assert.deepEqual(world.read().records[0].operation, original);
    assert.ok(world.read().records[0].sleepFollowUp);
    await assert.rejects(
      c.result().finishSleep(liveSleep.id, "2026-09-01T01:00:11.000Z"),
      /record_pending/,
    );
    receipt.resolve();
    await until(
      () => world.recordsSent.length === 2 && !c.result().syncing,
      "durable quick-sleep removal",
    );
    assert.equal(world.recordsSent[1].operation.kind, "delete");
    assert.notEqual(
      world.recordsSent[1].operation.operationId,
      original.operationId,
    );
    assert.ok(world.recordsSent.every((sent) => sent.durablySaved));
    assert.equal(world.server.entries.length, 0);
  } finally {
    receipt.resolve();
    c.unmount();
  }
});
test("offline completed sleep survives restart and sends original create then versioned finish", async () => {
  const world = makeWorld();
  const first = await boot(world);
  await first.result().saveRecord("entry", liveSleep);
  await first.result().finishSleep(liveSleep.id, "2026-09-01T01:01:00.000Z");
  const original = structuredClone(world.read().records[0].operation);
  const followUpId = world.read().records[0].sleepFollowUp.operationId;
  assert.equal(
    first.result().sharedState.entries[0].end,
    "2026-09-01T01:01:00.000Z",
  );
  first.unmount();
  world.offline = false;
  const next = world.mount();
  try {
    await until(
      () => world.recordsSent.length === 1 && !next.result().syncing,
      "restarted original sleep create",
    );
    assert.equal(
      next.result().sharedState.entries[0].end,
      "2026-09-01T01:01:00.000Z",
    );
    await next.result().refresh();
    assert.deepEqual(world.recordsSent[0].operation, original);
    assert.equal(world.recordsSent[1].operation.operationId, followUpId);
    assert.equal(world.recordsSent[1].operation.baseVersion, "1");
    assert.equal(world.server.entries[0].entry.end, "2026-09-01T01:01:00.000Z");
    assert.equal(world.read().records.length, 0);
  } finally {
    next.unmount();
  }
});
test("failed durable sleep stop rolls back projection and does not send the stop", async () => {
  const world = makeWorld();
  const c = await boot(world);
  try {
    await c.result().saveRecord("entry", liveSleep);
    world.beforeCommit = async () => {
      throw new Error("disk_full");
    };
    await assert.rejects(
      c.result().finishSleep(liveSleep.id, "2026-09-01T01:00:10.000Z"),
      /local_save_failed/,
    );
    assert.equal(c.result().canControlSleep(liveSleep.id), true);
    assert.equal(c.result().sharedState.entries[0].end, undefined);
    assert.equal(world.read().records[0].sleepFollowUp, undefined);
    assert.equal(world.recordsSent.length, 0);
  } finally {
    c.unmount();
  }
});
test("lost sleep-create response retries the immutable ID before applying the durable stop", async () => {
  const world = makeWorld({ offline: false });
  let failResponse = true;
  world.beforeRecord = async () => {
    if (failResponse) {
      failResponse = false;
      throw new Error("network_unavailable");
    }
  };
  const c = await boot(world);
  try {
    await c.result().saveRecord("entry", liveSleep);
    await until(
      () => world.recordsSent.length === 1 && !c.result().syncing,
      "lost sleep-create response",
    );
    assert.equal(c.result().error, "network_unavailable");
    const original = structuredClone(world.recordsSent[0].operation);
    world.offline = true;
    await c.result().finishSleep(liveSleep.id, "2026-09-01T01:00:10.000Z");
    world.offline = false;
    await c.result().refresh();
    await c.result().refresh();
    assert.deepEqual(world.recordsSent[1].operation, original);
    assert.equal(world.recordsSent.at(-1).operation.kind, "delete");
    assert.equal(world.server.entries.length, 0);
    assert.equal(world.read().records.length, 0);
  } finally {
    c.unmount();
  }
});
test("accepted sleep with an unavailable snapshot resumes its stop safely after restart", async () => {
  const world = makeWorld();
  const first = await boot(world);
  await first.result().saveRecord("entry", liveSleep);
  await first.result().finishSleep(liveSleep.id, "2026-09-01T01:00:10.000Z");
  world.beforeRecord = async () => {
    world.snapshotOffline = true;
  };
  world.offline = false;
  await first.result().refresh();
  assert.equal(world.read().records[0].status, "accepted");
  assert.equal(first.result().sharedState.entries.length, 0);
  first.unmount();
  world.snapshotOffline = false;
  world.beforeRecord = async () => {};
  const next = world.mount();
  try {
    await until(
      () => world.recordsSent.length === 2 && !next.result().syncing,
      "resuming accepted sleep stop",
    );
    assert.equal(world.recordsSent[1].operation.kind, "delete");
    assert.equal(world.server.entries.length, 0);
    assert.equal(world.read().records.length, 0);
  } finally {
    next.unmount();
  }
});
test("directory revocation stays hidden after restart even when family SQLite purge fails", async () => {
  const world = makeWorld({ offline: false });
  const first = await boot(world);
  assert.ok(first.result().sharedState);
  world.identityDenied = true;
  world.beforeCommit = async () => {
    throw new Error("disk_full");
  };
  await first.result().refresh();
  assert.equal(first.result().sharedState, null);
  assert.deepEqual(world.cachedIdentity.families, []);
  first.unmount();
  world.offline = true;
  const next = world.mount();
  await until(() => !next.result().booting, "revoked restart");
  assert.equal(next.result().sharedState, null);
  next.unmount();
});
test("full record conflict refreshes winner and preserves failed operation without overwriting", async () => {
  const world = makeWorld({ offline: false });
  const entry = {
    id: "full",
    type: "diaper",
    start: "2026-09-01T01:00:00.000Z",
    diaperKind: "wet",
    note: "winner",
  };
  world.server.entries = [
    { entry, version: "2", recordedBy: "user-a", lastEditedBy: "other" },
  ];
  const c = await boot(world);
  await c.result().saveRecord("entry", { ...entry, note: "loser" }, "1");
  await until(
    () => c.result().recordConflicts.length === 1 && !c.result().syncing,
    "conflict refresh",
  );
  assert.equal(c.result().sharedState.entries[0].note, "winner");
  assert.equal(c.result().recordConflicts[0].error, "record_changed");
  c.unmount();
});
function ownerWorld() {
  const world = makeWorld({ offline: false });
  world.identity.families = [];
  world.cachedIdentity.families = [];
  world.data.state.snapshot = null;
  world.data.state.draft = null;
  world.disk.set(world.account, JSON.stringify(world.data.state));
  world.personalSource.entries = [
    {
      id: "first",
      type: "feed",
      feedKind: "expressed",
      start: "2026-09-01T01:00:00.000Z",
      amount: 81.125,
      note: "Owner history",
    },
  ];
  return world;
}

test("Watch commands persist stable operation and receipt together, survive restart and reject other workspaces", async () => {
  const world = makeWorld({ offline: false });
  world.server.watchRecordingEnabled = true;
  const controller = await boot(world);
  const command = {
    schemaVersion: 1,
    commandId: "71111111-1111-4111-8111-111111111111",
    recordId: "72222222-2222-4222-8222-222222222222",
    workspaceKey: controller.result().watchWorkspaceKey,
    generation: 1,
    createdAt: new Date().toISOString(),
    kind: "create",
    entry: {
      id: "72222222-2222-4222-8222-222222222222",
      type: "diaper",
      start: new Date().toISOString(),
      diaperKind: "wet",
      note: "",
    },
  };
  try {
    world.offline = true;
    const receipt = await controller.result().applyWatchCommand(command);
    assert.equal(receipt.status, "pending");
    assert.equal(
      world.read().records[0].operation.operationId,
      command.commandId,
    );
    assert.equal(
      world.read().watchLedger[command.commandId].receipt.status,
      "pending",
    );
    const replay = await controller.result().applyWatchCommand(command);
    assert.equal(replay.status, "pending");
    assert.equal(world.read().records.length, 1);
    await assert.rejects(
      controller
        .result()
        .applyWatchCommand({ ...command, workspaceKey: "another-account" }),
      /membership_changed/,
    );
  } finally {
    controller.unmount();
  }
  const restarted = await boot(world);
  try {
    assert.equal(restarted.result().watchReceipts[0].status, "pending");
    world.offline = false;
    await restarted.result().refresh();
    assert.equal(restarted.result().watchReceipts[0].status, "shared");
    assert.equal(world.recordsSent[0].operation.operationId, command.commandId);
    assert.equal(
      world.read().watchLedger[command.commandId].receipt.status,
      "shared",
    );
  } finally {
    restarted.unmount();
  }
});

test("Watch family ingestion failure commits neither record nor receipt", async () => {
  const world = makeWorld({ offline: false });
  world.server.watchRecordingEnabled = true;
  const controller = await boot(world);
  try {
    world.beforeCommit = async () => {
      throw new Error("disk_full");
    };
    const id = "73333333-3333-4333-8333-333333333333";
    await assert.rejects(
      controller.result().applyWatchCommand({
        schemaVersion: 1,
        commandId: id,
        recordId: id,
        workspaceKey: controller.result().watchWorkspaceKey,
        generation: 1,
        createdAt: new Date().toISOString(),
        kind: "create",
        entry: {
          id,
          type: "diaper",
          start: new Date().toISOString(),
          diaperKind: "wet",
          note: "",
        },
      }),
      /local_save_failed/,
    );
    assert.equal(world.read().records?.length ?? 0, 0);
    assert.equal(world.read().watchLedger, undefined);
    assert.equal(controller.result().sharedState.entries.length, 0);
  } finally {
    controller.unmount();
  }
});

for (const flag of [undefined, false]) {
  test(`family Watch admission stays disabled when snapshot flag is ${String(flag)}`, async () => {
    const world = makeWorld({ offline: false });
    if (flag !== undefined) world.server.watchRecordingEnabled = flag;
    const controller = await boot(world);
    try {
      assert.equal(controller.result().watchRecordingEnabled, false);
      assert.equal(controller.result().getWatchState().state, null);
      assert.ok(
        controller.result().sharedState,
        "ordinary phone records remain available",
      );
      const id = "74444444-4444-4444-8444-444444444444";
      await assert.rejects(
        controller.result().applyWatchCommand({
          schemaVersion: 1,
          commandId: id,
          recordId: id,
          workspaceKey: controller.result().watchWorkspaceKey,
          generation: 1,
          createdAt: new Date().toISOString(),
          kind: "create",
          entry: {
            id,
            type: "diaper",
            start: new Date().toISOString(),
            diaperKind: "wet",
            note: "",
          },
        }),
        /watch_recording_unavailable/,
      );
      assert.equal(world.read().records?.length ?? 0, 0);
    } finally {
      controller.unmount();
    }
  });
}

test("disabling server Watch admission pauses durable Watch outbox until the timer guard returns", async () => {
  const world = makeWorld({ offline: false });
  world.server.watchRecordingEnabled = true;
  const controller = await boot(world);
  try {
    assert.equal(controller.result().watchRecordingEnabled, true);
    assert.ok(controller.result().getWatchState().state);
    world.offline = true;
    const id = "75555555-5555-4555-8555-555555555555";
    await controller.result().applyWatchCommand({
      schemaVersion: 1,
      commandId: id,
      recordId: id,
      workspaceKey: controller.result().watchWorkspaceKey,
      generation: 1,
      createdAt: new Date().toISOString(),
      kind: "create",
      entry: {
        id,
        type: "diaper",
        start: new Date().toISOString(),
        diaperKind: "wet",
        note: "",
      },
    });
    world.offline = false;
    world.server.watchRecordingEnabled = false;
    await controller.result().refresh();
    assert.equal(controller.result().getWatchState().state, null);
    assert.equal(world.recordsSent.length, 0);
    assert.equal(world.read().watchLedger[id].receipt.status, "pending");
    assert.equal(world.read().records.length, 1);
    world.server.watchRecordingEnabled = true;
    await controller.result().refresh();
    assert.equal(world.recordsSent.length, 1);
    assert.equal(world.read().watchLedger[id].receipt.status, "shared");
  } finally {
    controller.unmount();
  }
});

test("confirmed family revocation invalidates native Watch context before another snapshot exists", async () => {
  const world = makeWorld({ offline: false });
  const controller = await boot(world);
  try {
    const prior = world.watchInvalidations ?? 0;
    world.identity.families = [];
    await controller.result().refresh();
    assert.ok(world.watchInvalidations > prior);
    assert.equal(controller.result().watchWorkspaceKey, null);
    assert.equal(controller.result().getWatchState().state, null);
  } finally {
    controller.unmount();
  }
});

test("notification refresh distinguishes a readable offline cache from newly verified access", async () => {
  const world = makeWorld({ offline: false });
  const controller = await boot(world);
  try {
    world.offline = true;
    assert.equal(await controller.result().refreshForNotification(), false);
    assert.ok(
      controller.result().sharedState,
      "ordinary offline reading remains available",
    );
    world.offline = false;
    assert.equal(await controller.result().refreshForNotification(), true);
    world.identity.families = [];
    assert.equal(await controller.result().refreshForNotification(), false);
  } finally {
    controller.unmount();
  }
});

test("family creation fences a known undrained Watch inbox before committing a transition", async () => {
  const world = ownerWorld();
  const controller = await boot(world);
  try {
    world.watchInbox = ["pending-native-command"];
    await assert.rejects(
      controller.result().createFamilyFromSeed(ownerSeed(world)),
      /watch_pending/,
    );
    assert.equal(world.read().transition, null);
    assert.ok(world.watchSuspends > 0);
    assert.equal(world.mutationReceipts.size, 0);
  } finally {
    controller.unmount();
  }
});
function ownerSeed(world) {
  return {
    schemaVersion: 1,
    source: structuredClone(world.personalSource),
    inviteeEmails: ["family@example.test"],
    extrasSchemaVersion: 1,
    extraRecords: structuredClone(world.personalExtras),
    counts: {
      feed: 1,
      diaper: 0,
      sleep: 0,
      growth: 0,
      milestone: 0,
      care: 0,
      total: 1,
    },
  };
}
test("extras capability is required before new creation or join can clear personal data", async () => {
  for (const method of ["create", "join"]) {
    const world = ownerWorld();
    world.capabilities = {
      schemaVersion: 2,
      recordKinds: ["feed", "diaper", "sleep", "growth", "milestone", "care"],
      maxSeedBytes: 33554432,
    };
    const c = await boot(world);
    await assert.rejects(
      method === "create"
        ? c.result().createFamilyFromSeed(ownerSeed(world))
        : c.result().acceptInvitation("invite-b"),
      /sharing_unavailable/,
    );
    assert.equal(world.personalClears, 0);
    assert.equal(
      world.http.some((q) => q.operation?.operationId),
      false,
    );
    c.unmount();
  }
});
test("family creation compares extras again under the personal storage barrier", async () => {
  const world = ownerWorld();
  const c = await boot(world);
  const seed = ownerSeed(world);
  world.personalExtras.push({
    id: "play-selection",
    kind: "play-selection",
    selection: { included: ["face"], excluded: [] },
  });
  await assert.rejects(
    c.result().createFamilyFromSeed(seed),
    /owner_source_changed/,
  );
  assert.equal(world.personalClears, 0);
  assert.equal(
    world.http.some((q) => q.url === "/v2/families"),
    false,
  );
  c.unmount();
});
test("a reminder already being scheduled must finish before the final reviewed source comparison", async () => {
  const world = ownerWorld();
  const c = await boot(world);
  const seed = ownerSeed(world);
  world.beforeReminderDrain = async () => {
    world.personalExtras.push({
      id: "reminder-settings",
      kind: "reminder-settings",
      settings: null,
    });
  };
  await assert.rejects(
    c.result().createFamilyFromSeed(seed),
    /owner_source_changed/,
  );
  assert.equal(
    world.http.some((q) => q.url === "/v2/families"),
    false,
  );
  assert.equal(world.personalClears, 0);
  c.unmount();
});
test("family extras save through the durable versioned outbox and survive refresh", async () => {
  const world = makeWorld({ offline: false });
  const c = await boot(world);
  const record = {
    id: "play-selection",
    kind: "play-selection",
    selection: { included: ["face"], excluded: [] },
  };
  await c.result().saveRecord("extra", record);
  await until(
    () => world.recordsSent.length === 1 && !c.result().syncing,
    "extra synchronization",
  );
  assert.equal(world.recordsSent[0].durablySaved, true);
  assert.deepEqual(world.recordsSent[0].operation.extraRecord, record);
  assert.equal(c.result().sharedExtras[0].record.kind, "play-selection");
  c.unmount();
});
test("extra read failure before dispatch releases creation intent without clearing personal history", async () => {
  const world = ownerWorld();
  const c = await boot(world);
  world.personalCaptureError = "avatar_read_failed";
  await assert.rejects(
    c.result().createFamilyFromSeed(ownerSeed(world)),
    /avatar_read_failed/,
  );
  assert.equal(world.read().transition, null);
  assert.equal(world.personalClears, 0);
  assert.equal(
    world.http.some((q) => q.url === "/v2/families"),
    false,
  );
  c.unmount();
});
test("a newly submitted seed without the extras review cannot activate a family", async () => {
  const world = ownerWorld();
  const c = await boot(world);
  const seed = ownerSeed(world);
  delete seed.extrasSchemaVersion;
  delete seed.extraRecords;
  await assert.rejects(
    c.result().createFamilyFromSeed(seed),
    /owner_source_changed/,
  );
  assert.equal(world.personalClears, 0);
  assert.equal(world.read().transition, null);
  c.unmount();
});
test("family reminder delivery needs explicit local enable and logout clears it", async () => {
  const world = makeWorld({ offline: false });
  const c = await boot(world);
  assert.equal(c.result().notificationsEnabled, false);
  assert.equal(
    world.notificationCalls.some((call) => call.kind === "permission"),
    false,
  );
  await c.result().setNotificationsEnabled(true);
  assert.equal(c.result().notificationsEnabled, true);
  assert.equal(world.notificationOptIn.size, 1);
  await c.result().signOut();
  await until(
    () => world.notificationCalls.some((call) => call.kind === "clear"),
    "notification cleanup",
  );
  assert.equal(world.notificationOptIn.size, 0);
  c.unmount();
});

test("known auth expiry suspends notification delivery before another render", async () => {
  const world = makeWorld({ offline: false });
  const c = await boot(world);
  const enable = c.result().setNotificationsEnabled;
  await enable(true);
  const before = world.notificationCalls.length;
  world.identityError = { code: "unauthorized", status: 401 };
  await c.result().refresh();
  assert.ok(
    world.notificationCalls
      .slice(before)
      .some((call) => call.kind === "suspend"),
  );
  await assert.rejects(
    enable(true),
    /refresh_required|sign_in_required|session_changed/,
  );
  assert.equal(
    world.notificationCalls
      .slice(before)
      .some((call) => call.kind === "permission"),
    false,
  );
  c.unmount();
});

test("pending notification enable cannot schedule after auth expiry without a render", async () => {
  const world = makeWorld({ offline: false });
  const c = await boot(world);
  const permission = deferred();
  world.beforeNotificationEnable = () => permission.promise;
  const enable = c.result().setNotificationsEnabled(true);
  await until(
    () => world.notificationCalls.some((call) => call.kind === "permission"),
    "native permission request",
  );
  world.identityError = { code: "unauthorized", status: 401 };
  await c.result().refresh();
  const before = world.notificationCalls.length;
  permission.resolve();
  await assert.rejects(enable, /session_changed|refresh_required/);
  assert.equal(
    world.notificationCalls.slice(before).some((call) => call.kind === "sync"),
    false,
  );
  c.unmount();
});

test("verified revocation cancels notifications before an identity cache write can stall", async () => {
  const world = makeWorld({ offline: false });
  const c = await boot(world);
  await c.result().setNotificationsEnabled(true);
  const write = deferred();
  world.beforeIdentitySave = () => write.promise;
  world.identity.families = [];
  const before = world.notificationCalls.length;
  const refresh = c.result().refresh();
  await tick();
  assert.ok(
    world.notificationCalls.slice(before).some((call) => call.kind === "clear"),
  );
  write.resolve();
  await refresh;
  c.unmount();
});

for (const method of ["leaveFamily", "closeFamily"]) {
  test(`${method} waits for native notification cleanup before reporting success`, async () => {
    const world = makeWorld({ offline: false });
    if (method === "leaveFamily") {
      world.server.family.role = "caregiver";
      world.identity.families[0].role = "caregiver";
      world.cachedIdentity.families[0].role = "caregiver";
      world.data.state.snapshot.family.role = "caregiver";
      world.disk.set(world.account, JSON.stringify(world.data.state));
    }
    const c = await boot(world);
    await c.result().setNotificationsEnabled(true);
    const cleanup = deferred();
    world.beforeNotificationClear = () => cleanup.promise;
    let completed = false;
    const departure = c
      .result()
      [method]()
      .then(() => {
        completed = true;
      });
    await tick();
    await tick();
    assert.ok(world.notificationCalls.some((call) => call.kind === "clear"));
    assert.equal(completed, false);
    cleanup.resolve();
    await departure;
    assert.equal(world.notificationOptIn.size, 0);
    c.unmount();
  });
}
test("lost full creation response restarts the same reviewed seed operation before activation cleanup", async () => {
  const world = ownerWorld();
  const c = await boot(world);
  world.ownerSetupDisk.set(world.account, "private-source-draft");
  world.beforeMutation = async () => {
    throw new Error("network_unavailable");
  };
  await assert.rejects(
    c.result().createFamilyFromSeed(ownerSeed(world)),
    /network_unavailable/,
  );
  const operation = world.read().transition.operationId;
  assert.equal(world.personalClears, 0);
  assert.equal(c.result().sharedState, null);
  await assert.rejects(c.result().signOut(), /transition_pending/);
  c.unmount();
  world.beforeMutation = async () => {};
  const reopened = world.mount();
  await until(
    () => world.read().transition === null && !reopened.result().syncing,
    "full activation replay",
  );
  const sent = world.http.filter((q) => q.url === "/v2/families");
  assert.equal(sent.length, 2);
  assert.equal(sent[0].operation.declinePendingInvitations, true);
  assert.equal(sent[1].operation.declinePendingInvitations, true);
  assert.equal(sent[1].operation.operationId, operation);
  assert.equal(world.personalClears, 1);
  assert.equal(world.ownerSetupDisk.has(world.account), false);
  assert.equal(reopened.result().sharedState.entries[0].amount, 81.125);
  reopened.unmount();
});
test("activation stays frozen across restart when local cleanup fails and retries without another create", async () => {
  const world = ownerWorld();
  const c = await boot(world);
  world.beforePersonalClear = async () => {
    throw new Error("cleanup_failed");
  };
  await assert.rejects(
    c.result().createFamilyFromSeed(ownerSeed(world)),
    /cleanup_failed/,
  );
  assert.equal(world.read().transition.phase, "committed");
  assert.deepEqual(world.read().transition.body, {});
  assert.equal(c.result().sharedState, null);
  c.unmount();
  world.beforePersonalClear = async () => {};
  const next = world.mount();
  await until(() => world.read().transition === null, "cleanup resumed");
  assert.equal(world.http.filter((q) => q.url === "/v2/families").length, 1);
  assert.equal(world.personalClears, 1);
  next.unmount();
});
test("activation handles a revoked grant or corrupt seed receipt without clearing personal data", async () => {
  for (const corruption of ["destination", "digest"]) {
    const world = ownerWorld();
    const c = await boot(world);
    world.beforeMutation = async (_, op) => {
      if (corruption === "digest")
        world.mutationReceipts.get(op.operationId).seedDigest = "wrong";
      else {
        world.server.family.membershipId = "new-grant";
        world.server.members[0].membershipId = "new-grant";
        world.identity.families = [structuredClone(world.server.family)];
      }
    };
    if (corruption === "digest")
      await assert.rejects(
        c.result().createFamilyFromSeed(ownerSeed(world)),
        /invalid_response/,
      );
    else await c.result().createFamilyFromSeed(ownerSeed(world));
    assert.equal(world.personalClears, 0);
    assert.equal(c.result().sharedState, null);
    if (corruption === "digest") assert.notEqual(world.read().transition, null);
    else {
      assert.equal(world.read().transition, null);
      assert.equal(world.read().snapshot, null);
      assert.equal(c.result().notice, "membership_revoked");
    }
    c.unmount();
  }
});
test("unsupported full capabilities never submit seed or clear private storage", async () => {
  const world = ownerWorld();
  world.capabilities = {
    schemaVersion: 1,
    recordKinds: ["feed"],
    maxSeedBytes: 1,
  };
  const c = await boot(world);
  await assert.rejects(
    c.result().createFamilyFromSeed(ownerSeed(world)),
    /full_sharing_unavailable/,
  );
  assert.equal(world.personalClears, 0);
  assert.equal(
    world.http.some((q) => q.url === "/v2/families"),
    false,
  );
  c.unmount();
});
test("a sync in flight cannot send an optimistic outbox Save before SQLite commits", async () => {
  const world = makeWorld({ offline: false });
  const snapshotWrite = deferred();
  const outboxWrite = deferred();
  world.beforeCommit = async ({ number }) => {
    if (number === 1) await snapshotWrite.promise;
    if (number === 2) await outboxWrite.promise;
  };
  const controller = world.mount();
  try {
    await until(
      () => world.transactions.length === 1,
      "first snapshot disk write",
    );
    const saving = controller.result().saveDraft();
    snapshotWrite.resolve();
    await until(() => world.transactions.length === 2, "outbox disk write");
    for (let index = 0; index < 10; index++) await tick();
    assert.equal(world.feedsSent.length, 0, "An unsaved operation was sent");
    outboxWrite.resolve();
    await saving;
    await until(
      () => world.feedsSent.length === 1 && !controller.result().syncing,
      "saved operation synchronization",
    );
    assert.ok(world.feedsSent.every((item) => item.durablySaved));
  } finally {
    snapshotWrite.resolve();
    outboxWrite.resolve();
    controller.unmount();
  }
});

for (const failure of ["credentials", "cache", "both"])
  test(`logout remains closed and reports an explicit error when ${failure} cleanup fails`, async () => {
    const world = makeWorld();
    const controller = await boot(world);
    if (failure !== "cache")
      world.beforeAuthSignOut = async () => {
        throw new Error("Native credential deletion failed");
      };
    if (failure !== "credentials")
      world.beforeDelete = async () => {
        throw new Error("Native database deletion failed");
      };
    try {
      await assert.rejects(controller.result().signOut(), {
        message: "sign_out_failed",
      });
      assert.equal(controller.result().user, null);
      assert.equal(controller.result().snapshot, null);
      assert.equal(controller.result().error, "sign_out_failed");
      assert.equal(
        world.authSignOutCalls,
        1,
        "Credential cleanup must still run if cache cleanup fails",
      );
      assert.equal(
        world.deleteCalls,
        1,
        "Cache cleanup must still run if credential cleanup fails",
      );
      const requestCount = world.http.length;
      await controller.result().refresh();
      assert.equal(
        world.http.length,
        requestCount,
        "Confirmed logout must prevent further authenticated requests",
      );
      await assert.rejects(controller.result().signIn(), {
        message: "sign_out_failed",
      });
      assert.equal(
        world.authSignInCalls,
        0,
        "Unfinished cleanup must block authentication even through direct hook calls",
      );
      world.beforeAuthSignOut = async () => {};
      world.beforeDelete = async () => {};
      await controller.result().signOut();
      assert.equal(
        world.read(),
        null,
        "Retry must clear the departing account even though user is already null",
      );
      assert.equal(world.session, false);
    } finally {
      controller.unmount();
    }
  });

for (const operation of ["typing", "save"])
  test(`${operation} reports local_save_failed when SQLite fails`, async () => {
    const world = makeWorld();
    const controller = await boot(world);
    world.beforeCommit = async () => {
      throw new Error("Native disk is full");
    };
    try {
      const promise =
        operation === "typing"
          ? controller.result().setDraft({
              ...controller.result().draft,
              note: "Cannot persist",
            })
          : controller.result().saveDraft();
      await assert.rejects(promise, { message: "local_save_failed" });
      assert.equal(controller.result().error, "local_save_failed");
      assert.equal(world.read().queue.length, 0);
      assert.equal(world.feedsSent.length, 0);
    } finally {
      controller.unmount();
    }
  });

test("failed credential cleanup blocks sign-in even without a verified account", async () => {
  const world = makeWorld();
  world.session = false;
  world.cachedIdentity = null;
  const controller = world.mount();
  world.beforeAuthSignOut = async () => {
    throw new Error("Native credential deletion failed");
  };
  try {
    await assert.rejects(controller.result().signOut(), {
      message: "sign_out_failed",
    });
    assert.equal(controller.result().user, null);
    await assert.rejects(controller.result().signIn(), {
      message: "sign_out_failed",
    });
    assert.equal(world.authSignInCalls, 0);
    world.beforeAuthSignOut = async () => {};
    await controller.result().signOut();
    assert.equal(world.session, false);
  } finally {
    controller.unmount();
  }
});

test("navigation drains already accepted typing and reopening waits for those disk writes", async () => {
  const world = makeWorld();
  const first = await boot(world);
  const gate = deferred();
  world.beforeCommit = async ({ number }) => {
    if (number === 1) await gate.promise;
  };
  const firstTyping = first
    .result()
    .setDraft({ ...first.result().draft, note: "First keystroke" });
  await until(() => world.transactions.length === 1, "first typing disk write");
  const lastTyping = first
    .result()
    .setDraft({ ...first.result().draft, note: "Latest keystroke" });
  const settlements = Promise.allSettled([firstTyping, lastTyping]);
  first.unmount();
  const reopened = world.mount();
  try {
    for (let index = 0; index < 5; index++) await tick();
    assert.equal(
      reopened.result().user,
      null,
      "Reopening exposed a stale cache while accepted writes were pending",
    );
    gate.resolve();
    await settlements;
    await until(
      () => reopened.result().user?.id === "user-a",
      "reopened account data",
    );
    assert.equal(world.read().draft.note, "Latest keystroke");
    assert.equal(reopened.result().draft.note, "Latest keystroke");
  } finally {
    gate.resolve();
    reopened.unmount();
  }
});

test("reauthentication with the same account retains private drafts and saved work", async () => {
  const world = makeWorld({ queued: true });
  const controller = await boot(world);
  world.offline = false;
  world.snapshotOffline = true;
  try {
    await controller.result().signIn();
    assert.equal(controller.result().user.id, "user-a");
    assert.equal(controller.result().draft.recordId, "draft-a");
    assert.equal(
      controller.result().pending[0].operation.operationId,
      "saved-operation-a",
    );
    assert.equal(
      world.read().queue[0].operation.operationId,
      "saved-operation-a",
    );
    assert.equal(world.authSignOutCalls, 0);
  } finally {
    controller.unmount();
  }
});

test("reauthentication as a different account hides the original data and never sends its queue", async () => {
  const world = makeWorld({ queued: true });
  const controller = await boot(world);
  world.beforeAuthSignIn = async () => {
    world.identity = {
      user: {
        id: "user-b",
        displayName: "Other test account",
        email: "test-b@example.invalid",
      },
      families: [],
    };
    world.offline = false;
  };
  try {
    await assert.rejects(controller.result().signIn(), {
      message: "account_mismatch",
    });
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().snapshot, null);
    assert.equal(controller.result().draft, null);
    assert.equal(controller.result().pending.length, 0);
    assert.equal(
      world.read().queue[0].operation.operationId,
      "saved-operation-a",
    );
    assert.equal(world.feedsSent.length, 0);
    assert.equal(world.session, false);
  } finally {
    controller.unmount();
  }
});

test("revocation and joining another family erase every recovery payload", async () => {
  const world = makeWorld({ queued: true });
  const controller = await boot(world);
  const oldDraft = structuredClone(controller.result().draft);
  world.offline = false;
  world.identity.families = [];
  try {
    await controller.result().refresh();
    assert.equal(controller.result().draft, null);
    assert.equal(controller.result().conflicts.length, 0);
    assert.equal(world.read().queue.length, 0);
    const b = {
      ...world.server.family,
      id: "family-b",
      membershipId: "grant-b",
    };
    world.server = {
      ...world.server,
      family: b,
      members: [{ ...world.server.members[0], membershipId: "grant-b" }],
    };
    world.identity.families = [b];
    await controller.result().refresh();
    await assert.rejects(
      controller.result().setDraft(oldDraft),
      /draft_changed/,
    );
    await assert.rejects(
      controller.result().reviewPrivateDraft(),
      /family_unavailable/,
    );
    await assert.rejects(
      controller.result().reviewConflict("saved-operation-a"),
      /family_unavailable/,
    );
    assert.equal(world.feedsSent.length, 0);
    assert.equal(world.read().snapshot.family.id, "family-b");
  } finally {
    controller.unmount();
  }
});

test("lost leave response freezes workspace and restart reuses the durable operation", async () => {
  const world = makeWorld({ queued: true });
  world.data.state.snapshot.family.role = "caregiver";
  world.cachedIdentity.families[0].role = "caregiver";
  world.identity.families[0].role = "caregiver";
  world.server.family.role = "caregiver";
  world.disk.set(world.account, JSON.stringify(world.data.state));
  const controller = await boot(world);
  world.offline = false;
  world.beforeMutation = async () => {
    throw new Error("network_unavailable");
  };
  await assert.rejects(
    controller.result().leaveFamily(),
    /network_unavailable/,
  );
  const intent = world.read().transition;
  assert.equal(intent.kind, "leave");
  assert.equal(controller.result().transitionPending, true);
  assert.equal(controller.result().snapshot, null);
  assert.equal(controller.result().draft, null);
  await assert.rejects(controller.result().saveDraft(), /transition_pending/);
  controller.unmount();
  world.beforeMutation = async () => {};
  const reopened = world.mount();
  try {
    await until(
      () =>
        world.read().transition === null &&
        world.http.filter((r) => r.url.endsWith("/leave")).length === 2,
      "idempotent leave recovery",
    );
    const requests = world.http.filter((r) => r.url.endsWith("/leave"));
    assert.equal(
      requests[0].operation.operationId,
      requests[1].operation.operationId,
    );
    assert.equal(requests[0].operation.operationId, intent.operationId);
    assert.equal(world.read().snapshot, null);
    assert.equal(world.read().draft, null);
    assert.equal(world.read().queue.length, 0);
    assert.equal(world.feedsSent.length, 0);
  } finally {
    reopened.unmount();
  }
});

test("join keeps old storage intact until the replacement snapshot is downloaded", async () => {
  const world = makeWorld();
  const controller = await boot(world);
  const before = world.read();
  const b = { ...world.server.family, id: "family-b", membershipId: "grant-b" };
  world.server = {
    ...world.server,
    family: b,
    members: [{ ...world.server.members[0], membershipId: "grant-b" }],
  };
  world.offline = false;
  world.snapshotOffline = true;
  try {
    await assert.rejects(
      controller.result().acceptInvitation("invite-b"),
      /network_unavailable/,
    );
    assert.equal(controller.result().transitionPending, true);
    assert.equal(world.read().transition.phase, "committed");
    assert.deepEqual(world.read().draft, before.draft);
    assert.equal(world.read().snapshot.family.id, "family-a");
    world.snapshotOffline = false;
    await controller.result().refresh();
    assert.equal(world.read().transition, null);
    assert.equal(world.read().snapshot.family.id, "family-b");
    assert.equal(world.read().draft, null);
    assert.equal(world.read().queue.length, 0);
    assert.equal(world.feedsSent.length, 0);
  } finally {
    controller.unmount();
  }
});

function joinWorld() {
  const world = ownerWorld();
  world.server.family.id = "family-b";
  world.server.family.membershipId = "grant-b";
  world.server.members[0].membershipId = "grant-b";
  return world;
}

test("lost join response durably retries the same consent and required schema after restart", async () => {
  const world = joinWorld();
  const controller = await boot(world);
  world.beforeMutation = async () => {
    throw new Error("network_unavailable");
  };
  await assert.rejects(
    controller.result().acceptInvitation("invite-b"),
    /network_unavailable/,
  );
  const intent = world.read().transition;
  assert.equal(intent.body.declineOtherInvitations, true);
  assert.equal(intent.body.requiredSchemaVersion, 2);
  assert.equal(intent.phase, "pending");
  assert.equal(world.personalClears, 0);
  controller.unmount();
  world.offline = true;
  const reopened = world.mount();
  try {
    await until(() => !reopened.result().booting, "offline join restart");
    assert.equal(reopened.result().activationPending, true);
    assert.equal(world.read().transition.operationId, intent.operationId);
    await assert.rejects(reopened.result().signOut(), /transition_pending/);
    world.beforeMutation = async () => {};
    world.offline = false;
    await reopened.result().refresh();
    const calls = world.http.filter((r) => r.url.endsWith("/accept"));
    assert.equal(calls.length, 2);
    for (const call of calls)
      assert.deepEqual(structuredClone(call.operation), {
        declineOtherInvitations: true,
        requiredSchemaVersion: 2,
        requiredExtrasSchemaVersion: 1,
        operationId: intent.operationId,
      });
    assert.equal(world.read().transition, null);
    assert.equal(world.personalClears, 1);
    assert.equal(reopened.result().fullSnapshot.family.id, "family-b");
  } finally {
    reopened.unmount();
  }
});

for (const recovery of ["refresh", "restart"])
  test(`revoked committed join recovers on ${recovery} without deleting personal history`, async () => {
    const world = joinWorld();
    let controller = await boot(world);
    const personal = structuredClone(world.personalSource);
    world.snapshotOffline = true;
    await assert.rejects(
      controller.result().acceptInvitation("invite-b"),
      /network_unavailable/,
    );
    assert.equal(world.read().transition.phase, "committed");
    world.identity.families = [];
    if (recovery === "restart") {
      controller.unmount();
      controller = world.mount();
      await until(() => !controller.result().booting, "revoked join restart");
    } else await controller.result().refresh();
    try {
      assert.equal(controller.result().activationPending, false);
      assert.equal(controller.result().sharedMode, false);
      assert.equal(controller.result().notice, "membership_revoked");
      assert.equal(world.read().transition, null);
      assert.equal(world.read().snapshot, null);
      assert.equal(world.read().draft, null);
      assert.equal(world.read().queue.length, 0);
      assert.equal(world.personalClears, 0);
      assert.deepEqual(world.personalSource, personal);
      assert.equal(
        world.http.filter((r) => r.url.endsWith("/accept")).length,
        1,
      );
      await controller.result().signOut();
      assert.equal(controller.result().user, null);
      assert.equal(world.personalClears, 0);
    } finally {
      controller.unmount();
    }
  });

for (const replacementFamilyId of ["family-b", "family-c"])
  test(`committed join cannot activate a replacement grant in ${replacementFamilyId}`, async () => {
    const world = joinWorld();
    const controller = await boot(world);
    world.snapshotOffline = true;
    await assert.rejects(
      controller.result().acceptInvitation("invite-b"),
      /network_unavailable/,
    );
    world.snapshotOffline = false;
    world.server.family.id = replacementFamilyId;
    world.server.family.membershipId = "replacement-grant";
    world.server.members[0].membershipId = "replacement-grant";
    world.identity.families = [structuredClone(world.server.family)];
    const beforeRefresh = world.http.length;
    try {
      await controller.result().refresh();
      assert.equal(world.read().transition, null);
      assert.equal(world.read().snapshot, null);
      assert.equal(controller.result().fullSnapshot, null);
      assert.equal(controller.result().notice, "membership_revoked");
      assert.equal(world.personalClears, 0);
      assert.equal(
        world.http
          .slice(beforeRefresh)
          .some((r) => r.url.endsWith("/snapshot")),
        false,
      );
      assert.equal(
        world.http.filter((r) => r.url.endsWith("/accept")).length,
        1,
      );
      await controller.result().signOut();
      assert.equal(world.personalClears, 0);
    } finally {
      controller.unmount();
    }
  });

test("revoked join waits for durable cleanup before releasing its activation journal", async () => {
  const world = joinWorld();
  const controller = await boot(world);
  world.snapshotOffline = true;
  await assert.rejects(
    controller.result().acceptInvitation("invite-b"),
    /network_unavailable/,
  );
  const operation = world.read().transition.operationId;
  world.identity.families = [];
  world.beforeCommit = async () => {
    throw new Error("disk_full");
  };
  try {
    await controller.result().refresh();
    assert.equal(controller.result().activationPending, true);
    assert.equal(world.read().transition.operationId, operation);
    assert.equal(world.personalClears, 0);
    world.beforeCommit = async () => {};
    await controller.result().refresh();
    assert.equal(controller.result().activationPending, false);
    assert.equal(world.read().transition, null);
    assert.equal(world.personalClears, 0);
  } finally {
    controller.unmount();
  }
});

test("a grant changed between verification and snapshot cannot populate the activation cache", async () => {
  const world = joinWorld();
  const controller = await boot(world);
  world.snapshotOffline = true;
  await assert.rejects(
    controller.result().acceptInvitation("invite-b"),
    /network_unavailable/,
  );
  world.snapshotOffline = false;
  world.server.family.membershipId = "replacement-grant";
  world.server.members[0].membershipId = "replacement-grant";
  try {
    await controller.result().refresh();
    assert.equal(controller.result().error, "membership_changed");
    assert.equal(controller.result().activationPending, true);
    assert.equal(controller.result().sharedState, null);
    assert.equal(world.read().snapshot, null);
    assert.equal(world.personalClears, 0);
    world.identity.families = [structuredClone(world.server.family)];
    await controller.result().refresh();
    assert.equal(controller.result().activationPending, false);
    assert.equal(world.read().snapshot, null);
    assert.equal(world.personalClears, 0);
  } finally {
    controller.unmount();
  }
});

test("an older committed unsupported join permits safe logout without deleting personal history", async () => {
  const world = joinWorld();
  world.identity.families = [structuredClone(world.server.family)];
  world.cachedIdentity = structuredClone(world.identity);
  world.data.state.transition = {
    operationId: "legacy-join-operation",
    kind: "join",
    path: "/v1/invitations/invite-b/accept",
    body: {},
    userId: "user-a",
    familyId: "family-b",
    phase: "committed",
    dispatched: true,
    activation: { familyId: "family-b", membershipId: "grant-b" },
  };
  world.disk.set(world.account, JSON.stringify(world.data.state));
  world.snapshotUnsupported = true;
  const controller = await boot(world);
  try {
    assert.equal(controller.result().error, "family_schema_unsupported");
    assert.equal(controller.result().activationPending, false);
    assert.equal(controller.result().sharedMode, true);
    assert.equal(controller.result().sharedState, null);
    assert.equal(world.personalClears, 0);
    assert.equal(world.read().transition, null);
    assert.equal(
      world.http.some((r) => r.url.endsWith("/accept")),
      false,
    );
    await controller.result().signOut();
    assert.equal(controller.result().sharedMode, false);
    assert.equal(world.personalClears, 0);
  } finally {
    controller.unmount();
  }
});

test("an uncertain leave is never replayed against a new membership grant", async () => {
  const world = makeWorld();
  world.data.state.snapshot.family.role = "caregiver";
  world.cachedIdentity.families[0].role = "caregiver";
  world.identity.families[0].role = "caregiver";
  world.server.family.role = "caregiver";
  world.disk.set(world.account, JSON.stringify(world.data.state));
  const controller = await boot(world);
  world.offline = false;
  world.beforeMutation = async () => {
    throw new Error("network_unavailable");
  };
  try {
    await assert.rejects(
      controller.result().leaveFamily(),
      /network_unavailable/,
    );
    const b = {
      ...world.server.family,
      membershipId: "new-grant",
      role: "caregiver",
    };
    world.identity.families = [b];
    world.server = {
      ...world.server,
      family: b,
      members: [{ ...world.server.members[0], membershipId: "new-grant" }],
    };
    await controller.result().refresh();
    assert.equal(world.http.filter((r) => r.url.endsWith("/leave")).length, 1);
    assert.equal(world.read().transition, null);
    assert.equal(controller.result().snapshot, null);
    assert.equal(world.read().snapshot.family.membershipId, "new-grant");
    assert.equal(controller.result().draft, null);
    assert.equal(controller.result().error, "membership_changed");
  } finally {
    controller.unmount();
  }
});

test("failed lifecycle intent persistence sends no membership mutation", async () => {
  const world = makeWorld();
  const controller = await boot(world);
  world.offline = false;
  world.beforeCommit = async () => {
    throw new Error("disk unavailable");
  };
  try {
    await assert.rejects(
      controller.result().closeFamily(),
      /local_save_failed/,
    );
    assert.equal(world.http.filter((r) => r.url.endsWith("/close")).length, 0);
    assert.equal(world.read().transition, null);
    assert.notEqual(world.read().draft, null);
  } finally {
    controller.unmount();
  }
});

test("membership refresh prevents an old admin's queued edit from being sent after downgrade", async () => {
  const world = makeWorld();
  const other = {
    ...world.data.state.draft,
    id: "other-feed",
    amount: 120,
    version: "v1",
    recordedBy: "other-user",
    lastEditedBy: "other-user",
  };
  world.data.state.snapshot.feeds = [other];
  world.disk.set(world.account, JSON.stringify(world.data.state));
  const controller = await boot(world);
  try {
    await controller.result().beginFeed(other);
    await controller.result().saveDraft();
    await until(() => !controller.result().syncing, "offline queue pause");
    world.server.feeds = [other];
    world.server.family.role = "caregiver";
    world.server.members[0].role = "caregiver";
    world.identity.families[0].role = "caregiver";
    world.offline = false;
    await controller.result().refresh();
    assert.equal(world.feedsSent.length, 0);
    assert.equal(controller.result().conflicts[0].error, "record_forbidden");
    await assert.rejects(
      controller.result().beginFeed(other),
      /record_forbidden/,
    );
    await assert.rejects(
      controller.result().deleteFeed(other.id),
      /record_forbidden/,
    );
    await assert.rejects(
      controller.result().createInvitation("b@example.test"),
      /owner_required/,
    );
  } finally {
    controller.unmount();
  }
});

test("deletion receipt is durable before network and a lost response reuses its secret", async () => {
  const world = makeWorld();
  world.ownerSetupDisk.set(world.account, "staged-personal-history");
  world.data.state.snapshot.family.role = "caregiver";
  world.cachedIdentity.families[0].role = "caregiver";
  world.identity.families[0].role = "caregiver";
  world.server.family.role = "caregiver";
  world.disk.set(world.account, JSON.stringify(world.data.state));
  const controller = await boot(world);
  world.offline = false;
  world.beforeReceiptSave = async () => {
    throw new Error("secure_store_unavailable");
  };
  try {
    await assert.rejects(
      controller.result().deleteAccount(),
      /secure_store_unavailable/,
    );
    assert.equal(
      world.ownerSetupDisk.has(world.account),
      false,
      "Explicit deletion intent durably discards setup before network",
    );
    assert.equal(
      world.http.filter((r) => r.url === "/v1/account/delete").length,
      0,
    );
    assert.equal(controller.result().transitionPending, true);
    world.beforeReceiptSave = async () => {};
    world.beforeMutation = async () => {
      throw new Error("network_unavailable");
    };
    await controller.result().refresh();
    const sent = world.http.find(
      (r) => r.url === "/v1/account/delete",
    ).operation;
    assert.match(sent.receiptSecret, /^[a-f0-9]{64}$/);
    assert.equal(world.deletionReceipt.receiptSecret, sent.receiptSecret);
    assert.equal(
      JSON.stringify(world.read()).includes(sent.receiptSecret),
      false,
    );
    world.beforeMutation = async () => {};
    await controller.result().refresh();
    const again = world.http.filter((r) => r.url === "/v1/account/delete")[1]
      .operation;
    assert.equal(again.operationId, sent.operationId);
    assert.equal(again.receiptSecret, sent.receiptSecret);
    assert.equal(world.read().snapshot, null);
    assert.equal(world.read().draft, null);
    assert.equal(world.read().transition, null);
    await controller.result().signOut();
    assert.notEqual(world.deletionReceipt, null);
    await controller.result().checkDeletionStatus();
    assert.equal(controller.result().deletionStatus.status, "completed");
    assert.equal(controller.result().user, null);
  } finally {
    controller.unmount();
  }
});

function nativeAuthWorld() {
  const secure = new Map();
  const world = {
    secure,
    exchanges: [],
    refreshes: [],
    beforeSet: async () => {},
    beforeDeleteKey: async () => {},
    token: (name) => ({
      accessToken: name,
      refreshToken: `refresh-${name}`,
      issuedAt: Math.floor(Date.now() / 1000),
      expiresIn: 3600,
    }),
  };
  let requestNumber = 0;
  const config = {
    apiUrl: "https://pilot.example.invalid",
    tenantId: "tenant-a",
    clientId: "client-a",
    authority: "https://identity.example.invalid",
    scope: "Family.ReadWrite",
  };
  const dependencies = {
    "expo-secure-store": {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
      getItemAsync: async (key) => secure.get(key) ?? null,
      setItemAsync: async (key, value) => {
        await world.beforeSet(key, value);
        secure.set(key, value);
      },
      deleteItemAsync: async (key) => {
        await world.beforeDeleteKey(key);
        secure.delete(key);
      },
    },
    "expo-auth-session": {
      ResponseType: { Code: "code" },
      Prompt: { Login: "login" },
      TokenError: class extends Error {},
      fetchDiscoveryAsync: async () => ({}),
      makeRedirectUri: () => "mylittledays://auth",
      AuthRequest: class {
        codeVerifier = "synthetic-pkce-verifier";
        constructor() {
          this.number = ++requestNumber;
        }
        async promptAsync() {
          return {
            type: "success",
            params: { code: `synthetic-code-${this.number}` },
          };
        }
      },
      exchangeCodeAsync: async () => {
        const response = deferred();
        world.exchanges.push(response);
        return response.promise;
      },
      refreshAsync: async () => {
        const response = deferred();
        world.refreshes.push(response);
        return response.promise;
      },
    },
    "./config": { familyConfig: config },
  };
  const filename = path.join(root, "src/family/auth.native.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  world.reloadAuth = () => {
    const module = { exports: {} };
    vm.runInNewContext(
      code,
      {
        module,
        exports: module.exports,
        require: (name) => {
          assert.ok(dependencies[name], `Unstubbed auth dependency ${name}`);
          return dependencies[name];
        },
        Date,
        Promise,
        Error,
        setTimeout,
        clearTimeout,
      },
      { filename },
    );
    world.auth = module.exports;
  };
  world.reloadAuth();
  world.expireToken = () => {
    const key = "my-little-days.family-pilot.tokens";
    const stored = JSON.parse(secure.get(key));
    secure.set(key, JSON.stringify({ ...stored, expiresAt: 0 }));
  };
  return world;
}

test("a stale native token exchange cannot delete a newer verified identity", async () => {
  const world = nativeAuthWorld();
  const older = world.auth.signIn();
  const olderResult = Promise.allSettled([older]);
  await until(() => world.exchanges.length === 1, "older token exchange");
  const newer = world.auth.signIn();
  await until(() => world.exchanges.length === 2, "newer token exchange");
  world.exchanges[1].resolve(world.token("newer-access-token"));
  await newer;
  const identity = {
    user: {
      id: "user-b",
      displayName: "Test B",
      email: "test-b@example.invalid",
    },
    families: [],
  };
  await world.auth.saveIdentity(identity);
  world.exchanges[0].resolve(world.token("older-access-token"));
  await olderResult;
  assert.equal((await world.auth.loadIdentity())?.user.id, "user-b");
  assert.equal(await world.auth.getAccessToken(), "newer-access-token");
});

test("a native token write from an old refresh cannot erase a subsequent login", async () => {
  const world = nativeAuthWorld();
  const firstSignIn = world.auth.signIn();
  await until(() => world.exchanges.length === 1, "first token exchange");
  world.exchanges[0].resolve(world.token("first-access-token"));
  await firstSignIn;
  world.expireToken();
  const gate = deferred();
  let oldWriteStarted = false;
  world.beforeSet = async (_key, value) => {
    if (value.includes("old-refreshed-access-token")) {
      oldWriteStarted = true;
      await gate.promise;
    }
  };
  const refreshing = world.auth.getAccessToken();
  const refreshedResult = Promise.allSettled([refreshing]);
  await until(() => world.refreshes.length === 1, "old refresh");
  world.refreshes[0].resolve(world.token("old-refreshed-access-token"));
  await until(() => oldWriteStarted, "old native token write");
  const signingOut = world.auth.signOut();
  const signingIn = world.auth.signIn();
  await until(() => world.exchanges.length === 2, "replacement token exchange");
  world.exchanges[1].resolve(world.token("replacement-access-token"));
  for (let index = 0; index < 5; index++) await tick();
  gate.resolve();
  await Promise.all([signingOut, signingIn, refreshedResult]);
  assert.equal(await world.auth.hasSession(), true);
  assert.equal(await world.auth.getAccessToken(), "replacement-access-token");
});

test("a replacement login does not wait for an older session’s refresh response", async () => {
  const world = nativeAuthWorld();
  const firstSignIn = world.auth.signIn();
  await until(() => world.exchanges.length === 1, "first token exchange");
  world.exchanges[0].resolve(world.token("first-access-token"));
  await firstSignIn;
  world.expireToken();
  const oldRefresh = world.auth.getAccessToken();
  const oldResult = Promise.allSettled([oldRefresh]);
  await until(
    () => world.refreshes.length === 1,
    "old session refresh request",
  );
  await world.auth.signOut();
  const replacement = world.auth.signIn();
  await until(() => world.exchanges.length === 2, "replacement token exchange");
  world.exchanges[1].resolve(world.token("replacement-access-token"));
  await replacement;
  let accessToken;
  const access = world.auth.getAccessToken().then((value) => {
    accessToken = value;
  });
  try {
    for (let index = 0; index < 5; index++) await tick();
    assert.equal(accessToken, "replacement-access-token");
  } finally {
    world.refreshes[0].resolve(world.token("obsolete-refreshed-token"));
    await Promise.allSettled([access, oldResult]);
  }
});

test("native logout marker survives module restart even when key deletion fails", async () => {
  const world = nativeAuthWorld();
  const signingIn = world.auth.signIn();
  await until(
    () => world.exchanges.length === 1,
    "login before interrupted logout",
  );
  world.exchanges[0].resolve(world.token("old-token"));
  await signingIn;
  await world.auth.saveIdentity({ user: { id: "user-a" }, families: [] });
  world.beforeDeleteKey = async () => {
    throw new Error("native_delete_failed");
  };
  await assert.rejects(world.auth.signOut(), /sign_out_failed/);
  assert.ok(world.secure.has("my-little-days.family-pilot.tokens"));
  assert.ok(world.secure.has("my-little-days.family-pilot.signed-out"));
  world.reloadAuth();
  assert.equal(await world.auth.hasSession(), false);
  assert.equal(await world.auth.loadIdentity(), null);
  await assert.rejects(world.auth.getAccessToken(), /sign_in_required/);
  world.beforeDeleteKey = async () => {};
  const next = world.auth.signIn();
  await until(() => world.exchanges.length === 2, "fresh explicit login");
  world.exchanges[1].resolve(world.token("fresh-token"));
  await next;
  assert.equal(await world.auth.getAccessToken(), "fresh-token");
  assert.equal(
    world.secure.has("my-little-days.family-pilot.signed-out"),
    false,
  );
});

test("logout discard survives restart and explicit login when final SQLite row cleanup fails", async () => {
  const world = makeWorld({ queued: true });
  world.ownerSetupDisk.set(world.account, "staged-personal-history");
  const controller = await boot(world);
  world.beforeDelete = async () => {
    throw new Error("disk_delete_failed");
  };
  await assert.rejects(controller.result().signOut(), /sign_out_failed/);
  assert.equal(world.read().snapshot, null);
  assert.equal(world.read().draft, null);
  assert.equal(world.read().queue.length, 0);
  assert.equal(world.ownerSetupDisk.has(world.account), false);
  assert.equal(world.session, false);
  controller.unmount();
  world.beforeDelete = async () => {};
  const reopened = world.mount();
  world.offline = false;
  try {
    await reopened.result().signIn();
    await reopened.result().refresh();
    assert.equal(world.feedsSent.length, 0);
    assert.equal(reopened.result().draft, null);
    assert.equal(world.read().queue.length, 0);
    assert.equal(world.ownerSetupDisk.has(world.account), false);
  } finally {
    reopened.unmount();
  }
});

test("logout reports a failed purge before changing credentials when the discard cannot persist", async () => {
  const world = makeWorld({ queued: true });
  world.ownerSetupDisk.set(world.account, "staged-personal-history");
  const controller = await boot(world);
  world.beforeCommit = async () => {
    throw new Error("disk_full");
  };
  try {
    await assert.rejects(controller.result().signOut(), /local_save_failed/);
    assert.equal(world.authSignOutCalls, 0);
    assert.equal(world.session, true);
    assert.equal(world.read().queue.length, 1);
    assert.equal(
      world.ownerSetupDisk.get(world.account),
      "staged-personal-history",
    );
    assert.equal(controller.result().notice, null);
  } finally {
    controller.unmount();
  }
});

test("a malformed successful deletion response preserves its durable receipt for retry", async () => {
  const world = makeWorld();
  world.cachedIdentity.families = [];
  world.identity.families = [];
  const controller = await boot(world);
  world.offline = false;
  world.corruptMutationResponse = true;
  try {
    await assert.rejects(
      controller.result().deleteAccount(),
      /invalid_response/,
    );
    const receipt = structuredClone(world.deletionReceipt);
    assert.equal(world.read().transition.phase, "pending");
    assert.equal(controller.result().transitionPending, true);
    world.corruptMutationResponse = false;
    await controller.result().refresh();
    assert.equal(world.deletionReceipt.receiptSecret, receipt.receiptSecret);
    assert.equal(world.read().transition, null);
    const calls = world.http.filter((r) => r.url === "/v1/account/delete");
    assert.equal(calls.length, 2);
    assert.equal(
      calls[0].operation.operationId,
      calls[1].operation.operationId,
    );
    assert.equal(controller.result().deletionStatus.status, "pending");
  } finally {
    controller.unmount();
  }
});

test("verified revocation stays hidden across a restart even if SQLite cleanup fails", async () => {
  const world = makeWorld({ queued: true });
  const controller = await boot(world);
  world.offline = false;
  world.identity.families = [];
  world.beforeCommit = async () => {
    throw new Error("disk_full");
  };
  await controller.result().refresh();
  assert.equal(controller.result().snapshot, null);
  assert.equal(controller.result().draft, null);
  assert.equal(world.cachedIdentity.families.length, 0);
  assert.equal(
    world.read().queue.length,
    1,
    "Synthetic disk failure retains old physical row",
  );
  controller.unmount();
  world.offline = true;
  const reopened = world.mount();
  try {
    await until(
      () => reopened.result().user?.id === "user-a",
      "cached identity after failed purge",
    );
    assert.equal(reopened.result().snapshot, null);
    assert.equal(reopened.result().draft, null);
    assert.equal(reopened.result().pending.length, 0);
    assert.equal(world.feedsSent.length, 0);
  } finally {
    reopened.unmount();
  }
});

test("explicit logout can discard an unresolved offline lifecycle intent without replay on login", async () => {
  const world = makeWorld({ queued: true });
  const controller = await boot(world);
  try {
    // No request reaches the server; the intent remains pending on disk.
    await assert.rejects(
      controller.result().closeFamily(),
      /network_unavailable/,
    );
    assert.equal(controller.result().transitionPending, true);
    const closeCalls = world.http.filter((r) =>
      r.url.endsWith("/close"),
    ).length;
    await controller.result().signOut();
    assert.equal(controller.result().user, null);
    assert.equal(controller.result().transitionPending, false);
    assert.equal(world.read(), null);
    world.offline = false;
    await controller.result().signIn();
    await controller.result().refresh();
    assert.equal(controller.result().snapshot.family.id, "family-a");
    assert.equal(
      world.http.filter((r) => r.url.endsWith("/close")).length,
      closeCalls,
    );
    assert.equal(world.feedsSent.length, 0);
    assert.equal(controller.result().draft, null);
  } finally {
    controller.unmount();
  }
});

const liveFeed = {
  id: "live-feed",
  type: "feed",
  feedKind: "formula",
  feedRunning: true,
  amount: 120,
  start: "2026-09-01T01:00:00.000Z",
  note: "Feed note",
};
test("pending feed can finish with actual amount while its start API response is delayed", async () => {
  const world = makeWorld({ offline: false });
  const receipt = deferred();
  world.beforeRecord = async (op) => {
    if (op.kind === "create") await receipt.promise;
  };
  const c = await boot(world);
  try {
    await c.result().saveRecord("entry", liveFeed);
    await until(() => world.recordsSent.length === 1, "pending feed start");
    assert.equal(c.result().canControlFeed(liveFeed.id), true);
    assert.equal(c.result().canEditRecord("entry", liveFeed.id), false);
    const original = structuredClone(world.recordsSent[0].operation);
    await c
      .result()
      .finishFeed(
        liveFeed.id,
        "2026-09-01T01:10:00.000Z",
        85,
        undefined,
        liveFeed,
      );
    assert.equal(c.result().sharedState.entries[0].amount, 85);
    assert.equal(c.result().sharedState.entries[0].feedRunning, undefined);
    assert.equal(c.result().canControlFeed(liveFeed.id), false);
    assert.deepEqual(world.read().records[0].operation, original);
    await assert.rejects(
      c.result().finishFeed(liveFeed.id, "2026-09-01T01:10:00.000Z", 90),
      /record_pending/,
    );
    receipt.resolve();
    await until(
      () => world.recordsSent.length === 2 && !c.result().syncing,
      "finished feed shared",
    );
    assert.equal(world.recordsSent[1].operation.kind, "update");
    assert.equal(world.recordsSent[1].operation.entry.amount, 85);
    assert.equal(world.recordsSent[1].operation.entry.feedRunning, undefined);
    assert.ok(world.recordsSent.every((sent) => sent.durablySaved));
    assert.equal(world.server.entries[0].entry.amount, 85);
  } finally {
    receipt.resolve();
    c.unmount();
  }
});
test("durable offline feed finish survives restart with original create and stable selected-amount update", async () => {
  const world = makeWorld();
  const first = await boot(world);
  await first.result().saveRecord("entry", liveFeed);
  await first
    .result()
    .finishFeed(
      liveFeed.id,
      "2026-09-01T01:10:00.000Z",
      123.5,
      undefined,
      liveFeed,
    );
  const original = structuredClone(world.read().records[0].operation);
  const finishId = world.read().records[0].feedFollowUp.operationId;
  first.unmount();
  world.offline = false;
  const next = world.mount();
  try {
    await until(
      () => world.recordsSent.length >= 1 && !next.result().syncing,
      "restored feed start",
    );
    assert.equal(next.result().sharedState.entries[0].amount, 123.5);
    await next.result().refresh();
    assert.deepEqual(world.recordsSent[0].operation, original);
    assert.equal(world.recordsSent[1].operation.operationId, finishId);
    assert.equal(world.recordsSent[1].operation.entry.amount, 123.5);
    assert.equal(world.read().records.length, 0);
  } finally {
    next.unmount();
  }
});
test("feed confirmation rejects changed original content after a pending start has been acknowledged", async () => {
  const world = makeWorld({ offline: false });
  const c = await boot(world);
  try {
    await c.result().saveRecord("entry", liveFeed);
    await until(
      () => world.recordsSent.length === 1 && !c.result().syncing,
      "saved feed start",
    );
    world.server.entries[0].entry = { ...liveFeed, note: "remote edit" };
    world.server.entries[0].version = "2";
    world.server.entries[0].lastEditedBy = "other-user";
    world.server.revision = "2";
    await c.result().refresh();
    await assert.rejects(
      c
        .result()
        .finishFeed(
          liveFeed.id,
          "2026-09-01T01:10:00.000Z",
          85,
          undefined,
          liveFeed,
        ),
      /record_changed/,
    );
    assert.equal(world.recordsSent.length, 1);
    assert.equal(c.result().sharedState.entries[0].note, "remote edit");
  } finally {
    c.unmount();
  }
});
test("feed confirmation disk failure keeps the running feed and does not store the changed amount", async () => {
  const world = makeWorld();
  const c = await boot(world);
  try {
    await c.result().saveRecord("entry", liveFeed);
    world.beforeCommit = async () => {
      throw new Error("disk_full");
    };
    await assert.rejects(
      c
        .result()
        .finishFeed(
          liveFeed.id,
          "2026-09-01T01:10:00.000Z",
          85,
          undefined,
          liveFeed,
        ),
      /local_save_failed/,
    );
    assert.equal(c.result().canControlFeed(liveFeed.id), true);
    assert.equal(c.result().sharedState.entries[0].amount, 120);
    assert.equal(world.read().records[0].feedFollowUp, undefined);
    assert.equal(world.recordsSent.length, 0);
  } finally {
    c.unmount();
  }
});
