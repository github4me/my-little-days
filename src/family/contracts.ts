// Invitation pilot wire contract. This space never reads/writes the local baby State.
export type FamilyRole = "owner" | "caregiver";
export type FamilyUser = { id: string; displayName: string; email: string };
export type FamilySummary = {
  id: string;
  babyName: string;
  role: FamilyRole;
  membershipId: string;
};
export type FamilyMember = FamilyUser & {
  role: FamilyRole;
  membershipId: string;
};
export type FamilyInvitation = {
  id: string;
  email: string;
  expiresAt: string;
  status: "pending" | "accepted" | "revoked" | "expired";
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
