import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokenKey = "my-little-days.family-pilot.tokens";
const identityKey = "my-little-days.family-pilot.identity";
const guardKey = "my-little-days.family-pilot.cache-guard";
const logoutKey = "my-little-days.family-pilot.signed-out";
const origin = {
  userId: "user-a",
  familyId: "family-a",
  membershipId: "grant-a",
  historyId: "history-a",
};
const identity = (userId = "user-a") => ({
  user: { id: userId, displayName: "Synthetic account" },
  families: [],
  pendingInvitations: [],
  accountDeletion: null,
});
const plain = (value) => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
async function until(predicate) {
  for (let index = 0; index < 150; index++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Expected native boundary was not reached");
}
function nativeWorld() {
  const world = {
    secure: new Map(),
    exchanges: [],
    refreshes: [],
    discoveries: 0,
    beforeSet: async () => {},
    beforeGet: async () => {},
    afterGet: async () => {},
    beforeDelete: async () => {},
    prompt: { type: "success", params: { code: "synthetic-code" } },
    config: {
      apiUrl: "https://pilot.example.invalid",
      tenantId: "tenant-a",
      clientId: "client-a",
      authority: "https://identity.example.invalid",
      scope: "Family.ReadWrite",
    },
    token: (name) => ({
      accessToken: name,
      refreshToken: `refresh-${name}`,
      issuedAt: Math.floor(Date.now() / 1000),
      expiresIn: 3600,
    }),
  };
  const dependencies = {
    "expo-secure-store": {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
      getItemAsync: async (key) => {
        await world.beforeGet(key);
        const value = world.secure.get(key) ?? null;
        await world.afterGet(key, value);
        return value;
      },
      setItemAsync: async (key, value) => {
        await world.beforeSet(key, value);
        world.secure.set(key, value);
      },
      deleteItemAsync: async (key) => {
        await world.beforeDelete(key);
        world.secure.delete(key);
      },
    },
    "expo-auth-session": {
      ResponseType: { Code: "code" },
      Prompt: { Login: "login" },
      TokenError: class extends Error {},
      fetchDiscoveryAsync: async () => {
        world.discoveries++;
        return {};
      },
      makeRedirectUri: () => "mylittledays://auth",
      AuthRequest: class {
        codeVerifier = "synthetic-verifier";
        async promptAsync() {
          return world.prompt;
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
    "./config": { familyConfig: world.config },
  };
  const filename = path.join(root, "src/family/auth.native.ts");
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  world.reload = () => {
    const module = { exports: {} };
    vm.runInNewContext(
      code,
      {
        module,
        exports: module.exports,
        Date,
        Promise,
        Error,
        require: (name) => {
          assert.ok(dependencies[name], `Unstubbed dependency ${name}`);
          return dependencies[name];
        },
      },
      { filename },
    );
    world.auth = module.exports;
  };
  world.login = async (name = "account-a") => {
    const count = world.exchanges.length;
    const signingIn = world.auth.signIn();
    await until(() => world.exchanges.length > count);
    world.exchanges[count].resolve(world.token(name));
    await signingIn;
  };
  world.expire = () => {
    const stored = JSON.parse(world.secure.get(tokenKey));
    world.secure.set(tokenKey, JSON.stringify({ ...stored, expiresAt: 0 }));
  };
  world.reload();
  return world;
}

test("cache guard is local, legacy-compatible, and independently durable", async () => {
  const world = nativeWorld();
  assert.equal(await world.auth.loadCacheGuard("user-a"), null);
  assert.equal(world.discoveries, 0);
  await world.login();
  await world.auth.saveIdentity(identity());
  await world.auth.saveCacheOrigin(origin);
  world.reload();
  assert.deepEqual(plain(await world.auth.loadCacheGuard("user-a")), {
    userId: "user-a",
    reauthRequired: false,
    origin,
  });
  assert.equal(world.discoveries, 1);
  await assert.rejects(
    world.auth.loadCacheGuard("user-b"),
    /local_data_invalid/,
  );
  const replacement = { ...origin, historyId: "history-b" };
  await world.auth.saveCacheOrigin(replacement);
  world.reload();
  assert.deepEqual(
    plain((await world.auth.loadCacheGuard("user-a")).origin),
    replacement,
  );
});

test("known reauthentication survives restart without erasing recovery identity", async () => {
  const world = nativeWorld();
  await world.login();
  await world.auth.saveIdentity(identity());
  await world.auth.saveCacheOrigin(origin);
  await world.auth.markReauthenticationRequired("user-a");
  world.reload();
  assert.equal(await world.auth.hasSession(), true);
  assert.equal((await world.auth.loadIdentity()).user.id, "user-a");
  await assert.rejects(world.auth.getAccessToken(), /sign_in_required/);
  assert.equal(world.refreshes.length, 0);
  assert.equal(world.discoveries, 1);
  assert.deepEqual(plain(await world.auth.loadCacheGuard("user-a")), {
    userId: "user-a",
    reauthRequired: true,
    origin,
  });
  await assert.rejects(
    world.auth.saveCacheOrigin({ ...origin, historyId: "history-b" }),
    /sign_in_required/,
  );
  await world.auth.saveIdentity(identity());
  assert.equal(
    (await world.auth.loadCacheGuard("user-a")).reauthRequired,
    true,
  );
});

test("malformed or differently bound cache guards fail closed", async () => {
  const world = nativeWorld();
  await world.login();
  await world.auth.saveCacheOrigin(origin);
  const valid = JSON.parse(world.secure.get(guardKey));
  for (const invalid of [
    "{",
    "null",
    "[]",
    JSON.stringify({ ...valid, schema: 42 }),
    JSON.stringify({ ...valid, binding: "different-config" }),
    JSON.stringify({ ...valid, reauthRequired: "false" }),
    JSON.stringify({
      ...valid,
      origin: { ...origin, userId: "other-account" },
    }),
    JSON.stringify({ ...valid, origin: { ...origin, historyId: "" } }),
  ]) {
    world.secure.set(guardKey, invalid);
    world.reload();
    await assert.rejects(
      world.auth.loadCacheGuard("user-a"),
      /local_data_invalid/,
    );
    await assert.rejects(world.auth.getAccessToken(), /local_data_invalid/);
  }
  assert.equal(world.discoveries, 1);
});

test("reauthentication invalidates an outstanding refresh response", async () => {
  const world = nativeWorld();
  await world.login();
  await world.auth.saveIdentity(identity());
  world.expire();
  const refreshing = world.auth.getAccessToken();
  const result = assert.rejects(refreshing, /sign_in_required|session_changed/);
  await until(() => world.refreshes.length === 1);
  await world.auth.markReauthenticationRequired("user-a");
  world.refreshes[0].resolve(world.token("obsolete-refresh"));
  await result;
  assert.equal(await world.auth.hasSession(), true);
  assert.equal((await world.auth.loadIdentity()).user.id, "user-a");
  await assert.rejects(world.auth.getAccessToken(), /sign_in_required/);
  assert.equal(JSON.parse(world.secure.get(tokenKey)).accessToken, "account-a");
});

test("reauthentication during a token write retains identity but never returns its token", async () => {
  const world = nativeWorld();
  await world.login();
  await world.auth.saveIdentity(identity());
  world.expire();
  const gate = deferred();
  let writing = false;
  world.beforeSet = async (key, value) => {
    if (key === tokenKey && value.includes("late-refresh")) {
      writing = true;
      await gate.promise;
    }
  };
  const result = assert.rejects(
    world.auth.getAccessToken(),
    /sign_in_required|session_changed/,
  );
  await until(() => world.refreshes.length === 1);
  world.refreshes[0].resolve(world.token("late-refresh"));
  await until(() => writing);
  const marking = world.auth.markReauthenticationRequired("user-a");
  gate.resolve();
  await Promise.all([marking, result]);
  world.reload();
  assert.equal(await world.auth.hasSession(), true);
  assert.equal((await world.auth.loadIdentity()).user.id, "user-a");
  await assert.rejects(world.auth.getAccessToken(), /sign_in_required/);
});

test("reauthentication preserves a same-account identity write already in flight", async () => {
  const world = nativeWorld();
  await world.login();
  await world.auth.saveIdentity(identity());
  const gate = deferred();
  let writing = false;
  world.beforeSet = async (key) => {
    if (key === identityKey) {
      writing = true;
      await gate.promise;
    }
  };
  const result = assert.rejects(
    world.auth.saveIdentity(identity()),
    /session_changed/,
  );
  await until(() => writing);
  const marking = world.auth.markReauthenticationRequired("user-a");
  gate.resolve();
  await Promise.all([result, marking]);
  world.reload();
  assert.equal((await world.auth.loadIdentity()).user.id, "user-a");
  assert.equal(
    (await world.auth.loadCacheGuard("user-a")).reauthRequired,
    true,
  );
});

test("only a successful explicit sign-in resets the guard and cached identity", async () => {
  const world = nativeWorld();
  await world.login();
  await world.auth.saveIdentity(identity());
  await world.auth.markReauthenticationRequired("user-a");
  world.prompt = { type: "cancel" };
  await assert.rejects(world.auth.signIn(), /sign_in_cancelled/);
  assert.equal(
    (await world.auth.loadCacheGuard("user-a")).reauthRequired,
    true,
  );
  assert.equal((await world.auth.loadIdentity()).user.id, "user-a");
  world.prompt = { type: "success", params: { code: "synthetic-code" } };
  await world.login("account-b");
  assert.equal(await world.auth.loadIdentity(), null);
  assert.equal(await world.auth.loadCacheGuard("user-b"), null);
  await world.auth.saveIdentity(identity("user-b"));
  await world.auth.saveCacheOrigin({ ...origin, userId: "user-b" });
  assert.equal(await world.auth.getAccessToken(), "account-b");
});

test("logout remains primary even with a malformed guard and failed credential erase", async () => {
  const world = nativeWorld();
  await world.login();
  await world.auth.saveIdentity(identity());
  world.secure.set(guardKey, "malformed");
  world.beforeDelete = async () => {
    throw new Error("native_delete_failed");
  };
  await assert.rejects(world.auth.signOut(), /sign_out_failed/);
  assert.ok(world.secure.has(logoutKey));
  world.reload();
  assert.equal(await world.auth.hasSession(), false);
  assert.equal(await world.auth.loadIdentity(), null);
  await assert.rejects(world.auth.getAccessToken(), /sign_in_required/);
});

test("failed origin persistence never claims success or replaces the trusted origin", async () => {
  const world = nativeWorld();
  await world.login();
  await world.auth.saveCacheOrigin(origin);
  world.beforeSet = async (key) => {
    if (key === guardKey) throw new Error("secure_write_failed");
  };
  await assert.rejects(
    world.auth.saveCacheOrigin({ ...origin, historyId: "new-history" }),
    /secure_write_failed/,
  );
  world.reload();
  assert.deepEqual(
    plain((await world.auth.loadCacheGuard("user-a")).origin),
    origin,
  );
  assert.equal(
    await world.auth.hasSession(),
    false,
    "A failed new-origin write must not revive the previous history after restart",
  );
  await assert.rejects(world.auth.getAccessToken(), /sign_in_required/);
});

test("a stale origin write cannot attach the old history to a replacement login", async () => {
  const world = nativeWorld();
  await world.login();
  const gate = deferred();
  let writing = false;
  world.beforeSet = async (key) => {
    if (key === guardKey) {
      writing = true;
      await gate.promise;
    }
  };
  const stale = assert.rejects(
    world.auth.saveCacheOrigin(origin),
    /session_changed/,
  );
  await until(() => writing);
  const signingIn = world.login("account-b");
  await until(() => world.exchanges.length === 2);
  gate.resolve();
  await Promise.all([stale, signingIn]);
  assert.equal(await world.auth.loadCacheGuard("user-b"), null);
  assert.equal(await world.auth.getAccessToken(), "account-b");
});

test("a delayed old guard read cannot re-block a successful replacement login", async () => {
  const world = nativeWorld();
  await world.login();
  await world.auth.markReauthenticationRequired("user-a");
  world.reload();
  const gate = deferred();
  let reading = false;
  world.afterGet = async (key, value) => {
    if (key === guardKey && value && !reading) {
      reading = true;
      await gate.promise;
    }
  };
  const oldAccess = assert.rejects(
    world.auth.getAccessToken(),
    /sign_in_required|session_changed/,
  );
  await until(() => reading);
  const signingIn = world.login("account-b");
  await until(() => world.exchanges.length === 2);
  for (let index = 0; index < 30; index++)
    await new Promise((resolve) => setImmediate(resolve));
  gate.resolve();
  await Promise.all([oldAccess, signingIn]);
  assert.equal(await world.auth.getAccessToken(), "account-b");
  assert.equal(await world.auth.loadCacheGuard("user-b"), null);
});

test("failed reauth guard write falls back to a durable logout barrier", async () => {
  const world = nativeWorld();
  await world.login();
  await world.auth.saveIdentity(identity());
  world.beforeSet = async (key) => {
    if (key === guardKey) throw new Error("guard_write_failed");
  };
  await assert.rejects(
    world.auth.markReauthenticationRequired("user-a"),
    /guard_write_failed/,
  );
  assert.ok(
    world.secure.has(identityKey),
    "Recovery identity is not erased by the marker fallback",
  );
  world.reload();
  assert.equal(await world.auth.hasSession(), false);
  await assert.rejects(world.auth.getAccessToken(), /sign_in_required/);
});

test("failed reauth and logout marker writes fall back to invalidating credentials", async () => {
  const world = nativeWorld();
  await world.login();
  await world.auth.saveIdentity(identity());
  world.beforeSet = async () => {
    throw new Error("secure_write_failed");
  };
  await assert.rejects(
    world.auth.markReauthenticationRequired("user-a"),
    /secure_write_failed/,
  );
  assert.equal(world.secure.has(tokenKey), false);
  assert.ok(world.secure.has(identityKey));
  world.reload();
  assert.equal(await world.auth.hasSession(), false);
  await assert.rejects(world.auth.getAccessToken(), /sign_in_required/);
});

test("a failed restrictive identity write cannot revive old membership on restart", async () => {
  const world = nativeWorld();
  await world.login();
  const owner = {
    ...identity(),
    families: [{ id: "family-a", membershipId: "grant-a", role: "owner" }],
  };
  await world.auth.saveIdentity(owner);
  await world.auth.saveCacheOrigin(origin);
  world.beforeSet = async (key) => {
    if (key === identityKey) throw new Error("identity_write_failed");
  };
  await assert.rejects(
    world.auth.saveIdentity(identity()),
    /identity_write_failed/,
  );
  assert.deepEqual(
    JSON.parse(world.secure.get(identityKey)).identity,
    owner,
    "Recovery identity is retained even when the new membership cannot be stored",
  );
  world.reload();
  assert.equal(await world.auth.hasSession(), false);
  assert.equal(await world.auth.loadIdentity(), null);
  await assert.rejects(world.auth.getAccessToken(), /sign_in_required/);
});

test("an obsolete failed identity write cannot invalidate a queued replacement login", async () => {
  const world = nativeWorld();
  await world.login();
  await world.auth.saveIdentity(identity());
  const gate = deferred();
  let writing = false;
  world.beforeSet = async (key) => {
    if (key === identityKey) {
      writing = true;
      await gate.promise;
      throw new Error("identity_write_failed");
    }
  };
  const stale = assert.rejects(
    world.auth.saveIdentity(identity()),
    /identity_write_failed/,
  );
  await until(() => writing);
  const signingIn = world.login("account-b");
  await until(() => world.exchanges.length === 2);
  gate.resolve();
  await Promise.all([stale, signingIn]);
  assert.equal(await world.auth.hasSession(), true);
  assert.equal(await world.auth.loadIdentity(), null);
  assert.equal(await world.auth.getAccessToken(), "account-b");
  assert.equal(await world.auth.loadCacheGuard("user-b"), null);
});
