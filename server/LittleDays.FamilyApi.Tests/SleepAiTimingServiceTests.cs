using System.ClientModel.Primitives;
using System.Text.Json;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OpenAI.Responses;

#pragma warning disable OPENAI001 // Exercise metadata from the pinned Responses SDK.

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiTimingServiceTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-12T16:00:00+11:00");
    private const string PrivateMarker = "synthetic-private-payload-must-not-be-logged";
    private const string Ready = """
        {"status":"ready","periods":[{"sleepStart":"2026-10-12T17:00:00+11:00","sleepEnd":"2026-10-12T18:00:00+11:00","sootheStart":"2026-10-12T16:40:00+11:00","sootheEnd":"2026-10-12T16:55:00+11:00"}]}
        """;

    [Fact]
    public async Task SuccessfulPredictionRecordsSeparateStageTimesAndReturnedProviderMetadataWithoutPayloads()
    {
        var fixture = new Fixture(Ready);
        var result = await fixture.Service.PredictAsync(fixture.User, Request(), default);

        Assert.Equal("ready", result.Status);
        var provider = Assert.Single(fixture.Logs.Stage("Provider"));
        Assert.Equal(40d, provider["DurationMs"]);
        Assert.Equal(1, provider["Attempt"]);
        Assert.Equal("ok", provider["Outcome"]);
        Assert.Equal(SleepAiOptions.SelectedModel, provider["Model"]);
        Assert.Equal("priority", provider["ServiceTier"]);
        Assert.Equal(120L, provider["InputTokens"]);
        Assert.Equal(32L, provider["OutputTokens"]);
        Assert.Equal(80L, provider["CachedInputTokens"]);
        Assert.All(fixture.Logs.Stage("Access"), entry => Assert.Equal(3d, entry["DurationMs"]));
        Assert.Equal(2, fixture.Logs.Stage("Access").Count());
        var budget = Assert.Single(fixture.Logs.Stage("Budget"), entry => (int)entry["Attempt"]! == 1);
        Assert.Equal(5d, budget["DurationMs"]);
        Assert.Equal("ok", budget["Outcome"]);
        Assert.Equal("ok", Assert.Single(fixture.Logs.Stage("Validation"))["Outcome"]);
        var total = Assert.Single(fixture.Logs.Stage("Processing"));
        Assert.Equal(58d, total["DurationMs"]);
        Assert.Equal("ready", total["Outcome"]);
        Assert.Equal(1, fixture.Attempts.Released);
        fixture.AssertPrivateDataAbsent();
    }

    [Fact]
    public async Task InvalidOutputRepairRecordsBothProviderAttemptsValidationOutcomesAndOneProcessingTotal()
    {
        var fixture = new Fixture(PrivateMarker, Ready);
        Assert.Equal("ready", (await fixture.Service.PredictAsync(fixture.User, Request(), default)).Status);

        var providers = fixture.Logs.Stage("Provider").ToArray();
        Assert.Equal([1, 2], providers.Select(entry => (int)entry["Attempt"]!).ToArray());
        Assert.All(providers, entry => Assert.Equal(40d, entry["DurationMs"]));
        Assert.Equal(["invalid_output", "ok"], fixture.Logs.Stage("Validation").Select(entry => (string)entry["Outcome"]!).ToArray());
        Assert.Equal([1, 2], fixture.Logs.Stage("Validation").Select(entry => (int)entry["Attempt"]!).ToArray());
        var total = Assert.Single(fixture.Logs.Stage("Processing"));
        Assert.Equal(116d, total["DurationMs"]);
        Assert.Equal("ready", total["Outcome"]);
        Assert.Equal(2, fixture.Client.Calls);
        Assert.Equal(2, fixture.Attempts.Reserved);
        Assert.Equal(2, fixture.Attempts.Released);
        fixture.AssertPrivateDataAbsent();
    }

    [Theory]
    [InlineData("transport", "transport_error", "ai_provider_unavailable")]
    [InlineData("timeout", "ai_timeout", "ai_timeout")]
    [InlineData("cancelled", "cancelled", "ai_timeout")]
    public async Task ProviderFailuresRecordElapsedAttemptAndSafeProcessingOutcomeWithoutExceptionDetails(
        string kind, string providerOutcome, string serviceOutcome)
    {
        var fixture = new Fixture(Ready);
        fixture.Client.Error = kind switch
        {
            "timeout" => new TimeoutException(PrivateMarker),
            "cancelled" => new OperationCanceledException(PrivateMarker),
            _ => new HttpRequestException(PrivateMarker)
        };

        var error = await Assert.ThrowsAsync<ApiException>(() => fixture.Service.PredictAsync(fixture.User, Request(), default));
        Assert.Equal(serviceOutcome, error.Code);
        var provider = Assert.Single(fixture.Logs.Stage("Provider"));
        Assert.Equal(40d, provider["DurationMs"]);
        Assert.Equal(providerOutcome, provider["Outcome"]);
        Assert.Equal(1, provider["Attempt"]);
        Assert.Equal(SleepAiOptions.SelectedModel, provider["Model"]);
        Assert.Null(provider["InputTokens"]);
        Assert.Empty(fixture.Logs.Stage("Validation"));
        var processing = Assert.Single(fixture.Logs.Stage("Processing"));
        Assert.Equal(55d, processing["DurationMs"]);
        Assert.Equal(serviceOutcome, processing["Outcome"]);
        Assert.Equal(1, fixture.Client.Calls);
        Assert.Equal(1, fixture.Attempts.Released);
        fixture.AssertPrivateDataAbsent();
    }

    [Fact]
    public async Task InvalidOutputAfterRepairRecordsTerminalFailureWithoutAnAdditionalProviderAttempt()
    {
        var fixture = new Fixture(PrivateMarker);
        var error = await Assert.ThrowsAsync<ApiException>(() => fixture.Service.PredictAsync(fixture.User, Request(), default));
        Assert.Equal("ai_invalid_response", error.Code);
        Assert.Equal(2, fixture.Logs.Stage("Provider").Count());
        var validations = fixture.Logs.Stage("Validation").ToArray();
        Assert.Equal(2, validations.Length);
        Assert.All(validations, entry => Assert.Equal("invalid_output", entry["Outcome"]));
        var total = Assert.Single(fixture.Logs.Stage("Processing"));
        Assert.Equal(116d, total["DurationMs"]);
        Assert.Equal("ai_invalid_response", total["Outcome"]);
        Assert.Equal(2, fixture.Client.Calls);
        Assert.Equal(2, fixture.Attempts.Released);
        fixture.AssertPrivateDataAbsent();
    }

    [Fact]
    public async Task BudgetFailureRecordsReservationLatencyAndNeverCallsProvider()
    {
        var fixture = new Fixture(Ready);
        fixture.Attempts.Error = new ApiException(429, "ai_hourly_limit");
        var error = await Assert.ThrowsAsync<ApiException>(() => fixture.Service.PredictAsync(fixture.User, Request(), default));
        Assert.Equal("ai_hourly_limit", error.Code);
        Assert.Empty(fixture.Logs.Stage("Provider"));
        var budget = Assert.Single(fixture.Logs.Stage("Budget"), entry => (int)entry["Attempt"]! == 1);
        Assert.Equal(5d, budget["DurationMs"]);
        Assert.Equal("ai_hourly_limit", budget["Outcome"]);
        var total = Assert.Single(fixture.Logs.Stage("Processing"));
        Assert.Equal(8d, total["DurationMs"]);
        Assert.Equal("ai_hourly_limit", total["Outcome"]);
        Assert.Equal(0, fixture.Client.Calls);
        Assert.Equal(0, fixture.Attempts.Released);
    }

    [Fact]
    public async Task AuthorizationFailureRecordsAccessLatencyAndNeverReservesBudgetOrCallsProvider()
    {
        var fixture = new Fixture(Ready);
        fixture.Access.Error = new ApiException(403, "membership_revoked");
        Assert.Equal("membership_revoked", (await Assert.ThrowsAsync<ApiException>(() => fixture.Service.PredictAsync(fixture.User, Request(), default))).Code);
        var access = Assert.Single(fixture.Logs.Stage("Access"));
        Assert.Equal(3d, access["DurationMs"]);
        Assert.Equal("membership_revoked", access["Outcome"]);
        Assert.Empty(fixture.Logs.Stage("Budget"));
        Assert.Empty(fixture.Logs.Stage("Provider"));
        Assert.Equal(3d, Assert.Single(fixture.Logs.Stage("Processing"))["DurationMs"]);
        Assert.Equal(0, fixture.Client.Calls);
    }

    [Fact]
    public async Task MissingProviderUsageOrRawTierRemainsUnknownRatherThanAssumingFast()
    {
        var fixture = new Fixture(Ready);
        fixture.Client.IncludeMetadata = false;
        Assert.Equal("ready", (await fixture.Service.PredictAsync(fixture.User, Request(), default)).Status);
        var provider = Assert.Single(fixture.Logs.Stage("Provider"));
        Assert.Equal("unknown", provider["ServiceTier"]);
        Assert.Null(provider["InputTokens"]);
        Assert.Null(provider["OutputTokens"]);
        Assert.Null(provider["CachedInputTokens"]);
    }

    private static SleepPredictionRequest Request() => new()
    {
        SchemaVersion = 1, InputRevision = new('a', 64), ConsentVersion = "sleep-ai-v1", AgeDays = 100,
        TimeZone = "Australia/Melbourne", Now = Now, FamilyId = null, MembershipId = null, HistoryId = null,
        Records = [new() { Kind = "sleep", Start = Now.AddHours(-3), End = Now.AddHours(-2), Ongoing = false, FeedKind = null, AmountMl = null }]
    };

    private sealed class Fixture
    {
        public Clock Clock { get; } = new();
        public Logs Logs { get; } = new();
        public ChatFake Client { get; }
        public Access Access { get; }
        public Attempts Attempts { get; }
        public SleepAiService Service { get; }
        public PilotIdentity User { get; } = new() { ObjectId = Guid.NewGuid(), Email = "private@example.test" };
        public Fixture(params string[] outputs)
        {
            var options = Options.Create(new SleepAiOptions
            {
                Enabled = true, ChildDataProcessingApproved = true, ZeroDataRetentionApproved = true,
                HardSpendControlVerified = true, ApiKey = PrivateMarker
            });
            var diagnostics = new SleepAiDiagnostics(Logs, Clock);
            diagnostics.SetJob(Guid.NewGuid(), 1);
            Client = new ChatFake(Clock, outputs); Access = new Access(Clock); Attempts = new Attempts(Clock);
            Service = new(options, Access, new OpenAiSleepProvider(Client, options, diagnostics), new(Clock, options), Clock, Attempts, diagnostics);
        }
        public void AssertPrivateDataAbsent()
        {
            var output = string.Join("\n", Logs.Messages);
            foreach (var privateValue in new[] { PrivateMarker, Ready, User.Email!, User.ObjectId.ToString(), Request().InputRevision, Request().TimeZone, "ageDays", "records", "sleepStart" })
                Assert.DoesNotContain(privateValue, output);
            Assert.All(Logs.Exceptions, Assert.Null);
        }
    }

    private sealed class Clock : TimeProvider
    {
        private long milliseconds;
        public override long TimestampFrequency => 1000;
        public override long GetTimestamp() => milliseconds;
        public override DateTimeOffset GetUtcNow() => Now.AddMilliseconds(milliseconds);
        public void Advance(long value) => milliseconds += value;
    }

    private sealed class Access(Clock clock) : ISleepAiAccess
    {
        public Exception? Error { get; set; }
        public Task AuthorizeAsync(PilotIdentity user, SleepPredictionRequest request, CancellationToken ct)
        {
            clock.Advance(3);
            if (Error is not null) throw Error;
            return Task.CompletedTask;
        }
    }

    private sealed class Attempts(Clock clock) : ISleepAiAttemptStore
    {
        public Exception? Error { get; set; }
        public int Reserved { get; private set; }
        public int Released { get; private set; }
        public Task<IAsyncDisposable> Reserve(Guid userId, CancellationToken ct)
        {
            clock.Advance(5);
            if (Error is not null) throw Error;
            Reserved++;
            return Task.FromResult<IAsyncDisposable>(new Lease(this, clock));
        }
        private sealed class Lease(Attempts owner, Clock clock) : IAsyncDisposable
        {
            public ValueTask DisposeAsync() { clock.Advance(7); owner.Released++; return ValueTask.CompletedTask; }
        }
    }

    private sealed class ChatFake(Clock clock, string[] outputs) : IChatClient
    {
        public int Calls { get; private set; }
        public Exception? Error { get; set; }
        public bool IncludeMetadata { get; set; } = true;
        public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
        {
            clock.Advance(40); Calls++;
            if (Error is not null) throw Error;
            var output = outputs[Math.Min(Calls - 1, outputs.Length - 1)];
            return Task.FromResult(new ChatResponse(new ChatMessage(ChatRole.Assistant, output))
            {
                ModelId = SleepAiOptions.SelectedModel,
                FinishReason = IncludeMetadata ? null : ChatFinishReason.Stop,
                RawRepresentation = IncludeMetadata ? ModelReaderWriter.Read<ResponseResult>(BinaryData.FromString(JsonSerializer.Serialize(new
                {
                    id = "resp_synthetic", @object = "response", created_at = 1791777600, status = "completed",
                    model = SleepAiOptions.SelectedModel, service_tier = "priority", output = Array.Empty<object>()
                }))) : null,
                Usage = IncludeMetadata ? new UsageDetails { InputTokenCount = 120, OutputTokenCount = 32, CachedInputTokenCount = 80 } : null
            });
        }
        public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public object? GetService(Type serviceType, object? serviceKey = null) => null;
        public void Dispose() { }
    }

    private sealed class Logs : ILogger<SleepAiDiagnostics>
    {
        private readonly List<Dictionary<string, object?>> entries = [];
        public List<string> Messages { get; } = [];
        public List<Exception?> Exceptions { get; } = [];
        public IEnumerable<Dictionary<string, object?>> Stage(string stage) => entries.Where(entry => (string)entry["Stage"]! == stage);
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            entries.Add(((IEnumerable<KeyValuePair<string, object?>>)state!).ToDictionary(pair => pair.Key, pair => pair.Value));
            Messages.Add(formatter(state, exception)); Exceptions.Add(exception);
        }
    }
}
