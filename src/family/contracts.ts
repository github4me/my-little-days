import type { State, Entry, CareRecord } from "../domain";
import type { OwnerSeedDraft } from "./ownerSeed";
import type { FamilyExtraRecord } from "./extras";
export type { FamilyExtraRecord } from "./extras";

export type SharedRecord<T> = {
  version: string;
  recordedBy: string;
  lastEditedBy: string;
} & T;
export type FullFamilySnapshot = FamilySnapshot & {
  schemaVersion: 2;
  // Older APIs omit this. Only explicit server timer enforcement enables the
  // additional Watch writer; ordinary iPhone recording remains compatible.
  watchRecordingEnabled?: boolean;
  profile: State["profile"];
  entries: SharedRecord<{ entry: Entry }>[];
  careRecords: SharedRecord<{ record: CareRecord }>[];
  extrasSchemaVersion?: 1;
  extraRecords?: SharedRecord<{ record: FamilyExtraRecord }>[];
};
export type FamilyCapabilities = {
  schemaVersion: 2;
  recordKinds: string[];
  maxSeedBytes: number;
  extrasSchemaVersion?: 1;
};
export type FamilyActivation = {
  operationId: string;
  familyId: string;
  membershipId: string;
  historyId: string;
  seedDigest: string;
  snapshot: FullFamilySnapshot;
};
export type CreateFullFamily = {
  operationId: string;
  consentRevision: "family-sharing-v1";
  declinePendingInvitations?: boolean;
  seed: OwnerSeedDraft;
};
export type RecordOperation = Omit<FeedOperation, "feed"> & {
  collection: "entry" | "care" | "extra";
  entry?: Entry;
  careRecord?: CareRecord;
  extraRecord?: FamilyExtraRecord;
};
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
  declineReason?: "created_family" | "joined_family" | null;
  acceptedMembershipId?: string | null;
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
