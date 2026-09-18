import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptPushReply,
  allowsFamilyEntryPush,
  allowsFamilyEntryPushOpen,
  isFamilyEntryPush,
  readPushRegistration,
  validCategories,
  type PushRegistration,
} from "./family/familyPushCore";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const state = (): PushRegistration => ({
  schema: 1,
  binding: "test",
  scope: {
    userId: id(1),
    familyId: id(2),
    membershipId: id(3),
    historyId: id(4),
  },
  installationId: id(5),
  secret: "a".repeat(64),
  generation: 1,
  enabled: true,
  desiredEnabled: true,
  categories: ["feed", "diaper", "sleep"],
  desiredCategories: ["feed", "diaper", "sleep"],
  expiresAt: new Date(100000).toISOString(),
  token: "ExponentPushToken[synthetic]",
  pending: null,
});
const data = () => ({
  kind: "family-entry",
  eventId: id(6),
  familyId: id(2),
  membershipId: id(3),
  historyId: id(4),
  installationId: id(5),
  generation: 1,
});
test("notification taps survive preference renewal but never cross account or membership", () => {
  const s = {
    ...state(),
    generation: 2,
    enabled: false,
    desiredEnabled: false,
  };
  assert.equal(allowsFamilyEntryPushOpen(data(), s.scope, s), true);
  assert.equal(
    allowsFamilyEntryPushOpen({ ...data(), generation: 3 }, s.scope, s),
    false,
  );
  assert.equal(
    allowsFamilyEntryPushOpen(data(), { ...s.scope, userId: id(99) }, s),
    false,
  );
  assert.equal(
    allowsFamilyEntryPushOpen({ ...data(), membershipId: id(99) }, s.scope, s),
    false,
  );
  assert.equal(
    allowsFamilyEntryPushOpen(
      { ...data(), installationId: id(99) },
      s.scope,
      s,
    ),
    false,
  );
});
test("push storage and categories fail closed for unsupported scope, corruption and malformed secrets", () => {
  const s = state();
  assert.deepEqual(readPushRegistration(JSON.stringify(s), "test"), s);
  for (const patch of [
    { secret: "short" },
    { generation: -1 },
    { categories: ["growth"] },
    { scope: null },
    { pending: { kind: "unknown", body: {} } },
  ])
    assert.throws(
      () => readPushRegistration(JSON.stringify({ ...s, ...patch }), "test"),
      /push_storage_invalid/,
    );
  assert.throws(() => readPushRegistration(JSON.stringify(s), "other-api"));
  assert.equal(validCategories(["feed", "feed"]), false);
  assert.equal(validCategories(["care"]), false);
});
test("foreground pushes require current authorized grant, binding, generation and unexpired opt-in", () => {
  const s = state();
  assert.equal(allowsFamilyEntryPush(data(), s.scope, s, 1), true);
  for (const patch of [
    { familyId: id(8) },
    { membershipId: id(9) },
    { historyId: id(10) },
    { installationId: id(11) },
    { generation: 2 },
  ])
    assert.equal(
      allowsFamilyEntryPush({ ...data(), ...patch }, s.scope, s, 1),
      false,
    );
  assert.equal(allowsFamilyEntryPush(data(), null, s, 1), false);
  assert.equal(
    allowsFamilyEntryPush(data(), { ...s.scope, userId: id(8) }, s, 1),
    false,
  );
  assert.equal(
    allowsFamilyEntryPush(data(), s.scope, { ...s, desiredEnabled: false }, 1),
    false,
  );
  assert.equal(allowsFamilyEntryPush(data(), s.scope, s, 100000), false);
  assert.equal(
    isFamilyEntryPush({
      kind: "family-entry",
      url: "https://untrusted.invalid",
    }),
    false,
  );
});
test("registration acknowledgement must match exact pending operation and next generation", () => {
  const s = state();
  s.pending = {
    kind: "register",
    body: {
      operationId: id(7),
      installationSecret: s.secret,
      expectedGeneration: 1,
      enabled: true,
      categories: ["feed"],
      expoPushToken: "new-token",
    },
  };
  const reply = {
    operationId: id(7),
    installationId: id(5),
    generation: 2,
    enabled: true,
    categories: ["feed"],
    expiresAt: new Date(200000).toISOString(),
  };
  const next = acceptPushReply(s, reply);
  assert.equal(next.pending, null);
  assert.equal(next.token, "new-token");
  assert.equal(next.generation, 2);
  for (const patch of [
    { operationId: id(8) },
    { installationId: id(8) },
    { generation: 4 },
    { categories: ["growth"] },
    { enabled: "false" },
    { expiresAt: "invalid" },
  ])
    assert.throws(
      () => acceptPushReply(s, { ...reply, ...patch }),
      /push_response_invalid/,
    );
  assert.equal(allowsFamilyEntryPush(data(), s.scope, s, 1), false);
  // Revocation after a committed request supersedes enablement, never restores it.
  const revoked = acceptPushReply(s, { ...reply, enabled: false });
  assert.equal(revoked.pending, null);
  assert.equal(revoked.enabled, false);
  assert.equal(revoked.token, null);
});
