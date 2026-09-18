import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  userId: id(1),
  familyId: id(2),
  membershipId: id(3),
  historyId: id(4),
};
const projectId = id(99);
const plain = (x) => JSON.parse(JSON.stringify(x));
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(setImmediate);
  }
  assert.fail("Expected asynchronous boundary was not reached");
}
function world() {
  return {
    storage: null,
    calls: [],
    replies: new Map(),
    counter: 100,
    drop: false,
    diskFail: false,
    allowed: true,
    capabilities: true,
    user: id(1),
    tokenWait: null,
    tokenAsked: false,
  };
}
function fixture(w = world()) {
  const modules = new Map();
  class ApiError extends Error {
    constructor(code, status) {
      super(code);
      this.code = code;
      this.status = status;
    }
  }
  const deps = {
    "expo-secure-store": {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
      getItemAsync: async () => w.storage,
      setItemAsync: async (_, value, options) => {
        assert.equal(options.keychainAccessible, "device-only");
        if (w.diskFail) throw new Error("disk_full");
        w.storage = value;
      },
    },
    "expo-notifications": {
      IosAuthorizationStatus: { PROVISIONAL: 3 },
      getPermissionsAsync: async () => ({ granted: w.allowed }),
      requestPermissionsAsync: async () => ({ granted: w.allowed }),
      getExpoPushTokenAsync: async () => {
        w.tokenAsked = true;
        if (w.tokenWait) await w.tokenWait.promise;
        return { data: "ExponentPushToken[synthetic]" };
      },
    },
    "expo-crypto": {
      randomUUID: () => id(++w.counter),
      getRandomBytesAsync: async (n) => new Uint8Array(n).fill(42),
    },
    "react-native": { Platform: { OS: "ios" } },
    "../../app.json": { expo: { extra: { eas: { projectId } } } },
    "./config": {
      familyConfig: { apiUrl: "https://test.invalid", tenantId: id(88) },
    },
    "./auth": { loadIdentity: async () => ({ user: { id: w.user } }) },
    "./api": {
      PilotApiError: ApiError,
      familyRequest: async (route, body, signal, method) => {
        if (signal?.aborted) throw new Error("cancelled");
        w.calls.push({ route, body: body ? plain(body) : undefined, method });
        if (route.endsWith("capabilities"))
          return {
            registrationEnabled: w.capabilities,
            eventCreationEnabled: w.capabilities,
            projectId: w.capabilities ? projectId : null,
            categories: ["feed", "diaper", "sleep"],
          };
        const install = route.split("/")[4];
        if (
          w.failure &&
          body.expectedGeneration > 0 &&
          (!w.failure.registerOnly || method === "PUT")
        )
          throw new ApiError(w.failure.code, w.failure.status);
        if (!w.replies.has(body.operationId)) {
          assert.ok(
            w.storage &&
              JSON.parse(w.storage).pending?.body.operationId ===
                body.operationId,
            "request persisted before send",
          );
          w.replies.set(body.operationId, {
            operationId: body.operationId,
            installationId: install,
            generation: body.expectedGeneration + 1,
            enabled: method === "PUT" && body.enabled,
            categories: method === "PUT" ? body.categories : [],
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          });
        }
        if (w.drop) {
          w.drop = false;
          throw new Error("network_unavailable");
        }
        return w.replies.get(body.operationId);
      },
    },
  };
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const exports = {};
    modules.set(name, exports);
    const source = fs.readFileSync(
      path.join(root, "src/family", `${name}.ts`),
      "utf8",
    );
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    vm.runInNewContext(code, {
      exports,
      require: (key) => {
        if (key in deps) return deps[key];
        if (key === "./familyPushCore" || key === "./familyPushPresentation")
          return load(key.slice(2));
        throw new Error(`Unexpected dependency: ${key}`);
      },
      console,
      Date,
      Promise,
      AbortController,
      setTimeout,
      clearTimeout,
      Uint8Array,
    });
    return exports;
  }
  const api = load("familyPush.native");
  api.setFamilyPushContext(scope);
  return { api, w, presentation: load("familyPushPresentation") };
}
test("native push is opt-in; storage load makes no remote request", async () => {
  const { api, w } = fixture();
  assert.equal((await api.loadFamilyPush()).enabled, false);
  assert.equal(w.calls.length, 0);
  assert.equal((await api.reconcileFamilyPush("en")).enabled, false);
  assert.equal(w.calls.length, 0);
});
test("lost acknowledgement and process restart replay one durable registration ID", async () => {
  const w = world();
  w.drop = true;
  let { api } = fixture(w);
  await assert.rejects(
    api.configureFamilyPush(true, ["feed", "diaper", "sleep"], "en"),
    /network_unavailable/,
  );
  const pendingId = JSON.parse(w.storage).pending.body.operationId;
  ({ api } = fixture(w));
  assert.equal(
    (await api.configureFamilyPush(true, ["feed", "diaper", "sleep"], "en"))
      .enabled,
    true,
  );
  const puts = w.calls.filter((c) => c.method === "PUT");
  assert.equal(puts.length, 2);
  assert.ok(puts.every((c) => c.body.operationId === pendingId));
  assert.equal(w.replies.size, 1);
});
test("opt-out resolves ambiguous enable then durably unregisters, never re-enables on replay", async () => {
  const { api, w } = fixture();
  w.drop = true;
  await assert.rejects(api.configureFamilyPush(true, ["sleep"], "en"));
  const result = await api.configureFamilyPush(false, ["sleep"], "en");
  assert.equal(result.enabled, false);
  const stored = JSON.parse(w.storage);
  assert.equal(stored.desiredEnabled, false);
  assert.equal(stored.enabled, false);
  assert.equal(stored.generation, 2);
  assert.equal(stored.pending, null);
});
test("denied permission, disabled service and failed storage never register a token", async () => {
  for (const failure of ["allowed", "capabilities", "diskFail"]) {
    const { api, w } = fixture();
    w[failure] = failure === "diskFail";
    await assert.rejects(api.configureFamilyPush(true, ["feed"], "en"));
    assert.equal(w.calls.filter((c) => c.method === "PUT").length, 0);
  }
});
test("context change cancels a stalled native token request and ignores its late result", async () => {
  const { api, w } = fixture();
  w.tokenWait = deferred();
  const running = api.configureFamilyPush(true, ["feed"], "en");
  await until(() => w.tokenAsked);
  api.setFamilyPushContext(null);
  await assert.rejects(running);
  await api.prepareFamilyPushLogout();
  w.tokenWait.resolve();
  await new Promise(setImmediate);
  assert.equal(w.calls.filter((c) => c.method === "PUT").length, 0);
  assert.equal(JSON.parse(w.storage).desiredEnabled, false);
});
test("an old pending registration is never replayed with a different account", async () => {
  const { api, w } = fixture();
  w.drop = true;
  await assert.rejects(api.configureFamilyPush(true, ["feed"], "en"));
  w.user = id(8);
  api.setFamilyPushContext({ ...scope, userId: id(8), familyId: id(9) });
  await assert.rejects(
    api.configureFamilyPush(true, ["feed"], "en"),
    /push_previous_account/,
  );
  assert.equal(w.calls.filter((c) => c.method === "PUT").length, 1);
  assert.equal(JSON.parse(w.storage).desiredEnabled, false);
});
test("expired and explicitly missing installation is renewed under a fresh binding", async () => {
  const w = world();
  let { api } = fixture(w);
  await api.configureFamilyPush(true, ["feed"], "en");
  const old = JSON.parse(w.storage);
  w.storage = JSON.stringify({
    ...old,
    expiresAt: new Date(Date.now() - 86400000).toISOString(),
  });
  w.failure = { code: "push_installation_unknown", status: 404 };
  ({ api } = fixture(w));
  assert.equal((await api.loadFamilyPush()).pending, true);
  // The first renewal discovers the missing binding. Its fresh durable binding
  // is used on retry; no automatic request can reuse an old generation.
  let result = await api.configureFamilyPush(true, ["feed"], "en");
  if (!result.enabled)
    result = await api.configureFamilyPush(true, ["feed"], "en");
  assert.equal(result.enabled, true);
  const next = JSON.parse(w.storage);
  assert.notEqual(next.installationId, old.installationId);
  assert.equal(next.generation, 1);
});
test("conflicts and generic missing routes do not reset the registration identity", async () => {
  for (const failure of [
    { code: "push_binding_changed", status: 409 },
    { code: "not_found", status: 404 },
  ]) {
    const w = world();
    let { api } = fixture(w);
    await api.configureFamilyPush(true, ["feed"], "en");
    const old = JSON.parse(w.storage);
    w.storage = JSON.stringify({
      ...old,
      expiresAt: new Date(0).toISOString(),
    });
    w.failure = failure;
    ({ api } = fixture(w));
    await assert.rejects(api.configureFamilyPush(true, ["feed"], "en"));
    assert.equal(JSON.parse(w.storage).installationId, old.installationId);
  }
});
test("canonical category order avoids unnecessary generation changes", async () => {
  const { api, w } = fixture();
  await api.configureFamilyPush(true, ["sleep", "feed"], "en");
  await api.configureFamilyPush(true, ["feed", "sleep"], "en");
  assert.equal(w.calls.filter((c) => c.method === "PUT").length, 1);
});
test("definitive rejected registration does not prevent revoking the established binding", async () => {
  for (const code of [
    "membership_changed",
    "membership_revoked",
    "history_changed",
  ]) {
    const { api, w } = fixture();
    await api.configureFamilyPush(true, ["feed"], "en");
    w.failure = {
      code,
      status: code === "membership_revoked" ? 403 : 409,
      registerOnly: true,
    };
    await assert.rejects(api.configureFamilyPush(true, ["sleep"], "en"));
    assert.equal(JSON.parse(w.storage).pending.kind, "register");
    const result = await api.configureFamilyPush(false, ["sleep"], "en");
    assert.equal(result.enabled, false);
    assert.equal(result.pending, false);
    assert.equal(JSON.parse(w.storage).generation, 2);
  }
});
test("foreground reconciliation revokes an old known binding after an offline account switch", async () => {
  const { api, w } = fixture();
  await api.configureFamilyPush(true, ["feed"], "en");
  w.user = id(8);
  api.setFamilyPushContext({ ...scope, userId: id(8), membershipId: id(9) });
  const result = await api.reconcileFamilyPush("en");
  assert.equal(result.desiredEnabled, false);
  assert.equal(JSON.parse(w.storage).enabled, false);
  assert.equal(w.calls.filter((c) => c.method === "PUT").length, 1);
  assert.equal(w.calls.filter((c) => c.route.endsWith("unregister")).length, 1);
});
