using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi;

public sealed class SleepAiJobProcessor(SleepAiJobStore store, SleepAiService service)
{
    public async Task<bool> Process(CancellationToken stoppingToken)
    {
        var claim = await store.Claim(stoppingToken);
        if (claim is null) return false;
        SleepPredictionResponse? result = null; string? error = null;
        try
        {
            result = await service.PredictQueuedAsync(new() { ObjectId = claim.UserId, Email = "" }, claim.Request,
                async ct => { await store.EnsureCurrent(claim, ct); }, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { throw; }
        catch (ApiException e) { error = SleepAiJobPolicy.SafeError(e.Code); }
        catch (Exception) { error = "ai_provider_unavailable"; }
        await store.Complete(claim, result, error, stoppingToken);
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
