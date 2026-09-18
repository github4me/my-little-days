using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi;

public sealed class PushWakeSignal
{
    private readonly Channel<bool> signal = Channel.CreateBounded<bool>(new BoundedChannelOptions(1)
        { FullMode = BoundedChannelFullMode.DropWrite });
    public void Notify() => signal.Writer.TryWrite(true);
    public async Task Wait(TimeSpan delay, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(delay);
        try { await signal.Reader.ReadAsync(timeout.Token); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { }
    }
}

public sealed class PushProcessor(PilotDatabase db, PilotConfiguration config, TimeProvider clock, RecoveryGate recovery, IPushGateway gateway)
{
    private DateTimeOffset Now => clock.GetUtcNow();
    private FamilyService Service => new(db, config, clock);
    private sealed record Claimed(Guid Id, Guid FamilyId, Guid Lease, string? ReceiptId, PushEnvelope? Envelope);

    public async Task<int> Process(CancellationToken ct)
    {
        if (recovery.Blocked || !config.Push.DeliveryEnabled) return 0;
        var now = Now;
        var candidates = await db.NotificationSummaryBuckets.AsNoTracking().Where(x =>
            (x.ExpiresAt > now && (x.State == "pending" && x.DueAt <= now || x.State == "leased" && x.LeaseUntil <= now)) ||
            (x.State == "receipt" && x.ExpiresAt > now.AddHours(-24) && x.DueAt <= now && (x.LeaseUntil == null || x.LeaseUntil <= now)))
            .OrderBy(x => x.DueAt).ThenBy(x => x.Id).Select(x => new { x.Id, x.FamilyId }).Take(20).ToArrayAsync(ct);
        var handled = 0;
        foreach (var item in candidates)
        {
            if (recovery.Blocked || !config.Push.DeliveryEnabled) break;
            db.ChangeTracker.Clear();
            var claimed = await Service.FamilyTransaction(item.FamilyId, () => Claim(item.Id, ct), ct);
            if (claimed is null) continue;
            if (recovery.Blocked) break;
            // Claim committed before network I/O. Lifecycle actions can cancel this
            // lease, but a provider request already in flight cannot be recalled.
            var result = claimed.ReceiptId is not null
                ? await gateway.Receipt(claimed.ReceiptId, ct)
                : await gateway.Send(claimed.Envelope!, ct);
            db.ChangeTracker.Clear();
            await Service.FamilyTransaction(item.FamilyId, () => Complete(claimed, result, ct), ct);
            handled++;
        }
        return handled;
    }

    private async Task<Claimed?> Claim(Guid id, CancellationToken ct)
    {
        if (recovery.Blocked) return null;
        var row = await db.NotificationSummaryBuckets.FindAsync([id], ct);
        var now = Now;
        if (row is null || (row.State == "receipt" ? row.ExpiresAt.AddHours(24) <= now : row.ExpiresAt <= now) || row.DueAt > now ||
            row.State is not ("pending" or "leased" or "receipt") || row.LeaseUntil > now) return null;
        if (row.HistoryId != config.Family.HistoryId || !config.Push.Allows(row.RecipientUserId))
        { row.State = "cancelled"; return null; }
        PushEnvelope? envelope = null;
        if (row.State != "receipt")
        {
            var installation = await db.PushInstallations.FindAsync([row.InstallationId], ct);
            if (installation is null || !installation.Enabled || installation.Generation != row.Generation ||
                installation.UserId != row.RecipientUserId || installation.MembershipId != row.MembershipId ||
                installation.HistoryId != row.HistoryId || installation.FamilyId != row.FamilyId || installation.ExpiresAt <= now ||
                installation.ProjectId != config.Push.ProjectId || installation.Environment != config.Push.Environment ||
                await db.AccountDeletions.AnyAsync(x => x.UserId == row.RecipientUserId, ct) ||
                !await db.Families.AnyAsync(x => x.Id == row.FamilyId && x.DeletedAt == null, ct) ||
                !await db.Memberships.AnyAsync(x => x.Id == row.MembershipId && x.FamilyId == row.FamilyId &&
                    x.UserId == row.RecipientUserId && x.Active, ct))
            { row.State = "cancelled"; return null; }
            var permitted = PushPolicy.ReadCategories(installation.CategoryMask);
            var eligible = await (from delivery in db.PushDeliveries
                join entry in db.FamilyNotificationEvents on delivery.EventId equals entry.Id
                join record in db.FamilyRecords on new { entry.FamilyId, Collection = "entry", IdHash = entry.RecordIdHash }
                    equals new { record.FamilyId, record.Collection, record.IdHash }
                where delivery.BucketId == row.Id && !entry.Cancelled && entry.ExpiresAt > now && entry.NotBeforeAt <= now &&
                    entry.HistoryId == row.HistoryId && entry.FamilyId == row.FamilyId && entry.ActorUserId != row.RecipientUserId &&
                    permitted.Contains(entry.Category) && !record.Deleted &&
                    !db.AccountDeletions.Any(x => x.UserId == record.RecordedBy || x.UserId == record.LastEditedBy)
                select entry.Id).AnyAsync(ct);
            if (!eligible) { row.State = "cancelled"; return null; }
            if (installation.NextSendAt > now)
            { row.DueAt = installation.NextSendAt; return null; }
            try
            {
                envelope = new(new PushTokenProtector(config.Push).Unprotect(installation.ProtectedToken), installation.Locale,
                    row.Id, row.FamilyId, row.MembershipId, row.HistoryId, installation.Id, installation.Generation, row.ExpiresAt);
            }
            catch (System.Security.Cryptography.CryptographicException) { row.State = "failed"; row.LastError = "token_key_unavailable"; return null; }
            catch (FormatException) { row.State = "failed"; row.LastError = "token_key_unavailable"; return null; }
            // At most one overdue summary per installation per five minutes after
            // downtime, rather than replaying every expired scheduling window at once.
            installation.NextSendAt = now.AddSeconds(row.IsSummary ? 300 : 2);
            row.State = "leased";
        }
        row.Sealed = true; row.LeaseId = Guid.NewGuid(); row.LeaseUntil = now.AddMinutes(2); row.Attempts++;
        return new(row.Id, row.FamilyId, row.LeaseId.Value, row.ReceiptId, envelope);
    }

