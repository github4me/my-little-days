// Invitation pilot wire contract. This space never reads/writes the local baby State.
export type FamilyRole = "owner" | "caregiver";
export type FamilyUser = { id: string; displayName: string; email: string };
export type FamilySummary = {
  id: string;
  babyName: string;
  role: FamilyRole;
  membershipId: string;
  babyBirthDate: string | null;
  profileVersion: string;
};
export type FamilyMember = Omit<FamilyUser, "email"> & {
  email: string | null;
  role: FamilyRole;
  membershipId: string;
  status: "active" | "left" | "removed";
  endedAt: string | null;
};
export type FamilyInvitation = {
  id: string;
  email: string;
  expiresAt: string;
  status: "pending" | "accepted" | "revoked" | "expired" | "declined";
};
export type PendingFamilyInvitation = {
  id: string;
  familyId: string;
  ownerDisplayName: string;
  expiresAt: string;
};
export type OwnershipTransfer = {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: "pending";
  createdAt: string;
};
export type AccountDeletion = {
  deletionId: string;
  status: "pending" | "awaiting_identity_deletion" | "completed";
  requestedAt: string;
};
export type SharedFeedInput = {
  start: string;
  end: string;
  amount: number;
  note: string;
};
export type SharedFeed = SharedFeedInput & {
  id: string;
  version: string;
  recordedBy: string;
  lastEditedBy: string;
};
export type FamilySnapshot = {
  family: FamilySummary;
  historyId: string;
  revision: string;
  members: FamilyMember[];
  invitations: FamilyInvitation[];
  feeds: SharedFeed[];
  ownershipTransfer: OwnershipTransfer | null;
};
export type FeedOperation = {
  operationId: string;
  recordId: string;
  membershipId: string;
  historyId: string;
  kind: "create" | "update" | "delete";
  baseVersion?: string;
  feed?: SharedFeedInput;
};
export type FeedReceipt = {
  operationId: string;
  historyId: string;
  revision: string;
};
export type FamilyApiError = { code: string };
