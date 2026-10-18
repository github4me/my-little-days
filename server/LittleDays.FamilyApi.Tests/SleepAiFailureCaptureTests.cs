using System.Text.Json;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiFailureCaptureTests
{
    private const string PrivateOutput = "synthetic-invalid-output";
    private const string Ready = """
        {"status":"ready","periods":[{"sleepStart":"2026-10-18T17:00:00Z","sleepEnd":"2026-10-18T18:00:00Z","sootheStart":"2026-10-18T16:40:00Z","sootheEnd":"2026-10-18T16:55:00Z"}]}
        """;

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FailedResponsesRequireServerEpochNotAnEmptyOrUnstartedScope(bool emptyEpoch)
    {
        var f = new Fixture(false, PrivateOutput);
        if (emptyEpoch) f.Capture.StartAutomaticCapture(Guid.Empty);
        Assert.Equal("ai_invalid_response", (await Assert.ThrowsAsync<ApiException>(() => f.Predict())).Code);
        Assert.Equal(2, f.Client.Calls);
        Assert.Empty(f.Capture.Attempts);
        Assert.DoesNotContain(PrivateOutput, f.Logs.Text);
    }

    [Fact]
    public async Task RepairKeepsOnlyFailedResponseAndReason()
    {
        var f = new Fixture(true, PrivateOutput, Ready);
        var result = await f.Predict();
        Assert.Equal("ready", result.Status);
        Assert.Equal(2, f.Client.Calls);
        var attempt = Assert.Single(f.Capture.Attempts);
        Assert.Equal(1, attempt.Attempt);
        Assert.Equal(PrivateOutput, attempt.ResponseText);
        Assert.Equal("invalid_json", attempt.Reason);
        Assert.Equal(new[] { "$" }, attempt.Fields);
        Assert.Null(attempt.PeriodIndex);
        Assert.Equal(PrivateOutput.Length, attempt.OriginalLength);
        Assert.False(attempt.Truncated);
        Assert.Equal(125d, attempt.DurationMs);
        Assert.Equal(SleepAiOptions.SelectedModel, attempt.Model);
        Assert.DoesNotContain(Ready, JsonSerializer.Serialize(f.Capture.Attempts));
        f.AssertNoPrivateLogsOrInputs();
    }

    [Fact]
    public async Task BothInvalidAttemptsAreRetainedWithoutInputOrLogPayloads()
    {
        var f = new Fixture(true, PrivateOutput, "second-invalid-output");
        var error = await Assert.ThrowsAsync<ApiException>(() => f.Predict());
        Assert.Equal("ai_invalid_response", error.Code);
        Assert.Collection(f.Capture.Attempts,
            first => { Assert.Equal(1, first.Attempt); Assert.Equal(PrivateOutput, first.ResponseText); },
            second => { Assert.Equal(2, second.Attempt); Assert.Equal("second-invalid-output", second.ResponseText); });
        Assert.All(f.Capture.Attempts, x => Assert.Equal(125d, x.DurationMs));
        f.AssertNoPrivateLogsOrInputs();
        Assert.DoesNotContain("second-invalid-output", f.Logs.Text);
    }

    [Fact]
    public async Task InvalidPeriodKeepsSpecificReasonAndOutputIndex()
    {
        const string overlappingOutput = """
            {"status":"ready","periods":[
              {"sleepStart":"2026-10-18T17:00:00Z","sleepEnd":"2026-10-18T18:00:00Z","sootheStart":"2026-10-18T16:40:00Z","sootheEnd":"2026-10-18T16:55:00Z"},
              {"sleepStart":"2026-10-18T17:30:00Z","sleepEnd":"2026-10-18T19:00:00Z","sootheStart":"2026-10-18T17:15:00Z","sootheEnd":"2026-10-18T17:25:00Z"}
            ]}
            """;
        var f = new Fixture(true, overlappingOutput, Ready);
        Assert.Equal("ready", (await f.Predict()).Status);
        var failure = Assert.Single(f.Capture.Attempts);
        Assert.Equal("period_overlap", failure.Reason);
        Assert.Equal(1, failure.PeriodIndex);
        Assert.Equal(overlappingOutput, failure.ResponseText);
        Assert.DoesNotContain(overlappingOutput, f.Logs.Text);
    }

    [Theory]
    [InlineData(Ready, "ready")]
    [InlineData("{\"status\":\"insufficient_data\",\"periods\":[]}", "insufficient_data")]
    public async Task SuccessfulOutputIsNotRetained(string output, string status)
    {
        var f = new Fixture(true, output);
        Assert.Equal(status, (await f.Predict()).Status);
        Assert.Empty(f.Capture.Attempts);
        Assert.Equal(1, f.Client.Calls);
    }

    [Theory]
    [InlineData("timeout", "ai_timeout")]
    [InlineData("cancelled", "ai_timeout")]
    [InlineData("busy", "ai_provider_busy")]
    [InlineData("transport", "ai_provider_unavailable")]
    [InlineData("unexpected", "ai_provider_unavailable")]
    public async Task TransportFailuresKeepOnlySafeReasonAndDuration(string kind, string expected)
    {
        var f = new Fixture(true, Ready);
        f.Client.Error = kind switch
        {
            "timeout" => new TimeoutException("private exception body"),
            "cancelled" => new OperationCanceledException("private exception body"),
            "busy" => new HttpRequestException("private exception body", null, System.Net.HttpStatusCode.TooManyRequests),
            "unexpected" => new InvalidOperationException("private exception body"),
            _ => new HttpRequestException("private exception body")
        };
        Assert.Equal(expected, (await Assert.ThrowsAsync<ApiException>(() => f.Predict())).Code);
        var failure = Assert.Single(f.Capture.Attempts);
        Assert.Equal(expected, failure.Reason);
        Assert.Equal(new[] { "$provider" }, failure.Fields);
        Assert.Null(failure.ResponseText);
        Assert.Equal(0, failure.OriginalLength);
        Assert.False(failure.Truncated);
        Assert.Equal(125d, failure.DurationMs);
        Assert.DoesNotContain("private exception", JsonSerializer.Serialize(f.Capture.Attempts));
        Assert.DoesNotContain("private exception", f.Logs.Text);
        f.AssertNoPrivateLogsOrInputs();
    }

    [Fact]
    public async Task InterruptedCompletionRetainsOnlyAssistantTextNotReasoning()
    {
        var f = new Fixture(true, PrivateOutput);
        f.Client.FinishReason = ChatFinishReason.Length;
        f.Client.Reasoning = "private-reasoning-must-not-be-retained";
        Assert.Equal("ai_invalid_response", (await Assert.ThrowsAsync<ApiException>(() => f.Predict())).Code);
        Assert.Equal(2, f.Capture.Attempts.Count);
        Assert.All(f.Capture.Attempts, x =>
        {
            Assert.Equal("incomplete_response", x.Reason);
            Assert.Equal(PrivateOutput, x.ResponseText);
        });
        Assert.DoesNotContain(f.Client.Reasoning, JsonSerializer.Serialize(f.Capture.Attempts));
        Assert.DoesNotContain(f.Client.Reasoning, f.Logs.Text);
    }

    [Fact]
    public async Task ExternalCancellationDoesNotCreateFailureEvidence()
    {
        var f = new Fixture(true, PrivateOutput);
        using var cancellation = new CancellationTokenSource();
        f.Client.OnCall = cancellation.Cancel;
        f.Client.Error = new OperationCanceledException(cancellation.Token);
        await Assert.ThrowsAsync<OperationCanceledException>(() => f.Predict(cancellation.Token));
        Assert.Empty(f.Capture.Attempts);
    }

    [Theory]
    [InlineData(16383, false)]
    [InlineData(16384, false)]
    [InlineData(16385, true)]
    public void FailureResponseSizeBoundaryIsExplicitlyMarked(int length, bool truncated)
    {
        var f = new Fixture(true, Ready);
        f.Capture.Record(1, "invalid_output", null, new string('x', length), TimeSpan.FromSeconds(2), SleepAiOptions.SelectedModel);
        var failure = Assert.Single(f.Capture.Attempts);
        Assert.Equal(Math.Min(length, 16384), failure.ResponseText!.Length);
        Assert.Equal(length, failure.OriginalLength);
        Assert.Equal(truncated, failure.Truncated);
    }

    [Fact]
    public void TruncationDoesNotSplitSurrogatePair()
    {
        var f = new Fixture(true, Ready);
        var output = new string('x', 16383) + "🌙";
        f.Capture.Record(1, "invalid_output", null, output, TimeSpan.Zero, SleepAiOptions.SelectedModel);
        var failure = Assert.Single(f.Capture.Attempts);
        Assert.Equal(new string('x', 16383), failure.ResponseText);
        Assert.True(failure.Truncated);
        Assert.Equal(16385, failure.OriginalLength);
    }

    [Fact]
    public void CaptureIsBoundedToTwoUniqueAttemptsAndSanitizesMetadata()
    {
        var f = new Fixture(true, Ready);
        foreach (var attempt in new[] { 0, 1, 1, 2, 3 })
            f.Capture.Record(attempt, "private exception and input", 99, null, TimeSpan.FromMilliseconds(-1), "private-key");
        Assert.Equal(new[] { 1, 2 }, f.Capture.Attempts.Select(x => x.Attempt));
        Assert.All(f.Capture.Attempts, x =>
        {
            Assert.Equal("invalid_output", x.Reason); Assert.Null(x.PeriodIndex);
            Assert.Equal(0d, x.DurationMs); Assert.Equal("unknown", x.Model);
            Assert.Equal(new[] { "$" }, x.Fields);
        });
    }

    [Fact]
    public void CaptureCopiesDistinctCanonicalOutputFieldsWithoutRetainingCallerMutation()
    {
        var f = new Fixture(true, Ready);
        string[] fields = ["$.periods[0].sleepStart", "$.periods[23].sootheEnd", "$.periods[23].sootheEnd"];
        f.Capture.Record(1, "invalid_schema", 0, PrivateOutput, TimeSpan.Zero, SleepAiOptions.SelectedModel, fields);
        fields[0] = "private-input-value";
        var failure = Assert.Single(f.Capture.Attempts);
        Assert.Equal(new[] { "$.periods[0].sleepStart", "$.periods[23].sootheEnd" }, failure.Fields);
        Assert.Equal("invalid_schema", failure.Reason);
        Assert.DoesNotContain("private-input-value", JsonSerializer.Serialize(failure));
    }

    [Theory]
    [InlineData("$.privateChildName")]
    [InlineData("$.records[0].start")]
    [InlineData("$.periods[-1].sleepStart")]
    [InlineData("$.periods[24].sleepStart")]
    [InlineData("$.periods[01].sleepStart")]
    [InlineData("$.periods[0].sleepStart\n")]
    [InlineData("$provider")]
    public void CaptureRejectsUnapprovedFieldPathsInsteadOfPersistingThem(string path)
    {
        var f = new Fixture(true, Ready);
        f.Capture.Record(1, "invalid_json", null, PrivateOutput, TimeSpan.Zero, SleepAiOptions.SelectedModel, [path]);
        Assert.Equal(new[] { "$" }, Assert.Single(f.Capture.Attempts).Fields);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(5)]
    public void CaptureRejectsEmptyOrOversizedFieldLists(int count)
    {
        var f = new Fixture(true, Ready);
        f.Capture.Record(1, "invalid_json", null, null, TimeSpan.Zero, SleepAiOptions.SelectedModel,
            Enumerable.Repeat("$.status", count).ToArray());
        Assert.Equal(new[] { "$" }, Assert.Single(f.Capture.Attempts).Fields);
    }

    [Fact]
    public void CaptureAcceptsFourCanonicalLocationsButRejectsNullMembers()
    {
        var f = new Fixture(true, Ready);
        string[] fields = ["$", "$.status", "$.periods", "$.periods[23]"];
        f.Capture.Record(1, "invalid_schema", null, null, TimeSpan.Zero, SleepAiOptions.SelectedModel, fields);
        f.Capture.Record(2, "invalid_json", null, null, TimeSpan.Zero, SleepAiOptions.SelectedModel, [null!]);
        Assert.Equal(new[] { "$", "$.status", "$.periods", "$.periods[23]" }, f.Capture.Attempts[0].Fields);
        Assert.Equal(new[] { "$" }, f.Capture.Attempts[1].Fields);
    }

    [Fact]
    public void TransportAndSanitizedUnknownReasonsCannotBorrowUnrelatedOutputFields()
    {
        var f = new Fixture(true, Ready);
        f.Capture.Record(1, "ai_timeout", null, null, TimeSpan.Zero, SleepAiOptions.SelectedModel, ["$.status"]);
        f.Capture.Record(2, "private-exception", null, null, TimeSpan.Zero, SleepAiOptions.SelectedModel, ["$.status"]);
        Assert.Equal(new[] { "$provider" }, f.Capture.Attempts[0].Fields);
        Assert.Equal(new[] { "$" }, f.Capture.Attempts[1].Fields);
    }

    [Fact]
    public void FailedOutputExpiresExactlySevenDaysAfterFailure()
    {
        var f = new Fixture(true, Ready);
        f.Capture.Record(1, "invalid_output", null, PrivateOutput, TimeSpan.Zero, SleepAiOptions.SelectedModel);
        var failure = Assert.Single(f.Capture.Attempts);
        Assert.Equal(DateTimeOffset.Parse("2026-10-18T14:00:00Z"), failure.OccurredAt);
        Assert.Equal(DateTimeOffset.Parse("2026-10-25T14:00:00Z"), failure.ExpiresAt);
        Assert.True(failure.ExpiresAt > DateTimeOffset.Parse("2026-10-25T13:59:59.9999999Z"));
        Assert.False(failure.ExpiresAt > DateTimeOffset.Parse("2026-10-25T14:00:00Z"));
        Assert.False(failure.ExpiresAt > DateTimeOffset.Parse("2026-10-25T14:00:00.0000001Z"));
    }

    [Fact]
    public void NewScopeOrDisposalClearsPriorPrivateOutput()
    {
        var f = new Fixture(true, Ready);
        f.Capture.Record(1, "invalid_output", null, PrivateOutput, TimeSpan.Zero, SleepAiOptions.SelectedModel);
        f.Capture.StartAutomaticCapture(null);
        Assert.Empty(f.Capture.Attempts);
        f.Capture.Record(1, "invalid_output", null, PrivateOutput, TimeSpan.Zero, SleepAiOptions.SelectedModel);
        Assert.Empty(f.Capture.Attempts);
        f.Capture.StartAutomaticCapture(Guid.NewGuid());
        f.Capture.Record(1, "invalid_output", null, PrivateOutput, TimeSpan.Zero, SleepAiOptions.SelectedModel);
        Assert.Single(f.Capture.Attempts);
        f.Capture.Dispose();
        Assert.Empty(f.Capture.Attempts);
        f.Capture.Record(1, "invalid_output", null, PrivateOutput, TimeSpan.Zero, SleepAiOptions.SelectedModel);
        Assert.Empty(f.Capture.Attempts);
    }

    [Theory]
    [InlineData(false, 0)]
    [InlineData(true, 1)]
    public async Task WorkerStartsAutomaticCaptureFromClaimedServerEpochNotPreviousScope(bool automatic, int expected)
    {
        var f = new Fixture(true, Ready);
        var claim = new SleepAiJobClaim(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), f.Request)
            { FailureCaptureHistoryEpoch = automatic ? Guid.NewGuid() : null };
        var processor = new SleepAiJobProcessor(_ => Task.FromResult<SleepAiJobClaim?>(claim),
            (_, _) =>
            {
                f.Capture.Record(1, "invalid_output", null, PrivateOutput, TimeSpan.Zero, SleepAiOptions.SelectedModel);
                throw new ApiException(503, "ai_invalid_response");
            }, (_, _, error, _) =>
            {
                Assert.Equal("ai_invalid_response", error);
                Assert.Equal(expected, f.Capture.Attempts.Count);
                return Task.FromResult(true);
            }, null, f.Capture);
        Assert.True(await processor.Process(default));
    }

    private sealed class Fixture
    {
        public TimingClock Clock { get; } = new() { Utc = DateTimeOffset.Parse("2026-10-18T14:00:00Z") };
        public TimingLogs Logs { get; } = new();
        public SleepAiFailureCapture Capture { get; }
        public ChatFake Client { get; }
        public SleepAiService Service { get; }
        public SleepPredictionRequest Request { get; }
        public Fixture(bool automatic, params string[] outputs)
        {
            Capture = new(Clock); Capture.StartAutomaticCapture(automatic ? Guid.NewGuid() : null); Client = new(Clock, outputs);
            var options = Options.Create(new SleepAiOptions
            {
                Enabled = true, ChildDataProcessingApproved = true, ZeroDataRetentionApproved = true,
                HardSpendControlVerified = true, ApiKey = "synthetic-credential"
            });
            var diagnostics = new SleepAiDiagnostics(Logs, Clock);
            Service = new(options, new Access(), new OpenAiSleepProvider(Client, options, diagnostics, Capture),
                new(Clock, options), Clock, diagnostics: diagnostics, failures: Capture);
            Request = new()
            {
                SchemaVersion = 2, ConsentVersion = "sleep-ai-v2", InputRevision = new('a', 64), AgeDays = 100,
                TimeZone = "UTC", Now = Clock.Utc, FamilyId = null, MembershipId = null, HistoryId = null,
                PreviousEstimate = null,
                Records = [new() { Kind = "feed", Start = Clock.Utc.AddHours(-1), End = null, Ongoing = false, FeedKind = "formula", AmountMl = 135 }]
            };
        }
        public Task<SleepPredictionResponse> Predict(CancellationToken ct = default) =>
            Service.PredictAsync(new() { ObjectId = Guid.NewGuid(), Email = "synthetic-user@example.test" }, Request, ct);
        public void AssertNoPrivateLogsOrInputs()
        {
            Assert.DoesNotContain(PrivateOutput, Logs.Text);
            Assert.DoesNotContain(Ready, Logs.Text);
            Assert.All(Logs.Exceptions, Assert.Null);
            var diagnostics = JsonSerializer.Serialize(Capture.Attempts);
            foreach (var excluded in new[] { "synthetic-credential", "synthetic-user@example.test", Request.InputRevision, "ageDays", "records", "amountMl", "formula" })
            {
                Assert.DoesNotContain(excluded, diagnostics);
                Assert.DoesNotContain(excluded, Logs.Text);
            }
        }
    }

    private sealed class Access : ISleepAiAccess
    {
        public Task AuthorizeAsync(PilotIdentity user, SleepPredictionRequest request, CancellationToken ct) => Task.CompletedTask;
    }

    private sealed class ChatFake(TimingClock clock, string[] outputs) : IChatClient
    {
        public int Calls;
        public Exception? Error;
        public Action? OnCall;
        public ChatFinishReason FinishReason = ChatFinishReason.Stop;
        public string? Reasoning;
        public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
        {
            clock.Advance(125); Calls++; OnCall?.Invoke();
            if (Error is not null) throw Error;
            var message = new ChatMessage(ChatRole.Assistant, outputs[Math.Min(Calls - 1, outputs.Length - 1)]);
            if (Reasoning is not null) message.Contents.Add(new TextReasoningContent(Reasoning));
            return Task.FromResult(new ChatResponse(message) { FinishReason = FinishReason });
        }
        public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public object? GetService(Type serviceType, object? serviceKey = null) => null;
        public void Dispose() { }
    }
}
