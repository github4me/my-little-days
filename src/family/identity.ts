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
