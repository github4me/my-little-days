namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiJobTimingTests
{
    private static SleepAiJobClaim Claim(TimingClock clock) => new(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), new()
    {
        SchemaVersion = 2, InputRevision = new('a', 64), ConsentVersion = "sleep-ai-v2", AgeDays = 100,
        TimeZone = "Australia/Melbourne", Now = clock.Utc, Records = [],
        FamilyId = null, MembershipId = null, HistoryId = null
    }) { CreatedAt = clock.Utc.AddSeconds(-4), Run = 1 };

    [Theory]
    [InlineData(true, "completed", "ok")]
    [InlineData(false, "not_committed", "not_committed")]
    public async Task WorkerSeparatesQueueClaimAndPersistenceAndOnlyReportsCommittedSuccess(bool committed, string totalOutcome, string persistOutcome)
    {
        var clock = new TimingClock(); var logs = new TimingLogs(); var diagnostics = new SleepAiDiagnostics(logs, clock);
        var claim = Claim(clock); var writes = 0;
        var result = new SleepPredictionResponse(2, claim.Request.InputRevision, "insufficient_data", clock.Utc, clock.Utc.AddHours(10), []);
        var processor = new SleepAiJobProcessor(
            _ => { clock.Advance(100); return Task.FromResult<SleepAiJobClaim?>(claim); },
            (received, _) => { Assert.Same(claim, received); clock.Advance(800); return Task.FromResult(result); },
            (received, prediction, error, _) =>
            { Assert.Same(claim, received); Assert.Same(result, prediction); Assert.Null(error); writes++; clock.Advance(200); return Task.FromResult(committed); }, diagnostics);
        Assert.True(await processor.Process(default)); Assert.Equal(1, writes);
        Assert.Equal(4, logs.Events.Count);
        Assert.Equal(100d, logs.Events.Single(x => (string)x["Stage"]! == "Claim")["DurationMs"]);
        Assert.Equal(4100d, logs.Events.Single(x => (string)x["Stage"]! == "QueueWait")["DurationMs"]);
        var persisted = logs.Events.Single(x => (string)x["Stage"]! == "Persist");
        Assert.Equal(200d, persisted["DurationMs"]); Assert.Equal(persistOutcome, persisted["Outcome"]);
        var total = logs.Events.Single(x => (string)x["Stage"]! == "ServerTotal");
        Assert.Equal(5100d, total["DurationMs"]); Assert.Equal(totalOutcome, total["Outcome"]);
        Assert.Single(logs.Events.Select(x => x["Job"]).Distinct());
        Assert.All(logs.Events, row => Assert.Equal(1, row["Run"]));
        Assert.DoesNotContain(claim.UserId.ToString(), logs.Text); Assert.DoesNotContain(claim.Request.InputRevision, logs.Text);
    }

    [Fact]
    public async Task WorkerLogsProviderTimeoutAndPersistenceFailureWithoutPrivateErrors()
    {
        var clock = new TimingClock(); var logs = new TimingLogs(); var diagnostics = new SleepAiDiagnostics(logs, clock);
        var claim = Claim(clock); var failure = new InvalidOperationException("private SQL and records");
        var processor = new SleepAiJobProcessor(_ => Task.FromResult<SleepAiJobClaim?>(claim),
            (_, _) => { clock.Advance(60000); throw new ApiException(504, "ai_timeout"); },
            (_, prediction, error, _) => { Assert.Null(prediction); Assert.Equal("ai_timeout", error); clock.Advance(55); throw failure; }, diagnostics);
        Assert.Same(failure, await Assert.ThrowsAsync<InvalidOperationException>(() => processor.Process(default)));
        Assert.Equal("error", logs.Events.Single(x => (string)x["Stage"]! == "Persist")["Outcome"]);
        Assert.Equal("not_committed", logs.Events.Single(x => (string)x["Stage"]! == "ServerTotal")["Outcome"]);
        Assert.Equal(64055d, logs.Events.Single(x => (string)x["Stage"]! == "ServerTotal")["DurationMs"]);
        Assert.DoesNotContain("private", logs.Text); Assert.All(logs.Exceptions, Assert.Null);
    }

    [Fact]
    public async Task EmptyQueueDoesNotProduceLogsOrProviderCalls()
    {
        var logs = new TimingLogs(); var calls = 0;
        var processor = new SleepAiJobProcessor(_ => Task.FromResult<SleepAiJobClaim?>(null),
            (_, _) => { calls++; throw new InvalidOperationException(); },
            (_, _, _, _) => { calls++; throw new InvalidOperationException(); }, new(logs, new TimingClock()));
        Assert.False(await processor.Process(default)); Assert.Empty(logs.Events); Assert.Equal(0, calls);
    }

    [Fact]
    public async Task ShutdownLogsInterruptedTotalWithoutAcknowledgingCompletion()
    {
        var clock = new TimingClock(); var logs = new TimingLogs(); var writes = 0; var claim = Claim(clock);
        using var cancellation = new CancellationTokenSource();
        var processor = new SleepAiJobProcessor(_ => Task.FromResult<SleepAiJobClaim?>(claim),
            (_, _) => { clock.Advance(500); cancellation.Cancel(); throw new OperationCanceledException(cancellation.Token); },
            (_, _, _, _) => { writes++; return Task.FromResult(true); }, new(logs, clock));
        await Assert.ThrowsAsync<OperationCanceledException>(() => processor.Process(cancellation.Token));
        Assert.Equal(0, writes); Assert.DoesNotContain(logs.Events, x => (string)x["Stage"]! == "Persist");
        Assert.Equal("interrupted", logs.Events.Single(x => (string)x["Stage"]! == "ServerTotal")["Outcome"]);
    }
}
