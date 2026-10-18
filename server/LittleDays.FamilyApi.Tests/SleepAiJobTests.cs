using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiJobTests
{
    internal sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.Parse("2026-10-14T09:15:00+11:00");
        public override DateTimeOffset GetUtcNow() => Now;
    }
    internal static SleepAiOptions Enabled() => new()
    {
        Enabled = true, ChildDataProcessingApproved = true, ZeroDataRetentionApproved = true,
        HardSpendControlVerified = true, ApiKey = "synthetic-only", Model = "synthetic-2026-10-01"
    };
    internal static CreateSleepPredictionJobRequest Request(DateTimeOffset now) => new(Guid.NewGuid(), SleepAiJobPolicy.ConsentVersion,
        Guid.NewGuid(), new()
        {
            SchemaVersion = 2, ConsentVersion = "sleep-ai-v2", InputRevision = new('a', 64), AgeDays = 100,
            TimeZone = "Australia/Melbourne", Now = now, FamilyId = null, MembershipId = null, HistoryId = null,
            Records = [], PreviousEstimate = null
        });
    internal const string Output = """{"status":"insufficient_data","periods":[]}""";
    internal sealed class Provider : ISleepAiProvider
    {
        public int Calls { get; private set; }
        public SleepPredictionRequest? Request { get; private set; }
        public string FirstOutput { get; set; } = Output;
        public Task<string?> GenerateAsync(SleepPredictionRequest request, SleepAiTimeBounds bounds, bool retry, CancellationToken ct)
        { ct.ThrowIfCancellationRequested(); Calls++; Request = request; return Task.FromResult<string?>(retry ? Output : FirstOutput); }
    }
    private sealed class Access : ISleepAiAccess
    {
        public int Calls { get; private set; }
        public Task AuthorizeAsync(PilotIdentity user, SleepPredictionRequest request, CancellationToken ct)
        { ct.ThrowIfCancellationRequested(); Calls++; return Task.CompletedTask; }
    }
    private sealed class Attempts : ISleepAiAttemptStore
    {
        public int Reserved { get; private set; }
        public int Released { get; private set; }
        public string? Failure { get; set; }
        public Task<IAsyncDisposable> Reserve(Guid userId, CancellationToken ct)
        {
            if (Failure is not null) throw new ApiException(429, Failure);
            Reserved++; return Task.FromResult<IAsyncDisposable>(new Lease(this));
        }
        private sealed class Lease(Attempts owner) : IAsyncDisposable
        { public ValueTask DisposeAsync() { owner.Released++; return ValueTask.CompletedTask; } }
    }

    [Theory]
    [InlineData("operation")]
    [InlineData("generation")]
    [InlineData("consent")]
    [InlineData("schema")]
    [InlineData("stale")]
    [InlineData("request")]
    public void JobAdmissionRequiresIndependentConsentValidIdsSchemaAndFreshSnapshot(string invalid)
    {
        var clock = new Clock(); var request = Request(clock.Now);
        request = invalid switch
        {
            "operation" => request with { OperationId = Guid.Empty },
            "generation" => request with { ConsentGeneration = Guid.Empty },
            "consent" => request with { ConsentVersion = "sleep-ai-v2" },
            "schema" => request with { Request = request.Request with { SchemaVersion = 1 } },
            "stale" => request with { Request = request.Request with { Now = clock.Now.AddMinutes(-5).AddTicks(-1) } },
            _ => request with { Request = null! }
        };
        Assert.Equal("invalid_input", Assert.Throws<ApiException>(() => SleepAiJobPolicy.Validate(request, clock.Now)).Code);
    }

    [Fact]
    public void JobClockBoundaryAndStrictSerializationPreserveExistingPredictionContract()
    {
        var clock = new Clock(); var request = Request(clock.Now.AddMinutes(-5));
        Assert.Equal(DateTimeOffset.Parse("2026-10-15T00:00:00+11:00"), SleepAiJobPolicy.Validate(request, clock.Now).TodayEnd);
        var json = JsonSerializer.Serialize(request, SleepAiJson.Options);
        Assert.Contains("\"consentVersion\":\"sleep-ai-jobs-v1\"", json);
        Assert.Contains("\"consentVersion\":\"sleep-ai-v2\"", json);
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<CreateSleepPredictionJobRequest>(json[..^1] + ",\"notes\":\"private\"}", SleepAiJson.Options));
    }

    [Fact]
    public void OptionalDiagnosticsConsentPreservesLegacySerializationAndChangesExplicitOptInHash()
    {
        var request = Request(new Clock().Now);
        var original = JsonSerializer.Serialize(new { request.OperationId, request.ConsentVersion,
            request.ConsentGeneration, request.Request }, SleepAiJson.Options);
        Assert.Equal(original, JsonSerializer.Serialize(request, SleepAiJson.Options));
        var optedIn = request with { DiagnosticsConsentVersion = SleepAiFailureCapture.ConsentVersion };
        var json = JsonSerializer.Serialize(optedIn, SleepAiJson.Options);
        Assert.NotEqual(original, json);
        Assert.Contains("\"diagnosticsConsentVersion\":\"sleep-ai-failed-output-v1\"", json);
        Assert.Equal(json, JsonSerializer.Serialize(JsonSerializer.Deserialize<CreateSleepPredictionJobRequest>(json, SleepAiJson.Options), SleepAiJson.Options));
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("sleep-ai-failed-output-v1", true)]
    [InlineData("", false)]
    [InlineData("sleep-ai-jobs-v1", false)]
    [InlineData("sleep-ai-failed-output-v2", false)]
    public void FailedOutputRetentionRequiresExactOptionalConsent(string? version, bool accepted)
    {
        var clock = new Clock(); var request = Request(clock.Now) with { DiagnosticsConsentVersion = version };
        if (accepted) Assert.True(SleepAiJobPolicy.Validate(request, clock.Now).TodayEnd > clock.Now);
        else Assert.Equal("invalid_input", Assert.Throws<ApiException>(() => SleepAiJobPolicy.Validate(request, clock.Now)).Code);
    }

    [Fact]
    public void FailedOutputExpiryIsExactlySevenDaysFromFailureNotJobCompletion()
    {
        var occurred = DateTimeOffset.Parse("2026-10-03T23:59:59+10:00");
        var attempt = new SleepAiFailedAttempt(1, "invalid_json", null, "synthetic", 9, false, occurred, 12, "synthetic-2026-10-01");
        Assert.Equal(occurred.AddHours(168), attempt.ExpiresAt);
        Assert.True(attempt.ExpiresAt > occurred.AddDays(7).AddTicks(-1));
        Assert.False(attempt.ExpiresAt > occurred.AddDays(7));
    }

    [Fact]
    public async Task QueuedExecutionPreservesOriginalSnapshotAfterAdmissionWindowAndUsesDurableAttemptPerRepair()
    {
        var clock = new Clock(); var request = Request(clock.Now).Request; clock.Now = clock.Now.AddMinutes(20);
        var options = Options.Create(Enabled()); var access = new Access(); var attempts = new Attempts();
        var provider = new Provider { FirstOutput = "invalid synthetic output" }; var jobChecks = 0;
        var service = new SleepAiService(options, access, provider, new(clock, options), clock, attempts);
        var result = await service.PredictQueuedAsync(new() { ObjectId = Guid.NewGuid() }, request,
            _ => { jobChecks++; return Task.CompletedTask; }, default);
        Assert.Equal("insufficient_data", result.Status); Assert.Equal(request.Now, provider.Request!.Now);
        Assert.Equal(2, provider.Calls); Assert.Equal(2, attempts.Reserved); Assert.Equal(2, attempts.Released);
        Assert.Equal(4, access.Calls); Assert.Equal(4, jobChecks);
        Assert.Equal(clock.Now, result.GeneratedAt); Assert.Equal(SleepAiValidation.ValidateRequest(request, request.Now).TodayEnd, result.ExpiresAt);
        Assert.Equal("invalid_input", (await Assert.ThrowsAsync<ApiException>(() => service.PredictAsync(new(), request, default))).Code);
    }

    [Theory]
    [InlineData("ai_hourly_limit")]
    [InlineData("ai_daily_limit")]
    [InlineData("ai_busy")]
    public async Task DurableBudgetRefusalDoesNotDispatchProvider(string code)
    {
        var clock = new Clock(); var options = Options.Create(Enabled()); var provider = new Provider();
        var attempts = new Attempts { Failure = code };
        var service = new SleepAiService(options, new Access(), provider, new(clock, options), clock, attempts);
        var error = await Assert.ThrowsAsync<ApiException>(() => service.PredictAsync(new(), Request(clock.Now).Request, default));
        Assert.Equal(code, error.Code); Assert.Equal(429, error.Status); Assert.Equal(0, provider.Calls); Assert.Equal(0, attempts.Reserved);
    }

    [Fact]
    public async Task RevokedJobCheckStopsProviderAndMidnightNeverProducesYesterdayResult()
    {
        var clock = new Clock(); var options = Options.Create(Enabled()); var provider = new Provider();
        var service = new SleepAiService(options, new Access(), provider, new(clock, options), clock);
        var request = Request(clock.Now).Request;
        var error = await Assert.ThrowsAsync<ApiException>(() => service.PredictQueuedAsync(new(), request,
            _ => throw new ApiException(403, "ai_consent_revoked"), default));
        Assert.Equal("ai_consent_revoked", error.Code); Assert.Equal(0, provider.Calls);
        clock.Now = SleepAiValidation.ValidateRequest(request, request.Now).TodayEnd;
        error = await Assert.ThrowsAsync<ApiException>(() => service.PredictQueuedAsync(new(), request, _ => Task.CompletedTask, default));
        Assert.Equal("prediction_day_changed", error.Code); Assert.Equal(0, provider.Calls);
    }

    [Theory]
    [InlineData("ai_timeout", "ai_timeout")]
    [InlineData("ai_invalid_response", "ai_invalid_response")]
    [InlineData("private provider response body", "ai_provider_unavailable")]
    [InlineData("ai_job_cancelled", "ai_provider_unavailable")]
    public void JobErrorsNeverExposeProviderText(string input, string expected) => Assert.Equal(expected, SleepAiJobPolicy.SafeError(input));

    [Fact]
    public async Task JobCapabilityRequiresAuthenticationAndUsesNewConsentWithoutBreakingOldCapability()
    {
        var scenario = new Scenario(new SqlFixture()); await using var host = new TestHost(scenario.Config);
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/v2/sleep-prediction-jobs/capabilities")).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(scenario.Owner));
        using var response = await client.GetAsync("/v2/sleep-prediction-jobs/capabilities");
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        var capabilities = await response.Content.ReadFromJsonAsync<SleepPredictionJobCapabilities>();
        Assert.Equal(new(false, "sleep-ai-jobs-v1"), capabilities);
        Assert.Equal(SleepAiFailureCapture.ConsentVersion, capabilities!.DiagnosticsConsentVersion);
        Assert.Equal(7, capabilities.DiagnosticsRetentionDays);
        var old = await client.GetFromJsonAsync<SleepPredictionCapabilities>("/v2/sleep-predictions/capabilities");
        Assert.Equal("sleep-ai-v1", old!.ConsentVersion); Assert.Equal("sleep-ai-v2", old.WholeDayConsentVersion);
    }
}
