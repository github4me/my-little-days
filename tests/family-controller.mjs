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
    beforeDelete: async () => {},
    beforeAuthSignOut: async () => {},
    beforeAuthSignIn: async () => {},
    beforeMutation: async () => {},
    mutationReceipts: new Map(),
    deletionReceipt: null,
    beforeReceiptSave: async () => {},
    personalClears: 0,
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
  const contexts = new Map();
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
        addEventListener: () => ({ remove() {} }),
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
    config: {
      familyConfig: {
        apiUrl: "https://pilot.example.invalid",
        tenantId: "tenant-a",
      },
    },
    auth: {
      hasSession: async () => world.session,
      loadIdentity: async () => structuredClone(world.cachedIdentity),
      saveIdentity: async (identity) => {
        world.cachedIdentity = structuredClone(identity);
      },
      signIn: async () => {
        world.authSignInCalls++;
        await world.beforeAuthSignIn();
        world.session = true;
        world.cachedIdentity = null;
      },
      signOut: async () => {
        world.authSignOutCalls++;
        await world.beforeAuthSignOut();
        world.session = false;
        world.cachedIdentity = null;
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
      familyRequest: async (url, operation) => {
        world.http.push({ url, operation });
        if (world.offline) throw new PilotApiError("network_unavailable");
        if (url === "/v1/me") {
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
              maxSeedBytes: 10485760,
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
              operation.collection === "entry" ? "entries" : "careRecords",
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
              [field]: operation.entry ?? operation.careRecord,
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
          if (world.snapshotOffline)
            throw new PilotApiError("network_unavailable");
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
        setTimeout,
        clearTimeout,
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
        setInterval: () => 1,
        clearInterval() {},
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
    const cleanups = effects.map((effect) => effect());
    return {
      result,
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
function ownerSeed(world) {
  return {
    schemaVersion: 1,
    source: structuredClone(world.personalSource),
    inviteeEmails: ["family@example.test"],
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
test("activation refuses an unrelated snapshot or corrupt seed receipt without clearing personal data", async () => {
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
    await assert.rejects(
      c.result().createFamilyFromSeed(ownerSeed(world)),
      /invalid_response|membership_changed/,
    );
    assert.equal(world.personalClears, 0);
    assert.equal(c.result().sharedState, null);
    assert.notEqual(world.read().transition, null);
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
