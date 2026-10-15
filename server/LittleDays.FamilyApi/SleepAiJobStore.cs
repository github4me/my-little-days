using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi;

public sealed record SleepAiJobClaim(Guid UserId, Guid JobId, Guid LeaseId, SleepPredictionRequest Request)
{
    public DateTimeOffset CreatedAt { get; init; }
    public int Run { get; init; }
}

public sealed class SleepAiJobStore(PilotDatabase db, FamilyService family, RecoveryGate recovery,
    TimeProvider clock, IOptions<SleepAiOptions> options)
{
    private DateTimeOffset Now => clock.GetUtcNow();
    private void CheckRecovery() { if (recovery.Blocked) throw new ApiException(503, "recovery_blocked"); }
    private static PilotIdentity Identity(Guid id) => new() { ObjectId = id, Email = "" };
    private static string Serialize<T>(T value) => JsonSerializer.Serialize(value, SleepAiJson.Options);
    private Task<bool> Authorize(PilotIdentity user, SleepAiJobRow row, CancellationToken ct) =>
        family.AuthorizeSleepPredictionCore(user, row.FamilyId, row.MembershipId, row.HistoryId, ct);

    public Task<SleepPredictionJobResponse> Enqueue(PilotIdentity user, CreateSleepPredictionJobRequest value, CancellationToken ct)
    {
        CheckRecovery();
        if (!options.Value.IsAvailable) throw new ApiException(503, "ai_provider_unavailable");
        if (value.Request is null) throw new ApiException(422, "invalid_input");
        // Validate structure before serializing. For existing immutable operations,
        // replay is legal even after the original five-minute admission window.
        SleepAiJobPolicy.Validate(value, value.Request.Now);
        var json = Serialize(value.Request);
        if (Encoding.UTF8.GetByteCount(json) > 196608) throw new ApiException(422, "invalid_input");
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Serialize(value))));
        return family.Transaction(async () =>
        {
            CheckRecovery();
            await family.AuthorizeSleepPredictionCore(user, value.Request.FamilyId, value.Request.MembershipId, value.Request.HistoryId, ct);
            await CheckRevoked(user.ObjectId, value.OperationId, value.ConsentGeneration, ct);
            var old = await db.SleepAiJobs.FindAsync([user.ObjectId, value.OperationId], ct);
            if (old is not null)
            {
                if (old.RequestHash != hash) throw new ApiException(409, "operation_reused");
                Expire(old); return View(old);
            }
            var bounds = SleepAiJobPolicy.Validate(value, Now);
            if (Now < bounds.TodayStart || Now >= bounds.TodayEnd) throw new ApiException(409, "prediction_day_changed");
            // Keep at most one unfinished revision for this consent/scope. Older
            // completed plans remain readable as the next request's prior plan.
            var pending = await db.SleepAiJobs.Where(x => x.UserId == user.ObjectId &&
                x.ConsentGeneration == value.ConsentGeneration && x.FamilyId == value.Request.FamilyId &&
                (x.State == "queued" || x.State == "running")).ToArrayAsync(ct);
            var obsolete = pending.Any(x => x.RequestNow > value.Request.Now);
            if (!obsolete)
                foreach (var row in pending) Finish(row, "cancelled", null, null);
            if (await db.SleepAiJobs.CountAsync(x => x.State == "queued" || x.State == "running", ct) >= 256)
                throw new ApiException(429, "ai_busy");
            var rowNew = new SleepAiJobRow
            {
                UserId = user.ObjectId, Id = value.OperationId, ConsentGeneration = value.ConsentGeneration,
                FamilyId = value.Request.FamilyId, MembershipId = value.Request.MembershipId, HistoryId = value.Request.HistoryId,
                InputRevision = value.Request.InputRevision, RequestHash = hash, RequestNow = value.Request.Now,
                CreatedAt = Now, UpdatedAt = Now, ExpiresAt = bounds.TodayEnd,
                RequestJson = obsolete ? null : json, State = obsolete ? "cancelled" : "queued"
            };
            db.SleepAiJobs.Add(rowNew); return View(rowNew);
        }, ct);
    }

    public Task<SleepPredictionJobResponse> Get(PilotIdentity user, Guid id, CancellationToken ct) => family.Transaction(async () =>
    {
        CheckRecovery();
        var row = await db.SleepAiJobs.FindAsync([user.ObjectId, id], ct) ?? throw new ApiException(404, "job_not_found");
        await Authorize(user, row, ct);
        Expire(row);
        return View(row);
    }, ct);

    public Task<bool> Cancel(PilotIdentity user, Guid id, bool consent, CancellationToken ct) => family.Transaction(async () =>
    {
        CheckRecovery();
        if (id == Guid.Empty) throw new ApiException(422, "invalid_input");
        await family.AuthorizeSleepPredictionCore(user, null, null, null, ct);
        var kind = consent ? "consent" : "job";
        var old = await db.SleepAiRevocations.FindAsync([user.ObjectId, kind, id], ct);
        if (old is null) db.SleepAiRevocations.Add(new() { UserId = user.ObjectId, Kind = kind, Id = id, ExpiresAt = Now.AddDays(2) });
        else old.ExpiresAt = Now.AddDays(2);
        var rows = await db.SleepAiJobs.Where(x => x.UserId == user.ObjectId &&
            (consent ? x.ConsentGeneration == id : x.Id == id)).ToArrayAsync(ct);
        foreach (var row in rows) Finish(row, "cancelled", null, null);
        return true;
    }, ct);

    private async Task CheckRevoked(Guid user, Guid job, Guid generation, CancellationToken ct)
    {
        // Tombstones are deliberately checked until removed by bounded cleanup.
        // Original request freshness also prevents replay after metadata expiry.
        if (await db.SleepAiRevocations.AnyAsync(x => x.UserId == user &&
            (x.Kind == "job" && x.Id == job || x.Kind == "consent" && x.Id == generation), ct))
            throw new ApiException(403, "ai_consent_revoked");
    }

    public Task<SleepAiJobClaim?> Claim(CancellationToken ct) => family.Transaction(async () =>
    {
        CheckRecovery();
        if (!options.Value.IsAvailable) return null;
        var now = Now;
        var row = await db.SleepAiJobs.Where(x => x.State == "queued" || x.State == "running" && x.LeaseUntil <= now)
            .OrderBy(x => x.CreatedAt).ThenBy(x => x.Id).FirstOrDefaultAsync(ct);
        if (row is null) return null;
        if (Expire(row)) return null;
        try
        {
            await Authorize(Identity(row.UserId), row, ct);
            await CheckRevoked(row.UserId, row.Id, row.ConsentGeneration, ct);
        }
        catch (ApiException e) { Finish(row, "cancelled", null, SleepAiJobPolicy.SafeError(e.Code)); return null; }
        // One bounded recovery after an interrupted lease; never claim exactly-once
        // paid inference when a process may die after dispatching to the provider.
        if (row.Runs >= 2) { Finish(row, "failed", null, "ai_provider_unavailable"); return null; }
        if (row.RequestJson is null) { Finish(row, "failed", null, "ai_invalid_response"); return null; }
        var request = JsonSerializer.Deserialize<SleepPredictionRequest>(row.RequestJson, SleepAiJson.Options)
            ?? throw new InvalidOperationException("Invalid durable AI job.");
        row.State = "running"; row.LeaseId = Guid.NewGuid(); row.LeaseUntil = now.AddMinutes(2);
        row.Runs++; row.UpdatedAt = now;
        return new SleepAiJobClaim(row.UserId, row.Id, row.LeaseId.Value, request) { CreatedAt = row.CreatedAt, Run = row.Runs };
    }, ct);

    internal Task<bool> EnsureCurrent(SleepAiJobClaim claim, CancellationToken ct) => family.Transaction(async () =>
    {
        CheckRecovery();
        // Avoid serving an EF-tracked stale row after an independent cancellation.
        db.ChangeTracker.Clear();
        var row = await db.SleepAiJobs.FindAsync([claim.UserId, claim.JobId], ct);
        if (row is null || row.State != "running" || row.LeaseId != claim.LeaseId || row.LeaseUntil <= Now || row.ExpiresAt <= Now)
            throw new ApiException(409, "ai_job_cancelled");
        await Authorize(Identity(row.UserId), row, ct);
        await CheckRevoked(row.UserId, row.Id, row.ConsentGeneration, ct);
        return true;
    }, ct);

    public Task<bool> Complete(SleepAiJobClaim claim, SleepPredictionResponse? prediction, string? error, CancellationToken ct) => family.Transaction(async () =>
    {
        CheckRecovery(); db.ChangeTracker.Clear();
        var row = await db.SleepAiJobs.FindAsync([claim.UserId, claim.JobId], ct);
        if (row is null || row.State != "running" || row.LeaseId != claim.LeaseId || row.LeaseUntil <= Now) return false;
        if (Expire(row)) return false;
        try
        {
            await Authorize(Identity(row.UserId), row, ct);
            await CheckRevoked(row.UserId, row.Id, row.ConsentGeneration, ct);
        }
        catch (ApiException e) { Finish(row, "cancelled", null, SleepAiJobPolicy.SafeError(e.Code)); return false; }
        if (prediction is not null && prediction.Status is "ready" or "insufficient_data")
            Finish(row, "completed", Serialize(prediction), null);
        else Finish(row, "failed", null, SleepAiJobPolicy.SafeError(error ?? "ai_provider_unavailable"));
        return true;
    }, ct);

    private bool Expire(SleepAiJobRow row)
    {
        if (row.ExpiresAt > Now) return false;
        Finish(row, "expired", null, null); return true;
    }
    private void Finish(SleepAiJobRow row, string state, string? result, string? error)
    {
        row.State = state; row.ResultJson = result; row.ErrorCode = error;
        row.RequestJson = null; row.UpdatedAt = Now; row.LeaseId = null; row.LeaseUntil = null;
    }
    private static SleepPredictionJobResponse View(SleepAiJobRow row) => new(row.Id, row.InputRevision,
        row.State, row.RequestNow, row.CreatedAt, row.UpdatedAt, row.ExpiresAt,
        row.State == "completed" && row.ResultJson is not null ? JsonSerializer.Deserialize<SleepPredictionResponse>(row.ResultJson, SleepAiJson.Options) : null,
        row.ErrorCode);

    public Task<bool> Cleanup(CancellationToken ct) => family.Transaction(async () =>
    {
        CheckRecovery(); var now = Now; var metadataBefore = now.AddDays(-2);
        // Only AI-owned tables; domain records and operation receipts are untouched.
        // Expired/private input/output is cleared hourly, not retained for debugging.
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE TOP (500) FROM dbo.SleepAiJobs WHERE ExpiresAt <= {now}", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE TOP (500) FROM dbo.SleepAiRevocations WHERE ExpiresAt <= {now}", ct);
        await db.Database.ExecuteSqlInterpolatedAsync($"DELETE TOP (500) FROM dbo.SleepAiAttempts WHERE StartedAt < {metadataBefore}", ct);
        return true;
    }, ct);
}
