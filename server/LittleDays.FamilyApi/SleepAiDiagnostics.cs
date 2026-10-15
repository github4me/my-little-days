using System.Security.Cryptography;

namespace LittleDays.FamilyApi;

public enum SleepAiStage
{
    Enqueue, Poll, Claim, QueueWait, Access, Budget, Provider, Validation, Persist, Processing, ServerTotal
}

/// <summary>Metadata-only timings. Never accepts a prompt, record, response body or identity.</summary>
public sealed class SleepAiDiagnostics(ILogger<SleepAiDiagnostics> logger, TimeProvider clock)
{
    private readonly TimeProvider time = clock;
    private string correlation = Guid.NewGuid().ToString("N");
    private int run;

    public void SetJob(Guid id, int runNumber = 0)
    {
        // Correlate retries without logging the caller's operation ID verbatim.
        correlation = Convert.ToHexString(SHA256.HashData(id.ToByteArray()))[..24];
        run = runNumber;
    }

    public Timing Start(SleepAiStage stage, int attempt = 0) => new(this, stage, attempt);

    public async Task<T> MeasureAsync<T>(SleepAiStage stage, Func<Task<T>> action)
    {
        using var timing = Start(stage);
        try { var value = await action(); timing.Complete(); return value; }
        catch (Exception error) { timing.Fail(error); throw; }
    }

    public void WallDuration(SleepAiStage stage, DateTimeOffset since, string outcome = "ok") =>
        Write(stage, 0, Math.Max(0, (time.GetUtcNow() - since).TotalMilliseconds), outcome);

    private static string Outcome(string value) => value switch
    {
        "ok" or "ready" or "unavailable" or "insufficient_data" or "invalid_output" or "not_committed" or "interrupted" or
        "queued" or "running" or "completed" or "failed" or "cancelled" or "expired" or
        "database_error" or "transport_error" or "error" => value,
        _ => SleepAiJobPolicy.SafeError(value)
    };

    private void Write(SleepAiStage stage, int attempt, double milliseconds, string outcome,
        string? model = null, string? tier = null, long? input = null, long? output = null, long? cached = null)
    {
        try
        {
            logger.LogInformation(new EventId(4100, "SleepAiTiming"),
                "SleepAiTiming Stage={Stage} Job={Job} Run={Run} Attempt={Attempt} DurationMs={DurationMs} Outcome={Outcome} Model={Model} ServiceTier={ServiceTier} InputTokens={InputTokens} OutputTokens={OutputTokens} CachedInputTokens={CachedInputTokens}",
                stage.ToString(), correlation, run, attempt, Math.Round(milliseconds, 2), Outcome(outcome),
                model == SleepAiOptions.SelectedModel ? model : model is null ? null : "other_configured_model",
                tier is "default" or "priority" or "fast" or "flex" or "scale" or "ultrafast" ? tier : "unknown",
                input >= 0 ? input : null, output >= 0 ? output : null, cached >= 0 ? cached : null);
        }
        catch (Exception) { /* Observability must never change the job's outcome. */ }
    }

    public sealed class Timing : IDisposable
    {
        private readonly SleepAiDiagnostics owner;
        private readonly SleepAiStage stage;
        private readonly int attempt;
        private readonly long started;
        private string outcome = "interrupted";
        private string? model, tier;
        private long? input, output, cached;
        private bool disposed;

        internal Timing(SleepAiDiagnostics owner, SleepAiStage stage, int attempt)
        {
            this.owner = owner; this.stage = stage; this.attempt = attempt;
            started = owner.time.GetTimestamp();
        }
        public void Complete(string value = "ok") => outcome = value;
        public void Discard() => disposed = true;
        public void Fail(Exception error) => outcome = error switch
        {
            ApiException api => api.Code,
            OperationCanceledException => "cancelled",
            TimeoutException => "ai_timeout",
            System.ClientModel.ClientResultException api => api.Status == 429 ? "ai_provider_busy" : "ai_provider_unavailable",
            HttpRequestException => "transport_error",
            Microsoft.Data.SqlClient.SqlException => "database_error",
            _ => "error"
        };
        public void ProviderMetadata(string modelId, string? serviceTier, long? inputTokens, long? outputTokens, long? cachedInputTokens)
        {
            model = modelId; tier = serviceTier; input = inputTokens; output = outputTokens; cached = cachedInputTokens;
        }
        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            owner.Write(stage, attempt, owner.time.GetElapsedTime(started).TotalMilliseconds, outcome, model, tier, input, output, cached);
        }
    }
}
