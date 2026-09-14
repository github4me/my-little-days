import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createFamilyDemo,
  demoOwnerSource,
  demoScenarios,
  reduceFamilyDemo,
} from "./family/demoScenarios";
import { canEditSharedFeed } from "./family/pilotState";
import { prepareOwnerSeed, summarizeOwnerSeed } from "./family/ownerSeed";

const now = Date.UTC(2026, 8, 14, 12);

test("family demo scenarios use fresh, fictional fixtures and do not share state", () => {
  assert.equal(demoScenarios.length, 9);
  assert.equal(demoScenarios[0].id, "first-invite");
  for (const scenario of demoScenarios) {
    assert.ok(scenario.label.en && scenario.label["zh-CN"]);
    const first = createFamilyDemo(scenario.id, now);
    const second = createFamilyDemo(scenario.id, now);
    assert.deepEqual(first, second);
    assert.notEqual(first, second);
    if (first.user) assert.match(first.user.email, /@example\.com$/);
    for (const member of first.snapshot?.members ?? []) {
      assert.match(member.displayName, /^Sample /);
      if (member.email) assert.match(member.email, /@example\.com$/);
    }
    if (first.snapshot) {
      first.snapshot.family.babyName = "Changed only in one demo";
      first.snapshot.feeds.length = 0;
      assert.equal(second.snapshot?.family.babyName, "Demo Baby");
      assert.equal(second.snapshot?.feeds.length, 2);
    }
  }
});

test("first-invitation source includes every record category without using real app history", () => {
  const initial = createFamilyDemo("first-invite", now);
  assert.equal(initial.snapshot, null);
  assert.equal(initial.seededSource, null);
  assert.deepEqual(initial.inbox, []);
  assert.equal(initial.user?.email, "sample.admin@example.com");
  const source = demoOwnerSource(now);
  const another = demoOwnerSource(now);
  assert.deepEqual(source, another);
  assert.deepEqual(
    new Set(source.entries.map((entry) => entry.type)),
    new Set(["feed", "diaper", "sleep", "growth", "milestone"]),
  );
  assert.deepEqual(summarizeOwnerSeed(source), {
    counts: {
      feed: 2,
      diaper: 1,
      sleep: 1,
      growth: 1,
      milestone: 1,
      care: 1,
      total: 7,
    },
    runningCount: 0,
  });
  source.entries[0].note = "Changed one sample";
  source.profile.name = "Changed sample";
  assert.equal(another.entries[0].note, "Fictional bottle feed");
  assert.equal(another.profile.name, "Demo Baby");
});

test("first-invitation review is side-effect free; confirmation retains the whole seed and creates normalized invites", () => {
  const initial = createFamilyDemo("first-invite", now);
  const before = structuredClone(initial);
  const source = demoOwnerSource(now);
  const original = structuredClone(source);
  const draft = prepareOwnerSeed(
    source,
    " FAMILY.ONE@example.com, family.two@example.com\nfamily.one@example.com",
    initial.user!.email,
  );
  assert.deepEqual(initial, before, "Review must not create a family");
  assert.deepEqual(source, original);
  const created = reduceFamilyDemo(
    initial,
    { type: "create-family-from-seed", draft },
    now,
  );
  assert.deepEqual(created.seededSource, original);
  assert.notEqual(created.seededSource, draft.source);
  assert.equal(created.snapshot?.family.role, "owner");
  assert.equal(created.snapshot?.family.babyName, original.profile.name);
  assert.equal(
    created.snapshot?.family.babyBirthDate,
    original.profile.birthDate,
  );
  assert.equal(
    created.snapshot?.members.length,
    1,
    "Inviting does not grant membership",
  );
  assert.deepEqual(
    created.snapshot?.invitations.map((item) => item.email),
    ["family.one@example.com", "family.two@example.com"],
  );
  for (const invitation of created.snapshot!.invitations) {
    assert.equal(invitation.status, "pending");
    assert.equal(Date.parse(invitation.expiresAt) - now, 30 * 86400000);
  }
  assert.equal(
    created.snapshot?.feeds.length,
    1,
    "Pilot projection displays only completed bottle feeds",
  );
  assert.equal(created.snapshot?.feeds[0].recordedBy, initial.user!.id);
  assert.equal(
    created.seededSource?.entries.length,
    6,
    "Projection must not discard other record types",
  );
  assert.deepEqual(initial, before);
  draft.source.entries[0].amount = 999;
  assert.equal(created.seededSource?.entries[0].amount, 100);
});

