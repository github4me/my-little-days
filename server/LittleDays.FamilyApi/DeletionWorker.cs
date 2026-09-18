using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi;

public sealed class DeletionWorkerSettings
{
    public int PollIntervalMinutes { get; set; } = 120;
    public TimeSpan PollInterval => TimeSpan.FromMinutes(PollIntervalMinutes);
    public static DeletionWorkerSettings Load(IConfiguration configuration)
    {
        var settings = configuration.GetSection("AccountDeletion").Get<DeletionWorkerSettings>() ?? new();
        if (settings.PollIntervalMinutes is < 120 or > 1440)
            throw new InvalidOperationException("AccountDeletion:PollIntervalMinutes must be between 120 and 1440.");
        return settings;
    }
}

// SQL content cleanup is independent from directory availability. A crash after Graph succeeds
// is safe: the identity adapter verifies absence on retry before we mark the durable job complete.
public sealed class DeletionProcessor(PilotDatabase db, PilotConfiguration config, TimeProvider clock,
    IAccountIdentityDeletion identityDeletion, RecoveryGate? recovery = null)
{
    public async Task<bool> Process(CancellationToken ct)
    {
        if (recovery?.Blocked == true) return false;
        var service = new FamilyService(db, config, clock);
        var closed = await db.Families.AsNoTracking().Where(x => x.DeletedAt != null && x.PurgedAt == null)
            .OrderBy(x => x.DeletedAt).ThenBy(x => x.Id).Select(x => x.Id).Take(FamilyAvailability.CleanupBatchSize).ToArrayAsync(ct);
        foreach (var familyId in closed)
        {
            if (recovery?.Blocked == true) return false;
            if (!await DrainOperationReceipts(() => service.FamilyTransaction(familyId, async () =>
            {
                // Recheck the durable closure in every transaction. Receipt expiry
                // on a live family would weaken its idempotency/replay protection.
                if (!await db.Families.AnyAsync(x => x.Id == familyId && x.DeletedAt != null && x.PurgedAt == null, ct)) return 0;
                return await db.Database.ExecuteSqlInterpolatedAsync($"""
                    DELETE TOP ({FamilyAvailability.OperationCleanupBatchSize}) FROM dbo.Operations WHERE FamilyId = {familyId};
                    """, ct);
            }, ct), ct)) return false;
            await service.FamilyTransaction(familyId, async () =>
            {
                var family = await db.Families.SingleAsync(x => x.Id == familyId, ct);
                if (family.DeletedAt is null || family.PurgedAt is not null) return false;
                await db.Feeds.Where(x => x.FamilyId == family.Id).ExecuteDeleteAsync(ct);
                await db.FamilyRecords.Where(x => x.FamilyId == family.Id).ExecuteDeleteAsync(ct);
                await db.Invitations.Where(x => x.FamilyId == family.Id).ExecuteDeleteAsync(ct);
                await db.OwnershipTransfers.Where(x => x.FamilyId == family.Id).ExecuteDeleteAsync(ct);
                // The closed family cannot create new receipts between batches.
                // Refuse to mark cleanup complete if unexpected receipts remain.
                if (await db.Operations.AnyAsync(x => x.FamilyId == family.Id, ct))
                    throw new InvalidOperationException("Closed-family receipt cleanup is incomplete.");
                await db.Memberships.Where(x => x.FamilyId == family.Id).ExecuteDeleteAsync(ct);
                await db.PushInstallations.Where(x => x.FamilyId == family.Id).ExecuteUpdateAsync(s => s
                    .SetProperty(x => x.Enabled, false).SetProperty(x => x.ProtectedToken, "").SetProperty(x => x.TokenHash, (string?)null), ct);
                await db.NotificationSummaryBuckets.Where(x => x.FamilyId == family.Id && (x.State == "pending" || x.State == "leased"))
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.State, "cancelled"), ct);
                family.BabyName = ""; family.BabyBirthDate = null; family.BabySex = "unspecified";
                family.PurgedAt = clock.GetUtcNow();
                return true;
            }, ct);
            db.ChangeTracker.Clear();
        }
        var jobs = await db.AccountDeletions.AsNoTracking().Where(x => x.Status == "pending")
            .OrderBy(x => x.RequestedAt).ThenBy(x => x.UserId).Select(x => x.UserId).Take(FamilyAvailability.CleanupBatchSize).ToArrayAsync(ct);
        foreach (var userId in jobs)
        {
            if (recovery?.Blocked == true) return false;
            if (!await DrainOperationReceipts(() => service.Transaction(async () =>
            {
                // Account access was revoked when this durable job was created.
                // Each committed batch releases the global lifecycle lock so an
                // unrelated family does not wait for this user's entire history.
                if (!await db.AccountDeletions.AnyAsync(x => x.UserId == userId && x.Status == "pending", ct)) return 0;
                return await db.Database.ExecuteSqlInterpolatedAsync($"""
                    DELETE TOP ({FamilyAvailability.OperationCleanupBatchSize}) FROM dbo.Operations WHERE UserId = {userId};
                    """, ct);
            }, ct), ct)) return false;
            // An account can have authored records in several families. Preserve
            // the global lifecycle barrier, but release it between bounded jobs.
            if (!await DrainOperationReceipts(() => service.Transaction(async () =>
            {
                if (!await db.AccountDeletions.AnyAsync(x => x.UserId == userId && x.Status == "pending", ct)) return 0;
                // Purge device/event attribution before deleting the source records.
                // Each SQL statement is bounded; release the lifecycle lock between
                // batches. Orphan links carry only opaque IDs and expire separately.
                return await db.Database.ExecuteSqlInterpolatedAsync($"""
                    DELETE TOP (1000) delivery FROM dbo.PushDeliveries delivery
                    WHERE EXISTS(SELECT 1 FROM dbo.NotificationSummaryBuckets b WHERE b.Id=delivery.BucketId AND b.RecipientUserId={userId})
                       OR EXISTS(SELECT 1 FROM dbo.FamilyNotificationEvents e WHERE e.Id=delivery.EventId AND e.ActorUserId={userId});
                    DELETE TOP (1000) FROM dbo.NotificationSummaryBuckets WHERE RecipientUserId={userId};
                    DELETE TOP (1000) e FROM dbo.FamilyNotificationEvents e
                    WHERE e.ActorUserId={userId} OR EXISTS(SELECT 1 FROM dbo.FamilyRecords r
                        WHERE r.FamilyId=e.FamilyId AND r.Collection='entry' AND r.IdHash=e.RecordIdHash
                        AND (r.RecordedBy={userId} OR r.LastEditedBy={userId}));
                    """, ct);
            }, ct), ct)) return false;
            await service.Transaction(async () =>
            {
                var job = await db.AccountDeletions.SingleAsync(x => x.UserId == userId, ct);
                if (job.Status != "pending") return false;
                var memberEmails = await db.Memberships.Where(x => x.UserId == job.UserId).Select(x => x.Email).ToArrayAsync(ct);
                var bindingEmail = config.Pilot.Identities.SingleOrDefault(x => x.ObjectId == job.UserId)?.Email;
                var emails = memberEmails.Append(bindingEmail ?? "").Append(job.PendingEmail ?? "").Where(x => x.Length > 0).Distinct().ToArray();
                var familyIds = await db.Feeds.Where(x => x.RecordedBy == job.UserId || x.LastEditedBy == job.UserId).Select(x => x.FamilyId)
                    .Union(db.FamilyRecords.Where(x => x.RecordedBy == job.UserId || x.LastEditedBy == job.UserId).Select(x => x.FamilyId))
                    .Union(db.Memberships.Where(x => x.UserId == job.UserId).Select(x => x.FamilyId))
                    .Union(db.Invitations.Where(x => x.RecipientUserId == job.UserId || emails.Contains(x.Email)).Select(x => x.FamilyId))
                    .Union(db.OwnershipTransfers.Where(x => x.FromUserId == job.UserId || x.ToUserId == job.UserId).Select(x => x.FamilyId))
                    .Distinct().ToArrayAsync(ct);
                // The pilot has no earlier-version archive: deleting the current content is
                // safer than claiming an edited note was erased by zeroing its attribution.
                await db.Feeds.Where(x => x.RecordedBy == job.UserId || x.LastEditedBy == job.UserId).ExecuteDeleteAsync(ct);
                await db.FamilyRecords.Where(x => x.RecordedBy == job.UserId || x.LastEditedBy == job.UserId).ExecuteDeleteAsync(ct);
                await db.Invitations.Where(x => x.RecipientUserId == job.UserId || emails.Contains(x.Email)).ExecuteDeleteAsync(ct);
                await db.OwnershipTransfers.Where(x => x.FromUserId == job.UserId || x.ToUserId == job.UserId).ExecuteDeleteAsync(ct);
                if (await db.Operations.AnyAsync(x => x.UserId == job.UserId, ct))
                    throw new InvalidOperationException("Deleted-account receipt cleanup is incomplete.");
                await db.Memberships.Where(x => x.UserId == job.UserId).ExecuteDeleteAsync(ct);
                await db.PushInstallations.Where(x => x.UserId == job.UserId).ExecuteDeleteAsync(ct);
                await db.NotificationSummaryBuckets.Where(x => x.RecipientUserId == job.UserId && (x.State == "pending" || x.State == "leased"))
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.State, "cancelled"), ct);
                foreach (var family in await db.Families.Where(x => familyIds.Contains(x.Id) && x.DeletedAt == null).ToArrayAsync(ct)) family.Revision++;
                job.Status = "awaiting_identity_deletion";
                job.PendingEmail = null;
                return true;
            }, ct);
            db.ChangeTracker.Clear();
        }
        // Failed directory attempts rotate behind unattempted/older jobs, rather
        // than starving everything after the first permanently failing batch.
        var pendingIds = await db.AccountDeletions.AsNoTracking().Where(x => x.Status == "awaiting_identity_deletion")
            .OrderBy(x => x.LastIdentityAttemptAt).ThenBy(x => x.RequestedAt).ThenBy(x => x.UserId)
            .Select(x => x.UserId).Take(FamilyAvailability.CleanupBatchSize).ToArrayAsync(ct);
        var complete = true;
        foreach (var id in pendingIds)
        {
            if (recovery?.Blocked == true) return false;
            try
            {
                var attempt = await service.Transaction(async () =>
                {
                    var job = await db.AccountDeletions.SingleAsync(x => x.UserId == id, ct);
                    if (job.Status != "awaiting_identity_deletion") return false;
                    job.LastIdentityAttemptAt = clock.GetUtcNow();
                    return true;
                }, ct);
                if (!attempt) continue;
                if (recovery?.Blocked == true) return false;
                await identityDeletion.DeleteIdentityAsync(id, ct);
                await service.Transaction(async () =>
                {
                    var job = await db.AccountDeletions.SingleAsync(x => x.UserId == id, ct);
                    job.Status = "completed"; job.CompletedAt = clock.GetUtcNow();
                    return true;
                }, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception) { complete = false; db.ChangeTracker.Clear(); }
        }
        return complete &&
            !await db.Families.AnyAsync(x => x.DeletedAt != null && x.PurgedAt == null, ct) &&
            !await db.AccountDeletions.AnyAsync(x => x.Status != "completed", ct);
    }

    private async Task<bool> DrainOperationReceipts(Func<Task<int>> deleteBatch, CancellationToken ct)
    {
        while (true)
        {
            ct.ThrowIfCancellationRequested();
            if (recovery?.Blocked == true) return false;
            var deleted = await deleteBatch();
            db.ChangeTracker.Clear();
            if (deleted < FamilyAvailability.OperationCleanupBatchSize) return true;
            // The previous transaction has committed. Cancellation/restart now
            // leaves its durable closure/job pending and resumes the next batch.
            await Task.Yield();
        }
    }
}

public sealed class DeletionWorker(IServiceScopeFactory scopes, ILogger<DeletionWorker> logger,
    DeletionWorkerSettings settings, TimeProvider clock, RecoveryGate recovery) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Immediate startup recovery, then a bounded cadence that allows serverless SQL to sleep.
        // Access is revoked synchronously; pending content/directory purge retries every interval.
        using var timer = new PeriodicTimer(settings.PollInterval, clock);
        do
        {
            try
            {
                if (recovery.Blocked) continue;
                await using var scope = scopes.CreateAsyncScope();
                if (!await scope.ServiceProvider.GetRequiredService<DeletionProcessor>().Process(stoppingToken))
                    logger.LogWarning("One or more directory deletions remain pending; other queued requests were still processed.");
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception) { logger.LogWarning("Deletion cleanup is pending; verify SQL and directory cleanup configuration. No private details logged."); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
