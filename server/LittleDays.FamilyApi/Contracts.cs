namespace LittleDays.FamilyApi;

public sealed record FamilyUser(Guid Id, string DisplayName, string Email);
public sealed record FamilySummary(Guid Id, string BabyName, string Role, Guid MembershipId);
public sealed record FamilyMember(Guid Id, string DisplayName, string Email, string Role, Guid MembershipId);
public sealed record FamilyInvitation(Guid Id, string Email, DateTimeOffset ExpiresAt, string Status);
public sealed record SharedFeedInput(DateTimeOffset Start, DateTimeOffset End, decimal Amount, string Note);
public sealed record SharedFeed(Guid Id, string Version, Guid RecordedBy, Guid LastEditedBy,
    DateTimeOffset Start, DateTimeOffset End, decimal Amount, string Note);
public sealed record FamilySnapshot(FamilySummary Family, Guid HistoryId, string Revision,
    FamilyMember[] Members, FamilyInvitation[] Invitations, SharedFeed[] Feeds);
public sealed record FeedOperation(Guid OperationId, Guid RecordId, Guid MembershipId, Guid HistoryId,
    string Kind, string? BaseVersion, SharedFeedInput? Feed);
public sealed record FeedReceipt(Guid OperationId, Guid HistoryId, string Revision);
public sealed record CreateFamilyRequest(Guid OperationId, string BabyName);
public sealed record CreateInvitationRequest(Guid OperationId, string Email);
public sealed record AcceptInvitationRequest(Guid OperationId, string Token);
public sealed record OperationRequest(Guid OperationId);
public sealed record InvitationResult(FamilyInvitation Invitation, string InviteUrl);
public sealed record MeResult(FamilyUser User, FamilySummary[] Families);
public sealed record OkResult(bool Ok = true);
public sealed class ApiException(int status, string code) : Exception(code)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}
