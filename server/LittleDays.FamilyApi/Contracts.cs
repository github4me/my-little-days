using System.Text.Json;
using System.Text.Json.Serialization;

namespace LittleDays.FamilyApi;

public sealed record FamilyUser(Guid Id, string DisplayName, string Email);
public sealed record FamilySummary(Guid Id, string BabyName, string Role, Guid MembershipId, string? BabyBirthDate, string ProfileVersion);
public sealed record FamilyMember(Guid Id, string DisplayName, string? Email, string Role, Guid MembershipId, string Status, DateTimeOffset? EndedAt);
public sealed record FamilyInvitation(Guid Id, string Email, DateTimeOffset ExpiresAt, string Status, string? DeclineReason = null);
public sealed record PendingFamilyInvitation(Guid Id, Guid FamilyId, string OwnerDisplayName, DateTimeOffset ExpiresAt);
public sealed record OwnershipTransfer(Guid Id, Guid FromUserId, Guid ToUserId, string Status, DateTimeOffset CreatedAt);
public sealed record AccountDeletion(Guid DeletionId, string Status, DateTimeOffset RequestedAt);
public sealed record DeleteAccountRequest(Guid OperationId, string ReceiptSecret);
public sealed record DeletionStatusRequest(Guid DeletionId, string ReceiptSecret);
public sealed record SharedFeedInput(DateTimeOffset Start, DateTimeOffset End, decimal Amount, string Note);
public sealed record SharedFeed(Guid Id, string Version, Guid RecordedBy, Guid LastEditedBy,
    DateTimeOffset Start, DateTimeOffset End, decimal Amount, string Note);
public sealed record FamilySnapshot(FamilySummary Family, Guid HistoryId, string Revision,
    FamilyMember[] Members, FamilyInvitation[] Invitations, SharedFeed[] Feeds, OwnershipTransfer? OwnershipTransfer);
public sealed record FeedOperation(Guid OperationId, Guid RecordId, Guid MembershipId, Guid HistoryId,
    string Kind, string? BaseVersion, SharedFeedInput? Feed);
public sealed record FeedReceipt(Guid OperationId, Guid HistoryId, string Revision);
public sealed record FullFamilyCapabilities(int SchemaVersion, string[] RecordKinds, int MaxSeedBytes, int ExtrasSchemaVersion = 1);
public sealed record FullFamilyProfile(string Name, string BirthDate, string Sex);
public sealed record SharedEntry(JsonElement Entry, string Version, Guid RecordedBy, Guid LastEditedBy);
public sealed record SharedCareRecord(JsonElement Record, string Version, Guid RecordedBy, Guid LastEditedBy);
public sealed record SharedExtraRecord(JsonElement Record, string Version, Guid RecordedBy, Guid LastEditedBy);
public sealed record FullFamilySnapshot(int SchemaVersion, FullFamilyProfile Profile,
    SharedEntry[] Entries, SharedCareRecord[] CareRecords, FamilySummary Family, Guid HistoryId, string Revision,
    FamilyMember[] Members, FamilyInvitation[] Invitations, SharedFeed[] Feeds, OwnershipTransfer? OwnershipTransfer,
    int ExtrasSchemaVersion = 1, SharedExtraRecord[]? ExtraRecords = null);
public sealed record CreateFullFamilyRequest(Guid OperationId, string ConsentRevision, JsonElement Seed, bool DeclinePendingInvitations = false);
public sealed record CreateFullFamilyResult(Guid OperationId, Guid FamilyId, Guid MembershipId, Guid HistoryId, string SeedDigest, FullFamilySnapshot Snapshot);
public sealed record FullRecordOperation(Guid OperationId, string RecordId, Guid MembershipId, Guid HistoryId,
    string Kind, string Collection, string? BaseVersion, JsonElement? Entry, JsonElement? CareRecord,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] JsonElement? ExtraRecord = null);
public sealed record FullProfileRequest(Guid OperationId, Guid? MembershipId, Guid? HistoryId,
    string BaseVersion, JsonElement Profile) : IGrantContext;
public sealed record CreateFamilyRequest(Guid OperationId, string BabyName);
public interface IGrantContext { Guid? MembershipId { get; } Guid? HistoryId { get; } }
public sealed record CreateInvitationRequest(Guid OperationId, string Email, Guid? MembershipId = null, Guid? HistoryId = null) : IGrantContext;
public sealed record OperationRequest(Guid OperationId, Guid? MembershipId = null, Guid? HistoryId = null, Guid? TargetMembershipId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] bool DeclineOtherInvitations = false,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)] int? RequiredSchemaVersion = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] int? RequiredExtrasSchemaVersion = null) : IGrantContext;
public sealed record ProfileRequest(Guid OperationId, string BaseVersion, string BabyName, string? BabyBirthDate, Guid? MembershipId = null, Guid? HistoryId = null) : IGrantContext;
public sealed record NominateOwnerRequest(Guid OperationId, Guid UserId, Guid? MembershipId = null, Guid? HistoryId = null) : IGrantContext;
public sealed record InvitationResult(FamilyInvitation Invitation);
public sealed record MeResult(FamilyUser User, FamilySummary[] Families, PendingFamilyInvitation[] PendingInvitations, AccountDeletion? AccountDeletion);
public sealed record OkResult(bool Ok = true);
public sealed class ApiException(int status, string code) : Exception(code)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}