test("first-invitation confirmation revalidates timers and recipients without partial creation", () => {
  const initial = createFamilyDemo("first-invite", now);
  const draft = prepareOwnerSeed(
    demoOwnerSource(now),
    "family@example.com",
    initial.user!.email,
  );
  for (const kind of ["feed", "sleep"] as const) {
    const changed = structuredClone(draft);
    const entry = changed.source.entries.find((item) => item.type === kind)!;
    delete entry.end;
    if (kind === "feed") entry.feedRunning = true;
    assert.throws(
      () =>
        reduceFamilyDemo(
          initial,
          { type: "create-family-from-seed", draft: changed },
          now,
        ),
      /owner_active_timer/,
    );
  }
  assert.throws(
    () =>
      reduceFamilyDemo(
        initial,
        {
          type: "create-family-from-seed",
          draft: { ...draft, inviteeEmails: [initial.user!.email] },
        },
        now,
      ),
    /owner_self_invite/,
  );
  assert.throws(
    () =>
      reduceFamilyDemo(
        initial,
        {
          type: "create-family-from-seed",
          draft: { ...draft, inviteeEmails: ["bad-address"] },
        },
        now,
      ),
    /owner_invalid_email/,
  );
  assert.deepEqual(initial, createFamilyDemo("first-invite", now));
});

test("later invitations keep the same seeded family and existing membership blocks another import", () => {
  const initial = createFamilyDemo("first-invite", now);
  const draft = prepareOwnerSeed(
    demoOwnerSource(now),
    "family.one@example.com",
    initial.user!.email,
  );
  const created = reduceFamilyDemo(
    initial,
    { type: "create-family-from-seed", draft },
    now,
  );
  const later = reduceFamilyDemo(
    created,
    { type: "create-invitation", email: "family.two@example.com" },
    now,
  );
  assert.equal(later.snapshot!.family.id, created.snapshot!.family.id);
  assert.equal(
    later.snapshot!.family.membershipId,
    created.snapshot!.family.membershipId,
  );
  assert.deepEqual(later.seededSource, created.seededSource);
  assert.deepEqual(later.snapshot!.feeds, created.snapshot!.feeds);
  assert.equal(later.snapshot!.invitations.length, 2);
  for (const state of [later, createFamilyDemo("member", now)]) {
    assert.throws(
      () =>
        reduceFamilyDemo(
          state,
          { type: "create-family-from-seed", draft },
          now,
        ),
      /already_in_family/,
    );
  }
  assert.equal(
    reduceFamilyDemo(created, { type: "sign-out" }, now).seededSource,
    null,
  );
  assert.equal(
    reduceFamilyDemo(created, { type: "close-family" }, now).seededSource,
    null,
  );
});

test("admin acceptance changes control of the same seeded family without copying data or changing authors", () => {
  const initial = createFamilyDemo("first-invite", now);
  const draft = prepareOwnerSeed(
    demoOwnerSource(now),
    "family@example.com",
    initial.user!.email,
  );
  const created = reduceFamilyDemo(
    initial,
    { type: "create-family-from-seed", draft },
    now,
  );
  const member = createFamilyDemo("member", now);
  created.snapshot!.members.push(
    member.snapshot!.members.find((item) => item.id === member.user!.id)!,
  );
  const nominated = reduceFamilyDemo(
    created,
    { type: "nominate-owner", id: member.user!.id },
    now,
  );
  const nominee = {
    ...nominated,
    user: member.user,
    snapshot: {
      ...nominated.snapshot!,
      family: {
        ...nominated.snapshot!.family,
        role: "caregiver" as const,
        membershipId: "demo-member-grant",
      },
    },
  };
  const accepted = reduceFamilyDemo(nominee, { type: "accept-transfer" }, now);
  assert.equal(accepted.snapshot!.family.id, created.snapshot!.family.id);
  assert.equal(accepted.snapshot!.historyId, created.snapshot!.historyId);
  assert.equal(accepted.snapshot!.family.role, "owner");
  assert.deepEqual(accepted.seededSource, created.seededSource);
  assert.deepEqual(accepted.snapshot!.feeds, created.snapshot!.feeds);
  assert.equal(
    accepted.snapshot!.members.filter((item) => item.role === "owner").length,
    1,
  );
});

test("family demo controllers have no runtime account, network or storage imports", () => {
  for (const name of ["useFamilyDemo", "demoScenarios"]) {
    const source = readFileSync(
      new URL(`./family/${name}.ts`, import.meta.url),
      "utf8",
    );
    const runtimeSource = source.replace(/import type[\s\S]*?;/g, "");
    assert.doesNotMatch(
      runtimeSource,
      /from\s+["'][^"']*(?:useFamilyPilot|auth|[Ss]torage|config|api|expo-|react-native|deletionReceipt)[^"']*["']/,
    );
    assert.doesNotMatch(
      runtimeSource,
      /\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage)\b/,
    );
  }
});

