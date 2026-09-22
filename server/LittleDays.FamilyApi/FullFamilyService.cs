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

    public Task<ConditionalSnapshot<FullFamilySnapshot>> ConditionalFullSnapshot(PilotIdentity user, Guid familyId, string? ifNoneMatch, CancellationToken ct, int careSchemaVersion = 2) => FamilyTransaction(familyId, async () =>
    {
        var grant = await RequireGrant(user, familyId, null, ct);
        var family = await Family(familyId, ct);
        RequireFullFamily(family);
        await ExpireInvitations(family, ct);
        // The capability is current host configuration, not part of a family's
        // data revision. A gate change must invalidate a cached enabled result.
        var etag = $"\"v2-extras1-care{careSchemaVersion}-watch{(config.Family.EnforceSingleActiveTimers ? 1 : 0)}-cross-timer1-replace1:{config.Family.HistoryId:D}:{Revision(family)}:{grant.Id:D}\"";
        if (ifNoneMatch == etag) return new ConditionalSnapshot<FullFamilySnapshot>(etag, null);
        return new ConditionalSnapshot<FullFamilySnapshot>(etag, (await FullSnapshotData(family, grant, ct, expire: false)).ForCareSchema(careSchemaVersion));
    }, ct);

    private sealed record RecordConflictReceipt(string BaseVersion, string CurrentVersion,
        Guid? ReplacesOperationId, string? TimerCompletion);
    private sealed record RecordApplyOutcome(FeedReceipt? Receipt = null, string? Error = null);

    public async Task<FeedReceipt> ApplyFullRecord(PilotIdentity user, Guid familyId, FullRecordOperation operation, CancellationToken ct)
    {
        var value = FullDomainValidation.Operation(operation);
        var hash = Fingerprint("record-v2", new { familyId, operation });
        var json = value is null ? null : RecordJson(operation.Collection, value.Value);
        var outcome = await FamilyTransaction(familyId, async () =>
        {
            var grant = await RequireGrant(user, familyId, operation.MembershipId, ct);
            if (operation.HistoryId != config.Family.HistoryId) throw new ApiException(409, "history_changed");
            var family = await Family(familyId, ct);
            RequireFullFamily(family);
            var old = await Receipt(user, operation.OperationId, hash, ct);
            if (old is not null)
                return old.Action == "record-conflict-v2"
                    ? new RecordApplyOutcome(Error: "record_changed")
                    : new RecordApplyOutcome(ReadResult<FeedReceipt>(old));
            if (operation.Collection == "extra" && FullDomainValidation.IsExtraSingleton(operation.RecordId) && grant.Role != "owner")
                throw new ApiException(403, "record_forbidden");
            if (operation.Kind != "delete") await CheckCapacity(familyId, ct);
            RecordConflictReceipt? replacement = null;
            if (operation.ReplacesOperationId is Guid replacedOperationId)
            {
                var source = await db.Operations.SingleOrDefaultAsync(x =>
                    x.UserId == user.ObjectId && x.OperationId == replacedOperationId, ct);
                if (source is null || source.Action != "record-conflict-v2" || source.FamilyId != familyId ||
                    source.MembershipId != operation.MembershipId || source.HistoryId != operation.HistoryId)
                    throw new ApiException(409, "conflict_resolution_unavailable");
                replacement = ReadResult<RecordConflictReceipt>(source);
                if (operation.BaseVersion != replacement.CurrentVersion ||
                    operation.TimerCompletion != replacement.TimerCompletion)
                    throw new ApiException(409, "conflict_resolution_changed");
                var original = operation with
                {
                    OperationId = replacedOperationId,
                    BaseVersion = replacement.BaseVersion,
                    ReplacesOperationId = replacement.ReplacesOperationId,
                    TimerCompletion = replacement.TimerCompletion
                };
                var originalHash = Fingerprint("record-v2", new { familyId, operation = original });
                if (source.Fingerprint != originalHash)
                    throw new ApiException(409, "conflict_resolution_changed");
            }
            var idHash = RecordIdHash(operation.RecordId);
            var row = await db.FamilyRecords.SingleOrDefaultAsync(x => x.FamilyId == familyId && x.Collection == operation.Collection && x.IdHash == idHash, ct);
            if (operation.Kind == "create")
            {
                if (row is not null) throw new ApiException(412, "record_changed");
                if (operation.Collection == "entry") await GuardActiveTimer(familyId, operation.RecordId, value!.Value, ct);
                await CheckRecordBudget(familyId, null, json!, ct);
                row = NewRecord(familyId, operation.Collection, value!.Value, user.ObjectId, json);
                db.FamilyRecords.Add(row);
                await QueueRecordPush(user, family, operation, value!.Value, ct);
            }
            else
            {
                if (row is null || row.Deleted || Convert.ToBase64String(row.Version) != operation.BaseVersion)
                {
                    if (row is not null && !row.Deleted && value is not null &&
                        CanOfferConflictReplacement(grant, user, row, operation, value.Value))
                    {
                        var currentVersion = Convert.ToBase64String(row.Version);
                        SaveReceipt(user, operation.OperationId, familyId, grant.Id, "record-conflict-v2", hash,
                            new RecordConflictReceipt(operation.BaseVersion!, currentVersion,
                                operation.ReplacesOperationId, operation.TimerCompletion));
                        return new RecordApplyOutcome(Error: "record_changed");
                    }
                    throw new ApiException(412, "record_changed");
                }
                var previous = ReadRecord(row);
                var timerCompletion = operation.Collection == "entry" && value is not null &&
                    IsTimerCompletion(previous, value.Value);
                var competingTimerReplacement = replacement?.TimerCompletion is not null && value is not null &&
                    IsCompetingTimerCompletion(previous, value.Value, replacement.TimerCompletion);
                if (operation.TimerCompletion is not null && replacement is null && !timerCompletion) Invalid();
                if (grant.Role != "owner" && row.RecordedBy != user.ObjectId &&
                    !(timerCompletion && IsPureTimerCompletion(previous, value!.Value)) && !competingTimerReplacement)
                    throw new ApiException(403, "record_forbidden");
                if (operation.Collection == "extra" && value is not null &&
                    previous.GetProperty("kind").GetString() != value.Value.GetProperty("kind").GetString()) Invalid();
                if (operation.Collection == "entry" && value is not null)
                    await GuardActiveTimer(familyId, operation.RecordId, value.Value, ct);
                var replacementJson = replacement is null || value is null ? null : ReplacementJson(previous, value.Value);
                if (operation.Kind != "delete") await CheckRecordBudget(familyId, row, json!, ct, replacementJson);
                var previousEditor = row.LastEditedBy;
                row.LastEditedBy = user.ObjectId;
                if (operation.Kind == "delete")
                {
                    row.Deleted = true; row.RecordJson = "{}"; row.TimerEndedBy = null;
                    ClearConflictReplacement(row);
                    if (operation.Collection == "entry") await CancelRecordPush(familyId, operation.RecordId, ct);
                }
                else
                {
                    if (operation.Collection == "entry")
                    {
                        var affectsPush = PushPolicy.Categories.Contains(previous.GetProperty("type").GetString()!) ||
                            PushPolicy.Categories.Contains(value!.Value.GetProperty("type").GetString()!);
                        if (affectsPush && !JsonElement.DeepEquals(previous, value!.Value))
                        {
                            // Replace unsent notices with the latest state/actor, including category
                            // changes. A replay or a logically unchanged save must not alert again.
                            await CancelRecordPush(familyId, operation.RecordId, ct);
                            await QueueRecordPush(user, family, operation, value.Value, ct);
                        }
                        if (timerCompletion || competingTimerReplacement) row.TimerEndedBy = user.ObjectId;
                        else if (!PreservesTimerCompletion(previous, value!.Value)) row.TimerEndedBy = null;
                    }
                    row.RecordJson = json!;
                    if (replacement is not null)
                    {
                        row.ConflictReplacedBy = user.ObjectId;
                        row.ConflictPreviousEditedBy = previousEditor;
                        row.ConflictReplacedAt = Now;
                        row.ConflictPreviousJson = replacementJson;
                    }
                    else ClearConflictReplacement(row);
                }
                // A logically unchanged accepted update still consumes the base rowversion.
                db.Entry(row).Property(x => x.LastEditedBy).IsModified = true;
            }
            family.Revision++;
            var result = new FeedReceipt(operation.OperationId, config.Family.HistoryId, Revision(family));
            SaveReceipt(user, operation.OperationId, familyId, grant.Id, "record-v2", hash, result);
            return new RecordApplyOutcome(result);
        }, ct);
        if (outcome.Error is not null) throw new ApiException(412, outcome.Error);
        return outcome.Receipt!;
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
                .Select(x => new SharedEntry(ReadRecord(x), Convert.ToBase64String(x.Version), x.RecordedBy, x.LastEditedBy,
                    x.TimerEndedBy, ReadReplacement(x))).ToArray(),
            records.Where(x => x.Collection == "care").OrderBy(x => x.Id, StringComparer.Ordinal)
                .Select(x => new SharedCareRecord(ReadRecord(x), Convert.ToBase64String(x.Version), x.RecordedBy, x.LastEditedBy)).ToArray(),
            Summary(family, grant), config.Family.HistoryId, Revision(family), members.Select(x => Member(x, grant.Role == "owner")).ToArray(),
            invitations.Select(Invitation).ToArray(), [], transfer is null ? null : Transfer(transfer), 1,
            records.Where(x => x.Collection == "extra").OrderBy(x => x.Id, StringComparer.Ordinal)
                .Select(x => new SharedExtraRecord(ReadRecord(x), Convert.ToBase64String(x.Version), x.RecordedBy, x.LastEditedBy)).ToArray(),
            config.Family.EnforceSingleActiveTimers, CrossMemberTimerCompletionEnabled: true,
            ConflictReplacementEnabled: true);
        return FamilyAvailability.RequireResponseBudget(snapshot);
    }

    private sealed class RecordUsage
    {
        public int Records { get; set; }
        public int LiveRecords { get; set; }
        public int AuditRecords { get; set; }
        public long StoredBytes { get; set; }
    }
    private async Task CheckRecordBudget(Guid familyId, FamilyRecordRow? replaced, string? addedJson,
        CancellationToken ct, string? addedAuditJson = null)
    {
        // Aggregate in SQL before loading any record bodies. DATALENGTH of an LOB
        // does not require parsing/allocating its JSON in the API. Reject oversized
        // legacy data before the more costly UTF-8 response-size calculation.
        var usage = await db.Database.SqlQuery<RecordUsage>($"""
            SELECT COUNT(*) AS Records,
                COALESCE(SUM(CASE WHEN Deleted = 0 THEN 1 ELSE 0 END), 0) AS LiveRecords,
                COALESCE(SUM(CASE WHEN Deleted = 0 AND ConflictPreviousJson IS NOT NULL THEN 1 ELSE 0 END), 0) AS AuditRecords,
                COALESCE(SUM(CONVERT(bigint, DATALENGTH(RecordJson)) + COALESCE(DATALENGTH(ConflictPreviousJson), 0)), 0) AS StoredBytes
            FROM dbo.FamilyRecords WHERE FamilyId = {familyId}
            """).SingleAsync(ct);
        var stored = usage.StoredBytes - (replaced is null ? 0 : 2L *
            (replaced.RecordJson.Length + (replaced.ConflictPreviousJson?.Length ?? 0))) +
            (addedJson is null ? 0 : 2L * (addedJson.Length + (addedAuditJson?.Length ?? 0)));
        var count = usage.Records + (addedJson is not null && replaced is null ? 1 : 0);
        var liveCount = usage.LiveRecords + (addedJson is not null && replaced is null ? 1 : 0);
        var growingCount = addedJson is not null && replaced is null;
        var oldResponseBytes = replaced is null ? 0 : FamilyAvailability.MeasureRecordResponse(replaced.RecordJson) +
            (replaced.ConflictPreviousJson is null ? 0 : Encoding.UTF8.GetByteCount(replaced.ConflictPreviousJson) + 256);
        var newResponseBytes = addedJson is null ? 0 : FamilyAvailability.MeasureRecordResponse(addedJson) +
            (addedAuditJson is null ? 0 : Encoding.UTF8.GetByteCount(addedAuditJson) + 256);
        var reducing = replaced is not null && addedJson is not null &&
            addedJson.Length + (addedAuditJson?.Length ?? 0) <=
                replaced.RecordJson.Length + (replaced.ConflictPreviousJson?.Length ?? 0) &&
            newResponseBytes <= oldResponseBytes;
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
        jsonBytes += await db.Database.SqlQuery<long>($"""
            SELECT COALESCE(SUM(CONVERT(bigint, DATALENGTH(CONVERT(varchar(max), ConflictPreviousJson COLLATE Latin1_General_100_BIN2_UTF8)))), 0) AS Value
            FROM dbo.FamilyRecords WHERE FamilyId = {familyId} AND Deleted = 0 AND ConflictPreviousJson IS NOT NULL
            """).SingleAsync(ct);
        jsonBytes += (long)usage.AuditRecords * 256;
        jsonBytes -= replaced is null ? 0 : replaced.Collection == "extra"
            ? FamilyAvailability.MeasureRecordResponse(replaced.RecordJson) : Encoding.UTF8.GetByteCount(replaced.RecordJson);
        if (replaced?.ConflictPreviousJson is not null)
            jsonBytes -= Encoding.UTF8.GetByteCount(replaced.ConflictPreviousJson) + 256;
        jsonBytes += addedJson is null ? 0 : Encoding.UTF8.GetByteCount(addedJson);
        if (addedAuditJson is not null) jsonBytes += Encoding.UTF8.GetByteCount(addedAuditJson) + 256;
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

    private static bool CanOfferConflictReplacement(MembershipRow grant, PilotIdentity user,
        FamilyRecordRow row, FullRecordOperation operation, JsonElement intended)
    {
        if (operation.Kind != "update" || operation.Collection != "entry") return false;
        var current = ReadRecord(row);
        var kind = current.GetProperty("type").GetString();
        if (kind is not ("feed" or "sleep") || intended.GetProperty("type").GetString() != kind) return false;
        if (grant.Role == "owner" || row.RecordedBy == user.ObjectId) return true;
        return operation.TimerCompletion == kind && IsCompetingTimerCompletion(current, intended, kind);
    }

    private static bool IsCompetingTimerCompletion(JsonElement current, JsonElement intended, string kind)
    {
        if (kind is not ("feed" or "sleep") ||
            current.GetProperty("type").GetString() != kind || intended.GetProperty("type").GetString() != kind ||
            !current.TryGetProperty("end", out _) || !intended.TryGetProperty("end", out _) ||
            current.TryGetProperty("feedRunning", out _) || intended.TryGetProperty("feedRunning", out _)) return false;
        return IsPureTimerCompletionFields(current, intended, kind);
    }

    private static bool IsPureTimerCompletionFields(JsonElement previous, JsonElement next, string kind)
    {
        static bool Same(JsonElement left, JsonElement right, string name) =>
            left.TryGetProperty(name, out var one) && right.TryGetProperty(name, out var two) &&
            JsonElement.DeepEquals(one, two);
        return Same(previous, next, "id") && Same(previous, next, "type") &&
            Same(previous, next, "start") && Same(previous, next, "note") &&
            (kind == "sleep" || Same(previous, next, "feedKind"));
    }

    private static string ReplacementJson(JsonElement previous, JsonElement next)
    {
        var kind = previous.GetProperty("type").GetString()!;
        var summary = new ReplacedEntrySummary(
            previous.GetProperty("id").GetString()!, kind,
            previous.GetProperty("start").GetDateTimeOffset(),
            previous.TryGetProperty("end", out var end) ? end.GetDateTimeOffset() : null,
            previous.TryGetProperty("amount", out var amount) ? amount.GetDecimal() : null,
            previous.TryGetProperty("feedKind", out var feedKind) ? feedKind.GetString() : null,
            !JsonElement.DeepEquals(previous.GetProperty("note"), next.GetProperty("note")));
        return JsonSerializer.Serialize(summary, Json);
    }

    private static SharedRecordReplacement? ReadReplacement(FamilyRecordRow row)
    {
        if (row.ConflictReplacedBy is null || row.ConflictReplacedAt is null || row.ConflictPreviousJson is null)
            return null;
        return new(row.ConflictReplacedBy.Value, row.ConflictPreviousEditedBy, row.ConflictReplacedAt.Value,
            JsonSerializer.Deserialize<ReplacedEntrySummary>(row.ConflictPreviousJson, Json)!);
    }

    private static void ClearConflictReplacement(FamilyRecordRow row)
    {
        row.ConflictReplacedBy = null;
        row.ConflictPreviousEditedBy = null;
        row.ConflictReplacedAt = null;
        row.ConflictPreviousJson = null;
    }

    private static bool IsTimerCompletion(JsonElement previous, JsonElement next)
    {
        var kind = PushPolicy.ActiveTimer(previous);
        return kind is not null && next.GetProperty("type").GetString() == kind &&
            PushPolicy.ActiveTimer(next) is null && next.TryGetProperty("end", out _);
    }

    private static bool IsPureTimerCompletion(JsonElement previous, JsonElement next)
    {
        if (!IsTimerCompletion(previous, next)) return false;
        // Finishing a bottle feed may replace its provisional amount with the
        // measured amount. All other feed content belongs to the starter.
        return IsPureTimerCompletionFields(previous, next, previous.GetProperty("type").GetString()!);
    }

    private static bool IsCompletedTimer(JsonElement value) =>
        value.GetProperty("type").GetString() is "sleep" or "feed" && value.TryGetProperty("end", out _);

    private static bool PreservesTimerCompletion(JsonElement previous, JsonElement next) =>
        IsCompletedTimer(previous) && IsCompletedTimer(next) &&
        previous.GetProperty("type").GetString() == next.GetProperty("type").GetString();

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
