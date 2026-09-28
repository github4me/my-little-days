import test from "node:test";
import assert from "node:assert/strict";
import { parseFamilyConfig } from "./family/config";
import {
  acceptReceipt,
  applySnapshot,
  emptyPilotState,
  enqueue,
  feedFromDraft,
  projectedFeeds,
  pendingForSend,
  rejectOperation,
  revokeCache,
  originForSnapshot,
  parseStoredPilot,
  canEditSharedFeed,
} from "./family/pilotState";
import type { FamilySnapshot, FeedOperation } from "./family/contracts";

const input = {
  start: "2026-09-01T01:00:00.000Z",
  end: "2026-09-01T01:20:00.000Z",
  amount: 100,
  note: "synthetic",
};
const snap = (
  revision = "1",
  membershipId = "grant-a",
  historyId = "history-a",
): FamilySnapshot => ({
  historyId,
  revision,
  family: {
    id: "family-a",
    babyName: "Test baby",
    role: "owner",
    membershipId,
    babyBirthDate: null,
    profileVersion: revision,
  },
  members: [
    {
      id: "a",
      displayName: "A",
      email: "a@example.test",
      membershipId,
      role: "owner",
      status: "active",
      endedAt: null,
    },
  ],
  invitations: [],
  feeds: [],
  ownershipTransfer: null,
});
const op = (id = "feed-a"): FeedOperation => ({
  operationId: `operation-${id}`,
  recordId: id,
  membershipId: "grant-a",
  historyId: "history-a",
  kind: "create",
  feed: { ...input },
});
const seeded = () => applySnapshot(emptyPilotState(), snap());

test("family configuration requires HTTPS, exact public API scope and tenant IDs", () => {
  const config = {
    apiUrl: "https://family.example.test/",
    tenantId: "11111111-1111-1111-1111-111111111111",
    clientId: "22222222-2222-2222-2222-222222222222",
    scope: "api://33333333-3333-3333-3333-333333333333/Family.ReadWrite",
  };
  assert.equal(
    parseFamilyConfig(config)?.apiUrl,
    "https://family.example.test",
  );
  for (const apiUrl of [
    "http://family.example.test",
    "https://user:secret@family.example.test",
    "https://family.example.test/other",
    "https://family.example.test/?token=abc",
  ])
    assert.equal(parseFamilyConfig({ ...config, apiUrl }), null);
  assert.equal(parseFamilyConfig({ ...config, scope: "openid" }), null);
  assert.equal(parseFamilyConfig({ ...config, tenantId: "common" }), null);
});

test("draft edits remain private and snapshot refresh never overwrites typed values", () => {
  const draft = {
    recordId: "feed-a",
    start: input.start,
    end: input.end,
    amount: "105",
    note: "not saved",
    historyId: "history-a",
    membershipId: "grant-a",
    origin: originForSnapshot(snap()),
  };
  const state = { ...seeded(), draft };
  const refreshed = applySnapshot(state, snap("2"));
  assert.deepEqual(refreshed.draft, draft);
  assert.equal(refreshed.queue.length, 0);
  assert.equal(projectedFeeds(refreshed, "a").length, 0);
});

test("offline save keeps immutable payload and one unresolved operation per record", () => {
  const operation = op();
  const saved = enqueue(seeded(), operation);
  operation.feed!.amount = 999;
  assert.equal(saved.queue[0].operation.feed!.amount, 100);
  assert.throws(() => enqueue(saved, op()), /record_pending/);
  assert.equal(projectedFeeds(saved, "a").length, 1);
  const copy = JSON.parse(JSON.stringify(saved));
  assert.equal(
    copy.queue[0].operation.operationId,
    saved.queue[0].operation.operationId,
  );
});

test("overlapping independently created records are retained", () => {
  const state = enqueue(enqueue(seeded(), op("one")), op("two"));
  assert.equal(projectedFeeds(state, "a").length, 2);
});

