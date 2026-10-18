using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi;

public sealed class SleepAiJobProcessor
{
    private readonly Func<CancellationToken, Task<SleepAiJobClaim?>> claimJob;
    private readonly Func<SleepAiJobClaim, CancellationToken, Task<SleepPredictionResponse>> predict;
    private readonly Func<SleepAiJobClaim, SleepPredictionResponse?, string?, CancellationToken, Task<bool>> complete;
    private readonly SleepAiDiagnostics? diagnostics;
    private readonly SleepAiFailureCapture? failures;
    private readonly SleepAiExchangeCapture? exchanges;
    private readonly SleepAiJobStore? exchangeStore;

    public SleepAiJobProcessor(SleepAiJobStore store, SleepAiService service, SleepAiDiagnostics? diagnostics = null,
        SleepAiFailureCapture? failures = null, SleepAiExchangeCapture? exchanges = null)
        : this(store.Claim, (claim, ct) => service.PredictQueuedAsync(
            new() { ObjectId = claim.UserId, Email = "" }, claim.Request,
            async token => { await store.EnsureCurrent(claim, token); }, ct), store.Complete, diagnostics, failures)
    { this.exchanges = exchanges; exchangeStore = store; }

    // Narrow in-memory seam for timing tests; production still uses the same SQL store/service.
    internal SleepAiJobProcessor(Func<CancellationToken, Task<SleepAiJobClaim?>> claimJob,
        Func<SleepAiJobClaim, CancellationToken, Task<SleepPredictionResponse>> predict,
        Func<SleepAiJobClaim, SleepPredictionResponse?, string?, CancellationToken, Task<bool>> complete,
        SleepAiDiagnostics? diagnostics, SleepAiFailureCapture? failures = null)
    { this.claimJob = claimJob; this.predict = predict; this.complete = complete; this.diagnostics = diagnostics; this.failures = failures; }

    public async Task<bool> Process(CancellationToken stoppingToken)
    {
        var claim = await Claim(stoppingToken);
        if (claim is null) return false;
        await Process(claim, stoppingToken);
        return true;
    }

    internal async Task<SleepAiJobClaim?> Claim(CancellationToken stoppingToken)
    {
        failures?.StartAutomaticCapture(null);
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
        return claim;
    }

    internal async Task Process(SleepAiJobClaim claim, CancellationToken stoppingToken)
    {
        failures?.StartAutomaticCapture(claim.FailureCaptureHistoryEpoch);
        if (exchangeStore is not null) exchanges?.Start(claim, (value, token) => exchangeStore.StoreExchange(claim, value, token));
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
    }
}

public sealed class SleepAiJobWorker : BackgroundService
{
    private readonly Func<CancellationToken, Task<Task?>> tryStart;
    private readonly Func<CancellationToken, Task> cleanup;
    private readonly Func<bool> blocked;
    private readonly IOptions<SleepAiOptions> options;
    private readonly TimeProvider clock;
    private readonly ILogger<SleepAiJobWorker> logger;

    public SleepAiJobWorker(IServiceScopeFactory scopes, IOptions<SleepAiOptions> options,
        RecoveryGate recovery, TimeProvider clock, ILogger<SleepAiJobWorker> logger)
        : this(ct => TryStart(scopes, ct), async ct =>
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<SleepAiJobStore>().Cleanup(ct);
        }, () => recovery.Blocked, options, clock, logger) { }

    // Exercises the dispatcher without SQL/provider calls. Production delegates
    // below give each claimed job its own scope until completion.
    internal SleepAiJobWorker(Func<CancellationToken, Task<Task?>> tryStart,
        Func<CancellationToken, Task> cleanup, Func<bool> blocked, IOptions<SleepAiOptions> options,
        TimeProvider clock, ILogger<SleepAiJobWorker> logger)
    {
        this.tryStart = tryStart; this.cleanup = cleanup; this.blocked = blocked;
        this.options = options; this.clock = clock; this.logger = logger;
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken) => Run(stoppingToken);

    internal async Task Run(CancellationToken stoppingToken)
    {
        var cleanupAt = DateTimeOffset.MinValue;
        var active = new List<Task>();
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                foreach (var done in active.Where(x => x.IsCompleted).ToArray())
                {
                    await Observe(done, stoppingToken);
                    active.Remove(done);
                }
                try
                {
                    if (!blocked())
                    {
                        if (clock.GetUtcNow() >= cleanupAt)
                        { await cleanup(stoppingToken); cleanupAt = clock.GetUtcNow().AddHours(1); }
                        if (options.Value.IsAvailable && active.Count < options.Value.ConcurrentRequestLimit)
                        {
                            // One claim at a time: an empty queue costs one poll,
                            // not fifty independent polling and cleanup loops.
                            var work = await tryStart(stoppingToken);
                            if (work is not null) { active.Add(work); continue; }
                        }
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (Exception) { Warn(); }
                if (active.Count == 0) await Task.Delay(TimeSpan.FromSeconds(5), clock, stoppingToken);
                else
                {
                    try { await Task.WhenAny(active).WaitAsync(TimeSpan.FromSeconds(5), clock, stoppingToken); }
                    catch (TimeoutException) { }
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally { await Task.WhenAll(active.Select(task => Observe(task, stoppingToken))); }
    }

    private async Task Observe(Task work, CancellationToken stoppingToken)
    {
        try { await work; }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        catch (Exception) { Warn(); }
    }

    private void Warn() => logger.LogWarning("AI job processing remains pending; no private details logged.");

    internal static async Task<Task?> TryStart(IServiceScopeFactory scopes, CancellationToken ct)
    {
        var scope = scopes.CreateAsyncScope();
        try
        {
            var processor = scope.ServiceProvider.GetRequiredService<SleepAiJobProcessor>();
            var claim = await processor.Claim(ct);
            if (claim is not null) return ProcessScoped(scope, processor, claim, ct);
        }
        catch { await scope.DisposeAsync(); throw; }
        await scope.DisposeAsync();
        return null;
    }

    private static async Task ProcessScoped(AsyncServiceScope scope, SleepAiJobProcessor processor,
        SleepAiJobClaim claim, CancellationToken ct)
    {
        await using (scope) await processor.Process(claim, ct);
    }
}
