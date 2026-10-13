namespace LittleDays.FamilyApi;

public sealed partial class FamilyService
{
    // Authorizes client-projected data without creating a family, copying its
    // records to SQL, or holding a lifecycle lock over an external AI request.
    public Task<bool> AuthorizeSleepPrediction(PilotIdentity user, SleepPredictionRequest request, CancellationToken ct) => ReadTransaction(async () =>
    {
        var context = new[] { request.FamilyId, request.MembershipId, request.HistoryId };
        if (context.Any(x => x == Guid.Empty) || context.Any(x => x is null) && context.Any(x => x is not null))
            throw new ApiException(422, "invalid_input");
        await RequireAccount(user, ct);
        if (request.FamilyId is Guid familyId)
        {
            if (request.HistoryId != config.Family.HistoryId) throw new ApiException(409, "history_changed");
            await RequireGrant(user, familyId, request.MembershipId, ct);
        }
        return true;
    }, ct);
}
