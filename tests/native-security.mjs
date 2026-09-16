import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createRequire } from "node:module";

const source = fs.readFileSync("src/family/storageProtection.ts", "utf8");
function protection(os, nativeModule) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (name) => {
        if (name === "react-native") return { Platform: { OS: os } };
        if (name === "expo")
          return {
            requireNativeModule: (key) => {
              assert.equal(key, "FamilyStorageSecurity");
              if (!nativeModule)
                throw new Error("native_protection_unavailable");
              return nativeModule;
            },
          };
        throw new Error(name);
      },
    },
  );
  return module.exports.protectFamilyStorage;
}

test("iOS database backup protection is awaited and fails closed without the new native bridge", async () => {
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  let done = false;
  const promise = protection("ios", { protect: () => wait })().then(() => {
    done = true;
  });
  await Promise.resolve();
  assert.equal(done, false);
  release();
  await promise;
  assert.equal(done, true);
  await assert.rejects(protection("ios")(), /native_protection_unavailable/);
  await assert.rejects(
    protection("ios", {
      protect: async () => {
        throw new Error("attribute_failure");
      },
    })(),
    /attribute_failure/,
  );
  await protection("android")();
});

test("native backup exclusion protects existing SQLite files and future sidecars without migration or purgeable storage", () => {
  const swift = fs.readFileSync(
    "modules/family-storage-security/ios/FamilyStorageSecurityModule.swift",
    "utf8",
  );
  assert.match(swift, /\.documentDirectory/);
  assert.match(swift, /appendingPathComponent\("SQLite", isDirectory: true\)/);
  assert.match(swift, /values\.isExcludedFromBackup = true/);
  assert.match(
    swift,
    /resourceValues\(forKeys: \[\.isExcludedFromBackupKey\]\)/,
  );
  assert.doesNotMatch(swift, /\.cachesDirectory|moveItem|removeItem/);
  assert.match(
    swift,
    /FamilyStorageSecuritySubscriber: ExpoAppDelegateSubscriber/,
  );
  const storage = fs.readFileSync("src/family/pilotStorage.native.ts", "utf8");
  assert.ok(
    storage.indexOf("await protectFamilyStorage()") <
      storage.indexOf("await SQLite.openDatabaseAsync"),
  );
  const config = JSON.parse(fs.readFileSync("app.json"));
  assert.notEqual(
    config.expo.version,
    "0.2.0",
    "new native requirements must not target existing 0.2.0 OTA runtime",
  );
});

test("patched xcode UUID dependency retains its CommonJS v4 PBX identifier contract", () => {
  const require = createRequire(import.meta.url);
  const fromXcode = createRequire(require.resolve("xcode"));
  assert.equal(fromXcode("uuid/package.json").version, "11.1.1");
  const xcode = require("xcode");
  const project = xcode.project("synthetic.xcodeproj/project.pbxproj");
  project.hash = { project: { objects: {} } };
  const id = project.generateUuid();
  assert.match(id, /^[0-9A-F]{24}$/);
  const uuid = fromXcode("uuid");
  assert.throws(() => uuid.v5("x", uuid.v5.DNS, new Uint8Array(8), 4));
});

test("native candidate cannot accept unsigned OTA updates", () => {
  const { expo } = JSON.parse(fs.readFileSync("app.json"));
  assert.equal(
    expo.updates.enabled,
    false,
    "Until signed OTA is configured, distribute reviewed native builds only",
  );
  const ignore = fs.readFileSync(".easignore", "utf8");
  assert.match(ignore, /private-key/);
  assert.match(ignore, /work\//);
});
