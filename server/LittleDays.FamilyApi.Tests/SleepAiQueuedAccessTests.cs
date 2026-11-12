using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiQueuedAccessTests
{
    [Fact]
    public async Task QueuedSuccessUsesOnlyTheAuthoritativeCallbackBeforeAndAfterTheProvider()
    {
        var f = new Fixture(SleepAiJobTests.Output);
        var result = await f.Service.PredictQueuedAsync(f.User, f.Request, f.AuthorizeJob(), default);
        Assert.Equal("insufficient_data", result.Status); Assert.Equal(f.Request.InputRevision, result.InputRevision);
        Assert.Equal(SleepAiValidation.ValidateRequest(f.Request, f.Request.Now).TodayEnd, result.ExpiresAt);
        Assert.Equal(0, f.Access.Calls); Assert.Equal(2, f.JobChecks);
        Assert.Equal(1, f.Provider.Calls); Assert.Equal(1, f.Attempts.Reserved); Assert.Equal(1, f.Attempts.Released);
        Assert.Same(f.Request, Assert.Single(f.Provider.Requests)); Assert.Equal([false], f.Provider.Retries);
        Assert.Equal(["job:1", "reserve:1", "provider:1", "job:2", "release:1"], f.Events);
    }

    [Fact]
    public async Task QueuedRepairRechecksCallbackBeforeEachAttemptAndAfterEachResponse()
    {
        var f = new Fixture("invalid synthetic output", SleepAiJobTests.Output);
        var result = await f.Service.PredictQueuedAsync(f.User, f.Request, f.AuthorizeJob(), default);
        Assert.Equal("insufficient_data", result.Status); Assert.Equal(0, f.Access.Calls); Assert.Equal(4, f.JobChecks);
        Assert.Equal(2, f.Provider.Calls); Assert.Equal(2, f.Attempts.Reserved); Assert.Equal(2, f.Attempts.Released);
        Assert.Equal([false, true], f.Provider.Retries); Assert.All(f.Provider.Requests, request => Assert.Same(f.Request, request));
        Assert.Equal(["job:1", "reserve:1", "provider:1", "job:2", "release:1",
            "job:3", "reserve:2", "provider:2", "job:4", "release:2"], f.Events);
    }

    [Theory]
    [InlineData(1, 0)]
    [InlineData(2, 1)]
    [InlineData(3, 1)]
    [InlineData(4, 2)]
    public async Task QueuedRevocationAtEveryAuthorizationGateRejectsUnverifiedDispatchOrResult(int revokedAt, int providerCalls)
    {
        var f = new Fixture(revokedAt <= 2 ? SleepAiJobTests.Output : "invalid synthetic output", SleepAiJobTests.Output);
        var error = await Assert.ThrowsAsync<ApiException>(() => f.Service.PredictQueuedAsync(f.User, f.Request,
            f.AuthorizeJob(revokedAt), default));
        Assert.Equal("ai_consent_revoked", error.Code); Assert.Equal(403, error.Status);
        Assert.Equal(revokedAt, f.JobChecks); Assert.Equal(0, f.Access.Calls);
        Assert.Equal(providerCalls, f.Provider.Calls);
        Assert.Equal(providerCalls, f.Attempts.Reserved); Assert.Equal(providerCalls, f.Attempts.Released);
        Assert.Equal(EventsThroughRevocation("job", revokedAt), f.Events);
    }

    [Theory]
    [InlineData(false, 2, 1)]
    [InlineData(true, 4, 2)]
    public async Task DirectRequestsKeepLegacyAuthorizationBeforeAndAfterEveryAttempt(bool repair, int checks, int providerCalls)
    {
        var f = new Fixture(repair ? "invalid synthetic output" : SleepAiJobTests.Output, SleepAiJobTests.Output);
        var result = await f.Service.PredictAsync(f.User, f.Request, default);
        Assert.Equal("insufficient_data", result.Status); Assert.Equal(checks, f.Access.Calls); Assert.Equal(0, f.JobChecks);
        Assert.Equal(providerCalls, f.Provider.Calls);
        Assert.Equal(providerCalls, f.Attempts.Reserved); Assert.Equal(providerCalls, f.Attempts.Released);
        string[] expected = repair
            ? ["access:1", "reserve:1", "provider:1", "access:2", "release:1", "access:3", "reserve:2", "provider:2", "access:4", "release:2"]
            : ["access:1", "reserve:1", "provider:1", "access:2", "release:1"];
        Assert.Equal(expected, f.Events);
    }

    [Theory]
    [InlineData(1, 0)]
    [InlineData(2, 1)]
    [InlineData(3, 1)]
    [InlineData(4, 2)]
    public async Task DirectRequestRevocationStillBlocksEachDispatchOrResult(int revokedAt, int providerCalls)
    {
        var f = new Fixture(revokedAt <= 2 ? SleepAiJobTests.Output : "invalid synthetic output", SleepAiJobTests.Output);
        f.Access.RevokedAt = revokedAt;
        var error = await Assert.ThrowsAsync<ApiException>(() => f.Service.PredictAsync(f.User, f.Request, default));
        Assert.Equal("membership_revoked", error.Code); Assert.Equal(403, error.Status);
        Assert.Equal(revokedAt, f.Access.Calls); Assert.Equal(0, f.JobChecks);
        Assert.Equal(providerCalls, f.Provider.Calls);
        Assert.Equal(providerCalls, f.Attempts.Reserved); Assert.Equal(providerCalls, f.Attempts.Released);
        Assert.Equal(EventsThroughRevocation("access", revokedAt), f.Events);
    }

    [Fact]
    public async Task QueuedAuthorizationCancellationDoesNotDispatchOrSpendAndPreservesCallerCancellation()
    {
        var f = new Fixture(SleepAiJobTests.Output); using var cancellation = new CancellationTokenSource();
        var checks = 0;
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => f.Service.PredictQueuedAsync(f.User, f.Request, token =>
        {
            checks++; Assert.Equal(cancellation.Token, token); cancellation.Cancel();
            return Task.FromCanceled(token);
        }, cancellation.Token));
        Assert.Equal(1, checks); Assert.Equal(0, f.Access.Calls); Assert.Equal(0, f.Provider.Calls);
        Assert.Equal(0, f.Attempts.Reserved); Assert.Equal(0, f.Attempts.Released); Assert.True(cancellation.IsCancellationRequested);
    }

    private static string[] EventsThroughRevocation(string authority, int check) => check switch
    {
        1 => [$"{authority}:1"],
        2 => [$"{authority}:1", "reserve:1", "provider:1", $"{authority}:2", "release:1"],
        3 => [$"{authority}:1", "reserve:1", "provider:1", $"{authority}:2", "release:1", $"{authority}:3"],
        _ => [$"{authority}:1", "reserve:1", "provider:1", $"{authority}:2", "release:1", $"{authority}:3",
            "reserve:2", "provider:2", $"{authority}:4", "release:2"]
    };

    private sealed class Fixture
    {
        public List<string> Events { get; } = [];
        public SleepAiJobTests.Clock Clock { get; } = new();
        public AccessProbe Access { get; }
        public ProviderProbe Provider { get; }
        public AttemptProbe Attempts { get; }
        public SleepAiService Service { get; }
        public PilotIdentity User { get; } = new() { ObjectId = Guid.NewGuid() };
        public SleepPredictionRequest Request { get; }
        public int JobChecks { get; private set; }
        public Fixture(params string[] outputs)
        {
            var options = Options.Create(SleepAiJobTests.Enabled());
            Access = new(Events); Provider = new(Events, outputs); Attempts = new(Events);
            Request = SleepAiJobTests.Request(Clock.Now).Request;
            Service = new(options, Access, Provider, new(Clock, options), Clock, Attempts);
        }
        public Func<CancellationToken, Task> AuthorizeJob(int? revokedAt = null) => token =>
        {
            token.ThrowIfCancellationRequested(); JobChecks++; Events.Add($"job:{JobChecks}");
            if (JobChecks == revokedAt) throw new ApiException(403, "ai_consent_revoked");
            return Task.CompletedTask;
        };
    }

    private sealed class AccessProbe(List<string> events) : ISleepAiAccess
    {
        public int Calls { get; private set; }
        public int? RevokedAt { get; set; }
        public Task AuthorizeAsync(PilotIdentity user, SleepPredictionRequest request, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested(); Calls++; events.Add($"access:{Calls}");
            if (Calls == RevokedAt) throw new ApiException(403, "membership_revoked");
            return Task.CompletedTask;
        }
    }

    private sealed class ProviderProbe(List<string> events, string[] outputs) : ISleepAiProvider
    {
        public int Calls { get; private set; }
        public List<SleepPredictionRequest> Requests { get; } = [];
        public List<bool> Retries { get; } = [];
        public Task<string?> GenerateAsync(SleepPredictionRequest request, SleepAiTimeBounds bounds, bool retry, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested(); Calls++; events.Add($"provider:{Calls}"); Requests.Add(request); Retries.Add(retry);
            return Task.FromResult<string?>(outputs[Math.Min(Calls - 1, outputs.Length - 1)]);
        }
    }

    private sealed class AttemptProbe(List<string> events) : ISleepAiAttemptStore
    {
        public int Reserved { get; private set; }
        public int Released { get; private set; }
        public Task<IAsyncDisposable> Reserve(Guid userId, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested(); Reserved++; events.Add($"reserve:{Reserved}");
            return Task.FromResult<IAsyncDisposable>(new Lease(this, Reserved));
        }
        private void Release(int attempt) { Released++; events.Add($"release:{attempt}"); }
        private sealed class Lease(AttemptProbe owner, int attempt) : IAsyncDisposable
        {
            public ValueTask DisposeAsync()
            { owner.Release(attempt); return ValueTask.CompletedTask; }
        }
    }
}
