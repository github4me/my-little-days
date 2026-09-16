// UI-review fixtures only. This module has no account, storage or API access.
import type {
  AccountDeletion,
  FamilyMember,
  FamilySnapshot,
  FamilyUser,
  PendingFamilyInvitation,
  SharedFeed,
} from "./contracts";
import type { FeedDraft } from "./pilotState";
import type { State } from "../domain";
import { prepareOwnerSeed, type OwnerSeedDraft } from "./ownerSeed";
import {
  familyInvitationCapacity,
  MAX_INVITED_FAMILY_MEMBERS,
} from "./invitationCapacity";
import {
  canEditSharedFeed,
  feedFromDraft,
  originForSnapshot,
} from "./pilotState";

export const demoScenarios = [
  {
    id: "first-invite",
    label: { "zh-CN": "首次邀请", en: "First invitation" },
  },
  { id: "signed-out", label: { "zh-CN": "未登录", en: "Signed out" } },
  { id: "invitations", label: { "zh-CN": "收到邀请", en: "Invitations" } },
  { id: "owner", label: { "zh-CN": "管理员", en: "Admin" } },
  { id: "member", label: { "zh-CN": "家庭成员", en: "Member" } },
  { id: "transfer", label: { "zh-CN": "接受管理权", en: "Admin transfer" } },
  { id: "sole-owner", label: { "zh-CN": "关闭家庭", en: "Close family" } },
  { id: "removed", label: { "zh-CN": "已被移除", en: "Removed" } },
  { id: "deletion", label: { "zh-CN": "删除账户", en: "Account deletion" } },
] as const;
export type FamilyDemoScenario = (typeof demoScenarios)[number]["id"];

export type FamilyDemoState = {
  user: FamilyUser | null;
  snapshot: FamilySnapshot | null;
  inbox: PendingFamilyInvitation[];
  draft: FeedDraft | null;
  accountDeletion: AccountDeletion | null;
  deletionStatus: AccountDeletion | null;
  notice: string | null;
  sequence: number;
  seededSource: State | null;
};

const demoUser = (owner: boolean): FamilyUser => ({
  id: owner ? "demo-admin" : "demo-member",
  displayName: owner ? "Sample Admin" : "Sample Member",
  email: owner ? "sample.admin@example.com" : "sample.member@example.com",
});
const iso = (milliseconds: number) => new Date(milliseconds).toISOString();

// Complete fake starting data. Do not pass the app's actual local state into a
// demo session: every activity kind here is independently reviewable.
export function demoOwnerSource(now = Date.now()): State {
  const start = iso(now - 4 * 3600000);
  return {
    schemaVersion: 1,
    profile: {
      name: "Demo Baby",
      birthDate: iso(now - 70 * 86400000).slice(0, 10),
      sex: "unspecified",
    },
    entries: [
      {
        id: "sample-source-feed",
        type: "feed",
        start,
        end: iso(now - 4 * 3600000 + 20 * 60000),
        feedKind: "formula",
        amount: 100,
        note: "Fictional bottle feed",
      },
      {
        id: "sample-source-breast",
        type: "feed",
        start: iso(now - 8 * 3600000),
        end: iso(now - 8 * 3600000 + 15 * 60000),
        feedKind: "breast-left",
        note: "Fictional breastfeed",
      },
      {
        id: "sample-source-diaper",
        type: "diaper",
        start,
        diaperKind: "mixed",
        note: "Fictional nappy change",
      },
      {
        id: "sample-source-sleep",
        type: "sleep",
        start: iso(now - 3 * 3600000),
        end: iso(now - 2 * 3600000),
        note: "Fictional sleep",
      },
      {
        id: "sample-source-growth",
        type: "growth",
        start,
        weight: 5.1,
        length: 57,
        head: 38,
        note: "Fictional measurement",
      },
      {
        id: "sample-source-milestone",
        type: "milestone",
        start,
        title: "First smile",
        note: "Fictional milestone",
      },
    ],
    careRecords: [
      {
        id: "sample-source-care",
        kind: "temperature",
        time: start,
        temperature: 36.8,
        method: "armpit",
        note: "Fictional care record",
      },
    ],
  };
}