test("sync never sends optimistic queue entries before durable commit", () => {
  const committed = seeded(),
    visible = enqueue(committed, op());
  assert.equal(pendingForSend(committed, visible).length, 0);
  assert.equal(pendingForSend(visible, visible).length, 1);
  const rejected = rejectOperation(visible, op().operationId, "record_changed");
  assert.equal(pendingForSend(visible, rejected).length, 0);
  assert.equal(
    pendingForSend(visible, applySnapshot(visible, snap("2", "grant-b")))
      .length,
    0,
  );
});

test("accepted receipt remains visible until a sufficiently new snapshot arrives", () => {
  const operation = op();
  const queued = enqueue(seeded(), operation);
  const accepted = acceptReceipt(queued, operation.operationId, {
    operationId: operation.operationId,
    revision: "3",
    historyId: "history-a",
  });
  assert.equal(accepted.queue[0].status, "accepted");
  assert.equal(projectedFeeds(accepted, "a")[0].awaitingRefresh, true);
  assert.equal(projectedFeeds(accepted, "a")[0].pending, false);
  assert.equal(applySnapshot(accepted, snap("2")), accepted);
  const current = {
    ...snap("3"),
    feeds: [
      {
        ...input,
        id: operation.recordId,
        version: "row-v1",
        recordedBy: "a",
        lastEditedBy: "a",
      },
    ],
  };
  const applied = applySnapshot(accepted, current);
  assert.equal(applied.queue.length, 0);
  assert.equal(projectedFeeds(applied, "a").length, 1);
});

test("failed edit shows accepted values, keeps private payload and permits other operations", () => {
  const original = {
    ...input,
    id: "feed-a",
    version: "v1",
    recordedBy: "b",
    lastEditedBy: "b",
  };
  const s = applySnapshot(emptyPilotState(), { ...snap(), feeds: [original] });
  const operation = {
    ...op(),
    kind: "update" as const,
    baseVersion: "v1",
    feed: { ...input, amount: 110 },
  };
  const rejected = rejectOperation(
    enqueue(s, operation),
    operation.operationId,
    "record_changed",
  );
  assert.equal(projectedFeeds(rejected, "a")[0].amount, 100);
  assert.equal(rejected.queue[0].operation.feed!.amount, 110);
  const latest = applySnapshot(rejected, {
    ...snap("2"),
    feeds: [{ ...original, version: "v2", amount: 120 }],
  });
  assert.equal(projectedFeeds(latest, "a")[0].amount, 120);
  assert.equal(
    enqueue(latest, op("other")).queue.filter((q) => q.status === "pending")
      .length,
    1,
  );
});

test("confirmed delete is visible as pending until accepted and refreshed", () => {
  const original = {
    ...input,
    id: "feed-a",
    version: "v1",
    recordedBy: "a",
    lastEditedBy: "a",
  };
  const s = applySnapshot(emptyPilotState(), { ...snap(), feeds: [original] });
  const deletion = {
    ...op(),
    kind: "delete" as const,
    baseVersion: "v1",
    feed: undefined,
  };
  const queued = enqueue(s, deletion);
  assert.equal(projectedFeeds(queued, "a")[0].pendingDelete, true);
  const accepted = acceptReceipt(queued, deletion.operationId, {
    operationId: deletion.operationId,
    revision: "2",
    historyId: "history-a",
  });
  assert.equal(
    projectedFeeds(applySnapshot(accepted, snap("2")), "a").length,
    0,
  );
});

test("removal clears cache and rejoining never replays old-grant work", () => {
  const queued = enqueue(seeded(), op());
  const removed = revokeCache(queued);
  assert.equal(removed.snapshot, null);
  assert.equal(projectedFeeds(removed, "a").length, 0);
  const rejoined = applySnapshot(removed, snap("3", "grant-b"));
  assert.equal(rejoined.queue.length, 0);
  assert.equal(rejoined.draft, null);
  assert.throws(() => enqueue(rejoined, op()), /membership_changed/);
});

test("a restored history resets the revision floor and erases old operations", () => {
  const original = applySnapshot(emptyPilotState(), snap("120"));
  const queued = enqueue(original, op());
  const restored = applySnapshot(
    queued,
    snap("100", "grant-a", "history-restored"),
  );
  assert.equal(restored.snapshot!.revision, "100");
  assert.equal(restored.queue.length, 0);
  assert.equal(restored.acknowledgedRevision, null);
  assert.equal(projectedFeeds(restored, "a").length, 0);
});

