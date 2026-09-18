using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi;

public sealed partial class FamilyService
{
    public Task<PushRegistrationResult> RegisterPush(PilotIdentity user, Guid installationId, RegisterPushRequest request, CancellationToken ct)
    {
        PushPolicy.ValidateSecret(installationId, request.OperationId, request.InstallationSecret, request.ExpectedGeneration);
        return Transaction(async () =>
        {
            await RequireAccount(user, ct);
            var hash = Fingerprint("register-push", new { installationId, request });
            var row = await db.PushInstallations.FindAsync([installationId], ct);
            // This acknowledges only the same account's proven prior device request;
            // it grants nothing and remains resolvable after removal or gate disable.
            if (row is not null && row.UserId == user.ObjectId && row.LastOperationId == request.OperationId &&
                PushPolicy.SecretMatches(request.InstallationSecret, row.SecretHash))
            {
                if (row.LastRequestHash != hash) throw new ApiException(409, "operation_reused");
                return PushResult(row);
            }
            if (!config.Push.RegistrationEnabled || !config.Push.Allows(user.ObjectId)) throw new ApiException(503, "push_unavailable");
            PushPolicy.Validate(request, installationId, config.Push);
            await RequireGrant(user, request.FamilyId, request.MembershipId, ct);
            if (request.HistoryId != config.Family.HistoryId) throw new ApiException(409, "history_changed");
            RequireFullFamily(await Family(request.FamilyId, ct));
            if (row is not null)
            {
                if (!PushPolicy.SecretMatches(request.InstallationSecret, row.SecretHash) || row.UserId != user.ObjectId && row.Enabled)
                    throw new ApiException(403, "push_binding_forbidden");
                if (row.Generation != request.ExpectedGeneration) throw new ApiException(409, "push_binding_changed");
                if (row.UserId != user.ObjectId && await db.PushInstallations.CountAsync(x => x.UserId == user.ObjectId && x.ExpiresAt > Now, ct) >= config.Push.MaxInstallationsPerAccount)
                    throw new ApiException(409, "push_installation_limit");
                await CancelInstallationPush(row.Id, ct);
            }
            else
            {
                if (request.ExpectedGeneration != 0) throw new ApiException(404, "push_installation_unknown");
                // Bound inactive rows too; otherwise disabled registrations are an unlimited write surface.
                if (await db.PushInstallations.CountAsync(x => x.UserId == user.ObjectId && x.ExpiresAt > Now, ct) >= config.Push.MaxInstallationsPerAccount)
                    throw new ApiException(409, "push_installation_limit");
                row = new PushInstallationRow { Id = installationId, SecretHash = PushPolicy.Hash(request.InstallationSecret) };
                db.PushInstallations.Add(row);
            }
            var tokenHash = PushPolicy.Hash(request.ExpoPushToken);
            var occupied = await db.PushInstallations.SingleOrDefaultAsync(x => x.ProjectId == config.Push.ProjectId &&
                x.Environment == config.Push.Environment && x.TokenHash == tokenHash && x.Id != installationId, ct);
            if (occupied is not null)
            {
                // Token knowledge never authorizes replacement, even for the same account.
                if (occupied.Enabled && occupied.ExpiresAt > Now) throw new ApiException(409, "push_token_bound");
                occupied.TokenHash = null; occupied.ProtectedToken = "";
                await db.SaveChangesAsync(ct); // Unique token transfer remains inside this transaction.
            }
            row.UserId = user.ObjectId; row.FamilyId = request.FamilyId; row.MembershipId = request.MembershipId;
            row.HistoryId = request.HistoryId; row.ProjectId = config.Push.ProjectId; row.Environment = config.Push.Environment;
            row.TokenHash = tokenHash; row.ProtectedToken = new PushTokenProtector(config.Push).Protect(request.ExpoPushToken);
            row.Platform = request.Platform; row.Locale = request.Locale; row.Generation = checked(row.Generation + 1);
            row.Enabled = request.Enabled; row.CategoryMask = PushPolicy.CategoryMask(request.Categories);
            row.ExpiresAt = Now.AddHours(24); row.LastOperationId = request.OperationId; row.LastRequestHash = hash;
            return PushResult(row);
        }, ct);
    }

    public Task<PushRegistrationResult> UnregisterPush(PilotIdentity user, Guid installationId, UnregisterPushRequest request, CancellationToken ct)
    {
        PushPolicy.ValidateSecret(installationId, request.OperationId, request.InstallationSecret, request.ExpectedGeneration);
        // Disabling a previously registered device remains possible when admission is feature-disabled.
        return Transaction(async () =>
        {
            await RequireAccount(user, ct);
            var row = await db.PushInstallations.FindAsync([installationId], ct) ?? throw new ApiException(404, "push_installation_unknown");
            // Revocation only: the 256-bit device secret also permits cleanup after
            // offline logout and sign-in as a different account. It grants no binding.
            if (!PushPolicy.SecretMatches(request.InstallationSecret, row.SecretHash))
                throw new ApiException(403, "push_binding_forbidden");
            var hash = Fingerprint("unregister-push", new { installationId, request });
            if (row.LastOperationId == request.OperationId)
            {
                if (row.LastRequestHash != hash) throw new ApiException(409, "operation_reused");
                return PushResult(row);
            }
            if (row.Generation != request.ExpectedGeneration) throw new ApiException(409, "push_binding_changed");
            await CancelInstallationPush(installationId, ct);
            row.Enabled = false; row.Generation = checked(row.Generation + 1); row.TokenHash = null; row.ProtectedToken = "";
            row.LastOperationId = request.OperationId; row.LastRequestHash = hash;
            return PushResult(row);
        }, ct);
    }

