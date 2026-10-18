using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi;

public sealed partial class FamilyService
{
    internal Guid SleepAiHistoryEpoch => config.Family.HistoryId;

    internal async Task PurgeSleepAiFailuresForAccount(Guid userId, CancellationToken ct)
    {
        var affectedFamilies = db.Memberships.Where(x => x.UserId == userId).Select(x => x.FamilyId)
            .Union(db.Feeds.Where(x => x.RecordedBy == userId || x.LastEditedBy == userId).Select(x => x.FamilyId))
            .Union(db.FamilyRecords.Where(x => x.RecordedBy == userId || x.LastEditedBy == userId ||
                x.TimerEndedBy == userId || x.ConflictReplacedBy == userId || x.ConflictPreviousEditedBy == userId).Select(x => x.FamilyId));
        // Remove capture authority without cancelling other members' normal AI
        // predictions. Completion checks this authoritative row, not its claim.
        await db.SleepAiJobs.Where(x => x.UserId == userId ||
            x.FamilyId != null && affectedFamilies.Contains(x.FamilyId.Value))
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.DiagnosticsConsentVersion, (string?)null)
                .SetProperty(x => x.DiagnosticsHistoryEpoch, (Guid?)null)
                .SetProperty(x => x.ExchangeHistoryEpoch, (Guid?)null), ct);
        await db.SleepAiFailedOutputs.Where(x => x.UserId == userId ||
            x.FamilyId != null && affectedFamilies.Contains(x.FamilyId.Value)).ExecuteDeleteAsync(ct);
        await db.SleepAiExchanges.Where(x => x.UserId == userId ||
            x.FamilyId != null && affectedFamilies.Contains(x.FamilyId.Value)).ExecuteDeleteAsync(ct);
    }
    // Authorizes client-projected data without creating a family, copying its
    // records to SQL, or holding a lifecycle lock over an external AI request.
    public Task<bool> AuthorizeSleepPrediction(PilotIdentity user, SleepPredictionRequest request, CancellationToken ct) =>
        ReadTransaction(() => AuthorizeSleepPredictionCore(user, request.FamilyId, request.MembershipId, request.HistoryId, ct), ct);

    internal async Task<bool> AuthorizeSleepPredictionCore(PilotIdentity user, Guid? familyId, Guid? membershipId, Guid? historyId, CancellationToken ct)
    {
        var context = new[] { familyId, membershipId, historyId };
        if (context.Any(x => x == Guid.Empty) || context.Any(x => x is null) && context.Any(x => x is not null))
            throw new ApiException(422, "invalid_input");
        await RequireAccount(user, ct);
        if (familyId is Guid family)
        {
            if (historyId != config.Family.HistoryId) throw new ApiException(409, "history_changed");
            await RequireGrant(user, family, membershipId, ct);
        }
        return true;
    }
}
