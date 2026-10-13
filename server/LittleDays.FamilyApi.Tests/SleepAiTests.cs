using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using OpenAI.Responses;
using System.ClientModel;
using System.ClientModel.Primitives;

#pragma warning disable OPENAI001 // Pin and test the same isolated Responses adapter as production.

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-12T16:00:00+11:00");
    private static readonly PilotIdentity User = new() { ObjectId = Guid.NewGuid(), Email = "synthetic@example.test" };
    private static readonly string Ready = """
        {"status":"ready","periods":[{"sleepStart":"2026-10-12T17:00:00+11:00","sleepEnd":"2026-10-12T18:00:00+11:00","sootheStart":"2026-10-12T16:40:00+11:00","sootheEnd":"2026-10-12T16:55:00+11:00"}]}
        """;
    private const string Insufficient = """{"status":"insufficient_data","periods":[]}""";
    private static SleepPredictionRequest Request() => new()
    {
        SchemaVersion = 1, InputRevision = new('a', 64), ConsentVersion = "sleep-ai-v1", FamilyId = null,
        MembershipId = null, HistoryId = null, AgeDays = 100, TimeZone = "Australia/Melbourne", Now = Now,
        Records = [new() { Kind = "sleep", Start = Now.AddHours(-3), End = Now.AddHours(-2), Ongoing = false, FeedKind = null, AmountMl = null },
            new() { Kind = "feed", Start = Now.AddHours(-1), End = Now.AddMinutes(-50), Ongoing = false, FeedKind = "formula", AmountMl = 120 }]
    };
    private static SleepAiOptions Enabled() => new()
    {
        Enabled = true, ChildDataProcessingApproved = true, ZeroDataRetentionApproved = true,
        HardSpendControlVerified = true, ApiKey = "synthetic-not-a-real-secret", Model = "synthetic-2026-10-01"
    };

    [Fact]
    public async Task DisabledConfigurationNeverCallsProviderOrSqlAndReturnsNoPrediction()
    {
        var access = new Access(); var provider = new Provider(Ready); var options = new SleepAiOptions();
        Assert.Equal("gpt-6-luna", options.Model);
        var result = await Service(options, access, provider).PredictAsync(User, Request(), default);
        Assert.Equal("unavailable", result.Status); Assert.Empty(result.Periods);
        Assert.Equal(0, provider.Calls); Assert.Equal(0, access.Calls);
        Assert.Equal(Request().InputRevision, result.InputRevision);
    }

    [Theory]
    [InlineData("enabled")]
    [InlineData("child")]
    [InlineData("zdr")]
    [InlineData("spend")]
    [InlineData("key")]
    [InlineData("unresolved-key")]
    [InlineData("model")]
    [InlineData("quota")]
    public void EveryActivationGateIsRequired(string gate)
    {
        foreach (var model in new[] { "synthetic-2026-10-01", "gpt-6-luna" })
        {
            var options = Enabled(); options.Model = model; Assert.True(options.IsAvailable);
            switch (gate)
            {
                case "enabled": options.Enabled = false; break;
                case "child": options.ChildDataProcessingApproved = false; break;
                case "zdr": options.ZeroDataRetentionApproved = false; break;
                case "spend": options.HardSpendControlVerified = false; break;
                case "key": options.ApiKey = ""; break;
                case "unresolved-key": options.ApiKey = "@Microsoft.KeyVault(SecretUri=synthetic)"; break;
                case "model": options.Model = "latest"; break;
                case "quota": options.MaxRequestsPerAccountPerHour = 61; break;
            }
            Assert.False(options.IsAvailable);
        }
    }

    [Theory]
    [InlineData("gpt-6-luna", true)]
    [InlineData("synthetic-2026-10-01", true)]
    [InlineData("gpt-5.6-luna", false)]
    [InlineData("gpt-6-luna-latest", false)]
    [InlineData("gpt-6-luna-extra", false)]
    [InlineData("GPT-6-LUNA", false)]
    [InlineData(" gpt-6-luna", false)]
    [InlineData("gpt-6-luna ", false)]
    [InlineData("latest", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void ModelPolicyAllowsOnlySelectedLunaOrDatedIds(string? model, bool expected)
    {
        var options = Enabled(); options.Model = model!;
        Assert.Equal(expected, options.IsAvailable);
    }

    [Theory]
    [InlineData("age-negative")]
    [InlineData("age-over-limit")]
    [InlineData("timezone")]
    [InlineData("revision")]
    [InlineData("consent")]
    [InlineData("schema")]
    [InlineData("clock")]
    [InlineData("partial-context")]
    [InlineData("empty-context-id")]
    [InlineData("future")]
    [InlineData("reversed")]
    [InlineData("unknown-kind")]
    [InlineData("sleep-volume")]
    [InlineData("breast-volume")]
    [InlineData("formula-null-volume")]
    [InlineData("expressed-null-volume")]
    [InlineData("old-feed")]
    [InlineData("too-many")]
    [InlineData("overlap")]
    [InlineData("ongoing-mismatch")]
    public async Task InvalidInputIsRejectedBeforeProviderOrAuthorization(string invalid)
    {
        var request = Request();
        request = invalid switch
        {
            "age-negative" => request with { AgeDays = -1 },
            "age-over-limit" => request with { AgeDays = 2192 },
            "timezone" => request with { TimeZone = "Eastern Standard Time" },
            "revision" => request with { InputRevision = "not-a-hash" },
            "consent" => request with { ConsentVersion = "old-version" },
            "schema" => request with { SchemaVersion = 2 },
            "clock" => request with { Now = Now.AddMinutes(-5).AddTicks(-1) },
            "partial-context" => request with { FamilyId = Guid.NewGuid() },
            "empty-context-id" => request with { FamilyId = Guid.Empty, MembershipId = Guid.Empty, HistoryId = Guid.Empty },
            "future" => request with { Records = [request.Records[1] with { End = Now.AddTicks(1) }] },
            "reversed" => request with { Records = [request.Records[0] with { End = Now.AddHours(-4) }] },
            "unknown-kind" => request with { Records = [request.Records[0] with { Kind = "note" }] },
            "sleep-volume" => request with { Records = [request.Records[0] with { AmountMl = 120 }] },
            "breast-volume" => request with { Records = [request.Records[1] with { FeedKind = "breast" }] },
            "formula-null-volume" => request with { Records = [request.Records[1] with { AmountMl = null }] },
            "expressed-null-volume" => request with { Records = [request.Records[1] with { FeedKind = "expressed", AmountMl = null }] },
            "old-feed" => request with { Records = [request.Records[1] with { Start = Now.AddDays(-8), End = Now.AddDays(-8).AddMinutes(1) }] },
            "too-many" => request with { Records = Enumerable.Repeat(request.Records[1], 513).ToArray() },
            "overlap" => request with { Records = [request.Records[0], request.Records[0] with { Start = Now.AddHours(-2.5) }] },
            "ongoing-mismatch" => request with { Records = [request.Records[0] with { Ongoing = true }] },
            _ => throw new InvalidOperationException()
        };
        var provider = new Provider(Ready); var access = new Access();
        var error = await Assert.ThrowsAsync<ApiException>(() => Service(Enabled(), access, provider).PredictAsync(User, request, default));
        Assert.Equal(422, error.Status); Assert.Equal("invalid_input", error.Code);
        Assert.Equal(0, provider.Calls); Assert.Equal(0, access.Calls);
    }

    [Fact]
    public void CalendarWindowUsesLocalDaysAcrossDstAndPreservesCrossMidnightSleep()
    {
        var request = Request() with { Now = DateTimeOffset.Parse("2026-10-05T08:00:00+11:00"), Records = [] };
        var bounds = SleepAiValidation.ValidateRequest(request, request.Now);
        Assert.Equal(DateTimeOffset.Parse("2026-09-28T00:00:00+10:00"), bounds.HistoryStart);
        Assert.Equal(DateTimeOffset.Parse("2026-10-06T00:00:00+11:00"), bounds.TodayEnd);
        Assert.Equal(TimeSpan.FromHours(191), bounds.TodayEnd - bounds.HistoryStart);
        var crossing = request with { Records = [Request().Records[0] with { Start = bounds.HistoryStart.AddHours(-2), End = bounds.HistoryStart.AddHours(5) }] };
        Assert.Equal(bounds, SleepAiValidation.ValidateRequest(crossing, request.Now));
        var tooOld = crossing with { Records = [crossing.Records[0] with { Start = bounds.HistoryStart.AddHours(-24).AddTicks(-1) }] };
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(tooOld, request.Now));
    }

    [Fact]
    public void ExactInputLimitsAndInstantFeedAreAcceptedButAdjacentValuesAreRejected()
    {
        var request = Request() with { AgeDays = 2191, Records = [Request().Records[1] with { End = null }] };
        Assert.Equal(DateTimeOffset.Parse("2026-10-05T00:00:00+11:00"), SleepAiValidation.ValidateRequest(request, Now).HistoryStart);
        request = request with { AgeDays = 0, Records = Enumerable.Repeat(request.Records[0], 512).ToArray() };
        Assert.NotNull(SleepAiValidation.ValidateRequest(request, Now.AddMinutes(5)));
        var sleep = Request().Records[0] with { Start = Now.AddHours(-24), End = Now };
        Assert.NotNull(SleepAiValidation.ValidateRequest(Request() with { Records = [sleep] }, Now));
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(Request() with { Records = [sleep with { Start = sleep.Start.AddTicks(-1) }] }, Now));
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(request with { Records = [request.Records[0] with { AmountMl = 2000.01m }] }, Now));
        Assert.NotNull(SleepAiValidation.ValidateRequest(Request() with { Records = [Request().Records[1] with { FeedKind = "breast", AmountMl = null }] }, Now));
    }

    [Fact]
    public void OvernightAiSleepMayEndAtNextLocalNoonButNotBeyond()
    {
        var request = Request(); var bounds = SleepAiValidation.ValidateRequest(request, Now);
        var period = new SleepPredictionPeriod { SootheStart = Now, SootheEnd = Now.AddMinutes(10), SleepStart = Now.AddHours(4), SleepEnd = bounds.SleepEndLimit };
        var json = Serialize(new SleepPredictionModelOutput { Status = "ready", Periods = [period] });
        Assert.True(SleepAiValidation.TryReadOutput(json, request, bounds, out var result));
        Assert.Equal(period, Assert.Single(result!.Periods));
        Assert.False(SleepAiValidation.TryReadOutput(Serialize(result with { Periods = [period with { SleepEnd = bounds.SleepEndLimit.AddTicks(1) }] }), request, bounds, out _));
    }

    [Fact]
    public void RequestJsonRejectsDuplicateUnknownMissingAndOffsetlessFields()
    {
        var json = JsonSerializer.Serialize(Request(), SleepAiJson.Options);
        Assert.NotNull(JsonSerializer.Deserialize<SleepPredictionRequest>(json, SleepAiJson.Options));
        foreach (var invalid in new[]
        {
            json.Replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"schemaVersion\":1"),
            json.Replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"notes\":\"private\""),
            json.Replace("\"schemaVersion\":1,", ""),
            json.Replace("\"schemaVersion\":1", "\"schemaVersion\":\"1\""),
            json.Replace("+11:00", "")
        }) Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<SleepPredictionRequest>(invalid, SleepAiJson.Options));
    }

    [Theory]
    [InlineData("extra-field")]
    [InlineData("duplicate")]
    [InlineData("missing")]
    [InlineData("past")]
    [InlineData("reversed")]
    [InlineData("soothe-over-sleep")]
    [InlineData("next-day-start")]
    [InlineData("end-after-limit")]
    [InlineData("overlap")]
    [InlineData("unsorted")]
    [InlineData("empty-ready")]
    [InlineData("nonempty-insufficient")]
    [InlineData("unknown-status")]
    [InlineData("too-many")]
    [InlineData("ongoing-sleep")]
    public void ModelOutputIsRejectedNotSortedShiftedOrLocallyRepaired(string invalid)
    {
        var request = Request(); var json = Ready;
        var valid = JsonSerializer.Deserialize<SleepPredictionModelOutput>(Ready, SleepAiJson.Options)!;
        var period = valid.Periods[0];
        json = invalid switch
        {
            "extra-field" => Ready.Replace("\"status\":", "\"explanation\":\"unwanted\",\"status\":"),
            "duplicate" => Ready.Replace("\"status\":", "\"status\":\"ready\",\"status\":"),
            "missing" => """{"status":"ready"}""",
            "past" => Serialize(valid with { Periods = [period with { SootheStart = Now.AddTicks(-1) }] }),
            "reversed" => Serialize(valid with { Periods = [period with { SleepEnd = period.SleepStart }] }),
            "soothe-over-sleep" => Serialize(valid with { Periods = [period with { SootheEnd = period.SleepStart.AddTicks(1) }] }),
            "next-day-start" => Serialize(valid with { Periods = [period with { SleepStart = Now.Date.AddDays(1), SleepEnd = Now.Date.AddDays(1).AddHours(2) }] }),
            "end-after-limit" => Serialize(valid with { Periods = [period with { SleepEnd = DateTimeOffset.Parse("2026-10-13T12:00:00.001+11:00") }] }),
            "overlap" => Serialize(valid with { Periods = [period, period] }),
            "unsorted" => Serialize(valid with { Periods = [period with { SleepStart = period.SleepStart.AddHours(3), SleepEnd = period.SleepEnd.AddHours(3), SootheStart = period.SootheStart.AddHours(3), SootheEnd = period.SootheEnd.AddHours(3) }, period] }),
            "empty-ready" => """{"status":"ready","periods":[]}""",
            "nonempty-insufficient" => Ready.Replace("ready", "insufficient_data"),
            "unknown-status" => Ready.Replace("ready", "maybe"),
            "too-many" => Serialize(valid with { Periods = Enumerable.Repeat(period, 13).ToArray() }),
            "ongoing-sleep" => Ready,
            _ => throw new InvalidOperationException()
        };
        if (invalid == "ongoing-sleep") request = request with { Records = [request.Records[0] with { End = null, Ongoing = true }] };
        var bounds = SleepAiValidation.ValidateRequest(request, Now);
        Assert.False(SleepAiValidation.TryReadOutput(json, request, bounds, out _));
    }

    [Fact]
    public async Task ValidAiTimesAreReturnedExactlyAndAuthorizationIsRechecked()
    {
        var access = new Access(); var provider = new Provider(Ready);
        var result = await Service(Enabled(), access, provider).PredictAsync(User, Request(), default);
        Assert.Equal("ready", result.Status); Assert.Equal(2, access.Calls); Assert.Equal(1, provider.Calls);
        Assert.Equal(JsonSerializer.Deserialize<SleepPredictionModelOutput>(Ready, SleepAiJson.Options)!.Periods, result.Periods);
        Assert.Equal(Now, result.GeneratedAt); Assert.Equal(Now.AddMinutes(15), result.ExpiresAt);
    }

    [Fact]
    public async Task InvalidModelOutputRetriesOnceThenUnavailableWithoutLocalFallback()
    {
        var provider = new Provider("{bad json}"); var access = new Access();
        var result = await Service(Enabled(), access, provider).PredictAsync(User, Request(), default);
        Assert.Equal("unavailable", result.Status); Assert.Empty(result.Periods);
        Assert.Equal(2, provider.Calls); Assert.Equal([false, true], provider.Retries); Assert.Equal(4, access.Calls);
    }

    [Fact]
    public async Task InvalidThenValidUsesOnlyCorrectedAiOutput()
    {
        var provider = new Provider("bad", Ready); var result = await Service(Enabled(), new Access(), provider).PredictAsync(User, Request(), default);
        Assert.Equal("ready", result.Status); Assert.Equal(2, provider.Calls);
        Assert.Equal(JsonSerializer.Deserialize<SleepPredictionModelOutput>(Ready, SleepAiJson.Options)!.Periods, result.Periods);
    }

    [Fact]
    public async Task InsufficientDataRemainsEmptyIncludingAnOngoingSleep()
    {
        var request = Request() with { Records = [Request().Records[0] with { End = null, Ongoing = true }] };
        var provider = new Provider(Insufficient); var result = await Service(Enabled(), new Access(), provider).PredictAsync(User, request, default);
        Assert.Equal("insufficient_data", result.Status); Assert.Empty(result.Periods); Assert.Equal(1, provider.Calls);
    }

    [Theory]
    [InlineData(1, 0)]
    [InlineData(2, 1)]
    public async Task AccountOrGrantRevocationPreventsProviderCallOrResult(int rejectAt, int expectedCalls)
    {
        var access = new Access { RejectAt = rejectAt }; var provider = new Provider(Ready);
        var error = await Assert.ThrowsAsync<ApiException>(() => Service(Enabled(), access, provider).PredictAsync(User, Request(), default));
        Assert.Equal("membership_revoked", error.Code); Assert.Equal(expectedCalls, provider.Calls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task PendingInitialAuthorizationBlocksProviderUntilItsAsynchronousOutcome(bool denied)
    {
        var access = new DeferredAccess(1); var provider = new Provider(Ready);
        var pending = Service(Enabled(), access, provider).PredictAsync(User, Request(), default);
        Assert.False(pending.IsCompleted); Assert.Equal(1, access.Calls); Assert.Equal(0, provider.Calls);
        if (denied)
        {
            access.Pending.SetException(new ApiException(403, "membership_revoked"));
            var error = await Assert.ThrowsAsync<ApiException>(() => pending);
            Assert.Equal(403, error.Status); Assert.Equal("membership_revoked", error.Code);
            Assert.Equal(0, provider.Calls);
        }
        else
        {
            access.Pending.SetResult();
            var result = await pending;
            Assert.Equal("ready", result.Status); Assert.Equal(1, provider.Calls); Assert.Equal(2, access.Calls);
            Assert.Equal(JsonSerializer.Deserialize<SleepPredictionModelOutput>(Ready, SleepAiJson.Options)!.Periods, result.Periods);
        }
    }

    [Fact]
    public async Task PendingPostProviderAuthorizationPreventsReturningPeriodsAndPropagatesDeferredDenial()
    {
        var access = new DeferredAccess(2); var provider = new Provider(Ready);
        var pending = Service(Enabled(), access, provider).PredictAsync(User, Request(), default);
        Assert.False(pending.IsCompleted); Assert.Equal(2, access.Calls); Assert.Equal(1, provider.Calls);
        access.Pending.SetException(new ApiException(403, "membership_revoked"));
        var error = await Assert.ThrowsAsync<ApiException>(() => pending);
        Assert.Equal(403, error.Status); Assert.Equal("membership_revoked", error.Code);
        Assert.Equal(1, provider.Calls);
    }

    [Fact]
    public async Task PendingRetryAuthorizationBlocksSecondProviderCallAndPropagatesDeferredDenial()
    {
        var access = new DeferredAccess(3); var provider = new Provider("invalid", Ready);
        var pending = Service(Enabled(), access, provider).PredictAsync(User, Request(), default);
        Assert.False(pending.IsCompleted); Assert.Equal(3, access.Calls); Assert.Equal(1, provider.Calls);
        access.Pending.SetException(new ApiException(409, "history_changed"));
        var error = await Assert.ThrowsAsync<ApiException>(() => pending);
        Assert.Equal(409, error.Status); Assert.Equal("history_changed", error.Code);
        Assert.Equal(1, provider.Calls); Assert.Equal([false], provider.Retries);
    }

    [Fact]
    public async Task CancellationAndNetworkFailureNeverCreateFallbackPredictions()
    {
        var canceled = new CancellationToken(true); var provider = new Provider(Ready);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Service(Enabled(), new Access(), provider).PredictAsync(User, Request(), canceled));
        Assert.Equal(0, provider.Calls);
        provider = new Provider(Ready) { Error = new HttpRequestException("synthetic private message") };
        var result = await Service(Enabled(), new Access(), provider).PredictAsync(User, Request(), default);
        Assert.Equal("unavailable", result.Status); Assert.Empty(result.Periods); Assert.Equal(1, provider.Calls);
        provider = new Provider(Ready) { Error = new OperationCanceledException() };
        result = await Service(Enabled(), new Access(), provider).PredictAsync(User, Request(), default);
        Assert.Equal("unavailable", result.Status); Assert.Empty(result.Periods); Assert.Equal(1, provider.Calls);
    }

    [Fact]
    public async Task PerInstanceAccountBudgetIncludesInvalidOutputRetryAndDoesNotShareAccounts()
    {
        var options = Enabled(); options.MaxRequestsPerAccountPerHour = 2;
        var provider = new Provider("invalid"); var service = Service(options, new Access(), provider);
        Assert.Equal("unavailable", (await service.PredictAsync(User, Request(), default)).Status);
        var error = await Assert.ThrowsAsync<ApiException>(() => service.PredictAsync(User, Request(), default));
        Assert.Equal(429, error.Status); Assert.Equal(2, provider.Calls);
        Assert.Equal("unavailable", (await service.PredictAsync(new PilotIdentity { ObjectId = Guid.NewGuid() }, Request(), default)).Status);
        Assert.Equal(4, provider.Calls);
    }

    [Fact]
    public void PerInstanceBudgetBoundsConcurrencyDailyCallsAndResetsOnlyRelevantWindow()
    {
        var options = Enabled(); options.MaxRequestsPerAccountPerHour = 2; options.MaxRequestsPerInstancePerDay = 3;
        var clock = new MutableClock(Now); var budget = new SleepAiBudget(clock, Options.Create(options));
        Assert.True(budget.TryEnter()); Assert.True(budget.TryEnter()); Assert.False(budget.TryEnter());
        budget.Exit(); Assert.True(budget.TryEnter()); budget.Exit(); budget.Exit();
        Assert.True(budget.TrySpend(User.ObjectId)); Assert.True(budget.TrySpend(User.ObjectId)); Assert.False(budget.TrySpend(User.ObjectId));
        clock.Current = clock.Current.AddHours(1);
        Assert.True(budget.TrySpend(User.ObjectId)); Assert.False(budget.TrySpend(Guid.NewGuid()));
        clock.Current = clock.Current.AddDays(1);
        Assert.True(budget.TrySpend(User.ObjectId));
    }

    [Fact]
    public async Task ProviderOnlySendsAllowlistedDataAndUsesNoStoreStrictSchemaAndBoundedTokens()
    {
        var fake = new ChatFake(new ChatResponse(new ChatMessage(ChatRole.Assistant, Ready)) { FinishReason = ChatFinishReason.Stop });
        var options = Options.Create(Enabled()); var provider = new OpenAiSleepProvider(fake, options);
        var request = Request() with { FamilyId = Guid.NewGuid(), MembershipId = Guid.NewGuid(), HistoryId = Guid.NewGuid() };
        Assert.Equal(Ready, await provider.GenerateAsync(request, SleepAiValidation.ValidateRequest(request, Now), false, default));
        using var input = JsonDocument.Parse(fake.Messages![1].Text);
        Assert.Equal(["ageDays", "now", "records", "sleepEndLimit", "timeZone", "todayEnd"], input.RootElement.EnumerateObject().Select(x => x.Name).Order().ToArray());
        Assert.DoesNotContain(request.FamilyId.ToString()!, fake.Messages[1].Text); Assert.DoesNotContain(request.InputRevision, fake.Messages[1].Text);
        Assert.Equal(4096, fake.Options!.MaxOutputTokens); Assert.False(fake.Options.AllowBackgroundResponses);
        Assert.IsType<ChatResponseFormatJson>(fake.Options.ResponseFormat); Assert.Null(fake.Options.Tools); Assert.Null(fake.Options.ConversationId);
        var raw = Assert.IsType<CreateResponseOptions>(fake.Options.RawRepresentationFactory!(fake));
        Assert.False(raw.StoredOutputEnabled); Assert.False(raw.BackgroundModeEnabled);
        Assert.Null(fake.Options.Temperature);
    }

    [Theory]
    [InlineData("length")]
    [InlineData("content_filter")]
    [InlineData("tool_calls")]
    public async Task ProviderRejectsIncompleteOrFilteredCompletion(string reason)
    {
        var fake = new ChatFake(new ChatResponse(new ChatMessage(ChatRole.Assistant, Ready)) { FinishReason = new ChatFinishReason(reason) });
        var provider = new OpenAiSleepProvider(fake, Options.Create(Enabled()));
        Assert.Null(await provider.GenerateAsync(Request(), SleepAiValidation.ValidateRequest(Request(), Now), false, default));
    }

    [Theory]
    [InlineData("continuation")]
    [InlineData("tool-content")]
    [InlineData("error-content")]
    public async Task ProviderRejectsOtherwiseValidJsonAccompaniedByContinuationOrNonTextContent(string extra)
    {
        List<AIContent> content = [new TextContent(Ready)];
        if (extra == "tool-content") content.Add(new FunctionCallContent("call_synthetic", "unrequested", new Dictionary<string, object?>()));
        if (extra == "error-content") content.Add(new ErrorContent("synthetic refusal"));
        var response = new ChatResponse(new ChatMessage(ChatRole.Assistant, content))
        {
            FinishReason = ChatFinishReason.Stop,
            ContinuationToken = extra == "continuation" ? ResponseContinuationToken.FromBytes("synthetic"u8.ToArray()) : null
        };
        var fake = new ChatFake(response); var provider = new OpenAiSleepProvider(fake, Options.Create(Enabled()));
        Assert.Null(await provider.GenerateAsync(Request(), SleepAiValidation.ValidateRequest(Request(), Now), false, default));
        Assert.Equal(2, fake.Messages!.Count);
    }

    [Fact]
    public async Task RecoveryGateEnabledDuringProviderWorkPreventsReturningCompletedPrediction()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Recovery:Blocked"] = "false" }).Build();
        var gate = new RecoveryGate(configuration);
        // The first authorization is supplied by a fake SQL boundary. The actual
        // SleepAiAccess adapter is exercised after generation: recovery must stop
        // it before FamilyService/SQL could be reached.
        var actualAccess = new SleepAiAccess(null!, gate);
        var access = new AfterFirstAccess(actualAccess); var provider = new DeferredProvider();
        var pending = Service(Enabled(), access, provider).PredictAsync(User, Request(), default);
        Assert.Equal(1, access.Calls); Assert.Equal(1, provider.Calls); Assert.False(pending.IsCompleted);
        configuration["Recovery:Blocked"] = "true";
        provider.Pending.SetResult(Ready);
        var error = await Assert.ThrowsAsync<ApiException>(() => pending);
        Assert.Equal(503, error.Status); Assert.Equal("recovery_blocked", error.Code);
        Assert.Equal(2, access.Calls); Assert.Equal(1, provider.Calls);
    }

    [Theory]
    [InlineData("synthetic-2026-10-01")]
    [InlineData("gpt-6-luna")]
    public async Task ActualSdkWireSendsStoreFalseStrictJsonNoBackgroundAndNoTools(string model)
    {
        var options = Enabled(); options.Model = model;
        using var transport = new WireHandler(Ready);
        using var http = new HttpClient(transport);
        using var chat = new ResponsesClient(new ApiKeyCredential("synthetic-not-real"), new ResponsesClientOptions
        {
            Transport = new HttpClientPipelineTransport(http), RetryPolicy = new ClientRetryPolicy(0),
            ClientLoggingOptions = new() { EnableLogging = false, EnableMessageLogging = false, EnableMessageContentLogging = false }
        }).AsIChatClient(model);
        var provider = new OpenAiSleepProvider(chat, Options.Create(options));
        Assert.Equal(Ready, await provider.GenerateAsync(Request(), SleepAiValidation.ValidateRequest(Request(), Now), false, default));
        using var wire = JsonDocument.Parse(transport.Body!); var root = wire.RootElement;
        Assert.Equal(model, root.GetProperty("model").GetString());
        Assert.False(root.TryGetProperty("temperature", out _));
        Assert.False(root.GetProperty("store").GetBoolean()); Assert.False(root.GetProperty("background").GetBoolean());
        Assert.Equal("json_schema", root.GetProperty("text").GetProperty("format").GetProperty("type").GetString());
        Assert.True(root.GetProperty("text").GetProperty("format").GetProperty("strict").GetBoolean());
        Assert.Equal(4096, root.GetProperty("max_output_tokens").GetInt32());
        Assert.False(root.TryGetProperty("previous_response_id", out _)); Assert.False(root.TryGetProperty("conversation", out _));
        Assert.False(root.TryGetProperty("tools", out var tools) && tools.GetArrayLength() > 0);
        Assert.Equal(1, transport.Calls);
    }

    [Fact]
    public async Task HttpRequiresJwtAndDirectoryAdmissionAndDisabledCapabilitiesNeverResolveProvider()
    {
        var scenario = new Scenario(new SqlFixture()); await using var host = new TestHost(scenario.Config);
        var providerResolutions = 0;
        await using var isolated = host.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddScoped<ISleepAiAccess>(_ => new Access());
            services.AddScoped<ISleepAiProvider>(_ => { providerResolutions++; return new Provider(Ready); });
        }));
        using var client = isolated.CreateClient();
        var configured = isolated.Services.GetRequiredService<IOptions<SleepAiOptions>>().Value;
        Assert.Equal("gpt-6-luna", configured.Model); Assert.False(configured.Enabled);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/v2/sleep-predictions/capabilities")).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(new() { ObjectId = Guid.NewGuid(), Email = scenario.Owner.Email }));
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/v2/sleep-predictions/capabilities")).StatusCode);
        client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(scenario.Owner));
        using var response = await client.GetAsync("/v2/sleep-predictions/capabilities");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        var capability = await response.Content.ReadFromJsonAsync<SleepPredictionCapabilities>();
        Assert.Equal(new(false, "sleep-ai-v1", "OpenAI", true), capability);
        Assert.Equal(0, providerResolutions);
        var request = Request() with { Now = DateTimeOffset.UtcNow, Records = [] };
        using var prediction = await client.PostAsJsonAsync("/v2/sleep-predictions", request);
        Assert.Equal(HttpStatusCode.OK, prediction.StatusCode);
        Assert.Equal("unavailable", (await prediction.Content.ReadFromJsonAsync<SleepPredictionResponse>())!.Status);
        using var malformed = await client.PostAsJsonAsync("/v2/sleep-predictions", new { schemaVersion = 1, notes = "forbidden" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, malformed.StatusCode);
    }

    [Fact]
    public async Task HttpEnabledFlowReauthorizesAndReturnsOnlyAiTimesWithNoStore()
    {
        var scenario = new Scenario(new SqlFixture()); var access = new Access(); var provider = new Provider(Ready);
        await using var host = new TestHost(scenario.Config);
        await using var isolated = host.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<IOptions<SleepAiOptions>>(Options.Create(Enabled()));
            services.AddSingleton<TimeProvider>(new Clock());
            services.AddScoped<ISleepAiAccess>(_ => access);
            services.AddScoped<ISleepAiProvider>(_ => provider);
        }));
        using var client = isolated.CreateClient(); client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(scenario.Owner));
        using var response = await client.PostAsJsonAsync("/v2/sleep-predictions", Request());
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        var result = await response.Content.ReadFromJsonAsync<SleepPredictionResponse>();
        Assert.Equal("ready", result!.Status); Assert.Equal(Request().InputRevision, result.InputRevision);
        Assert.Equal(2, access.Calls); Assert.Equal(1, provider.Calls);
        Assert.Equal(JsonSerializer.Deserialize<SleepPredictionModelOutput>(Ready, SleepAiJson.Options)!.Periods, result.Periods);
    }

    private static string Serialize(object value) => JsonSerializer.Serialize(value, SleepAiJson.Options);
    private static SleepAiService Service(SleepAiOptions options, ISleepAiAccess access, ISleepAiProvider provider)
    {
        var wrapped = Options.Create(options); var clock = new Clock();
        return new(wrapped, access, provider, new SleepAiBudget(clock, wrapped), clock);
    }
    private sealed class Clock : TimeProvider { public override DateTimeOffset GetUtcNow() => Now; }
    private sealed class MutableClock(DateTimeOffset now) : TimeProvider
    { public DateTimeOffset Current { get; set; } = now; public override DateTimeOffset GetUtcNow() => Current; }
    private sealed class Access : ISleepAiAccess
    {
        public int Calls { get; private set; }
        public int RejectAt { get; init; }
        public Task AuthorizeAsync(PilotIdentity user, SleepPredictionRequest request, CancellationToken ct)
        {
            Calls++; if (Calls == RejectAt) throw new ApiException(403, "membership_revoked");
            return Task.CompletedTask;
        }
    }
    private sealed class DeferredAccess(int pendingCall) : ISleepAiAccess
    {
        public int Calls { get; private set; }
        public TaskCompletionSource Pending { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task AuthorizeAsync(PilotIdentity user, SleepPredictionRequest request, CancellationToken ct)
        {
            Calls++;
            return Calls == pendingCall ? Pending.Task.WaitAsync(ct) : Task.CompletedTask;
        }
    }
    private sealed class AfterFirstAccess(ISleepAiAccess actual) : ISleepAiAccess
    {
        public int Calls { get; private set; }
        public Task AuthorizeAsync(PilotIdentity user, SleepPredictionRequest request, CancellationToken ct)
        {
            Calls++;
            return Calls == 1 ? Task.CompletedTask : actual.AuthorizeAsync(user, request, ct);
        }
    }
    private sealed class DeferredProvider : ISleepAiProvider
    {
        public int Calls { get; private set; }
        public TaskCompletionSource<string?> Pending { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task<string?> GenerateAsync(SleepPredictionRequest request, SleepAiTimeBounds bounds, bool retry, CancellationToken ct)
        { Calls++; return Pending.Task.WaitAsync(ct); }
    }
    private sealed class Provider(params string[] responses) : ISleepAiProvider
    {
        public int Calls { get; private set; }
        public List<bool> Retries { get; } = [];
        public Exception? Error { get; init; }
        public Task<string?> GenerateAsync(SleepPredictionRequest request, SleepAiTimeBounds bounds, bool retry, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested(); Calls++; Retries.Add(retry);
            if (Error is not null) throw Error;
            return Task.FromResult<string?>(responses[Math.Min(Calls - 1, responses.Length - 1)]);
        }
    }
    private sealed class ChatFake(ChatResponse response) : IChatClient
    {
        public List<ChatMessage>? Messages { get; private set; }
        public ChatOptions? Options { get; private set; }
        public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
        { Messages = messages.ToList(); Options = options; return Task.FromResult(response); }
        public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public object? GetService(Type serviceType, object? serviceKey = null) => null;
        public void Dispose() { }
    }
    private sealed class WireHandler(string output) : HttpMessageHandler
    {
        public string? Body { get; private set; }
        public int Calls { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++; Body = await request.Content!.ReadAsStringAsync(ct);
            return new(HttpStatusCode.OK) { Content = JsonContent.Create(new
            {
                id = "resp_synthetic", @object = "response", created_at = 1791777600, status = "completed",
                model = "synthetic-2026-10-01", output = new[] { new { type = "message", id = "msg_synthetic", status = "completed", role = "assistant",
                    content = new[] { new { type = "output_text", text = output, annotations = Array.Empty<object>() } } } }
            }) };
        }
    }
}
