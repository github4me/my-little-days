import type {
  FamilyUser,
  FamilySummary,
  PendingFamilyInvitation,
  AccountDeletion,
} from "./contracts";
export type PilotIdentity = {
  user: FamilyUser;
  families: FamilySummary[];
  pendingInvitations: PendingFamilyInvitation[];
  accountDeletion: AccountDeletion | null;
};

// This response recognizes only the JWT subject. Account admission, deletion
// and family permissions are still unknown until /v1/me and the snapshot.
export type TokenSession = {
  status: "token_valid";
  userId: string;
  accountAccess: "pending";
  familyAccess: "pending";
};
