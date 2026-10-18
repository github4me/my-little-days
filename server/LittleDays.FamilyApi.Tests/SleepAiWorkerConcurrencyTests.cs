using System.Threading.Channels;
using System.Collections.Concurrent;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiWorkerConcurrencyTests
{
    [Fact]
    public async Task FiftyProductionScopesKeepEachJobsFailurePayloadIsolatedAndClearItAfterCompletion()
    {
        var clock = new ManualClock(); var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var captures = new List<SleepAiFailureCapture>(); var probes = new List<ScopeProbe>();
        var results = new ConcurrentDictionary<Guid, string>();
        var services = new ServiceCollection();
        services.AddScoped(_ => new SleepAiFailureCapture(clock));
        services.AddScoped(_ => new ScopeProbe());
        services.AddScoped(sp =>
        {
            var capture = sp.GetRequiredService<SleepAiFailureCapture>(); captures.Add(capture);
            probes.Add(sp.GetRequiredService<ScopeProbe>());
            var claim = new SleepAiJobClaim(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), SleepAiJobTests.Request(clock.GetUtcNow()).Request)
                { Run = 1, FailureCaptureHistoryEpoch = Guid.NewGuid() };
            var text = $"synthetic failure for {claim.JobId}";
            return new SleepAiJobProcessor(_ => Task.FromResult<SleepAiJobClaim?>(claim), async (received, ct) =>
            {
                Assert.Same(claim, received);
                capture.Record(1, "invalid_json", null, text, TimeSpan.FromMilliseconds(10), SleepAiOptions.SelectedModel);
                await release.Task.WaitAsync(ct);
                return new(2, claim.Request.InputRevision, "insufficient_data", clock.GetUtcNow(), clock.GetUtcNow().AddDays(1), []);
            }, (received, _, _, _) =>
            {
                Assert.Same(claim, received);
                var failure = Assert.Single(capture.Attempts); Assert.Equal(text, failure.ResponseText);
                Assert.True(results.TryAdd(claim.JobId, failure.ResponseText!)); return Task.FromResult(true);
            }, null, capture);
        });
        await using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
        var tasks = new List<Task>(); var scopes = provider.GetRequiredService<IServiceScopeFactory>();
        for (var i = 0; i < 50; i++) tasks.Add(Assert.IsAssignableFrom<Task>(await SleepAiJobWorker.TryStart(scopes, default)));
        Assert.Equal(50, captures.Distinct().Count()); Assert.Equal(50, probes.Distinct().Count());
        Assert.Equal(50, captures.Select(x => Assert.Single(x.Attempts).ResponseText).Distinct().Count());
        Assert.All(tasks, task => Assert.False(task.IsCompleted)); Assert.All(probes, probe => Assert.Equal(0, probe.Disposals));
        release.SetResult(); await Task.WhenAll(tasks).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(50, results.Count); Assert.Equal(50, results.Values.Distinct().Count());
        Assert.All(captures, capture => Assert.Empty(capture.Attempts)); Assert.All(probes, probe => Assert.Equal(1, probe.Disposals));
    }

    [Theory]
    [InlineData("empty")]
    [InlineData("claim")]
    [InlineData("persist")]
    [InlineData("cancel")]
    public async Task ProductionScopeIsDisposedWhenQueueEmptyOrClaimProcessingIsInterrupted(string state)
    {
        var clock = new ManualClock(); using var stopping = new CancellationTokenSource();
        var probe = new ScopeProbe(); var capture = new SleepAiFailureCapture(clock);
        var services = new ServiceCollection(); services.AddScoped(_ => capture); services.AddScoped(_ => probe);
        services.AddScoped(sp =>
        {
            sp.GetRequiredService<ScopeProbe>(); sp.GetRequiredService<SleepAiFailureCapture>();
            var claim = new SleepAiJobClaim(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), SleepAiJobTests.Request(clock.GetUtcNow()).Request)
                { Run = 1, FailureCaptureHistoryEpoch = Guid.NewGuid() };
            return new SleepAiJobProcessor(_ => state == "claim" ? throw new InvalidOperationException("synthetic")
                : Task.FromResult<SleepAiJobClaim?>(state == "empty" ? null : claim), (received, ct) =>
            {
                capture.Record(1, "invalid_json", null, "synthetic failed output", TimeSpan.Zero, SleepAiOptions.SelectedModel);
                if (state == "cancel") { stopping.Cancel(); ct.ThrowIfCancellationRequested(); }
                return Task.FromResult(new SleepPredictionResponse(2, received.Request.InputRevision, "insufficient_data", clock.GetUtcNow(), clock.GetUtcNow().AddDays(1), []));
            }, (_, _, _, _) => throw new InvalidOperationException("synthetic"), null, capture);
        });
        await using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
        var scopes = provider.GetRequiredService<IServiceScopeFactory>();
        if (state == "claim") await Assert.ThrowsAsync<InvalidOperationException>(() => SleepAiJobWorker.TryStart(scopes, stopping.Token));
        else
        {
            var task = await SleepAiJobWorker.TryStart(scopes, stopping.Token);
            if (state == "empty") Assert.Null(task);
            else if (state == "cancel") await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task!);
            else await Assert.ThrowsAsync<InvalidOperationException>(() => task!);
        }
        Assert.Equal(1, probe.Disposals); Assert.Empty(capture.Attempts);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(7)]
    [InlineData(50)]
    public async Task DispatcherHonorsFiftyOrLowerLimitReusesSlotAndDrainsAllWorkOnShutdown(int limit)
    {
        var options = SleepAiJobTests.Enabled(); options.MaxConcurrentRequests = limit;
        var clock = new ManualClock(); using var stopping = new CancellationTokenSource();
        var releases = Enumerable.Range(0, limit + 1).Select(_ => new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously)).ToArray();
        var started = 0; var active = 0; var maximum = 0; var stopped = 0; var cleanups = 0;
        async Task Work(int index, CancellationToken ct)
        {
            var count = Interlocked.Increment(ref active); maximum = Math.Max(maximum, count);
            try { await releases[index].Task.WaitAsync(ct); }
            finally { Interlocked.Decrement(ref active); Interlocked.Increment(ref stopped); }
        }
        var worker = new SleepAiJobWorker(ct =>
        {
            var index = started++;
            Assert.True(index < releases.Length, "No claim may run while all configured slots are occupied.");
            return Task.FromResult<Task?>(Work(index, ct));
        }, _ => { cleanups++; return Task.CompletedTask; }, () => false, Options.Create(options), clock,
            NullLogger<SleepAiJobWorker>.Instance);

        var run = worker.Run(stopping.Token); var firstWait = await clock.NextWait();
        Assert.Equal(limit, started); Assert.Equal(limit, active); Assert.Equal(limit, maximum); Assert.Equal(1, cleanups);
        releases[0].SetResult();
        var secondWait = await clock.NextWait();
        // WaitAsync may resume the dispatcher before its completion callback has
        // disposed the previous timeout timer. Observe cleanup itself, not the
        // unrelated creation of the replacement timer on another continuation.
        await firstWait.WhenDisposed.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.True(firstWait.Disposed); Assert.Equal(limit + 1, started); Assert.Equal(limit, active);
        Assert.Equal(limit, maximum); Assert.Equal(1, stopped); Assert.Equal(1, cleanups);
        stopping.Cancel(); await run.WaitAsync(TimeSpan.FromSeconds(5));
        await secondWait.WhenDisposed.WaitAsync(TimeSpan.FromSeconds(5)); Assert.True(secondWait.Disposed);
        Assert.Equal(0, active); Assert.Equal(limit + 1, stopped);
    }

    [Fact]
    public async Task EmptyQueueUsesOneFiveSecondPollAndOnlyOneHourlyCleanup()
    {
        var clock = new ManualClock(); using var stopping = new CancellationTokenSource(); var claims = 0; var cleanups = 0;
        var worker = new SleepAiJobWorker(_ => { claims++; return Task.FromResult<Task?>(null); },
            _ => { cleanups++; return Task.CompletedTask; }, () => false, Options.Create(SleepAiJobTests.Enabled()), clock,
            NullLogger<SleepAiJobWorker>.Instance);
        var run = worker.Run(stopping.Token); var wait = await clock.NextWait();
        Assert.Equal(TimeSpan.FromSeconds(5), wait.DueTime); Assert.Equal(1, claims); Assert.Equal(1, cleanups);
        clock.Fire(wait, TimeSpan.FromSeconds(5)); wait = await clock.NextWait();
        Assert.Equal(2, claims); Assert.Equal(1, cleanups);
        clock.Fire(wait, TimeSpan.FromMinutes(59) + TimeSpan.FromSeconds(55)); await clock.NextWait();
        Assert.Equal(3, claims); Assert.Equal(2, cleanups); Assert.Equal(3, clock.Created);
        stopping.Cancel(); await run.WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Theory]
    [InlineData("disabled")]
    [InlineData("blocked")]
    [InlineData("invalid")]
    public async Task DisabledInvalidOrRecoveryBlockedDispatcherDoesNotClaimThenResumes(string state)
    {
        var options = SleepAiJobTests.Enabled(); var blocked = state == "blocked";
        if (state == "disabled") options.Enabled = false;
        if (state == "invalid") options.MaxConcurrentRequests = 51;
        var clock = new ManualClock(); using var stopping = new CancellationTokenSource(); var claims = 0; var cleanups = 0;
        var worker = new SleepAiJobWorker(_ => { claims++; return Task.FromResult<Task?>(null); },
            _ => { cleanups++; return Task.CompletedTask; }, () => blocked, Options.Create(options), clock,
            NullLogger<SleepAiJobWorker>.Instance);
        var run = worker.Run(stopping.Token); var wait = await clock.NextWait();
        Assert.Equal(0, claims); Assert.Equal(blocked ? 0 : 1, cleanups);
        options.Enabled = true; options.MaxConcurrentRequests = 50; blocked = false;
        clock.Fire(wait, TimeSpan.FromSeconds(5)); await clock.NextWait();
        Assert.Equal(1, claims); Assert.Equal(1, cleanups);
        stopping.Cancel(); await run.WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Theory]
    [InlineData("cleanup")]
    [InlineData("claim")]
    [InlineData("work")]
    public async Task DispatcherRecoversFromFailureWithoutLoggingPrivateException(string stage)
    {
        var options = SleepAiJobTests.Enabled(); options.MaxConcurrentRequests = 1;
        var clock = new ManualClock(); var logs = new WorkerLogs(); using var stopping = new CancellationTokenSource();
        var claims = 0; var cleanups = 0;
        var worker = new SleepAiJobWorker(_ =>
        {
            claims++;
            if (claims == 1 && stage == "claim") throw new InvalidOperationException("private record");
            return Task.FromResult<Task?>(claims == 1 && stage == "work" ? Task.FromException(new InvalidOperationException("private record")) : null);
        }, _ =>
        {
            cleanups++;
            if (cleanups == 1 && stage == "cleanup") throw new InvalidOperationException("private record");
            return Task.CompletedTask;
        }, () => false, Options.Create(options), clock, logs);
        var run = worker.Run(stopping.Token); var wait = await clock.NextWait();
        Assert.Single(logs.Messages); Assert.DoesNotContain("private record", logs.Messages[0]); Assert.All(logs.Exceptions, Assert.Null);
        var before = claims; clock.Fire(wait, TimeSpan.FromSeconds(5)); await clock.NextWait();
        Assert.Equal(before + 1, claims);
        stopping.Cancel(); await run.WaitAsync(TimeSpan.FromSeconds(5));
    }

    private sealed class ManualClock : TimeProvider
    {
        private readonly Channel<ControlledTimer> waits = Channel.CreateUnbounded<ControlledTimer>();
        private DateTimeOffset now = DateTimeOffset.Parse("2026-10-18T00:00:00Z");
        public int Created { get; private set; }
        public override DateTimeOffset GetUtcNow() => now;
        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            var timer = new ControlledTimer(callback, state, dueTime); Created++; waits.Writer.TryWrite(timer); return timer;
        }
        public async Task<ControlledTimer> NextWait() => await waits.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));
        public void Fire(ControlledTimer timer, TimeSpan advance) { now += advance; Assert.False(timer.Disposed); timer.Fire(); }
    }

    private sealed class ControlledTimer(TimerCallback callback, object? state, TimeSpan dueTime) : ITimer
    {
        private readonly TaskCompletionSource disposed = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TimeSpan DueTime { get; private set; } = dueTime;
        public bool Disposed => disposed.Task.IsCompletedSuccessfully;
        public Task WhenDisposed => disposed.Task;
        public bool Change(TimeSpan dueTime, TimeSpan period) { DueTime = dueTime; return !Disposed; }
        public void Fire() => callback(state);
        public void Dispose() => disposed.TrySetResult();
        public ValueTask DisposeAsync() { Dispose(); return ValueTask.CompletedTask; }
    }

    private sealed class WorkerLogs : ILogger<SleepAiJobWorker>
    {
        public List<string> Messages { get; } = [];
        public List<Exception?> Exceptions { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        { Messages.Add(formatter(state, exception)); Exceptions.Add(exception); }
    }

    private sealed class ScopeProbe : IDisposable
    {
        public int Disposals { get; private set; }
        public void Dispose() => Disposals++;
    }
}
