import test from "node:test";
import assert from "node:assert/strict";
import { initialState } from "./domain";
import { prepareOwnerSeed } from "./family/ownerSeed";
import {
  parseStoredOwnerSetup,
  serializeOwnerSetupDraft,
} from "./family/ownerSetupDraft";

const owner = "owner@example.test";
const recipient = "family@example.test";
const draft = () => prepareOwnerSeed(initialState, recipient, owner);

test("owner setup draft canonical round trip preserves detached reviewed data", () => {
  const source = draft();
  const restored = parseStoredOwnerSetup(
    serializeOwnerSetupDraft(source),
    owner,
  );
  assert.deepEqual(restored, source);
  assert.notEqual(restored?.source, source.source);
  assert.equal(parseStoredOwnerSetup(null, owner), null);
});

test("owner setup draft rejects corruption rather than silently returning empty", () => {
  const valid = draft();
  for (const raw of [
    "",
    "not json",
    "null",
    "{}",
    JSON.stringify({ ...valid, schemaVersion: 2 }),
    JSON.stringify({ ...valid, unrecognizedPrivateData: "secret" }),
    JSON.stringify({ ...valid, counts: { ...valid.counts, total: 7 } }),
    JSON.stringify({
      ...valid,
      inviteeEmails: ["a@example.test,b@example.test"],
    }),
    JSON.stringify({ ...valid, inviteeEmails: [null] }),
    JSON.stringify({ ...valid, source: { ...valid.source, schemaVersion: 2 } }),
  ])
    assert.throws(() => parseStoredOwnerSetup(raw, owner), {
      message: "owner_invalid_data",
    });
});

test("owner setup draft rechecks its recipients against the signed-in owner", () => {
  const raw = serializeOwnerSetupDraft(draft());
  assert.throws(() => parseStoredOwnerSetup(raw, "FAMILY@example.test"), {
    message: "owner_invalid_data",
  });
  assert.throws(() => parseStoredOwnerSetup(raw, ""), {
    message: "owner_invalid_data",
  });
});

test("owner setup draft cannot serialize a running timer or invalid data", () => {
  const value = draft();
  value.source.entries.push({
    id: "sleep",
    type: "sleep",
    start: "2026-09-01T10:00:00.000Z",
    note: "",
  });
  assert.throws(() => serializeOwnerSetupDraft(value), {
    message: "owner_active_timer",
  });
  assert.throws(() => parseStoredOwnerSetup(JSON.stringify(value), owner), {
    message: "owner_invalid_data",
  });
});