    private async Task<bool> Complete(Claimed claim, PushGatewayResult result, CancellationToken ct)
    {
        if (recovery.Blocked) return false;
        var row = await db.NotificationSummaryBuckets.FindAsync([claim.Id], ct);
        if (row is null || row.LeaseId != claim.Lease || row.State is not ("leased" or "receipt")) return false;
        row.LeaseId = null; row.LeaseUntil = null; row.LastError = result.Error;
        if (result.Outcome == "accepted")
        {
            row.State = "receipt"; row.ReceiptId = result.ReceiptId; row.DueAt = Now.AddMinutes(15);
        }
        else if (result.Outcome == "retry")
        {
            row.State = row.Attempts >= 12 || (row.ReceiptId is null ? row.ExpiresAt <= Now : row.ExpiresAt.AddHours(24) <= Now)
                ? "failed" : row.ReceiptId is null ? "pending" : "receipt";
            row.DueAt = Now + PushPolicy.RetryDelay(row.Attempts);
        }
        else
        {
            row.State = result.Outcome == "sent" ? "sent" : "failed";
            if (result.Outcome == "unregistered")
                await db.PushInstallations.Where(x => x.Id == row.InstallationId && x.Generation == row.Generation)
                    .ExecuteUpdateAsync(s => s.SetProperty(x => x.Enabled, false).SetProperty(x => x.ProtectedToken, "")
                        .SetProperty(x => x.TokenHash, (string?)null), ct);
        }
        return true;
    }

    // Purge only this feature's expired metadata. Domain operation receipts and
    // family histories are never queue cleanup targets. Four bounded statements.
    public async Task Cleanup(CancellationToken ct)
    {
        if (recovery.Blocked) return;
        var before = Now.AddDays(-7);
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE TOP (500) FROM dbo.PushDeliveries WHERE ExpiresAt < {before}", ct);
        if (recovery.Blocked) return;
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE TOP (500) FROM dbo.NotificationSummaryBuckets WHERE ExpiresAt < {before}", ct);
        if (recovery.Blocked) return;
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE TOP (500) FROM dbo.FamilyNotificationEvents WHERE ExpiresAt < {before}", ct);
        if (recovery.Blocked) return;
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE TOP (100) FROM dbo.PushInstallations WHERE ExpiresAt < {before}", ct);
    }
}

public sealed class PushWorker(IServiceScopeFactory scopes, PushWakeSignal signal, RecoveryGate recovery,
    ILogger<PushWorker> logger, TimeProvider clock) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var cleanupAt = DateTimeOffset.MinValue;
        while (!stoppingToken.IsCancellationRequested)
        {
            var handled = 0;
            try
            {
                if (!recovery.Blocked)
                {
                    await using var scope = scopes.CreateAsyncScope();
                    var processor = scope.ServiceProvider.GetRequiredService<PushProcessor>();
                    handled = await processor.Process(stoppingToken);
                    if (clock.GetUtcNow() >= cleanupAt)
                    { await processor.Cleanup(stoppingToken); cleanupAt = clock.GetUtcNow().AddHours(1); }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception) { logger.LogWarning("Push processing remains pending; check queue age and provider configuration. No private details logged."); }
            try { await signal.Wait(TimeSpan.FromSeconds(handled > 0 ? 5 : 30), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
        }
    }
}