    private static PushRegistrationResult PushResult(PushInstallationRow row) =>
        new(row.LastOperationId, row.Id, row.Generation, row.Enabled, PushPolicy.ReadCategories(row.CategoryMask), row.ExpiresAt);
    private Task<int> CancelInstallationPush(Guid installationId, CancellationToken ct) =>
        db.NotificationSummaryBuckets.Where(x => x.InstallationId == installationId && (x.State == "pending" || x.State == "leased"))
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.State, "cancelled"), ct);

    private async Task QueueRecordPush(PilotIdentity actor, FamilyRow family, FullRecordOperation operation, JsonElement value, CancellationToken ct)
    {
        if (!config.Push.EventCreationEnabled || !config.Push.Allows(actor.ObjectId) || operation.Collection != "entry") return;
        var category = value.GetProperty("type").GetString()!;
        if (!PushPolicy.Categories.Contains(category)) return;
        var now = Now;
        var mask = PushPolicy.CategoryMask([category]);
        var installations = await (from device in db.PushInstallations
            join grant in db.Memberships on device.MembershipId equals grant.Id
            where device.FamilyId == family.Id && device.HistoryId == config.Family.HistoryId && device.UserId != actor.ObjectId &&
                device.Enabled && device.ExpiresAt > now && (device.CategoryMask & mask) != 0 && grant.Active &&
                grant.UserId == device.UserId && grant.FamilyId == family.Id && device.ProjectId == config.Push.ProjectId &&
                device.Environment == config.Push.Environment && !db.AccountDeletions.Any(x => x.UserId == device.UserId)
            select device).Take(60).ToArrayAsync(ct);
        installations = installations.Where(x => config.Push.Allows(x.UserId)).ToArray();
        if (installations.Length == 0) return;
        var entry = new FamilyNotificationEventRow
        {
            Id = Guid.NewGuid(), FamilyId = family.Id, HistoryId = config.Family.HistoryId,
            ActorUserId = actor.ObjectId, OperationId = operation.OperationId, Category = category,
            RecordIdHash = RecordIdHash(operation.RecordId), CreatedAt = now, ExpiresAt = now.AddHours(24),
            NotBeforeAt = PushPolicy.NotBefore(value, now)
        };
        db.FamilyNotificationEvents.Add(entry);
        var summary = value.GetProperty("start").GetDateTimeOffset() < now.AddMinutes(-15);
        foreach (var device in installations)
        {
            var window = PushPolicy.Window(now);
            NotificationSummaryBucketRow? bucket = null;
            // A sealed window cannot gain members. At most the current and next window
            // can be involved, because next-window work cannot be claimed early.
            for (var attempt = 0; attempt < 2; attempt++, window = window.AddMinutes(5))
            {
                var key = PushPolicy.Hash(string.Join(':', entry.HistoryId, family.Id, device.MembershipId, device.Id,
                    device.Generation, summary ? window.ToUnixTimeSeconds().ToString(System.Globalization.CultureInfo.InvariantCulture) : entry.Id.ToString()));
                bucket = await db.NotificationSummaryBuckets.SingleOrDefaultAsync(x => x.BucketKey == key, ct);
                if (bucket is { Sealed: true }) continue;
                if (bucket is null)
                {
                    bucket = new NotificationSummaryBucketRow
                    {
                        Id = Guid.NewGuid(), BucketKey = key, FamilyId = family.Id, HistoryId = entry.HistoryId,
                        RecipientUserId = device.UserId, MembershipId = device.MembershipId, InstallationId = device.Id,
                        Generation = device.Generation, IsSummary = summary, WindowStart = window, ExpiresAt = entry.ExpiresAt,
                        DueAt = PushPolicy.Max(entry.NotBeforeAt, summary ? window.AddMinutes(5) : now)
                    };
                    db.NotificationSummaryBuckets.Add(bucket);
                }
                else bucket.DueAt = PushPolicy.Max(bucket.DueAt, entry.NotBeforeAt);
                db.PushDeliveries.Add(new PushDeliveryRow { EventId = entry.Id, BucketId = bucket.Id, ExpiresAt = entry.ExpiresAt });
                break;
            }
        }
    }

    private async Task CancelRecordPush(Guid familyId, string recordId, CancellationToken ct)
    {
        var hash = RecordIdHash(recordId);
        await db.FamilyNotificationEvents.Where(x => x.FamilyId == familyId && x.RecordIdHash == hash && !x.Cancelled)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.Cancelled, true), ct);
    }

    private async Task GuardActiveTimer(Guid familyId, string recordId, JsonElement value, CancellationToken ct)
    {
        if (!config.Family.EnforceSingleActiveTimers || PushPolicy.ActiveTimer(value) is not { } kind) return;
        var hash = RecordIdHash(recordId);
        var conflict = await db.Database.SqlQuery<int>($"""
            SELECT COUNT(*) AS Value FROM dbo.FamilyRecords
            WHERE FamilyId={familyId} AND ActiveTimerKind={kind} AND IdHash<>{hash}
            """).SingleAsync(ct);
        if (conflict > 0) throw new ApiException(409, "active_timer_conflict");
    }
}
