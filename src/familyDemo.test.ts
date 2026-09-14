import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createFamilyDemo,
  demoScenarios,
  reduceFamilyDemo,
} from "./family/demoScenarios";
import { canEditSharedFeed } from "./family/pilotState";

const now = Date.UTC(2026, 8, 14, 12);

test("family demo scenarios use fresh, fictional fixtures and do not share state", () => {
  assert.equal(demoScenarios.length, 8);
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
