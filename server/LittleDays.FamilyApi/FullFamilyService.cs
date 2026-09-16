using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi;

public sealed partial class FamilyService
{
    private sealed record SeedCommitReceipt(string SeedDigest);
    public Task<CreateFullFamilyResult> CreateFullFamily(PilotIdentity user, CreateFullFamilyRequest request, CancellationToken ct) => Transaction(async () =>
    {
        await RequireAccount(user, ct);
        ValidateId(request.OperationId);
        if (request.ConsentRevision != "family-sharing-v1") Invalid();
        var seed = FullDomainValidation.Seed(request.Seed);
        if (seed.InviteeEmails.Contains(user.Email, StringComparer.Ordinal)) Invalid();
        // Keep existing durable receipts replayable for older clients that omit the new consent.
        var hash = request.DeclinePendingInvitations
            ? Fingerprint("create-family-v2", request)
            : Fingerprint("create-family-v2", new { request.OperationId, request.ConsentRevision, request.Seed });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null)
        {
            // The receipt contains no copy of the uploaded baby data. A retry reads only
            // the current authorized family, and cannot regrant a removed membership.
            var priorGrant = await RequireGrant(user, old.FamilyId, old.MembershipId, ct);
            var priorFamily = await Family(old.FamilyId, ct);
            RequireFullFamily(priorFamily);
            return new CreateFullFamilyResult(request.OperationId, priorFamily.Id, priorGrant.Id, config.Family.HistoryId, ReadResult<SeedCommitReceipt>(old).SeedDigest,
                await FullSnapshotData(priorFamily, priorGrant, ct));
        }
        if (await db.Memberships.AnyAsync(x => x.UserId == user.ObjectId && x.Active, ct))
            throw new ApiException(409, "already_in_family");
        var received = await LiveReceivedInvitations(user, Now).ToArrayAsync(ct);
        // A stale/older app must never silently reject invitations without the new warning.
        if (received.Length > 0 && !request.DeclinePendingInvitations)
            throw new ApiException(409, "invitation_decline_consent_required");
        foreach (var invitation in received)
        {
            // Internal terminal state fits the existing status column; public API still returns
            // "declined" plus a reason, so older clients display a safe terminal status.
            invitation.Status = "own_family";
            invitation.RecipientUserId = user.ObjectId;
        }
        foreach (var familyId in received.Select(x => x.FamilyId).Distinct())
            (await Family(familyId, ct)).Revision++;
        var family = new FamilyRow
        {
            Id = Guid.NewGuid(), SchemaVersion = 2, BabyName = seed.Profile.Name,
            BabyBirthDate = seed.Profile.BirthDate, BabySex = seed.Profile.Sex,
            Revision = 1, CreatedAt = Now
        };
        var grant = NewGrant(user, family.Id, "owner");
        db.Families.Add(family);
        db.Memberships.Add(grant);
        foreach (var entry in seed.Entries) db.FamilyRecords.Add(NewRecord(family.Id, "entry", entry, user.ObjectId));
        foreach (var care in seed.CareRecords) db.FamilyRecords.Add(NewRecord(family.Id, "care", care, user.ObjectId));
        foreach (var email in seed.InviteeEmails)
            db.Invitations.Add(new InvitationRow { Id = Guid.NewGuid(), FamilyId = family.Id, Email = email, CreatedAt = Now, ExpiresAt = Now.AddDays(30) });
        var seedDigest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(request.Seed.GetRawText()))).ToLowerInvariant();
        SaveReceipt(user, request.OperationId, family.Id, grant.Id, "create-family-v2", hash, new SeedCommitReceipt(seedDigest));
        // Flush to obtain SQL rowversions, still under the same transaction as the
        // family, profile, every imported record, invitations and durable receipt.
        await db.SaveChangesAsync(ct);
        return new CreateFullFamilyResult(request.OperationId, family.Id, grant.Id, config.Family.HistoryId, seedDigest,
            await FullSnapshotData(family, grant, ct));
    }, ct);

    public Task<FullFamilySnapshot> FullSnapshot(PilotIdentity user, Guid familyId, CancellationToken ct) => Transaction(async () =>
    {
        var grant = await RequireGrant(user, familyId, null, ct);
        var family = await Family(familyId, ct);
        RequireFullFamily(family);
        return await FullSnapshotData(family, grant, ct);
    }, ct);

    public Task<FeedReceipt> ApplyFullRecord(PilotIdentity user, Guid familyId, FullRecordOperation operation, CancellationToken ct) => Transaction(async () =>
    {
        var value = FullDomainValidation.Operation(operation);
        var grant = await RequireGrant(user, familyId, operation.MembershipId, ct);
        if (operation.HistoryId != config.Family.HistoryId) throw new ApiException(409, "history_changed");
        var family = await Family(familyId, ct);
        RequireFullFamily(family);
        var hash = Fingerprint("record-v2", new { familyId, operation });
        var old = await Receipt(user, operation.OperationId, hash, ct);
        if (old is not null) return ReadResult<FeedReceipt>(old);
        await CheckCapacity(familyId, ct);
        var idHash = RecordIdHash(operation.RecordId);
        var row = await db.FamilyRecords.SingleOrDefaultAsync(x => x.FamilyId == familyId && x.Collection == operation.Collection && x.IdHash == idHash, ct);
        if (operation.Kind == "create")
        {
            if (row is not null) throw new ApiException(412, "record_changed");
            if (await db.FamilyRecords.CountAsync(x => x.FamilyId == familyId && x.Collection == operation.Collection, ct) >= FullDomainValidation.MaxRecordsPerCollection) Invalid();
            row = NewRecord(familyId, operation.Collection, value!.Value, user.ObjectId);
            db.FamilyRecords.Add(row);
        }
        else
        {
            if (row is null || row.Deleted || Convert.ToBase64String(row.Version) != operation.BaseVersion)
                throw new ApiException(412, "record_changed");
            if (grant.Role != "owner" && row.RecordedBy != user.ObjectId) throw new ApiException(403, "record_forbidden");
            row.LastEditedBy = user.ObjectId;
            if (operation.Kind == "delete") row.Deleted = true;
            else row.RecordJson = JsonSerializer.Serialize(value!.Value, Json);
            // A logically unchanged accepted update still consumes the base rowversion.
            db.Entry(row).Property(x => x.LastEditedBy).IsModified = true;
        }
        family.Revision++;
        var result = new FeedReceipt(operation.OperationId, config.Family.HistoryId, Revision(family));
        SaveReceipt(user, operation.OperationId, familyId, grant.Id, "record-v2", hash, result);
        return result;
    }, ct);

    public Task<FamilySummary> UpdateFullProfile(PilotIdentity user, Guid familyId, FullProfileRequest request, CancellationToken ct) => Transaction(async () =>
    {
        ValidateId(request.OperationId);
        var grant = await RequireOwner(user, familyId, ct);
        RequireContext(request, grant);
        var profile = FullDomainValidation.Profile(request.Profile);
        if (!FullDomainValidation.RowVersion(request.BaseVersion)) Invalid();
        var family = await Family(familyId, ct);
        RequireFullFamily(family);
        var hash = Fingerprint("profile-v2", new { familyId, request });
        var old = await Receipt(user, request.OperationId, hash, ct);
        if (old is not null) return Summary(family, grant);
        await CheckCapacity(familyId, ct);
        if (Convert.ToBase64String(family.ProfileVersion) != request.BaseVersion) throw new ApiException(412, "profile_changed");
        family.BabyName = profile.Name;
        family.BabyBirthDate = profile.BirthDate;
        family.BabySex = profile.Sex;
        family.Revision++;
        SaveReceipt(user, request.OperationId, familyId, grant.Id, "profile-v2", hash, new OkResult());
        await db.SaveChangesAsync(ct);
        return Summary(family, grant);
    }, ct);

    private async Task<FullFamilySnapshot> FullSnapshotData(FamilyRow family, MembershipRow grant, CancellationToken ct)
    {
        var now = Now;
        var expired = await db.Invitations.Where(x => x.FamilyId == family.Id && x.Status == "pending" && x.ExpiresAt <= now).ToArrayAsync(ct);
        foreach (var invitation in expired) invitation.Status = "expired";
        if (expired.Length > 0)
        {
            family.Revision++;
            await db.SaveChangesAsync(ct);
        }
        var members = await db.Memberships.Where(x => x.FamilyId == family.Id && (x.Active || grant.Role == "owner")).OrderBy(x => x.GrantedAt).ToArrayAsync(ct);
        var invitations = grant.Role == "owner"
            ? await db.Invitations.Where(x => x.FamilyId == family.Id).OrderBy(x => x.Status == "pending" ? 0 : 1).ThenByDescending(x => x.CreatedAt).Take(100).ToArrayAsync(ct)
            : [];
        var records = await db.FamilyRecords.Where(x => x.FamilyId == family.Id && !x.Deleted).ToArrayAsync(ct);
        var transfer = await db.OwnershipTransfers.SingleOrDefaultAsync(x => x.FamilyId == family.Id && x.Status == "pending", ct);
        return new FullFamilySnapshot(2, new(family.BabyName, family.BabyBirthDate ?? "", family.BabySex),
            records.Where(x => x.Collection == "entry").OrderBy(x => x.Id, StringComparer.Ordinal)
                .Select(x => new SharedEntry(ReadRecord(x), Convert.ToBase64String(x.Version), x.RecordedBy, x.LastEditedBy)).ToArray(),
            records.Where(x => x.Collection == "care").OrderBy(x => x.Id, StringComparer.Ordinal)
                .Select(x => new SharedCareRecord(ReadRecord(x), Convert.ToBase64String(x.Version), x.RecordedBy, x.LastEditedBy)).ToArray(),
            Summary(family, grant), config.Family.HistoryId, Revision(family), members.Select(x => Member(x, grant.Role == "owner")).ToArray(),
            invitations.Select(Invitation).ToArray(), [], transfer is null ? null : Transfer(transfer));
    }

    private static FamilyRecordRow NewRecord(Guid familyId, string collection, JsonElement value, Guid author)
    {
        var id = value.GetProperty("id").GetString()!;
        return new() { FamilyId = familyId, Collection = collection, Id = id, IdHash = RecordIdHash(id),
            RecordJson = JsonSerializer.Serialize(value, Json), RecordedBy = author, LastEditedBy = author };
    }
    private static string RecordIdHash(string id) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(id)));
    private static JsonElement ReadRecord(FamilyRecordRow row)
    {
        using var json = JsonDocument.Parse(row.RecordJson);
        return json.RootElement.Clone();
    }
    private static void RequireFullFamily(FamilyRow family)
    {
        if (family.SchemaVersion != 2) throw new ApiException(409, "family_schema_unsupported");
    }
    private static void RequireLegacyFamily(FamilyRow family)
    {
        if (family.SchemaVersion != 1) throw new ApiException(409, "family_schema_unsupported");
    }
}
