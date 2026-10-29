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
    public Guid? FailureCaptureHistoryEpoch { get; init; }
    public Guid? ExchangeCaptureHistoryEpoch { get; init; }
}

public sealed class SleepAiJobStore(PilotDatabase db, FamilyService family, RecoveryGate recovery,
    TimeProvider clock, IOptions<SleepAiOptions> options, SleepAiFailureCapture? failureCapture = null)
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
        return family.SleepAiTransaction(async () =>
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
                RequestJson = obsolete ? null : json, State = obsolete ? "cancelled" : "queued",
                DiagnosticsConsentVersion = value.DiagnosticsConsentVersion,
                // Automatic server policy applies equally to old and new clients.
                // Keep the client's actual optional consent field/hash unchanged.
                DiagnosticsHistoryEpoch = family.SleepAiHistoryEpoch,
                ExchangeHistoryEpoch = options.Value.FullRequestCaptureEnabled && !obsolete ? family.SleepAiHistoryEpoch : null
            };
            db.SleepAiJobs.Add(rowNew); return View(rowNew);
        }, ct);
    }

    public Task<SleepPredictionJobResponse> Get(PilotIdentity user, Guid id, CancellationToken ct) => family.SleepAiTransaction(async () =>
    {
        CheckRecovery();
        var row = await db.SleepAiJobs.FindAsync([user.ObjectId, id], ct) ?? throw new ApiException(404, "job_not_found");
        await Authorize(user, row, ct);
        Expire(row);
        return View(row);
    }, ct);

    public Task<bool> Cancel(PilotIdentity user, Guid id, bool consent, CancellationToken ct) => family.SleepAiTransaction(async () =>
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
        // Do not join to jobs: their midnight cleanup precedes the diagnostic TTL.
        await db.SleepAiFailedOutputs.Where(x => x.UserId == user.ObjectId &&
            (consent ? x.ConsentGeneration == id : x.JobId == id)).ExecuteDeleteAsync(ct);
        await db.SleepAiExchanges.Where(x => x.UserId == user.ObjectId &&
            (consent ? x.ConsentGeneration == id : x.JobId == id)).ExecuteDeleteAsync(ct);
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

    public Task<SleepAiJobClaim?> Claim(CancellationToken ct) => family.SleepAiTransaction(async () =>
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
        return new SleepAiJobClaim(row.UserId, row.Id, row.LeaseId.Value, request)
        { CreatedAt = row.CreatedAt, Run = row.Runs,
            FailureCaptureHistoryEpoch = row.DiagnosticsHistoryEpoch == family.SleepAiHistoryEpoch
                ? row.DiagnosticsHistoryEpoch : null,
            ExchangeCaptureHistoryEpoch = row.ExchangeHistoryEpoch == family.SleepAiHistoryEpoch
                ? row.ExchangeHistoryEpoch : null };
    }, ct);

    internal Task<bool> EnsureCurrent(SleepAiJobClaim claim, CancellationToken ct) => family.SleepAiTransaction(async () =>
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

    public async Task<bool> Complete(SleepAiJobClaim claim, SleepPredictionResponse? prediction, string? error, CancellationToken ct)
    {
        var completed = await family.SleepAiTransaction(async () =>
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
        // Diagnostics must never undo completion or cause another paid inference.
        // A second lifecycle transaction rechecks authority after the first commits.
        if (completed && failureCapture?.Attempts.Count > 0)
            await StoreFailuresBestEffort(claim, ct);
        return completed;
    }

    private async Task StoreFailuresBestEffort(SleepAiJobClaim claim, CancellationToken ct)
    {
        try
        {
            await family.SleepAiTransaction(async () =>
            {
                CheckRecovery(); db.ChangeTracker.Clear();
                var row = await db.SleepAiJobs.FindAsync([claim.UserId, claim.JobId], ct);
                if (row is null || row.Runs != claim.Run || row.State is not ("completed" or "failed") || row.ExpiresAt <= Now)
                    return false;
                await Authorize(Identity(row.UserId), row, ct);
                await CheckRevoked(row.UserId, row.Id, row.ConsentGeneration, ct);
                if (claim.FailureCaptureHistoryEpoch == family.SleepAiHistoryEpoch &&
                    row.DiagnosticsHistoryEpoch == family.SleepAiHistoryEpoch && failureCapture is not null)
                {
                    foreach (var failed in failureCapture.Attempts.Where(x => x.Attempt is 1 or 2)
                        .DistinctBy(x => x.Attempt).Take(2))
                    {
                        if (failed.ExpiresAt <= Now) continue;
                        db.SleepAiFailedOutputs.Add(new()
                        {
                            UserId = row.UserId, JobId = row.Id, Run = row.Runs, Attempt = failed.Attempt,
                            ConsentGeneration = row.ConsentGeneration, FamilyId = row.FamilyId, MembershipId = row.MembershipId,
                            HistoryEpoch = family.SleepAiHistoryEpoch, Reason = failed.Reason, PeriodIndex = failed.PeriodIndex,
                            FailureFieldsJson = Serialize(failed.Fields),
                            ResponseText = failed.ResponseText, OriginalLength = failed.OriginalLength, Truncated = failed.Truncated,
                            OccurredAt = failed.OccurredAt, ExpiresAt = failed.ExpiresAt,
                            DurationMs = failed.DurationMs, Model = failed.Model
                        });
                    }
                }
                return true;
            }, ct);
        }
        catch (Exception e) when (e is not OutOfMemoryException and not StackOverflowException and not AccessViolationException)
        {
            // No response text or exception details enter application logs.
            db.ChangeTracker.Clear();
        }
    }

    private bool Expire(SleepAiJobRow row)
    {
        if (row.ExpiresAt > Now) return false;
        Finish(row, "expired", null, null); return true;
    }

    internal Task<bool> StoreExchange(SleepAiJobClaim claim, SleepAiExchange exchange, CancellationToken ct) => family.SleepAiTransaction(async () =>
    {
        CheckRecovery(); db.ChangeTracker.Clear();
        if (!options.Value.FullRequestCaptureEnabled || claim.ExchangeCaptureHistoryEpoch != family.SleepAiHistoryEpoch ||
            exchange.Attempt is not (1 or 2) || exchange.SchemaVersion != claim.Request.SchemaVersion || exchange.ExpiresAt <= Now) return false;
        var job = await db.SleepAiJobs.FindAsync([claim.UserId, claim.JobId], ct);
        if (job is null || job.State != "running" || job.Runs != claim.Run || job.LeaseId != claim.LeaseId || job.LeaseUntil <= Now ||
            job.ExpiresAt <= Now || job.ExchangeHistoryEpoch != family.SleepAiHistoryEpoch) return false;
        await Authorize(Identity(job.UserId), job, ct);
        await CheckRevoked(job.UserId, job.Id, job.ConsentGeneration, ct);
        var row = await db.SleepAiExchanges.FindAsync([job.UserId, job.Id, claim.Run, exchange.Attempt], ct);
        if (row is null)
        {
            row = new SleepAiExchangeRow { UserId = job.UserId, JobId = job.Id, Run = claim.Run, Attempt = exchange.Attempt,
                ConsentGeneration = job.ConsentGeneration, FamilyId = job.FamilyId, MembershipId = job.MembershipId,
                HistoryEpoch = family.SleepAiHistoryEpoch };
            db.SleepAiExchanges.Add(row);
        }
        row.SchemaVersion = exchange.SchemaVersion; row.StartedAt = exchange.StartedAt; row.FinishedAt = exchange.FinishedAt;
        row.ExpiresAt = exchange.ExpiresAt; row.RequestBody = exchange.RequestBody; row.ResponseBody = exchange.ResponseBody;
        row.RequestBytes = exchange.RequestBytes; row.ResponseBytes = exchange.ResponseBytes;
        row.RequestTruncated = exchange.RequestTruncated; row.ResponseTruncated = exchange.ResponseTruncated;
        row.HttpStatus = exchange.HttpStatus; row.ProviderRequestId = exchange.ProviderRequestId;
        row.Outcome = exchange.Outcome; row.DurationMs = exchange.DurationMs;
        return true;
    }, ct);
    private void Finish(SleepAiJobRow row, string state, string? result, string? error)
    {
        row.State = state; row.ResultJson = result; row.ErrorCode = error;
        row.RequestJson = null; row.UpdatedAt = Now; row.LeaseId = null; row.LeaseUntil = null;
    }
    private static SleepPredictionJobResponse View(SleepAiJobRow row) => new(row.Id, row.InputRevision,
        row.State, row.RequestNow, row.CreatedAt, row.UpdatedAt, row.ExpiresAt,
        row.State == "completed" && row.ResultJson is not null ? JsonSerializer.Deserialize<SleepPredictionResponse>(row.ResultJson, SleepAiJson.Options) : null,
        row.ErrorCode);

    public async Task<bool> Cleanup(CancellationToken ct)
    {
        CheckRecovery(); var now = Now; var metadataBefore = now.AddDays(-2);
        // Only AI-owned tables; domain records and operation receipts are untouched.
        // Keep the original retention predicates and 500-row per-table bound.
        // Payload rows can be large: commit one at a time so log-write throttling
        // cannot extend one lifecycle barrier across hundreds of payload deletes.
        // A later failure does not roll back the earlier committed batches.
        var epoch = family.SleepAiHistoryEpoch;
        await Batches(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE TOP (1) FROM dbo.SleepAiFailedOutputs WHERE ExpiresAt <= {now} OR HistoryEpoch <> {epoch}", ct), 1);
        await Batches(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE TOP (1) FROM dbo.SleepAiExchanges WHERE ExpiresAt <= {now} OR HistoryEpoch <> {epoch}", ct), 1);
        await Batches(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE TOP (1) FROM dbo.SleepAiJobs WHERE ExpiresAt <= {now}", ct), 1);
        await Batches(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE TOP (25) FROM dbo.SleepAiRevocations WHERE ExpiresAt <= {now}", ct), 25);
        await Batches(() => db.Database.ExecuteSqlInterpolatedAsync($"DELETE TOP (25) FROM dbo.SleepAiAttempts WHERE StartedAt < {metadataBefore}", ct), 25);
        return true;

        async Task Batches(Func<Task<int>> delete, int batchSize)
        {
            for (var count = 0; count < 500; count += batchSize)
            {
                var deleted = await family.SleepAiTransaction(async () =>
                {
                    CheckRecovery();
                    return await delete();
                }, ct);
                if (deleted < batchSize) break;
            }
        }
    }
}
