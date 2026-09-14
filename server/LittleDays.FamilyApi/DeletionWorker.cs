using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi;

// SQL content cleanup is independent from directory availability. A crash after Graph succeeds
// is safe: the identity adapter verifies absence on retry before we mark the durable job complete.
public sealed class DeletionProcessor(PilotDatabase db, PilotConfiguration config, TimeProvider clock,
    IAccountIdentityDeletion identityDeletion)
{
    public async Task<bool> Process(CancellationToken ct)
    {
        var service = new FamilyService(db, config, clock);
        var pendingIds = await service.Transaction(async () =>
        {
            var closed = await db.Families.Where(x => x.DeletedAt != null).ToArrayAsync(ct);
            foreach (var family in closed)
            {
                await db.Feeds.Where(x => x.FamilyId == family.Id).ExecuteDeleteAsync(ct);
                await db.Invitations.Where(x => x.FamilyId == family.Id).ExecuteDeleteAsync(ct);
                await db.OwnershipTransfers.Where(x => x.FamilyId == family.Id).ExecuteDeleteAsync(ct);
                await db.Operations.Where(x => x.FamilyId == family.Id).ExecuteDeleteAsync(ct);
                await db.Memberships.Where(x => x.FamilyId == family.Id).ExecuteDeleteAsync(ct);
                family.BabyName = ""; family.BabyBirthDate = null;
            }
            var jobs = await db.AccountDeletions.Where(x => x.Status == "pending").ToArrayAsync(ct);
            foreach (var job in jobs)
            {
                var memberEmails = await db.Memberships.Where(x => x.UserId == job.UserId).Select(x => x.Email).ToArrayAsync(ct);
                var bindingEmail = config.Pilot.Identities.SingleOrDefault(x => x.ObjectId == job.UserId)?.Email;
                var emails = memberEmails.Append(bindingEmail ?? "").Where(x => x.Length > 0).Distinct().ToArray();
                var familyIds = await db.Feeds.Where(x => x.RecordedBy == job.UserId || x.LastEditedBy == job.UserId).Select(x => x.FamilyId)
                    .Union(db.Memberships.Where(x => x.UserId == job.UserId).Select(x => x.FamilyId))
                    .Union(db.Invitations.Where(x => x.RecipientUserId == job.UserId || emails.Contains(x.Email)).Select(x => x.FamilyId))
                    .Union(db.OwnershipTransfers.Where(x => x.FromUserId == job.UserId || x.ToUserId == job.UserId).Select(x => x.FamilyId))
                    .Distinct().ToArrayAsync(ct);
                // The pilot has no earlier-version archive: deleting the current content is
                // safer than claiming an edited note was erased by zeroing its attribution.
                await db.Feeds.Where(x => x.RecordedBy == job.UserId || x.LastEditedBy == job.UserId).ExecuteDeleteAsync(ct);
                await db.Invitations.Where(x => x.RecipientUserId == job.UserId || emails.Contains(x.Email)).ExecuteDeleteAsync(ct);
                await db.OwnershipTransfers.Where(x => x.FromUserId == job.UserId || x.ToUserId == job.UserId).ExecuteDeleteAsync(ct);
                await db.Operations.Where(x => x.UserId == job.UserId).ExecuteDeleteAsync(ct);
                await db.Memberships.Where(x => x.UserId == job.UserId).ExecuteDeleteAsync(ct);
                foreach (var family in await db.Families.Where(x => familyIds.Contains(x.Id) && x.DeletedAt == null).ToArrayAsync(ct)) family.Revision++;
                job.Status = "awaiting_identity_deletion";
            }
            await db.SaveChangesAsync(ct);
            return await db.AccountDeletions.Where(x => x.Status == "awaiting_identity_deletion").Select(x => x.UserId).ToArrayAsync(ct);
        }, ct);
        var complete = true;
        foreach (var id in pendingIds)
        {
            try
            {
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
        return complete;
    }
}

public sealed class DeletionWorker(IServiceScopeFactory scopes, ILogger<DeletionWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                if (!await scope.ServiceProvider.GetRequiredService<DeletionProcessor>().Process(stoppingToken))
                    logger.LogWarning("One or more directory deletions remain pending; other queued requests were still processed.");
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception) { logger.LogWarning("Deletion cleanup is pending; verify SQL and directory cleanup configuration. No private details logged."); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
