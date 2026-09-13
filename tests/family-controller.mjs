import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

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
  };
  const family = {
    id: "family-a",
    babyName: "Fictional baby",
    role: "owner",
    membershipId: "grant-a",
  };
  const end = new Date(Date.now() - 60_000).toISOString();
  const start = new Date(Date.now() - 1_260_000).toISOString();
  return {
    identity: { user: member, families: [family] },
    state: {
      schema: 1,
      snapshot: {
        family,
        historyId: "history-a",
        revision: "0",
        members: [member],
        invitations: [],
        feeds: [],
      },
      draft: {
        recordId: "draft-a",
        start,
        end,
        amount: "120",
        note: "",
        membershipId: "grant-a",
        historyId: "history-a",
      },
      queue: [],
      acknowledgedRevision: null,
    },
  };
}

function makeWorld({ offline = true, queued = false } = {}) {
  const data = fixture();
  if (queued)
    data.state.queue.push({
      status: "pending",
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
  };
  const contexts = new Map();
  let activeReact;
  let operationSequence = 0;
  class PilotApiError extends Error {
    constructor(code, status = 0) {
      super(code);
      this.code = code;
      this.status = status;
    }
  }
  const database = {
    execAsync: async () => {},
    getFirstAsync: async (_query, key) => {
      world.readCalls++;
      const payload = world.disk.get(key);
      return payload === undefined ? null : { payload };
    },
    withExclusiveTransactionAsync: async (callback) => {
      const transaction = { number: world.transactions.length + 1, writes: [] };
      world.transactions.push(transaction);
      await callback({
        runAsync: async (_query, key, payload) => {
          transaction.writes.push([key, payload]);
        },
      });
      await world.beforeCommit(transaction);
      for (const [key, payload] of transaction.writes)
        world.disk.set(key, payload);
    },
    runAsync: async (query, key) => {
      assert.match(query, /^DELETE /);
      world.deleteCalls++;
      await world.beforeDelete();
      world.disk.delete(key);
    },
  };
  const overrides = {
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
    "expo-crypto": { randomUUID: () => `operation-${++operationSequence}` },
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
    api: {
      PilotApiError,
      familyRequest: async (url, operation) => {
        world.http.push({ url, operation });
        if (world.offline) throw new PilotApiError("network_unavailable");
        if (url === "/v1/me") return structuredClone(world.identity);
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
        if (["auth", "api", "config"].includes(basename))
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

function nativeAuthWorld() {
  const secure = new Map();
  const world = {
    secure,
    exchanges: [],
    refreshes: [],
    beforeSet: async () => {},
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
  const module = { exports: {} };
  const filename = path.join(root, "src/family/auth.native.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
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