test("demo sign-in exposes invitations but never automatically joins", () => {
  const signedOut = createFamilyDemo("signed-out", now);
  const inbox = reduceFamilyDemo(signedOut, { type: "sign-in" }, now);
  assert.equal(inbox.snapshot, null);
  assert.equal(inbox.inbox.length, 2);
  const declined = reduceFamilyDemo(
    inbox,
    { type: "decline-invitation", id: inbox.inbox[1].id },
    now,
  );
  assert.equal(declined.inbox.length, 1);
  assert.equal(declined.snapshot, null);
  const joined = reduceFamilyDemo(
    declined,
    { type: "accept-invitation", id: declined.inbox[0].id },
    now,
  );
  assert.equal(joined.snapshot?.family.role, "caregiver");
  assert.equal(joined.inbox.length, 0);
  assert.equal(inbox.inbox.length, 2);
  assert.equal(signedOut.user, null);
});

test("demo member can modify only own feeds and cannot manage the family", () => {
  const member = createFamilyDemo("member", now);
  const snapshot = member.snapshot!;
  assert.equal(
    snapshot.members.find((item) => item.id === "demo-admin")?.email,
    null,
  );
  assert.equal(snapshot.invitations.length, 0);
  const own = snapshot.feeds.find(
    (feed) => feed.recordedBy === member.user!.id,
  )!;
  const other = snapshot.feeds.find(
    (feed) => feed.recordedBy !== member.user!.id,
  )!;
  assert.equal(canEditSharedFeed(snapshot, own), true);
  assert.equal(canEditSharedFeed(snapshot, other), false);
  assert.throws(
    () => reduceFamilyDemo(member, { type: "delete-feed", id: other.id }, now),
    /record_forbidden/,
  );
  assert.throws(
    () => reduceFamilyDemo(member, { type: "begin-feed", feed: other }, now),
    /record_forbidden/,
  );
  assert.throws(
    () =>
      reduceFamilyDemo(
        member,
        { type: "create-invitation", email: "other@example.com" },
        now,
      ),
    /owner_required/,
  );
  assert.throws(
    () =>
      reduceFamilyDemo(
        member,
        { type: "update-profile", babyName: "Changed", babyBirthDate: null },
        now,
      ),
    /owner_required/,
  );
  const deleted = reduceFamilyDemo(
    member,
    { type: "delete-feed", id: own.id },
    now,
  );
  assert.equal(deleted.snapshot?.feeds.length, 1);
  assert.equal(member.snapshot?.feeds.length, 2);
});

test("demo drafts only become records on Save and use actual validation", () => {
  const member = createFamilyDemo("member", now);
  const editing = reduceFamilyDemo(member, { type: "begin-feed" }, now);
  assert.equal(editing.snapshot?.feeds.length, 2);
  const invalid = reduceFamilyDemo(
    editing,
    { type: "set-draft", draft: { ...editing.draft!, amount: "invalid" } },
    now,
  );
  assert.throws(
    () => reduceFamilyDemo(invalid, { type: "save-draft" }, now),
    /invalid_feed/,
  );
  const updated = reduceFamilyDemo(
    editing,
    { type: "set-draft", draft: { ...editing.draft!, amount: "95" } },
    now,
  );
  const saved = reduceFamilyDemo(updated, { type: "save-draft" }, now);
  assert.equal(saved.draft, null);
  assert.equal(saved.snapshot?.feeds.length, 3);
  assert.equal(saved.snapshot?.feeds[0].amount, 95);
  assert.equal(saved.snapshot?.feeds[0].recordedBy, member.user?.id);
  assert.equal(member.snapshot?.feeds.length, 2);
  const left = reduceFamilyDemo(editing, { type: "leave" }, now);
  assert.equal(left.draft, null);
  assert.equal(left.snapshot, null);
});