test("family, author, grant and history origins cannot be rebound by snapshot or disk recovery", () => {
  const draft = {
    recordId: "draft",
    ...input,
    amount: "100",
    origin: originForSnapshot(snap()),
  };
  const saved = { ...enqueue(seeded(), op()), draft };
  for (const incoming of [
    { ...snap("2"), family: { ...snap().family, id: "family-b" } },
    snap("2", "grant-b"),
    snap("2", "grant-a", "history-b"),
    { ...snap("2"), members: [{ ...snap().members[0], id: "other-user" }] },
  ]) {
    const replaced = applySnapshot(saved, incoming);
    assert.equal(replaced.draft, null);
    assert.equal(replaced.queue.length, 0);
    assert.equal(pendingForSend(saved, replaced).length, 0);
  }
  const legacy = parseStoredPilot(JSON.stringify({ ...saved, schema: 1 }));
  assert.equal(legacy.draft, null);
  assert.equal(legacy.queue.length, 0);
  assert.equal(legacy.snapshot?.family.id, "family-a");
});

test("only an active author or administrator may enqueue changes to existing records", () => {
  const other = {
    ...input,
    id: "other-feed",
    version: "v1",
    recordedBy: "b",
    lastEditedBy: "b",
  };
  const caregiver = {
    ...snap(),
    family: { ...snap().family, role: "caregiver" as const },
    feeds: [other],
  };
  assert.equal(canEditSharedFeed(caregiver, other), false);
  assert.equal(
    canEditSharedFeed(caregiver, { ...other, recordedBy: "a" }),
    true,
  );
  assert.equal(canEditSharedFeed(snap(), other), true);
  assert.throws(
    () =>
      enqueue(applySnapshot(emptyPilotState(), caregiver), {
        ...op("other-feed"),
        kind: "delete",
        baseVersion: "v1",
      }),
    /record_forbidden/,
  );
});

test("persisted transition freezes outbox and projected data until resolved", () => {
  const queued = enqueue(seeded(), op());
  const frozen = {
    ...queued,
    transition: {
      operationId: "leave-a",
      kind: "leave" as const,
      userId: "a",
      familyId: "family-a",
      path: "/v1/families/family-a/leave",
      body: {},
      phase: "pending" as const,
    },
  };
  assert.equal(pendingForSend(queued, frozen).length, 0);
  assert.equal(projectedFeeds(frozen, "a").length, 0);
  assert.throws(() => enqueue(frozen, op("other")), /transition_pending/);
  assert.deepEqual(
    parseStoredPilot(JSON.stringify(frozen)).transition,
    frozen.transition,
  );
  assert.equal(revokeCache(frozen).transition?.operationId, "leave-a");
});

test("revision comparison remains lossless above JavaScript safe integers", () => {
  const state = applySnapshot(emptyPilotState(), snap("9007199254740993"));
  assert.equal(applySnapshot(state, snap("9007199254740992")), state);
  assert.equal(
    applySnapshot(state, snap("9007199254740994")).snapshot!.revision,
    "9007199254740994",
  );
});

test("completed feed validation rejects blank amounts, future and reversed intervals", () => {
  const draft = { recordId: "id", ...input, amount: "100" };
  assert.equal(feedFromDraft(draft).amount, 100);
  assert.equal(feedFromDraft({ ...draft, amount: "0" }).amount, 0);
  assert.equal(feedFromDraft({ ...draft, amount: "12.34" }).amount, 12.34);
  for (const amount of ["", " ", "-1", "2001", "NaN", "0x10", "1e2", "12.345"])
    assert.throws(() => feedFromDraft({ ...draft, amount }));
  assert.equal(
    feedFromDraft({ ...draft, note: "x".repeat(500) }).note.length,
    500,
  );
  assert.throws(() => feedFromDraft({ ...draft, note: "x".repeat(501) }));
  assert.throws(() => feedFromDraft({ ...draft, end: "2026-09-01T00:59:00Z" }));
  assert.throws(() => feedFromDraft(draft, Date.parse(input.start) - 60_000));
});
