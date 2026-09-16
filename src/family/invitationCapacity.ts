import type { FamilyInvitation, FamilyMember } from "./contracts";

export const MAX_INVITED_FAMILY_MEMBERS = 5;

// Pending invitations reserve a place until accepted, declined, revoked or
// expired. Count people, not invitation rows; renewal must not consume a place.
export function familyInvitationCapacity(
  members: readonly Pick<FamilyMember, "role" | "status" | "email">[],
  invitations: readonly Pick<
    FamilyInvitation,
    "status" | "expiresAt" | "email"
  >[],
  now = Date.now(),
) {
  const active = members.filter((member) => member.status === "active");
  const activeEmails = new Set(
    active.flatMap((member) =>
      member.email ? [member.email.trim().toLowerCase()] : [],
    ),
  );
  const reserved = new Set(
    invitations
      .filter(
        (invite) =>
          invite.status === "pending" && Date.parse(invite.expiresAt) > now,
      )
      .map((invite) => invite.email.trim().toLowerCase())
      .filter((email) => !!email && !activeEmails.has(email)),
  );
  const activeMembers = active.filter(
    (member) => member.role !== "owner",
  ).length;
  const pendingInvitations = reserved.size;
  const used = activeMembers + pendingInvitations;
  return {
    limit: MAX_INVITED_FAMILY_MEMBERS,
    activeMembers,
    pendingInvitations,
    used,
    remaining: Math.max(0, MAX_INVITED_FAMILY_MEMBERS - used),
  };
}