test("demo admin invitation/removal/profile actions are isolated and retain contributions", () => {
  const owner = createFamilyDemo("owner", now);
  const invited = reduceFamilyDemo(
    owner,
    { type: "create-invitation", email: "new.guest@example.com" },
    now,
  );
  const invitation = invited.snapshot!.invitations[0];
  assert.equal(Date.parse(invitation.expiresAt) - now, 30 * 86400000);
  const revoked = reduceFamilyDemo(
    invited,
    { type: "revoke-invitation", id: invitation.id },
    now,
  );
  assert.equal(revoked.snapshot!.invitations[0].status, "revoked");
  const removed = reduceFamilyDemo(
    owner,
    { type: "remove-member", id: "demo-member" },
    now,
  );
  assert.equal(
    removed.snapshot!.members.find((member) => member.id === "demo-member")
      ?.status,
    "removed",
  );
  assert.deepEqual(removed.snapshot!.feeds, owner.snapshot!.feeds);
  assert.equal(
    owner.snapshot!.members.find((member) => member.id === "demo-member")
      ?.status,
    "active",
  );
  const updated = reduceFamilyDemo(
    owner,
    {
      type: "update-profile",
      babyName: "Another Demo Baby",
      babyBirthDate: "2026-08-01",
    },
    now,
  );
  assert.equal(updated.snapshot!.family.babyName, "Another Demo Baby");
  assert.equal(owner.snapshot!.family.babyName, "Demo Baby");
  assert.throws(
    () =>
      reduceFamilyDemo(
        owner,
        {
          type: "update-profile",
          babyName: "Demo",
          babyBirthDate: "2026-02-31",
        },
        now,
      ),
    /invalid_input/,
  );
});

test("demo admin transfer takes effect only on nominee acceptance", () => {
  const owner = createFamilyDemo("owner", now);
  const nominated = reduceFamilyDemo(
    owner,
    { type: "nominate-owner", id: "demo-member" },
    now,
  );
  assert.equal(nominated.snapshot!.family.role, "owner");
  assert.equal(nominated.snapshot!.ownershipTransfer?.toUserId, "demo-member");
  assert.throws(
    () => reduceFamilyDemo(nominated, { type: "accept-transfer" }, now),
    /transfer_unavailable/,
  );
  assert.equal(
    reduceFamilyDemo(nominated, { type: "cancel-transfer" }, now).snapshot!
      .ownershipTransfer,
    null,
  );
  const nominee = createFamilyDemo("transfer", now);
  const accepted = reduceFamilyDemo(nominee, { type: "accept-transfer" }, now);
  assert.equal(accepted.snapshot!.family.role, "owner");
  assert.equal(accepted.snapshot!.ownershipTransfer, null);
  assert.equal(
    accepted.snapshot!.members.find((member) => member.id === "demo-admin")
      ?.role,
    "caregiver",
  );
  assert.equal(
    accepted.snapshot!.members.filter((member) => member.role === "owner")
      .length,
    1,
  );
  assert.equal(nominee.snapshot!.family.role, "caregiver");
});

test("demo requires sole admin closure before account deletion", () => {
  const owner = createFamilyDemo("owner", now);
  assert.throws(
    () => reduceFamilyDemo(owner, { type: "close-family" }, now),
    /family_has_members/,
  );
  assert.throws(
    () => reduceFamilyDemo(owner, { type: "delete-account" }, now),
    /family_owner_cannot_delete/,
  );
  assert.throws(
    () => reduceFamilyDemo(owner, { type: "leave" }, now),
    /owner_cannot_leave/,
  );
  const sole = createFamilyDemo("sole-owner", now);
  assert.throws(
    () => reduceFamilyDemo(sole, { type: "delete-account" }, now),
    /family_owner_cannot_delete/,
  );
  const closed = reduceFamilyDemo(sole, { type: "close-family" }, now);
  assert.equal(closed.snapshot, null);
  const requested = reduceFamilyDemo(closed, { type: "delete-account" }, now);
  assert.equal(requested.deletionStatus?.status, "pending");
  assert.equal(sole.snapshot?.feeds.length, 2);
});

test("demo deletion remains simulated, survives demo sign-out, and advances to completion", () => {
  const member = createFamilyDemo("member", now);
  const pending = reduceFamilyDemo(member, { type: "delete-account" }, now);
  assert.equal(pending.snapshot, null);
  assert.throws(
    () => reduceFamilyDemo(pending, { type: "dismiss-deletion" }, now),
    /deletion_pending/,
  );
  const signedOut = reduceFamilyDemo(pending, { type: "sign-out" }, now);
  assert.equal(signedOut.user, null);
  assert.equal(signedOut.deletionStatus?.status, "pending");
  const processing = reduceFamilyDemo(
    signedOut,
    { type: "check-deletion" },
    now,
  );
  assert.equal(processing.deletionStatus?.status, "awaiting_identity_deletion");
  const completed = reduceFamilyDemo(
    processing,
    { type: "check-deletion" },
    now,
  );
  assert.equal(completed.deletionStatus?.status, "completed");
  assert.equal(
    reduceFamilyDemo(completed, { type: "dismiss-deletion" }, now)
      .deletionStatus,
    null,
  );
  assert.equal(member.snapshot?.feeds.length, 2);
  assert.equal(createFamilyDemo("removed", now).snapshot, null);
});