function demoSnapshot(owner: boolean, now: number): FamilySnapshot {
  const members: FamilyMember[] = [
    {
      ...demoUser(true),
      role: "owner",
      membershipId: "demo-admin-grant",
      status: "active",
      endedAt: null,
    },
    {
      ...demoUser(false),
      role: "caregiver",
      membershipId: "demo-member-grant",
      status: "active",
      endedAt: null,
    },
    {
      id: "demo-left",
      displayName: "Sample Former Member",
      email: "sample.former@example.com",
      role: "caregiver",
      membershipId: "demo-left-grant",
      status: "left",
      endedAt: iso(now - 86400000),
    },
    {
      id: "demo-removed",
      displayName: "Sample Removed Member",
      email: "sample.removed@example.com",
      role: "caregiver",
      membershipId: "demo-removed-grant",
      status: "removed",
      endedAt: iso(now - 172800000),
    },
  ];
  return {
    family: {
      id: "demo-family",
      babyName: "Demo Baby",
      role: owner ? "owner" : "caregiver",
      membershipId: owner ? "demo-admin-grant" : "demo-member-grant",
      babyBirthDate: iso(now - 70 * 86400000).slice(0, 10),
      profileVersion: "1",
    },
    historyId: "demo-history",
    revision: "1",
    members: owner
      ? members
      : members.map((member) => ({
          ...member,
          email: member.id === "demo-member" ? member.email : null,
        })),
    invitations: owner
      ? [
          {
            id: "demo-outgoing",
            email: "sample.guest@example.com",
            expiresAt: iso(now + 30 * 86400000),
            status: "pending",
          },
          {
            id: "demo-declined",
            email: "sample.declined@example.com",
            expiresAt: iso(now + 28 * 86400000),
            status: "declined",
          },
        ]
      : [],
    feeds: [
      {
        id: "demo-feed-admin",
        version: "1",
        recordedBy: "demo-admin",
        lastEditedBy: "demo-admin",
        start: iso(now - 4 * 3600000),
        end: iso(now - 4 * 3600000 + 20 * 60000),
        amount: 100,
        note: "Fictional review record",
      },
      {
        id: "demo-feed-member",
        version: "1",
        recordedBy: "demo-member",
        lastEditedBy: "demo-member",
        start: iso(now - 3600000),
        end: iso(now - 40 * 60000),
        amount: 120,
        note: "Fictional review record",
      },
    ],
    ownershipTransfer: null,
  };
}

export function createFamilyDemo(
  scenario: FamilyDemoScenario,
  now = Date.now(),
): FamilyDemoState {
  const owner =
    scenario === "owner" ||
    scenario === "sole-owner" ||
    scenario === "first-invite";
  const state: FamilyDemoState = {
    user: scenario === "signed-out" ? null : demoUser(owner),
    snapshot: ["owner", "member", "transfer", "sole-owner"].includes(scenario)
      ? demoSnapshot(owner, now)
      : null,
    inbox:
      scenario === "invitations"
        ? [
            {
              id: "demo-incoming",
              familyId: "demo-family",
              ownerDisplayName: "Sample Admin",
              expiresAt: iso(now + 30 * 86400000),
            },
            {
              id: "demo-other-incoming",
              familyId: "demo-other-family",
              ownerDisplayName: "Sample Other Admin",
              expiresAt: iso(now + 25 * 86400000),
            },
          ]
        : [],
    draft: null,
    accountDeletion: null,
    deletionStatus: null,
    notice: scenario === "removed" ? "membership_revoked" : null,
    sequence: 1,
    seededSource: null,
  };
  if (scenario === "sole-owner" && state.snapshot) {
    state.snapshot.members = state.snapshot.members.map((member) =>
      member.id === "demo-member"
        ? { ...member, status: "left", endedAt: iso(now - 60000) }
        : member,
    );
  }
  if (scenario === "transfer" && state.snapshot) {
    state.snapshot.ownershipTransfer = {
      id: "demo-transfer",
      fromUserId: "demo-admin",
      toUserId: "demo-member",
      status: "pending",
      createdAt: iso(now - 60000),
    };
  }
  if (scenario === "deletion") {
    state.user = null;
    state.deletionStatus = {
      deletionId: "demo-deletion",
      status: "pending",
      requestedAt: iso(now),
    };
  }
  return state;
}

