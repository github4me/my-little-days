using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi;

public sealed partial class FamilyService
{
    private sealed record SeedCommitReceipt(string SeedDigest);
    public Task<CreateFullFamilyResult> CreateFullFamily(PilotIdentity user, CreateFullFamilyRequest request, CancellationToken ct)
    {
        // Bound/validate/hash caller data before taking the cross-family lifecycle
        // barrier. Only authorization, receipt decisions and the commit need it.
        ValidateId(request.OperationId);
        if (request.ConsentRevision != "family-sharing-v1") Invalid();
        var seed = FullDomainValidation.Seed(request.Seed);
        if (seed.InviteeEmails.Contains(user.Email, StringComparer.Ordinal)) Invalid();
        // Keep existing durable receipts replayable for older clients that omit the new consent.
        var hash = request.DeclinePendingInvitations
            ? Fingerprint("create-family-v2", request)
            : Fingerprint("create-family-v2", new { request.OperationId, request.ConsentRevision, request.Seed });
        var imported = seed.Entries.Select(x => NewRecord(Guid.Empty, "entry", x, user.ObjectId))
            .Concat(seed.CareRecords.Select(x => NewRecord(Guid.Empty, "care", x, user.ObjectId)))
            .Concat(seed.ExtraRecords.Select(x => NewRecord(Guid.Empty, "extra", x, user.ObjectId))).ToArray();
        var storedBytes = imported.Sum(x => 2L * x.RecordJson.Length);
        var responseBytes = imported.Sum(x => (long)Encoding.UTF8.GetByteCount(x.RecordJson));
        var seedDigest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(request.Seed.GetRawText()))).ToLowerInvariant();
        return Transaction(async () =>
        {
            await RequireAccount(user, ct);
            var old = await Receipt(user, request.OperationId, hash, ct);
            if (old is not null)
            {
                // The receipt contains no copy of the uploaded baby data. A retry reads only
                // the current authorized family, and cannot regrant a removed membership.
                var priorGrant = await RequireGrant(user, old.FamilyId, old.MembershipId, ct);
                var priorFamily = await Family(old.FamilyId, ct);
                RequireFullFamily(priorFamily);
                return FamilyAvailability.RequireResponseBudget(new CreateFullFamilyResult(request.OperationId, priorFamily.Id, priorGrant.Id, config.Family.HistoryId, ReadResult<SeedCommitReceipt>(old).SeedDigest,
                    await FullSnapshotData(priorFamily, priorGrant, ct)));
            }
            if (await db.Memberships.AnyAsync(x => x.UserId == user.ObjectId && x.Active, ct))
                throw new ApiException(409, "already_in_family");
            await CheckCreationCapacity(user, ct);
            FamilyAvailability.RequireBudget(storedBytes, responseBytes, imported.Length, imported.Length);
            // Enforce the current policy only for a new commit. Older committed seeds
            // remain replayable through their durable receipt without re-uploading data.
            if (seed.InviteeEmails.Length >= config.Pilot.EffectiveMaxMembers)
                throw new ApiException(409, "invitation_limit");
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
            await AdvanceInvitationFamilyRevisions(received, ct);
            var family = new FamilyRow
            {
                Id = Guid.NewGuid(),
                SchemaVersion = 2,
                BabyName = seed.Profile.Name,
                BabyBirthDate = seed.Profile.BirthDate,
                BabySex = seed.Profile.Sex,
                Revision = 1,
                CreatedAt = Now
            };
            var grant = NewGrant(user, family.Id, "owner");
            db.Families.Add(family);
            db.Memberships.Add(grant);
            foreach (var record in imported) { record.FamilyId = family.Id; db.FamilyRecords.Add(record); }
            foreach (var email in seed.InviteeEmails)
                db.Invitations.Add(new InvitationRow { Id = Guid.NewGuid(), FamilyId = family.Id, Email = email, CreatedAt = Now, ExpiresAt = Now.AddDays(30) });
            SaveReceipt(user, request.OperationId, family.Id, grant.Id, "create-family-v2", hash, new SeedCommitReceipt(seedDigest));
            // Flush to obtain SQL rowversions, still under the same transaction as the
            // family, profile, every imported record, invitations and durable receipt.
            await db.SaveChangesAsync(ct);
            return FamilyAvailability.RequireResponseBudget(new CreateFullFamilyResult(request.OperationId, family.Id, grant.Id, config.Family.HistoryId, seedDigest,
                await FullSnapshotData(family, grant, ct)));
        }, ct);
    }

    public async Task<FullFamilySnapshot> FullSnapshot(PilotIdentity user, Guid familyId, CancellationToken ct) =>
        (await ConditionalFullSnapshot(user, familyId, null, ct)).Snapshot!;

    public Task<ConditionalSnapshot<FullFamilySnapshot>> ConditionalFullSnapshot(PilotIdentity user, Guid familyId, string? ifNoneMatch, CancellationToken ct) => FamilyTransaction(familyId, async () =>
    {
        var grant = await RequireGrant(user, familyId, null, ct);
        var family = await Family(familyId, ct);
        RequireFullFamily(family);
        await ExpireInvitations(family, ct);
        // The capability is current host configuration, not part of a family's
        // data revision. A gate change must invalidate a cached enabled result.
        var etag = $"\"v2-extras1-watch{(config.Family.EnforceSingleActiveTimers ? 1 : 0)}:{config.Family.HistoryId:D}:{Revision(family)}:{grant.Id:D}\"";
        if (ifNoneMatch == etag) return new ConditionalSnapshot<FullFamilySnapshot>(etag, null);
        return new ConditionalSnapshot<FullFamilySnapshot>(etag, await FullSnapshotData(family, grant, ct, expire: false));
    }, ct);

    public Task<FeedReceipt> ApplyFullRecord(PilotIdentity user, Guid familyId, FullRecordOperation operation, CancellationToken ct)
    {
        var value = FullDomainValidation.Operation(operation);
        var hash = Fingerprint("record-v2", new { familyId, operation });
        var json = value is null ? null : RecordJson(operation.Collection, value.Value);
        return FamilyTransaction(familyId, async () =>
        {
            var grant = await RequireGrant(user, familyId, operation.MembershipId, ct);
            if (operation.HistoryId != config.Family.HistoryId) throw new ApiException(409, "history_changed");
            var family = await Family(familyId, ct);
            RequireFullFamily(family);
            var old = await Receipt(user, operation.OperationId, hash, ct);
            if (old is not null) return ReadResult<FeedReceipt>(old);
            if (operation.Collection == "extra" && FullDomainValidation.IsExtraSingleton(operation.RecordId) && grant.Role != "owner")
                throw new ApiException(403, "record_forbidden");
            if (operation.Kind != "delete") await CheckCapacity(familyId, ct);
            var idHash = RecordIdHash(operation.RecordId);
            var row = await db.FamilyRecords.SingleOrDefaultAsync(x => x.FamilyId == familyId && x.Collection == operation.Collection && x.IdHash == idHash, ct);
            if (operation.Collection == "entry" && value is not null) await GuardActiveTimer(familyId, operation.RecordId, value.Value, ct);
            if (operation.Kind == "create")
            {
                if (row is not null) throw new ApiException(412, "record_changed");
                await CheckRecordBudget(familyId, null, json!, ct);
                row = NewRecord(familyId, operation.Collection, value!.Value, user.ObjectId, json);
                db.FamilyRecords.Add(row);
                await QueueRecordPush(user, family, operation, value!.Value, ct);
            }
            else
            {
                if (row is null || row.Deleted || Convert.ToBase64String(row.Version) != operation.BaseVersion)
                    throw new ApiException(412, "record_changed");
                if (grant.Role != "owner" && row.RecordedBy != user.ObjectId) throw new ApiException(403, "record_forbidden");
                if (operation.Collection == "extra" && value is not null &&
                    ReadRecord(row).GetProperty("kind").GetString() != value.Value.GetProperty("kind").GetString()) Invalid();
                if (operation.Kind != "delete") await CheckRecordBudget(familyId, row, json!, ct);
                row.LastEditedBy = user.ObjectId;
                if (operation.Kind == "delete")
                {
                    row.Deleted = true; row.RecordJson = "{}";
                    if (operation.Collection == "entry") await CancelRecordPush(familyId, operation.RecordId, ct);
                }
                else
                {
                    if (operation.Collection == "entry")
                    {
                        var previous = ReadRecord(row);
                        var affectsPush = PushPolicy.Categories.Contains(previous.GetProperty("type").GetString()!) ||
                            PushPolicy.Categories.Contains(value!.Value.GetProperty("type").GetString()!);
                        if (affectsPush && !JsonElement.DeepEquals(previous, value!.Value))
                        {
                            // Replace unsent notices with the latest state/actor, including category
                            // changes. A replay or a logically unchanged save must not alert again.
                            await CancelRecordPush(familyId, operation.RecordId, ct);
                            await QueueRecordPush(user, family, operation, value.Value, ct);
                        }
                    }
                    row.RecordJson = json!;
                }
                // A logically unchanged accepted update still consumes the base rowversion.
                db.Entry(row).Property(x => x.LastEditedBy).IsModified = true;
            }
            family.Revision++;
            var result = new FeedReceipt(operation.OperationId, config.Family.HistoryId, Revision(family));
            SaveReceipt(user, operation.OperationId, familyId, grant.Id, "record-v2", hash, result);
            return result;
        }, ct);
    }

    public Task<FamilySummary> UpdateFullProfile(PilotIdentity user, Guid familyId, FullProfileRequest request, CancellationToken ct) => FamilyTransaction(familyId, async () =>
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

    private async Task<FullFamilySnapshot> FullSnapshotData(FamilyRow family, MembershipRow grant, CancellationToken ct, bool expire = true)
    {
        if (expire) await ExpireInvitations(family, ct);
        await CheckRecordBudget(family.Id, null, null, ct);
        await CheckMemberSnapshotCapacity(family.Id, ct);
        var members = await db.Memberships.Where(x => x.FamilyId == family.Id && (x.Active || grant.Role == "owner")).OrderBy(x => x.GrantedAt).ToArrayAsync(ct);
        var invitations = grant.Role == "owner"
            ? await db.Invitations.Where(x => x.FamilyId == family.Id).OrderBy(x => x.Status == "pending" ? 0 : 1).ThenByDescending(x => x.CreatedAt).Take(100).ToArrayAsync(ct)
            : [];
        var records = await db.FamilyRecords.Where(x => x.FamilyId == family.Id && !x.Deleted).ToArrayAsync(ct);
        var transfer = await db.OwnershipTransfers.SingleOrDefaultAsync(x => x.FamilyId == family.Id && x.Status == "pending", ct);
        var snapshot = new FullFamilySnapshot(2, new(family.BabyName, family.BabyBirthDate ?? "", family.BabySex),
            records.Where(x => x.Collection == "entry").OrderBy(x => x.Id, StringComparer.Ordinal)
                .Select(x => new SharedEntry(ReadRecord(x), Convert.ToBase64String(x.Version), x.RecordedBy, x.LastEditedBy)).ToArray(),
            records.Where(x => x.Collection == "care").OrderBy(x => x.Id, StringComparer.Ordinal)
                .Select(x => new SharedCareRecord(ReadRecord(x), Convert.ToBase64String(x.Version), x.RecordedBy, x.LastEditedBy)).ToArray(),
            Summary(family, grant), config.Family.HistoryId, Revision(family), members.Select(x => Member(x, grant.Role == "owner")).ToArray(),
            invitations.Select(Invitation).ToArray(), [], transfer is null ? null : Transfer(transfer), 1,
            records.Where(x => x.Collection == "extra").OrderBy(x => x.Id, StringComparer.Ordinal)
                .Select(x => new SharedExtraRecord(ReadRecord(x), Convert.ToBase64String(x.Version), x.RecordedBy, x.LastEditedBy)).ToArray(),
            config.Family.EnforceSingleActiveTimers);
        return FamilyAvailability.RequireResponseBudget(snapshot);
    }

    private sealed class RecordUsage
    {
        public int Records { get; set; }
        public int LiveRecords { get; set; }
        public long StoredBytes { get; set; }
    }
    private async Task CheckRecordBudget(Guid familyId, FamilyRecordRow? replaced, string? addedJson, CancellationToken ct)
    {
        // Aggregate in SQL before loading any record bodies. DATALENGTH of an LOB
        // does not require parsing/allocating its JSON in the API. Reject oversized
        // legacy data before the more costly UTF-8 response-size calculation.
        var usage = await db.Database.SqlQuery<RecordUsage>($"""
            SELECT COUNT(*) AS Records,
                COALESCE(SUM(CASE WHEN Deleted = 0 THEN 1 ELSE 0 END), 0) AS LiveRecords,
                COALESCE(SUM(CONVERT(bigint, DATALENGTH(RecordJson))), 0) AS StoredBytes
            FROM dbo.FamilyRecords WHERE FamilyId = {familyId}
            """).SingleAsync(ct);
        var stored = usage.StoredBytes - (replaced is null ? 0 : 2L * replaced.RecordJson.Length) + (addedJson is null ? 0 : 2L * addedJson.Length);
        var count = usage.Records + (addedJson is not null && replaced is null ? 1 : 0);
        var liveCount = usage.LiveRecords + (addedJson is not null && replaced is null ? 1 : 0);
        var growingCount = addedJson is not null && replaced is null;
        var reducing = replaced is not null && addedJson is not null && addedJson.Length <= replaced.RecordJson.Length &&
            FamilyAvailability.MeasureRecordResponse(addedJson) <= FamilyAvailability.MeasureRecordResponse(replaced.RecordJson);
        // Legacy histories over the new count cap can still read/edit/delete.
        // Oversized legacy payloads can be reduced without permitting further
        // growth; a snapshot remains explicitly blocked until it fits safely.
        if (reducing) return;
        FamilyAvailability.RequireBudget(stored, 0, count, liveCount, growingCount);
        var jsonBytes = await db.Database.SqlQuery<long>($"""
            SELECT COALESCE(SUM(CONVERT(bigint, DATALENGTH(CONVERT(varchar(max), RecordJson COLLATE Latin1_General_100_BIN2_UTF8)))), 0) AS Value
            FROM dbo.FamilyRecords WHERE FamilyId = {familyId} AND Deleted = 0 AND Collection <> 'extra'
            """).SingleAsync(ct);
        // Older extras preserved raw JSON. Some Unicode characters are escaped
        // even by the relaxed encoder, so raw UTF-8 length is not a safe estimate.
        // This pass is bounded by the storage/count preflight above; new extras
        // are stored canonically, without inflating photo base64 '+' characters.
        await foreach (var json in db.FamilyRecords.AsNoTracking().Where(x => x.FamilyId == familyId && !x.Deleted && x.Collection == "extra")
            .Select(x => x.RecordJson).AsAsyncEnumerable().WithCancellation(ct))
            jsonBytes += FamilyAvailability.MeasureRecordResponse(json);
        jsonBytes -= replaced is null ? 0 : replaced.Collection == "extra"
            ? FamilyAvailability.MeasureRecordResponse(replaced.RecordJson) : Encoding.UTF8.GetByteCount(replaced.RecordJson);
        jsonBytes += addedJson is null ? 0 : Encoding.UTF8.GetByteCount(addedJson);
        FamilyAvailability.RequireBudget(stored, jsonBytes, count, liveCount, growingCount);
    }

    private static FamilyRecordRow NewRecord(Guid familyId, string collection, JsonElement value, Guid author, string? json = null)
    {
        var id = value.GetProperty("id").GetString()!;
        return new()
        {
            FamilyId = familyId,
            Collection = collection,
            Id = id,
            IdHash = RecordIdHash(id),
            RecordJson = json ?? RecordJson(collection, value),
            RecordedBy = author,
            LastEditedBy = author
        };
    }
    // Canonical response encoding makes byte accounting stable while avoiding
    // default HTML escaping of base64 '+' that could exceed the avatar SQL cap.
    private static string RecordJson(string collection, JsonElement value) =>
        JsonSerializer.Serialize(value, collection == "extra" ? FamilyAvailability.SnapshotJson : Json);
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
