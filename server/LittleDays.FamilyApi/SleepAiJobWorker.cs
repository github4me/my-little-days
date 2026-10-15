using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi;

public sealed class SleepAiJobProcessor
{
    private readonly Func<CancellationToken, Task<SleepAiJobClaim?>> claimJob;
    private readonly Func<SleepAiJobClaim, CancellationToken, Task<SleepPredictionResponse>> predict;
    private readonly Func<SleepAiJobClaim, SleepPredictionResponse?, string?, CancellationToken, Task<bool>> complete;
    private readonly SleepAiDiagnostics? diagnostics;

    public SleepAiJobProcessor(SleepAiJobStore store, SleepAiService service, SleepAiDiagnostics? diagnostics = null)
        : this(store.Claim, (claim, ct) => service.PredictQueuedAsync(
            new() { ObjectId = claim.UserId, Email = "" }, claim.Request,
            async token => { await store.EnsureCurrent(claim, token); }, ct), store.Complete, diagnostics) { }

    // Narrow in-memory seam for timing tests; production still uses the same SQL store/service.
    internal SleepAiJobProcessor(Func<CancellationToken, Task<SleepAiJobClaim?>> claimJob,
        Func<SleepAiJobClaim, CancellationToken, Task<SleepPredictionResponse>> predict,
        Func<SleepAiJobClaim, SleepPredictionResponse?, string?, CancellationToken, Task<bool>> complete,
        SleepAiDiagnostics? diagnostics)
    { this.claimJob = claimJob; this.predict = predict; this.complete = complete; this.diagnostics = diagnostics; }

    public async Task<bool> Process(CancellationToken stoppingToken)
    {
        SleepAiJobClaim? claim;
        using (var timing = diagnostics?.Start(SleepAiStage.Claim))
        {
            try
            {
                claim = await claimJob(stoppingToken);
                if (claim is null) timing?.Discard(); // Do not emit empty-queue logs every five seconds.
                else { diagnostics?.SetJob(claim.JobId, claim.Run); timing?.Complete(); }
            }
            catch (Exception claimError) { timing?.Fail(claimError); throw; }
        }
        if (claim is null) return false;
        diagnostics?.WallDuration(SleepAiStage.QueueWait, claim.CreatedAt);
        SleepPredictionResponse? result = null; string? error = null;
        try
        {
            result = await predict(claim, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        { diagnostics?.WallDuration(SleepAiStage.ServerTotal, claim.CreatedAt, "interrupted"); throw; }
        catch (ApiException e) { error = SleepAiJobPolicy.SafeError(e.Code); }
        catch (Exception) { error = "ai_provider_unavailable"; }
        using (var timing = diagnostics?.Start(SleepAiStage.Persist))
        {
            try
            {
                var committed = await complete(claim, result, error, stoppingToken);
                var outcome = committed ? error ?? (result?.Status is "ready" or "insufficient_data" ? "completed" : "failed") : "not_committed";
                timing?.Complete(committed ? "ok" : "not_committed");
                diagnostics?.WallDuration(SleepAiStage.ServerTotal, claim.CreatedAt, outcome);
            }
            catch (Exception failure)
            {
                timing?.Fail(failure);
                diagnostics?.WallDuration(SleepAiStage.ServerTotal, claim.CreatedAt, "not_committed");
                throw;
            }
        }
        return true;
    }
}

public sealed class SleepAiJobWorker(IServiceScopeFactory scopes, IOptions<SleepAiOptions> options,
    RecoveryGate recovery, TimeProvider clock, ILogger<SleepAiJobWorker> logger) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        Task.WhenAll(Run(stoppingToken), Run(stoppingToken));

    private async Task Run(CancellationToken stoppingToken)
    {
        var cleanupAt = DateTimeOffset.MinValue;
        while (!stoppingToken.IsCancellationRequested)
        {
            var handled = false;
            try
            {
                if (!recovery.Blocked)
                {
                    await using var scope = scopes.CreateAsyncScope();
                    var store = scope.ServiceProvider.GetRequiredService<SleepAiJobStore>();
                    if (clock.GetUtcNow() >= cleanupAt)
                    { await store.Cleanup(stoppingToken); cleanupAt = clock.GetUtcNow().AddHours(1); }
                    if (options.Value.IsAvailable)
                        handled = await scope.ServiceProvider.GetRequiredService<SleepAiJobProcessor>().Process(stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception) { logger.LogWarning("AI job processing remains pending; no private details logged."); }
            try { await Task.Delay(TimeSpan.FromSeconds(handled ? 1 : 5), clock, stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
        }
    }
}