export type FamilyDemoAction =
  | {
      type:
        | "sign-in"
        | "sign-out"
        | "refresh"
        | "leave"
        | "cancel-transfer"
        | "accept-transfer"
        | "close-family"
        | "delete-account"
        | "check-deletion"
        | "dismiss-deletion"
        | "discard-draft"
        | "save-draft";
    }
  | { type: "create-family"; babyName: string }
  | { type: "create-family-from-seed"; draft: OwnerSeedDraft }
  | {
      type:
        | "accept-invitation"
        | "decline-invitation"
        | "revoke-invitation"
        | "remove-member"
        | "nominate-owner"
        | "delete-feed";
      id: string;
    }
  | { type: "create-invitation"; email: string }
  | { type: "update-profile"; babyName: string; babyBirthDate: string | null }
  | { type: "begin-feed"; feed?: SharedFeed }
  | { type: "set-draft"; draft: FeedDraft };

// Each result is a fresh copy. No input fixture or other demo session is changed.
export function reduceFamilyDemo(
  previous: FamilyDemoState,
  action: FamilyDemoAction,
  now = Date.now(),
): FamilyDemoState {
  const state = JSON.parse(JSON.stringify(previous)) as FamilyDemoState;
  state.notice = null;
  const requireUser = () => {
    if (!state.user) throw new Error("sign_in_required");
    if (state.accountDeletion) throw new Error("account_deleted");
    return state.user;
  };
  const family = (owner = false) => {
    requireUser();
    if (!state.snapshot) throw new Error("family_unavailable");
    if (owner && state.snapshot.family.role !== "owner")
      throw new Error("owner_required");
    return state.snapshot;
  };
  const nextId = () => `demo-new-${++state.sequence}`;
  const clearFamily = () => {
    state.snapshot = null;
    state.draft = null;
    state.seededSource = null;
  };
  const validName = (name: string) => {
    if (!name.trim() || name.trim().length > 60)
      throw new Error("invalid_input");
    return name.trim();
  };
  switch (action.type) {
    case "sign-in": {
      if (state.deletionStatus) throw new Error("deletion_pending");
      return createFamilyDemo("invitations", now);
    }
    case "sign-out":
      clearFamily();
      state.user = null;
      state.inbox = [];
      state.accountDeletion = null;
      state.notice = "signed_out";
      break;
    case "refresh":
      break;
    case "create-family": {
      const user = requireUser();
      if (state.snapshot) throw new Error("already_in_family");
      const snapshot = demoSnapshot(true, now);
      snapshot.family.babyName = validName(action.babyName);
      snapshot.family.babyBirthDate = null;
      snapshot.family.membershipId = "demo-created-grant";
      snapshot.members = [
        {
          ...user,
          role: "owner",
          membershipId: snapshot.family.membershipId,
          status: "active",
          endedAt: null,
        },
      ];
      snapshot.feeds = [];
      snapshot.invitations = [];
      state.snapshot = snapshot;
      state.inbox = [];
      break;
    }
    case "create-family-from-seed": {
      const user = requireUser();
      if (state.snapshot) throw new Error("already_in_family");
      const seed = prepareOwnerSeed(
        action.draft.source,
        action.draft.inviteeEmails.join("\n"),
        user.email,
      );
      const snapshot = demoSnapshot(true, now);
      snapshot.family.babyName = seed.source.profile.name;
      snapshot.family.babyBirthDate = seed.source.profile.birthDate || null;
      snapshot.family.membershipId = "demo-created-grant";
      snapshot.members = [
        {
          ...user,
          role: "owner",
          membershipId: snapshot.family.membershipId,
          status: "active",
          endedAt: null,
        },
      ];
      snapshot.feeds = seed.source.entries
        .filter(
          (entry) =>
            entry.type === "feed" &&
            !!entry.end &&
            (entry.feedKind === "formula" || entry.feedKind === "expressed"),
        )
        .map((entry) => ({
          id: entry.id,
          version: "1",
          recordedBy: user.id,
          lastEditedBy: user.id,
          start: entry.start,
          end: entry.end!,
          amount: entry.amount!,
          note: entry.note,
        }));
      snapshot.invitations = seed.inviteeEmails.map((email) => ({
        id: nextId(),
        email,
        expiresAt: iso(now + 30 * 86400000),
        status: "pending",
      }));
      // The feed-only pilot projection must not discard other record types.
      // Keep the entire validated source, unchanged, beside that projection.
      state.seededSource = seed.source;
      state.snapshot = snapshot;
      state.inbox = [];
      break;
    }
    case "accept-invitation": {
      requireUser();
      if (state.snapshot) throw new Error("already_in_family");
      const invite = state.inbox.find((item) => item.id === action.id);
      if (!invite || Date.parse(invite.expiresAt) <= now)
        throw new Error("invitation_unavailable");
      state.snapshot = demoSnapshot(false, now);
      if (
        familyInvitationCapacity(state.snapshot.members, [], now)
          .activeMembers > MAX_INVITED_FAMILY_MEMBERS
      )
        throw new Error("invitation_limit");
      state.snapshot.family.id = invite.familyId;
      state.snapshot.members[0].displayName = invite.ownerDisplayName;
      state.inbox = [];
      state.draft = null;
      break;
    }
    case "decline-invitation":
      requireUser();
      if (!state.inbox.some((item) => item.id === action.id))
        throw new Error("invitation_unavailable");
      state.inbox = state.inbox.filter((item) => item.id !== action.id);
      break;
    case "create-invitation": {
      const snapshot = family(true),
        email = action.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
        throw new Error("invalid_input");
      if (
        snapshot.members.some(
          (member) =>
            member.email?.toLowerCase() === email && member.status === "active",
        )
      )
        throw new Error("invitation_already_created");
      const existing = snapshot.invitations.filter(
        (item) =>
          item.email.toLowerCase() === email &&
          item.status === "pending" &&
          Date.parse(item.expiresAt) > now,
      );
      if (
        !existing.length &&
        !familyInvitationCapacity(snapshot.members, snapshot.invitations, now)
          .remaining
      )
        throw new Error("invitation_limit");
      for (const invitation of existing) invitation.status = "revoked";
      snapshot.invitations.unshift({
        id: nextId(),
        email,
        expiresAt: iso(now + 30 * 86400000),
        status: "pending",
      });
      break;
    }
    case "revoke-invitation": {
      const invitation = family(true).invitations.find(
        (item) => item.id === action.id && item.status === "pending",
      );
      if (!invitation) throw new Error("invitation_unavailable");
      invitation.status = "revoked";
      break;
    }
    case "remove-member": {
      const snapshot = family(true),
        member = snapshot.members.find(
          (item) => item.id === action.id && item.status === "active",
        );
      if (!member || member.id === state.user!.id)
        throw new Error("member_changed");
      member.status = "removed";
      member.endedAt = iso(now);
      if (snapshot.ownershipTransfer?.toUserId === member.id)
        snapshot.ownershipTransfer = null;
      break;
    }
    case "leave":
      if (family().family.role === "owner")
        throw new Error("owner_cannot_leave");
      clearFamily();
      state.inbox = [];
      break;
    case "update-profile": {
      const snapshot = family(true),
        birth = action.babyBirthDate;
      if (
        birth &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(birth) ||
          !Number.isFinite(Date.parse(birth)) ||
          iso(Date.parse(birth)).slice(0, 10) !== birth ||
          birth > iso(now).slice(0, 10))
      )
        throw new Error("invalid_input");
      snapshot.family.babyName = validName(action.babyName);
      snapshot.family.babyBirthDate = birth;
      snapshot.family.profileVersion = String(
        Number(snapshot.family.profileVersion) + 1,
      );
      break;
    }
    case "nominate-owner": {
      const snapshot = family(true),
        member = snapshot.members.find(
          (item) => item.id === action.id && item.status === "active",
        );
      if (snapshot.ownershipTransfer) throw new Error("transfer_pending");
      if (!member || member.id === state.user!.id)
        throw new Error("member_changed");
      snapshot.ownershipTransfer = {
        id: nextId(),
        fromUserId: state.user!.id,
        toUserId: member.id,
        status: "pending",
        createdAt: iso(now),
      };
      break;
    }
    case "cancel-transfer": {
      const snapshot = family(true);
      if (!snapshot.ownershipTransfer) throw new Error("transfer_unavailable");
      snapshot.ownershipTransfer = null;
      break;
    }
    case "accept-transfer": {
      const snapshot = family(),
        transfer = snapshot.ownershipTransfer;
      if (!transfer || transfer.toUserId !== state.user!.id)
        throw new Error("transfer_unavailable");
      snapshot.members = snapshot.members.map((member) => ({
        ...member,
        role: member.id === state.user!.id ? "owner" : "caregiver",
      }));
      snapshot.family.role = "owner";
      snapshot.ownershipTransfer = null;
      break;
    }
    case "close-family": {
      const snapshot = family(true);
      if (
        snapshot.members.some(
          (member) =>
            member.status === "active" && member.id !== state.user!.id,
        )
      )
        throw new Error("family_has_members");
      clearFamily();
      state.inbox = [];
      break;
    }
    case "delete-account": {
      requireUser();
      if (state.snapshot?.family.role === "owner")
        throw new Error("family_owner_cannot_delete");
      const deletion: AccountDeletion = {
        deletionId: nextId(),
        status: "pending",
        requestedAt: iso(now),
      };
      clearFamily();
      state.inbox = [];
      state.accountDeletion = deletion;
      state.deletionStatus = { ...deletion };
      break;
    }
    case "check-deletion": {
      const receipt = state.deletionStatus;
      if (!receipt) throw new Error("deletion_receipt_unavailable");
      receipt.status =
        receipt.status === "pending"
          ? "awaiting_identity_deletion"
          : "completed";
      if (state.accountDeletion) state.accountDeletion = { ...receipt };
      break;
    }
    case "dismiss-deletion":
      if (state.deletionStatus?.status !== "completed")
        throw new Error("deletion_pending");
      state.deletionStatus = null;
      state.accountDeletion = null;
      state.user = null;
      break;
    case "begin-feed": {
      const snapshot = family();
      if (state.draft) throw new Error("draft_exists");
      const feed = action.feed
        ? snapshot.feeds.find((item) => item.id === action.feed!.id)
        : undefined;
      if (action.feed && !feed) throw new Error("record_changed");
      if (feed && !canEditSharedFeed(snapshot, feed))
        throw new Error("record_forbidden");
      state.draft = {
        recordId: feed?.id ?? nextId(),
        baseVersion: feed?.version,
        start: feed?.start ?? iso(now - 20 * 60000),
        end: feed?.end ?? iso(now),
        amount: String(feed?.amount ?? 120),
        note: feed?.note ?? "",
        historyId: snapshot.historyId,
        membershipId: snapshot.family.membershipId,
        origin: originForSnapshot(snapshot),
      };
      break;
    }
    case "set-draft":
      family();
      if (!state.draft || state.draft.recordId !== action.draft.recordId)
        throw new Error("draft_changed");
      state.draft = {
        ...state.draft,
        start: action.draft.start,
        end: action.draft.end,
        amount: action.draft.amount,
        note: action.draft.note,
      };
      break;
    case "discard-draft":
      state.draft = null;
      break;
    case "save-draft": {
      const snapshot = family(),
        draft = state.draft;
      if (!draft) throw new Error("draft_changed");
      const input = feedFromDraft(draft, now),
        existing = snapshot.feeds.find((item) => item.id === draft.recordId);
      if (
        draft.baseVersion &&
        (!existing || existing.version !== draft.baseVersion)
      )
        throw new Error("record_changed");
      if (existing && !canEditSharedFeed(snapshot, existing))
        throw new Error("record_forbidden");
      const feed: SharedFeed = {
        ...input,
        id: draft.recordId,
        version: String(Number(existing?.version ?? "0") + 1),
        recordedBy: existing?.recordedBy ?? state.user!.id,
        lastEditedBy: state.user!.id,
      };
      snapshot.feeds = [
        feed,
        ...snapshot.feeds.filter((item) => item.id !== feed.id),
      ];
      state.draft = null;
      break;
    }
    case "delete-feed": {
      const snapshot = family(),
        feed = snapshot.feeds.find((item) => item.id === action.id);
      if (!feed) throw new Error("record_changed");
      if (!canEditSharedFeed(snapshot, feed))
        throw new Error("record_forbidden");
      snapshot.feeds = snapshot.feeds.filter((item) => item.id !== feed.id);
      break;
    }
  }
  return state;
}
