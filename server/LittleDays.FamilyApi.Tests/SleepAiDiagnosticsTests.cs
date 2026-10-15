using Microsoft.Extensions.Logging;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiDiagnosticsTests
{
    [Fact]
    public void TimingsUseMonotonicClockAndAllowlistedMetadataWithoutPrivateText()
    {
        var clock = new TimingClock(); var logs = new TimingLogs(); var diagnostics = new SleepAiDiagnostics(logs, clock);
        var id = Guid.NewGuid(); diagnostics.SetJob(id, 2);
        var timing = diagnostics.Start(SleepAiStage.Provider, 2);
        clock.Advance(1750); clock.Utc = clock.Utc.AddHours(-1);
        timing.ProviderMetadata("private-model-name", "private-tier", 15, 8, -1);
        timing.Fail(new ApiException(500, "private exception and patient text"));
        timing.Dispose(); timing.Dispose();
        var entry = Assert.Single(logs.Events);
        Assert.Equal(LogLevel.Information, Assert.Single(logs.Levels)); Assert.Equal(4100, Assert.Single(logs.Ids));
        Assert.Equal(1750d, entry["DurationMs"]); Assert.Equal(2, entry["Attempt"]); Assert.Equal(2, entry["Run"]);
        Assert.Equal("Provider", entry["Stage"]); Assert.Equal("ai_provider_unavailable", entry["Outcome"]);
        Assert.Equal("other_configured_model", entry["Model"]); Assert.Equal("unknown", entry["ServiceTier"]);
        Assert.Equal(15L, entry["InputTokens"]); Assert.Equal(8L, entry["OutputTokens"]); Assert.Null(entry["CachedInputTokens"]);
        Assert.DoesNotContain("private", logs.Text); Assert.DoesNotContain(id.ToString(), logs.Text);
        Assert.DoesNotContain(id.ToString("N"), logs.Text); Assert.All(logs.Exceptions, Assert.Null);
    }

    [Fact]
    public async Task MeasuredOperationsPreserveResultsFailuresAndJobCorrelation()
    {
        var clock = new TimingClock(); var logs = new TimingLogs(); var diagnostics = new SleepAiDiagnostics(logs, clock);
        var job = Guid.NewGuid(); diagnostics.SetJob(job);
        var value = await diagnostics.MeasureAsync(SleepAiStage.Enqueue, () => { clock.Advance(125); return Task.FromResult(42); });
        Assert.Equal(42, value); Assert.Equal(125d, logs.Events[0]["DurationMs"]);
        var failure = new TimeoutException("private-response");
        Assert.Same(failure, await Assert.ThrowsAsync<TimeoutException>(() => diagnostics.MeasureAsync<int>(SleepAiStage.Poll, () =>
        { clock.Advance(75); throw failure; })));
        Assert.Equal(75d, logs.Events[1]["DurationMs"]); Assert.Equal("ai_timeout", logs.Events[1]["Outcome"]);
        Assert.Equal(logs.Events[0]["Job"], logs.Events[1]["Job"]); Assert.DoesNotContain("private-response", logs.Text);
        diagnostics.SetJob(Guid.NewGuid());
        diagnostics.WallDuration(SleepAiStage.QueueWait, clock.Utc.AddSeconds(1));
        Assert.Equal(0d, logs.Events[2]["DurationMs"]); Assert.NotEqual(logs.Events[0]["Job"], logs.Events[2]["Job"]);
    }

    [Fact]
    public async Task BrokenLoggerCannotFailSuccessfulWorkOrReplaceOriginalFailure()
    {
        var logs = new TimingLogs { Throw = true }; var diagnostics = new SleepAiDiagnostics(logs, new TimingClock());
        Assert.Equal(7, await diagnostics.MeasureAsync(SleepAiStage.Enqueue, () => Task.FromResult(7)));
        var original = new InvalidOperationException("original-private-error");
        Assert.Same(original, await Assert.ThrowsAsync<InvalidOperationException>(() =>
            diagnostics.MeasureAsync<int>(SleepAiStage.Poll, () => throw original)));
    }

    [Theory]
    [InlineData("priority")]
    [InlineData("fast")]
    [InlineData("default")]
    [InlineData("flex")]
    public void ProviderMetadataKeepsActualTierAndNonnegativeTokenCounts(string tier)
    {
        var logs = new TimingLogs(); var diagnostics = new SleepAiDiagnostics(logs, new TimingClock());
        using (var timing = diagnostics.Start(SleepAiStage.Provider, 1))
        { timing.ProviderMetadata("gpt-6-luna", tier, 100, 25, 60); timing.Complete(); }
        var row = Assert.Single(logs.Events);
        Assert.Equal(tier, row["ServiceTier"]); Assert.Equal("gpt-6-luna", row["Model"]);
        Assert.Equal(100L, row["InputTokens"]); Assert.Equal(25L, row["OutputTokens"]); Assert.Equal(60L, row["CachedInputTokens"]);
    }
}

internal sealed class TimingClock : TimeProvider
{
    public DateTimeOffset Utc = DateTimeOffset.Parse("2026-10-15T02:00:00Z");
    private long timestamp;
    public override long TimestampFrequency => 1000;
    public override long GetTimestamp() => timestamp;
    public override DateTimeOffset GetUtcNow() => Utc;
    public void Advance(int milliseconds) { timestamp += milliseconds; Utc = Utc.AddMilliseconds(milliseconds); }
}

internal sealed class TimingLogs : ILogger<SleepAiDiagnostics>
{
    public List<Dictionary<string, object?>> Events { get; } = [];
    public List<Exception?> Exceptions { get; } = [];
    public List<LogLevel> Levels { get; } = [];
    public List<int> Ids { get; } = [];
    public string Text = "";
    public bool Throw;
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
    public bool IsEnabled(LogLevel logLevel) => true;
    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
        if (Throw) throw new InvalidOperationException("logging sink unavailable");
        Levels.Add(logLevel); Ids.Add(eventId.Id);
        Events.Add(((IEnumerable<KeyValuePair<string, object?>>)state!).ToDictionary(x => x.Key, x => x.Value));
        Exceptions.Add(exception); Text += formatter(state, exception);
    }
}
