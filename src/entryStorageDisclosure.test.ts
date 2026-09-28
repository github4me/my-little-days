import assert from "node:assert/strict";
import test from "node:test";
import { entryStorageDisclosure } from "./entryStorageDisclosure";

test("personal records stay local without an account", () => {
  assert.equal(
    entryStorageDisclosure({ sharedMode: false, hasAccount: false }),
    "仅保存在这台设备 · 无需联网",
  );
});

test("sign-in alone does not describe personal records as uploaded or shared", () => {
  assert.equal(
    entryStorageDisclosure({ sharedMode: false, hasAccount: true }),
    "本机记录 · 登录不会自动上传",
  );
});

test("shared records require sync confirmation rather than claiming local-only or synced", () => {
  assert.equal(
    entryStorageDisclosure({ sharedMode: true, hasAccount: true }),
    "家庭共享记录 · 保存后等待同步确认",
  );
});

test("cached shared workspace remains shared during temporary account verification", () => {
  assert.equal(
    entryStorageDisclosure({ sharedMode: true, hasAccount: false }),
    entryStorageDisclosure({ sharedMode: true, hasAccount: true }),
  );
});
