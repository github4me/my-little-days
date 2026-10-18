using System.Text.Json;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiRemainingDayTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-18T20:15:35+11:00");
    private static readonly DateTimeOffset Midnight = DateTimeOffset.Parse("2026-10-19T00:00:00+11:00");
    private static SleepPredictionRequest Request(params SleepPredictionRecord[] records) => new()
    {
        SchemaVersion = 3, ConsentVersion = "sleep-ai-v2", InputRevision = new('d', 64),
        FamilyId = null, MembershipId = null, HistoryId = null, AgeDays = 106,
        TimeZone = "Australia/Melbourne", Now = Now, Records = records, PreviousEstimate = null
    };
    private static SleepPredictionRecord Sleep(DateTimeOffset start, DateTimeOffset? end) => new()
    { Kind = "sleep", Start = start, End = end, Ongoing = end is null, FeedKind = null, AmountMl = null };
    private static SleepPredictionPeriod Period(DateTimeOffset start, DateTimeOffset end, bool ongoing = false) => new()
    { SleepStart = start, SleepEnd = end, SootheStart = ongoing ? null : start.AddMinutes(-20), SootheEnd = ongoing ? null : start.AddMinutes(-5) };
    private static string Output(params SleepPredictionPeriod[] periods) => JsonSerializer.Serialize(
        new SleepPredictionModelOutput { Status = "ready", Periods = periods }, SleepAiJson.Options);
    private static bool Read(SleepPredictionRequest request, SleepPredictionPeriod[] periods, out SleepAiOutputFailure? failure) =>
        SleepAiValidation.TryReadOutput(Output(periods), request, SleepAiValidation.ValidateRequest(request, request.Now), out _, out failure);
    private static SleepAiService Service(Provider provider, Clock clock, Access access)
    {
        var options = Options.Create(SleepAiJobTests.Enabled());
        return new(options, access, provider, new(clock, options), clock);
    }

    [Fact]
    public async Task RemainingDayOmitsRecordedSleepWithoutChangingDatabaseEvidenceAndExpiresAtMidnight()
    {
        var recorded = Sleep(Now.AddHours(-6), Now.AddHours(-4));
        var request = Request(recorded); var original = JsonSerializer.Serialize(request, SleepAiJson.Options);
        var future = Period(Now.AddHours(1), Midnight);
        var provider = new Provider(Output(future)); var access = new Access();
        var result = await Service(provider, new(Now), access).PredictAsync(new() { ObjectId = Guid.NewGuid() }, request, default);

        Assert.Equal(3, result.SchemaVersion); Assert.Equal("ready", result.Status);
        Assert.Equal(future, Assert.Single(result.Periods)); Assert.Equal(Midnight, result.ExpiresAt);
        Assert.Equal(request.InputRevision, result.InputRevision); Assert.Equal(1, provider.Calls); Assert.Equal(2, access.Calls);
        Assert.Same(request, provider.Request); Assert.Equal(original, JsonSerializer.Serialize(request, SleepAiJson.Options));
        Assert.False(Read(request, [Period(recorded.Start, recorded.End!.Value, true), future], out var failure));
        Assert.Equal("sleep_bounds", failure!.Reason); Assert.Equal(0, failure.PeriodIndex);
        Assert.Equal(["$.periods[0].sleepStart", "$.periods[0].sleepEnd"], failure.Fields);
    }

    [Theory]
    [InlineData("2026-10-04T10:00:00+11:00", "2026-09-27T00:00:00+10:00", "2026-10-04T00:00:00+10:00", "2026-10-05T00:00:00+11:00", 23, 168)]
    [InlineData("2026-10-05T10:00:00+11:00", "2026-09-28T00:00:00+10:00", "2026-10-05T00:00:00+11:00", "2026-10-06T00:00:00+11:00", 24, 167)]
    [InlineData("2026-04-05T10:00:00+10:00", "2026-03-29T00:00:00+11:00", "2026-04-05T00:00:00+11:00", "2026-04-06T00:00:00+10:00", 25, 168)]
    [InlineData("2026-04-06T10:00:00+10:00", "2026-03-30T00:00:00+11:00", "2026-04-06T00:00:00+10:00", "2026-04-07T00:00:00+10:00", 24, 169)]
    [InlineData("2026-10-18T20:15:35+11:00", "2026-10-11T00:00:00+11:00", "2026-10-18T00:00:00+11:00", "2026-10-19T00:00:00+11:00", 24, 168)]
    [InlineData("2026-10-18T00:00:00+11:00", "2026-10-11T00:00:00+11:00", "2026-10-18T00:00:00+11:00", "2026-10-19T00:00:00+11:00", 24, 168)]
    public void HistoryUsesSevenCompleteLocalDaysExcludingTodayAcrossDst(string text, string history, string today, string end, int dayHours, int historyHours)
    {
        var now = DateTimeOffset.Parse(text); var request = Request() with { Now = now };
        var bounds = SleepAiValidation.ValidateRequest(request, now);
        Assert.Equal(DateTimeOffset.Parse(history), bounds.HistoryStart);
        Assert.Equal(DateTimeOffset.Parse(today), bounds.TodayStart);
        Assert.Equal(TimeSpan.FromHours(historyHours), bounds.TodayStart - bounds.HistoryStart);
        Assert.Equal(DateTimeOffset.Parse(end), bounds.TodayEnd); Assert.Equal(bounds.TodayEnd, bounds.SleepEndLimit);
        Assert.Equal(TimeSpan.FromHours(dayHours), bounds.TodayEnd - bounds.TodayStart);
        Assert.True(Read(request, [Period(now.AddHours(1), bounds.TodayEnd)], out _));
        Assert.False(Read(request, [Period(now.AddHours(1), bounds.TodayEnd.AddTicks(1))], out var failure));
        Assert.Equal("sleep_bounds", failure!.Reason);
    }

    [Fact]
    public void CompleteDayHistoryAllowsCrossingSleepButRejectsOlderFinishedSleepAndFeeds()
    {
        var boundary = DateTimeOffset.Parse("2026-10-11T00:00:00+11:00");
        var crossing = Sleep(boundary.AddHours(-1), boundary.AddMinutes(1));
        Assert.Equal(boundary, SleepAiValidation.ValidateRequest(Request(crossing), Now).HistoryStart);
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(Request(crossing with { End = boundary }), Now));
        var feed = new SleepPredictionRecord { Kind = "feed", Start = boundary, End = null,
            Ongoing = false, FeedKind = "formula", AmountMl = 120 };
        Assert.Equal(boundary, SleepAiValidation.ValidateRequest(Request(feed), Now).HistoryStart);
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(Request(feed with { Start = boundary.AddTicks(-1) }), Now));
    }

    [Fact]
    public void CurrentSleepReturnsOnlyMinuteRoundedPredictedRemainderThenFutureSettling()
    {
        var request = Request(Sleep(Now.AddHours(-1), null));
        var current = Period(Now.AddSeconds(-35), Now.AddMinutes(30), true);
        var future = Period(Now.AddHours(1), Midnight);
        Assert.True(Read(request, [current, future], out var failure)); Assert.Null(failure);
        Assert.False(Read(request, [current with { SleepStart = current.SleepStart.AddTicks(-1) }, future], out failure));
        Assert.Equal("sleep_bounds", failure!.Reason);
        Assert.False(Read(request, [current with { SleepStart = current.SleepStart.AddMinutes(1) }, future], out failure));
        Assert.Equal("predicted_sleep_missing_settling", failure!.Reason);
        Assert.False(Read(Request(), [current], out failure)); Assert.Equal("predicted_sleep_missing_settling", failure!.Reason);
        Assert.False(Read(request, [current with { SleepEnd = Now }], out failure)); Assert.Equal("sleep_bounds", failure!.Reason);
        Assert.False(Read(request, [current, future with { SootheStart = null, SootheEnd = null }], out failure));
        Assert.Equal("predicted_sleep_missing_settling", failure!.Reason); Assert.Equal(1, failure.PeriodIndex);
    }

    [Fact]
    public void RawOverlappingRecordsAreUnchangedContextNotMandatoryOutputAnchors()
    {
        var first = Sleep(Now.AddHours(-4), Now.AddHours(-2));
        var request = Request(first, first with { }, Sleep(Now.AddHours(-3), Now.AddHours(-1)),
            Sleep(Now.AddHours(-1), null), Sleep(Now.AddMinutes(-30), null));
        var original = JsonSerializer.Serialize(request, SleepAiJson.Options);
        Assert.True(Read(request, [Period(Now.AddHours(1), Midnight)], out var failure)); Assert.Null(failure);
        Assert.Equal(original, JsonSerializer.Serialize(request, SleepAiJson.Options));
    }

    [Theory]
    [InlineData("past-sleep", "sleep_bounds", "sleepStart")]
    [InlineData("next-day-start", "sleep_bounds", "sleepStart")]
    [InlineData("after-midnight", "sleep_bounds", "sleepEnd")]
    [InlineData("zero-duration", "sleep_order", "sleepEnd")]
    [InlineData("one-null", "settling_incomplete", "sootheStart")]
    [InlineData("no-settling", "predicted_sleep_missing_settling", "sootheStart")]
    [InlineData("past-settling", "settling_before_now", "sootheStart")]
    [InlineData("zero-settling", "settling_order", "sootheStart")]
    [InlineData("late-settling", "settling_after_sleep", "sootheEnd")]
    public void RemainingDayRejectsInvalidTemporalFieldsWithExactDiagnosticLocations(string mutation, string reason, string field)
    {
        var future = Period(Now.AddHours(1), Midnight);
        var invalid = mutation switch
        {
            "past-sleep" => future with { SleepStart = Now.AddMinutes(-1) },
            "next-day-start" => future with { SleepStart = Midnight, SleepEnd = Midnight.AddHours(1) },
            "after-midnight" => future with { SleepEnd = Midnight.AddTicks(1) },
            "zero-duration" => future with { SleepEnd = future.SleepStart },
            "one-null" => future with { SootheStart = null },
            "no-settling" => future with { SootheStart = null, SootheEnd = null },
            "past-settling" => future with { SootheStart = Now.AddMinutes(-1) },
            "zero-settling" => future with { SootheEnd = future.SootheStart },
            "late-settling" => future with { SootheEnd = future.SleepStart.AddTicks(1) },
            _ => throw new InvalidOperationException()
        };
        Assert.True(Read(Request(), [future], out _));
        Assert.False(Read(Request(), [invalid], out var failure));
        Assert.Equal(reason, failure!.Reason); Assert.Equal(0, failure.PeriodIndex);
        Assert.Contains($"$.periods[0].{field}", failure.Fields);
    }

    [Fact]
    public void FutureSleepAndSettlingRemainNonoverlappingAndStrictlyOrdered()
    {
        var first = Period(Now.AddMinutes(20), Now.AddMinutes(40));
        var second = Period(Now.AddHours(1), Midnight);
        Assert.True(Read(Request(), [first, second], out _));
        Assert.False(Read(Request(), [first, second with { SleepStart = first.SleepEnd.AddTicks(-1) }], out var failure));
        Assert.Equal("period_overlap", failure!.Reason); Assert.Equal(1, failure.PeriodIndex);
        Assert.False(Read(Request(), [first, second with { SootheStart = first.SleepEnd.AddTicks(-1) }], out failure));
        Assert.Equal("settling_overlap", failure!.Reason); Assert.Equal(["$.periods[1].sootheStart"], failure.Fields);
        Assert.False(Read(Request(), [second, first], out failure)); Assert.Equal("period_overlap", failure!.Reason);
    }

    [Fact]
    public void MinuteBoundaryAllowsCurrentMinuteSettlingWithoutPermittingPreviousMinute()
    {
        var start = Now.AddSeconds(-35);
        var future = Period(Now.AddMinutes(20), Midnight) with { SootheStart = start };
        Assert.True(Read(Request(), [future], out _));
        Assert.False(Read(Request(), [future with { SootheStart = start.AddTicks(-1) }], out var failure));
        Assert.Equal("settling_before_now", failure!.Reason);
        Assert.Equal(["$.periods[0].sootheStart"], failure.Fields);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void RemainingDayMinuteFloorAndExactFutureEndUseEquivalentLocalAndUtcInstants(bool useUtc)
    {
        var request = Request(Sleep(Now.AddHours(-1), null));
        var original = JsonSerializer.Serialize(request, SleepAiJson.Options);
        var bounds = SleepAiValidation.ValidateRequest(request, Now);
        var currentMinute = Now.AddSeconds(-35);
        var remainder = Period(currentMinute, Now.AddMilliseconds(1), true);
        string Timestamp(DateTimeOffset value) => useUtc
            ? value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture)
            : value.ToString("yyyy-MM-dd'T'HH:mm:ss.fffzzz", System.Globalization.CultureInfo.InvariantCulture);
        string Json(SleepPredictionPeriod period) => JsonSerializer.Serialize(new
        {
            status = "ready", periods = new[] { new
            {
                sleepStart = Timestamp(period.SleepStart), sleepEnd = Timestamp(period.SleepEnd),
                sootheStart = period.SootheStart is { } start ? Timestamp(start) : null,
                sootheEnd = period.SootheEnd is { } end ? Timestamp(end) : null
            } }
        });
        bool ReadJson(SleepPredictionPeriod period, out SleepPredictionModelOutput? output, out SleepAiOutputFailure? failure) =>
            SleepAiValidation.TryReadOutput(Json(period), request, bounds, out output, out failure);

        Assert.True(ReadJson(remainder, out var accepted, out var acceptedFailure));
        Assert.Null(acceptedFailure);
        Assert.Equal(currentMinute, Assert.Single(accepted!.Periods).SleepStart);
        Assert.Equal(Now.AddMilliseconds(1), accepted.Periods[0].SleepEnd);
        Assert.Equal(useUtc ? TimeSpan.Zero : TimeSpan.FromHours(11), accepted.Periods[0].SleepStart.Offset);
        Assert.Null(accepted.Periods[0].SootheStart); Assert.Null(accepted.Periods[0].SootheEnd);

        foreach (var end in new[] { Now.AddMilliseconds(-1), Now })
        {
            Assert.False(ReadJson(remainder with { SleepEnd = end }, out _, out var failure));
            Assert.Equal("sleep_bounds", failure!.Reason); Assert.Equal(0, failure.PeriodIndex);
            Assert.Equal(["$.periods[0].sleepStart", "$.periods[0].sleepEnd"], failure.Fields);
        }
        Assert.False(ReadJson(remainder with { SleepStart = currentMinute.AddMilliseconds(-1) }, out _, out var previousMinuteFailure));
        Assert.Equal("sleep_bounds", previousMinuteFailure!.Reason);

        var future = Period(Now.AddMinutes(20), Midnight) with { SootheStart = currentMinute };
        Assert.True(ReadJson(future, out accepted, out acceptedFailure)); Assert.Null(acceptedFailure);
        Assert.Equal(currentMinute, Assert.Single(accepted!.Periods).SootheStart);
        Assert.Equal(Midnight, accepted.Periods[0].SleepEnd);
        Assert.False(ReadJson(future with { SootheStart = currentMinute.AddMilliseconds(-1) }, out _, out var settlingFailure));
        Assert.Equal("settling_before_now", settlingFailure!.Reason); Assert.Equal(0, settlingFailure.PeriodIndex);
        Assert.Equal(["$.periods[0].sootheStart"], settlingFailure.Fields);
        Assert.Equal(original, JsonSerializer.Serialize(request, SleepAiJson.Options));
    }

    [Fact]
    public void RemainingDayCountAndShapeGuardsDoNotRegressWithEmptyReadySupport()
    {
        var request = Request() with { Now = Midnight.AddHours(-12) };
        var periods = Enumerable.Range(0, 24).Select(index =>
            Period(request.Now.AddMinutes(index * 25 + 20), request.Now.AddMinutes(index * 25 + 24))).ToArray();
        Assert.True(Read(request, periods, out _));
        Assert.False(Read(request, [.. periods, Period(request.Now.AddHours(11), Midnight)], out var failure));
        Assert.Equal("too_many_periods", failure!.Reason); Assert.Equal(["$.periods"], failure.Fields);
        Assert.False(Read(request, [null!], out failure)); Assert.Equal("period_missing", failure!.Reason);
        var bounds = SleepAiValidation.ValidateRequest(request, request.Now);
        Assert.True(SleepAiValidation.TryReadOutput("{\"status\":\"insufficient_data\",\"periods\":[]}", request, bounds, out var output));
        Assert.Equal("insufficient_data", output!.Status); Assert.Empty(output.Periods);
        Assert.False(SleepAiValidation.TryReadOutput(Output(periods[0]).Replace("ready", "insufficient_data"), request, bounds, out _, out failure));
        Assert.Equal("insufficient_data_with_periods", failure!.Reason);
    }

    [Fact]
    public void RemainingDaySettlingFormatLimitIsEnforcedWithoutInventingMedicalWindows()
    {
        var request = Request() with { Now = Midnight.AddHours(-10) };
        var future = Period(request.Now.AddHours(5), Midnight) with { SootheStart = request.Now.AddHours(1) };
        Assert.True(Read(request, [future], out _));
        Assert.False(Read(request, [future with { SootheStart = future.SootheStart!.Value.AddTicks(-1) }], out var failure));
        Assert.Equal("settling_too_early", failure!.Reason);
        Assert.Equal(["$.periods[0].sootheStart", "$.periods[0].sleepStart"], failure.Fields);
    }

    [Fact]
    public void PreviousEstimateIsBoundedUntrustedContextNotReconstructedHistory()
    {
        var priorStart = Now.AddHours(-2);
        var prior = new SleepPredictionPreviousEstimate { GeneratedAt = priorStart.AddSeconds(45),
            Periods = [Period(priorStart, priorStart.AddHours(1), true)] };
        var request = Request(Sleep(priorStart.AddMinutes(-30), priorStart.AddMinutes(15))) with { PreviousEstimate = prior };
        Assert.Equal(Midnight, SleepAiValidation.ValidateRequest(request, Now).TodayEnd);
        Assert.True(Read(request, [Period(Now.AddHours(1), Midnight)], out _));
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(request with
        { PreviousEstimate = prior with { Periods = [Period(Midnight.AddDays(-1).AddMinutes(-1), priorStart, true)] } }, Now));
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(request with
        { PreviousEstimate = prior with { Periods = [Period(prior.GeneratedAt.AddMinutes(1), Midnight, true)] } }, Now));
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(request with
        { PreviousEstimate = prior with { Periods = [Period(priorStart, Midnight.AddTicks(1), true)] } }, Now));
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(request with
        { PreviousEstimate = prior with { GeneratedAt = Now.AddTicks(1) } }, Now));
    }

    [Fact]
    public async Task LateDayCanReturnReadyEmptyWithoutFabricatingAnotherSleep()
    {
        var now = Midnight.AddSeconds(-30); var request = Request() with { Now = now };
        var provider = new Provider(Output());
        var response = await Service(provider, new(now), new()).PredictAsync(new() { ObjectId = Guid.NewGuid() }, request, default);
        Assert.Equal("ready", response.Status); Assert.Empty(response.Periods); Assert.Equal(Midnight, response.ExpiresAt);
        Assert.Equal(1, provider.Calls);
        Assert.Equal(Midnight, SleepAiValidation.ValidateRequest(request with
        { PreviousEstimate = new() { GeneratedAt = now.AddSeconds(-1), Periods = [] } }, now).TodayEnd);
        Assert.False(Read(request with { SchemaVersion = 2 }, [], out var failure)); Assert.Equal("empty_periods", failure!.Reason);
    }

    [Fact]
    public void RemainingDayRequiresExistingConsentExplicitPriorAndCompatibleDurableAdmission()
    {
        var request = Request(); var json = JsonSerializer.Serialize(request, SleepAiJson.Options);
        var missingPrior = JsonSerializer.Deserialize<SleepPredictionRequest>(json.Replace(",\"previousEstimate\":null", ""), SleepAiJson.Options)!;
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(missingPrior, Now));
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(request with { ConsentVersion = "sleep-ai-v1" }, Now));
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(request with { SchemaVersion = 4 }, Now));
        var job = new CreateSleepPredictionJobRequest(Guid.NewGuid(), SleepAiJobPolicy.ConsentVersion, Guid.NewGuid(), request);
        Assert.Equal(Midnight, SleepAiJobPolicy.Validate(job, Now).SleepEndLimit);
        Assert.Equal(Midnight.AddHours(12), SleepAiJobPolicy.Validate(job with { Request = request with { SchemaVersion = 2 } }, Now).SleepEndLimit);
    }

    [Fact]
    public async Task DurableV3RetainsOriginalSnapshotAndRejectsResultAfterLocalMidnight()
    {
        var request = Request(); var provider = new Provider(Output(Period(Now.AddHours(1), Midnight)));
        var clock = new Clock(Now.AddMinutes(10)); var service = Service(provider, clock, new());
        var response = await service.PredictQueuedAsync(new() { ObjectId = Guid.NewGuid() }, request, _ => Task.CompletedTask, default);
        Assert.Equal("ready", response.Status); Assert.Equal(clock.Now, response.GeneratedAt);
        Assert.Same(request, provider.Request); Assert.Equal(Midnight, response.ExpiresAt);
        clock.Now = Midnight;
        var error = await Assert.ThrowsAsync<ApiException>(() => service.PredictQueuedAsync(new(), request, _ => Task.CompletedTask, default));
        Assert.Equal("prediction_day_changed", error.Code); Assert.Equal(1, provider.Calls);
    }

    [Fact]
    public async Task RemainingDayProviderUsesSevenCompleteDaysPlusTodayWithMinimizedEvidence()
    {
        var history = DateTimeOffset.Parse("2026-10-11T00:00:00+11:00");
        var record = Sleep(Now.AddHours(-2), Now.AddHours(-1));
        var request = Request(Sleep(history.AddHours(1), history.AddHours(3)), record, record with { });
        var fake = new ChatFake(); var provider = new OpenAiSleepProvider(fake, Options.Create(SleepAiJobTests.Enabled()));
        await provider.GenerateAsync(request, SleepAiValidation.ValidateRequest(request, Now), false, default);
        using var payload = JsonDocument.Parse(fake.Messages![1].Text); var root = payload.RootElement;
        Assert.Equal(["ageDays", "historyStart", "now", "previousEstimate", "records", "sleepEndLimit", "timeZone", "todayEnd", "todayStart"],
            root.EnumerateObject().Select(x => x.Name).Order().ToArray());
        Assert.Equal(request.AgeDays, root.GetProperty("ageDays").GetInt32());
        Assert.Equal(history, root.GetProperty("historyStart").GetDateTimeOffset());
        Assert.Equal(DateTimeOffset.Parse("2026-10-18T00:00:00+11:00"), root.GetProperty("todayStart").GetDateTimeOffset());
        Assert.Equal(Midnight, root.GetProperty("sleepEndLimit").GetDateTimeOffset());
        Assert.Equal(JsonSerializer.Serialize(request.Records, SleepAiJson.Options), root.GetProperty("records").GetRawText());
        Assert.Equal(OpenAiSleepProvider.RemainingDayInstructions, fake.Messages[0].Text);
        Assert.Contains("authoritative database evidence rendered separately", fake.Messages[0].Text);
        Assert.Contains("exact ageDays", fake.Messages[0].Text); Assert.Contains("Population-level total sleep", fake.Messages[0].Text);
        Assert.Contains("Do not browse, use tools, fetch sources", fake.Messages[0].Text);
        Assert.DoesNotContain("Each isolated completed recorded sleep", fake.Messages[0].Text);
        Assert.Null(fake.Options!.Tools); Assert.False(fake.Options.AllowBackgroundResponses);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RemainingDayPromptSummarizesSevenDayPatternBeforeAdjustingToday(bool retry)
    {
        var request = Request(); var fake = new ChatFake();
        await new OpenAiSleepProvider(fake, Options.Create(SleepAiJobTests.Enabled())).GenerateAsync(
            request, SleepAiValidation.ValidateRequest(request, Now), retry, default);
        var prompt = fake.Messages![0].Text;
        var summarize = prompt.IndexOf("STEP 1 — SUMMARIZE THE PREVIOUS SEVEN COMPLETE LOCAL DAYS FIRST", StringComparison.Ordinal);
        var adjust = prompt.IndexOf("STEP 2 — COMPARE TODAY AND ADJUST THE REMAINING DAY", StringComparison.Ordinal);
        Assert.True(summarize >= 0 && adjust > summarize);
        var historicalStep = prompt[summarize..adjust];
        Assert.Contains("BEFORE making any prediction", historicalStep);
        Assert.Contains("[historyStart,todayStart)", historicalStep);
        Assert.Contains("EXCLUDING today", historicalStep);
        Assert.Contains("do not include today's portion of a crossing sleep", historicalStep);
        Assert.Contains("Preceding-night total sleep and longest continuous sleep stretch", historicalStep);
        Assert.Contains("Identify the main overnight sleep period from the recurring observed pattern", historicalStep);
        Assert.Contains("total recorded sleep across its separate bouts and the longest uninterrupted bout separately", historicalStep);
        Assert.Contains("Do not automatically classify the last daytime nap as nighttime sleep", historicalStep);
        Assert.DoesNotContain("Treat the main night sleep as the longest continuous stretch", historicalStep);
        Assert.Contains("Do not bridge a known awake gap", historicalStep);
        Assert.Contains("around 19:00", historicalStep);
        Assert.Contains("not a compulsory bedtime or rigid boundary", historicalStep);
        Assert.Contains("Daytime total sleep duration", historicalStep);
        Assert.Contains("Daytime nap count", historicalStep);
        Assert.Contains("without counting a midnight split of the same night sleep as a new nap", historicalStep);
        Assert.Contains("daytime nap-time distribution", historicalStep);
        Assert.Contains("wake-to-sleep intervals", historicalStep);
        Assert.Contains("do not treat missing days as zero totals", historicalStep);
        Assert.Contains("Assess data usability separately for each metric", historicalStep);
        Assert.Contains("Incomplete daytime records must not be treated as complete daytime totals or nap counts", historicalStep);
        Assert.Contains("reliable individual nap times and fully observed wake-to-sleep intervals may still inform timing patterns", historicalStep);
        Assert.Contains("usable preceding-night data may still be considered independently", historicalStep);
        Assert.Contains("Low recorded sleep totals or few recorded naps alone do not establish that records are missing", historicalStep);
        Assert.Contains("without claiming seven days of observations", historicalStep);
        var adjustmentStep = prompt[adjust..];
        Assert.Contains("Only after completing Step 1", adjustmentStep);
        Assert.Contains("seven-day common pattern as the primary inference basis", adjustmentStep);
        Assert.Contains("modest adjustments for today's observed deviations", adjustmentStep);
        Assert.Contains("do not over-rely on any single day's data", adjustmentStep);
        Assert.Contains("today's remaining sleep periods and windows to BEGIN settling", adjustmentStep);
        Assert.Contains("never contradict those facts just to follow the baseline", adjustmentStep);
        Assert.Contains("Return predictions only for the remaining day up to todayEnd, using the current-minute precision rule below for starts", adjustmentStep);
        Assert.Contains("No explanations, debug text, confidence fields, record corrections or extra keys", adjustmentStep);
        Assert.DoesNotContain("especially today's sleep", prompt);
        Assert.DoesNotContain("rolling seven days immediately before now", prompt);
        Assert.Equal(retry, prompt.Contains("previous response failed structural/temporal validation", StringComparison.Ordinal));
        Assert.Equal(2, fake.Messages.Count); Assert.Null(fake.Options!.Tools);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RemainingDayPromptAlignsPriorEstimateEvidenceMinuteFloorAndTimezoneOnFirstAndRetry(bool retry)
    {
        var prior = new SleepPredictionPreviousEstimate
        {
            GeneratedAt = Now.AddHours(-1),
            Periods = [Period(Now.AddMinutes(-30), Now.AddMinutes(30))]
        };
        var request = Request(Sleep(Now.AddMinutes(-20), Now.AddMinutes(-5))) with { PreviousEstimate = prior };
        var original = JsonSerializer.Serialize(request, SleepAiJson.Options);
        var fake = new ChatFake();
        await new OpenAiSleepProvider(fake, Options.Create(SleepAiJobTests.Enabled())).GenerateAsync(
            request, SleepAiValidation.ValidateRequest(request, Now), retry, default);
        var prompt = fake.Messages![0].Text;
        Assert.Contains("previousEstimate is an earlier guess, never observed evidence", prompt);
        Assert.Contains("if new records conflict with previousEstimate, discard the contradicted portions", prompt);
        Assert.Contains("Do not move a missed prediction to now as though a new wake event occurred", prompt);
        Assert.Contains("If neither a usable timing anchor nor a repeatable sleep pattern exists, return insufficient_data with an empty periods array", prompt);
        Assert.DoesNotContain("If there is no usable timing anchor or repeatable pattern", prompt);
        Assert.Contains("Let currentMinute be now rounded down to the start of its minute", prompt);
        Assert.Contains("currentMinute <= sootheStart < sootheEnd <= sleepStart < sleepEnd <= todayEnd", prompt);
        Assert.DoesNotContain("requires now <= sootheStart", prompt);
        Assert.Contains("Sleep must still end strictly after the exact now timestamp", prompt);
        Assert.Contains("Interpret all local clock times and calendar boundaries in the supplied IANA timezone", prompt);
        Assert.Contains("correct offset for that instant in the supplied timezone, or the equivalent UTC instant with Z", prompt);
        Assert.Equal(retry, prompt.Contains("previous response failed structural/temporal validation", StringComparison.Ordinal));
        using var payload = JsonDocument.Parse(fake.Messages[1].Text);
        Assert.Equal(JsonSerializer.Serialize(prior, SleepAiJson.Options), payload.RootElement.GetProperty("previousEstimate").GetRawText());
        Assert.Equal(JsonSerializer.Serialize(request.Records, SleepAiJson.Options), payload.RootElement.GetProperty("records").GetRawText());
        Assert.Equal(original, JsonSerializer.Serialize(request, SleepAiJson.Options));
    }

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    { public DateTimeOffset Now { get; set; } = now; public override DateTimeOffset GetUtcNow() => Now; }
    private sealed class Access : ISleepAiAccess
    {
        public int Calls { get; private set; }
        public Task AuthorizeAsync(PilotIdentity user, SleepPredictionRequest request, CancellationToken ct)
        { Calls++; return Task.CompletedTask; }
    }
    private sealed class Provider(string output) : ISleepAiProvider
    {
        public int Calls { get; private set; }
        public SleepPredictionRequest? Request { get; private set; }
        public Task<string?> GenerateAsync(SleepPredictionRequest request, SleepAiTimeBounds bounds, bool retry, CancellationToken ct)
        { Calls++; Request = request; return Task.FromResult<string?>(output); }
    }
    private sealed class ChatFake : IChatClient
    {
        public List<ChatMessage>? Messages { get; private set; }
        public ChatOptions? Options { get; private set; }
        public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
        { Messages = messages.ToList(); Options = options; return Task.FromResult(new ChatResponse(new ChatMessage(ChatRole.Assistant,
            "{\"status\":\"insufficient_data\",\"periods\":[]}")) { FinishReason = ChatFinishReason.Stop }); }
        public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public object? GetService(Type type, object? key = null) => null;
        public void Dispose() { }
    }
}
