using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.ClientModel;
using System.ClientModel.Primitives;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using OpenAI.Responses;

#pragma warning disable OPENAI001 // Same pinned no-store provider adapter as production.

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiWholeDayTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-13T16:00:00+11:00");
    private static readonly PilotIdentity User = new() { ObjectId = Guid.NewGuid() };
    private static readonly DateTimeOffset Midnight = DateTimeOffset.Parse("2026-10-13T00:00:00+11:00");
    private static SleepPredictionRequest Request() => new()
    {
        SchemaVersion = 2, InputRevision = new('b', 64), ConsentVersion = "sleep-ai-v2",
        FamilyId = null, MembershipId = null, HistoryId = null, AgeDays = 100,
        TimeZone = "Australia/Melbourne", Now = Now, Records = [], PreviousEstimate = null
    };
    private static SleepAiOptions Enabled() => new()
    {
        Enabled = true, ChildDataProcessingApproved = true, ZeroDataRetentionApproved = true,
        HardSpendControlVerified = true, ApiKey = "synthetic-not-real", Model = "gpt-6-luna"
    };
    private static SleepPredictionRecord Sleep(DateTimeOffset start, DateTimeOffset? end) => new()
    { Kind = "sleep", Start = start, End = end, Ongoing = end is null, FeedKind = null, AmountMl = null };
    private static SleepPredictionPeriod Period(DateTimeOffset start, DateTimeOffset end, bool anchored = false) => new()
    { SleepStart = start, SleepEnd = end, SootheStart = anchored ? null : start.AddMinutes(-20), SootheEnd = anchored ? null : start.AddMinutes(-5) };
    private static string Output(params SleepPredictionPeriod[] periods) => JsonSerializer.Serialize(
        new SleepPredictionModelOutput { Status = "ready", Periods = periods }, SleepAiJson.Options);
    private static bool Accepts(SleepPredictionRequest request, params SleepPredictionPeriod[] periods) =>
        SleepAiValidation.TryReadOutput(Output(periods), request, SleepAiValidation.ValidateRequest(request, request.Now), out _);
    private static SleepAiService Service(Access access, Provider provider, Clock? clock = null, SleepAiOptions? options = null)
    {
        clock ??= new(Now); var wrapped = Options.Create(options ?? Enabled());
        return new(wrapped, access, provider, new SleepAiBudget(clock, wrapped), clock);
    }

    [Fact]
    public async Task WholeDayReturnsObservedOngoingAndFutureExactlyWithMidnightExpiry()
    {
        var completed = Sleep(Midnight.AddHours(-3), Midnight.AddHours(7));
        var ongoing = Sleep(Now.AddMinutes(-30), null);
        var request = Request() with { Records = [completed, ongoing] };
        var periods = new[] { Period(completed.Start, completed.End!.Value, true),
            Period(ongoing.Start, Now.AddMinutes(35), true), Period(Now.AddHours(2), Now.AddHours(3)),
            Period(Midnight.AddHours(21), Midnight.AddDays(1).AddHours(7)) };
        var access = new Access(); var provider = new Provider(Output(periods));
        var result = await Service(access, provider).PredictAsync(User, request, default);
        Assert.Equal(2, result.SchemaVersion); Assert.Equal("ready", result.Status);
        Assert.Equal(periods, result.Periods); Assert.Equal(Now, result.GeneratedAt);
        Assert.Equal(Midnight.AddDays(1), result.ExpiresAt); Assert.Equal(request.InputRevision, result.InputRevision);
        Assert.Equal(2, access.Calls); Assert.Equal(1, provider.Calls);
        Assert.All(result.Periods.Take(2), period => { Assert.Null(period.SootheStart); Assert.Null(period.SootheEnd); });
    }

    [Theory]
    [InlineData("partial")]
    [InlineData("one-millisecond")]
    [InlineData("duplicate-object")]
    [InlineData("duplicate-value")]
    [InlineData("nested")]
    [InlineData("transitive")]
    [InlineData("ongoing")]
    [InlineData("multiple-ongoing")]
    [InlineData("cross-midnight")]
    public async Task WholeDayLetsAiReconcileRawManualOverlapsWithoutChangingRecords(string shape)
    {
        var first = Sleep(Midnight.AddHours(10), Midnight.AddHours(11));
        SleepPredictionRecord[] records = shape switch
        {
            "partial" => [first, Sleep(first.Start.AddMinutes(50), first.Start.AddHours(2))],
            "one-millisecond" => [first, Sleep(first.End!.Value.AddMilliseconds(-1), first.Start.AddHours(2))],
            "duplicate-object" => [first, first],
            "duplicate-value" => [first, first with { }],
            "nested" => [Sleep(first.Start, first.Start.AddHours(3)), Sleep(first.Start.AddHours(1), first.Start.AddHours(2)),
                Sleep(first.Start.AddHours(2.5), first.Start.AddHours(2.75))],
            "transitive" => [first, Sleep(first.Start.AddMinutes(30), first.Start.AddHours(2)),
                Sleep(first.Start.AddHours(1.5), first.Start.AddHours(3))],
            "ongoing" => [Sleep(Now.AddHours(-2), null), Sleep(Now.AddHours(-1), Now.AddMinutes(-30))],
            "multiple-ongoing" => [Sleep(Now.AddHours(-2), null), Sleep(Now.AddHours(-1), null)],
            "cross-midnight" => [Sleep(Midnight.AddHours(-1), Midnight.AddHours(1)),
                Sleep(Midnight.AddMinutes(30), Midnight.AddHours(2))],
            _ => throw new InvalidOperationException()
        };
        // Deliberately unsorted raw evidence; no caller-side union or correction.
        records = records.Reverse().ToArray();
        var request = Request() with { Records = records };
        var original = JsonSerializer.Serialize(request, SleepAiJson.Options);
        var inferred = Period(records.Min(x => x.Start).AddMinutes(1),
            records.Any(x => x.Ongoing) ? Now.AddMinutes(30) : records.Max(x => x.End!.Value).AddMinutes(-1), true);
        var provider = new Provider(Output(inferred)); var access = new Access();

        var result = await Service(access, provider).PredictAsync(User, request, default);

        Assert.Equal("ready", result.Status); Assert.Equal(inferred, Assert.Single(result.Periods));
        Assert.Equal(1, provider.Calls); Assert.Equal(2, access.Calls);
        Assert.Equal(original, JsonSerializer.Serialize(request, SleepAiJson.Options));
        Assert.Same(request, provider.LastRequest);
        Assert.Equal(2, result.SchemaVersion); Assert.Equal(Midnight.AddDays(1), result.ExpiresAt);
    }

    [Fact]
    public async Task WholeDayPreservesCoincidentZeroElapsedOngoingAnchorsWithOneExactOutput()
    {
        var request = Request() with { Records = [Sleep(Now, null), Sleep(Now, null)] };
        var original = JsonSerializer.Serialize(request, SleepAiJson.Options);
        var period = Period(Now, Now.AddMinutes(30), true);
        var provider = new Provider(Output(period)); var access = new Access();

        var result = await Service(access, provider).PredictAsync(User, request, default);

        Assert.Equal("ready", result.Status); Assert.Equal(period, Assert.Single(result.Periods));
        Assert.Null(result.Periods[0].SootheStart); Assert.Null(result.Periods[0].SootheEnd);
        Assert.Equal(original, JsonSerializer.Serialize(request, SleepAiJson.Options));
        Assert.Same(request, provider.LastRequest); Assert.Equal(2, provider.LastRequest!.Records.Length);
        Assert.Equal(1, provider.Calls); Assert.Equal(2, access.Calls);
    }

    [Fact]
    public void WholeDayAiMayChooseOrDiscountConflictsButMustRetainIsolatedSleep()
    {
        var conflict = Sleep(Midnight.AddHours(9), Midnight.AddHours(11));
        var other = Sleep(Midnight.AddHours(10), Midnight.AddHours(12));
        var isolated = Sleep(Midnight.AddHours(13), Midnight.AddHours(14));
        var request = Request() with { Records = [conflict, other, isolated] };
        var known = Period(isolated.Start, isolated.End!.Value, true);
        var future = Period(Now.AddHours(1), Now.AddHours(2));
        Assert.True(Accepts(request, Period(conflict.Start, conflict.End!.Value, true), known, future));
        Assert.True(Accepts(request, Period(conflict.Start, other.End!.Value, true), known, future));
        Assert.True(Accepts(request, known, future));
        Assert.False(Accepts(request, future));
        Assert.False(Accepts(request, known with { SleepStart = known.SleepStart.AddMilliseconds(1) }, future));
        Assert.False(Accepts(request, known with { SleepEnd = known.SleepEnd.AddMilliseconds(-1) }, future));
        Assert.False(Accepts(request, Period(conflict.Start, isolated.Start.AddMinutes(1), true), known, future));
        Assert.False(Accepts(request, known, Period(known.SleepEnd.AddMinutes(10), known.SleepEnd.AddHours(1))));
    }

    [Theory]
    [InlineData("no-intersection")]
    [InlineData("touching-end")]
    [InlineData("touching-start")]
    [InlineData("future-null")]
    [InlineData("invented-settling")]
    [InlineData("one-null")]
    [InlineData("overlapping-output")]
    public void WholeDayConflictInterpretationsRetainStrictSettlingAndOutputRules(string invalid)
    {
        var request = Request() with { Records = [Sleep(Now.AddHours(-2), null), Sleep(Now.AddHours(-1), null)] };
        var inferred = Period(Now.AddHours(-1.5), Now.AddMinutes(30), true);
        SleepPredictionPeriod[] periods = invalid switch
        {
            "no-intersection" => [Period(Now.AddHours(-4), Now.AddHours(-3), true)],
            "touching-end" => [Period(Now, Now.AddHours(1), true)],
            "touching-start" => [Period(Now.AddHours(-3), Now.AddHours(-2), true)],
            "future-null" => [Period(Now.AddMilliseconds(1), Now.AddHours(1), true)],
            "invented-settling" => [Period(inferred.SleepStart, inferred.SleepEnd)],
            "one-null" => [inferred with { SootheStart = inferred.SleepStart.AddMinutes(-20) }],
            "overlapping-output" => [inferred, inferred with { SleepStart = inferred.SleepStart.AddMinutes(1) }],
            _ => throw new InvalidOperationException()
        };
        Assert.True(Accepts(request, inferred));
        Assert.False(Accepts(request, periods));
        Assert.True(Accepts(request, Period(Now.AddMinutes(20), Now.AddHours(1))));
    }

    [Fact]
    public void HistoricalOverlapIsContextAndDoesNotRequireTodaysReconstruction()
    {
        var request = Request() with { Records = [Sleep(Midnight.AddDays(-2).AddHours(10), Midnight.AddDays(-2).AddHours(12)),
            Sleep(Midnight.AddDays(-2).AddHours(11), Midnight.AddDays(-2).AddHours(13))] };
        var future = Period(Now.AddHours(1), Now.AddHours(2));
        Assert.True(Accepts(request, future));
        Assert.False(Accepts(request, Period(Midnight.AddHours(10), Midnight.AddHours(11), true), future));
    }

    [Fact]
    public void FeedCoincidenceAndTouchingSleepsRemainIsolatedExactAnchors()
    {
        var first = Sleep(Midnight.AddHours(9), Midnight.AddHours(10));
        var next = Sleep(first.End!.Value, first.End.Value.AddHours(1));
        var feed = new SleepPredictionRecord { Kind = "feed", Start = first.Start, End = next.End,
            Ongoing = false, FeedKind = "formula", AmountMl = 120 };
        var request = Request() with { Records = [first, feed, next] };
        var a = Period(first.Start, first.End.Value, true); var b = Period(next.Start, next.End!.Value, true);
        Assert.True(Accepts(request, a, b));
        Assert.False(Accepts(request, a));
        Assert.False(Accepts(request, b));
        Assert.False(Accepts(request, Period(first.Start, next.End.Value, true)));
    }

    [Fact]
    public void WholeDayReconciliationStillProtectsIsolatedSleepOutsideTodaysAnchors()
    {
        var request = Request() with { Records = [Sleep(Midnight.AddHours(-2), Midnight),
            Sleep(Midnight.AddHours(8), Midnight.AddHours(9)), Sleep(Midnight.AddHours(8.5), Midnight.AddHours(9.5))] };
        var first = Period(Midnight.AddMinutes(20), Midnight.AddHours(1));
        var reconciled = Period(Midnight.AddHours(8), Midnight.AddHours(9.5), true);
        Assert.True(Accepts(request, first, reconciled));
        // The prior-night record is not an obligatory output anchor, so only
        // collision validation protects it from fabricated settling advice.
        Assert.False(Accepts(request, first with { SootheStart = Midnight.AddTicks(-1) }, reconciled));
    }

    [Theory]
    [InlineData("future")]
    [InlineData("reversed")]
    [InlineData("overlong")]
    [InlineData("ongoing-state")]
    [InlineData("feed-data")]
    public async Task AcceptingOverlapDoesNotBypassOtherWholeDayInputGuards(string invalid)
    {
        var sleep = Sleep(Now.AddHours(-2), Now.AddHours(-1));
        var bad = invalid switch
        {
            "future" => sleep with { End = Now.AddMilliseconds(1) },
            "reversed" => sleep with { End = sleep.Start.AddMilliseconds(-1) },
            "overlong" => sleep with { Start = sleep.End!.Value.AddHours(-24).AddMilliseconds(-1) },
            "ongoing-state" => sleep with { Ongoing = true },
            "feed-data" => sleep with { AmountMl = 120 },
            _ => throw new InvalidOperationException()
        };
        var access = new Access(); var provider = new Provider("{}");
        var error = await Assert.ThrowsAsync<ApiException>(() => Service(access, provider).PredictAsync(User,
            Request() with { Records = [sleep, sleep, bad] }, default));
        Assert.Equal(422, error.Status); Assert.Equal("invalid_input", error.Code);
        Assert.Equal(0, access.Calls); Assert.Equal(0, provider.Calls);
    }

    [Fact]
    public async Task SchemaOneStillRejectsOverlapBeforeAuthorityOrProviderCall()
    {
        var record = Sleep(Now.AddHours(-2), Now.AddHours(-1));
        var request = Request() with { SchemaVersion = 1, ConsentVersion = "sleep-ai-v1", Records = [record, record] };
        var access = new Access(); var provider = new Provider("{}");
        var error = await Assert.ThrowsAsync<ApiException>(() => Service(access, provider).PredictAsync(User, request, default));
        Assert.Equal(422, error.Status); Assert.Equal("invalid_input", error.Code);
        Assert.Equal(0, access.Calls); Assert.Equal(0, provider.Calls); Assert.Null(provider.LastRequest);
    }

    [Fact]
    public async Task WholeDayOverlapCanReturnInsufficientDataWithoutRetryOrFabricatedOutput()
    {
        var record = Sleep(Now.AddHours(-2), Now.AddHours(-1));
        var provider = new Provider("{\"status\":\"insufficient_data\",\"periods\":[]}");
        var access = new Access();
        var response = await Service(access, provider).PredictAsync(User, Request() with { Records = [record, record] }, default);
        Assert.Equal("insufficient_data", response.Status); Assert.Empty(response.Periods);
        Assert.Equal(1, provider.Calls); Assert.Equal([false], provider.Retries); Assert.Equal(2, access.Calls);
    }

    [Fact]
    public async Task WholeDayProviderReceivesEveryRawOverlapAndExplicitManualErrorInstructions()
    {
        var record = Sleep(Now.AddHours(-2), null);
        var request = Request() with { Records = [record, record with { }, Sleep(Now.AddHours(-1), Now.AddMinutes(-30))] };
        var before = JsonSerializer.Serialize(request, SleepAiJson.Options);
        var fake = new ChatFake(); var provider = new OpenAiSleepProvider(fake, Options.Create(Enabled()));
        await provider.GenerateAsync(request, SleepAiValidation.ValidateRequest(request, Now), false, default);
        using var payload = JsonDocument.Parse(fake.Messages![1].Text);
        Assert.Equal(JsonSerializer.Serialize(request.Records, SleepAiJson.Options), payload.RootElement.GetProperty("records").GetRawText());
        Assert.Equal(3, payload.RootElement.GetProperty("records").GetArrayLength());
        Assert.Equal(before, JsonSerializer.Serialize(request, SleepAiJson.Options));
        var instructions = fake.Messages[0].Text;
        Assert.Contains("manual timing errors or duplicates", instructions);
        Assert.Contains("choose, combine or discount", instructions);
        Assert.Contains("Overlap alone is not a reason to return insufficient_data", instructions);
        Assert.Contains("Never interpret your reconciliation as editing a recorded fact, ending a timer or observing a wake event", instructions);
        Assert.Contains("New records always outrank it", instructions);
        Assert.Equal(["ageDays", "now", "previousEstimate", "records", "sleepEndLimit", "timeZone", "todayEnd", "todayStart"], payload.RootElement.EnumerateObject().Select(p => p.Name).Order().ToArray());
        Assert.Equal("gpt-6-luna", fake.Options!.ModelId);
        var raw = Assert.IsType<CreateResponseOptions>(fake.Options.RawRepresentationFactory!(fake));
        Assert.False(raw.StoredOutputEnabled); Assert.False(raw.BackgroundModeEnabled);
    }

    [Fact]
    public void PastUnobservedPlanContextIsAllowedButNeedsItsOwnAiSettlingWindow()
    {
        var past = Period(Midnight.AddHours(9), Midnight.AddHours(10));
        Assert.True(Accepts(Request(), past));
        Assert.False(Accepts(Request(), past with { SootheStart = null, SootheEnd = null }));
        Assert.False(Accepts(Request(), past with { SootheStart = null }));
    }

    [Theory]
    [InlineData("2026-10-04T10:00:00+11:00", "2026-10-04T00:00:00+10:00", "2026-10-05T00:00:00+11:00", 23)]
    [InlineData("2026-04-05T10:00:00+10:00", "2026-04-05T00:00:00+11:00", "2026-04-06T00:00:00+10:00", 25)]
    public async Task WholeDayBoundsAndExpiryUseCalendarMidnightAcrossDst(string nowText, string startText, string endText, int hours)
    {
        var now = DateTimeOffset.Parse(nowText); var request = Request() with { Now = now };
        var bounds = SleepAiValidation.ValidateRequest(request, now);
        Assert.Equal(DateTimeOffset.Parse(startText), bounds.TodayStart);
        Assert.Equal(DateTimeOffset.Parse(endText), bounds.TodayEnd);
        Assert.Equal(TimeSpan.FromHours(hours), bounds.TodayEnd - bounds.TodayStart);
        var result = await Service(new(), new("""{"status":"insufficient_data","periods":[]}"""), new(now)).PredictAsync(User, request, default);
        Assert.Equal(now, result.GeneratedAt); Assert.Equal(bounds.TodayEnd, result.ExpiresAt);
        Assert.Equal("insufficient_data", result.Status); Assert.Empty(result.Periods);
    }

    [Theory]
    [InlineData("missing-completed")]
    [InlineData("shift-completed-start")]
    [InlineData("shift-completed-end")]
    [InlineData("invent-completed-settling")]
    [InlineData("missing-ongoing")]
    [InlineData("shift-ongoing-start")]
    [InlineData("ongoing-end-at-now")]
    [InlineData("ongoing-end-before-now")]
    [InlineData("invent-ongoing-settling")]
    [InlineData("overlap-recorded")]
    [InlineData("settling-overlaps-recorded")]
    public void WholeDayRejectsMissingChangedOrConflictingObservedAnchors(string mutation)
    {
        var completed = Sleep(Now.AddHours(-6), Now.AddHours(-5)); var ongoing = Sleep(Now.AddHours(-1), null);
        var request = Request() with { Records = [completed, ongoing] };
        var first = Period(completed.Start, completed.End!.Value, true);
        var current = Period(ongoing.Start, Now.AddMinutes(30), true);
        SleepPredictionPeriod[] periods = [first, current];
        periods = mutation switch
        {
            "missing-completed" => [current],
            "shift-completed-start" => [first with { SleepStart = first.SleepStart.AddTicks(1) }, current],
            "shift-completed-end" => [first with { SleepEnd = first.SleepEnd.AddTicks(1) }, current],
            "invent-completed-settling" => [Period(first.SleepStart, first.SleepEnd), current],
            "missing-ongoing" => [first],
            "shift-ongoing-start" => [first, current with { SleepStart = current.SleepStart.AddTicks(1) }],
            "ongoing-end-at-now" => [first, current with { SleepEnd = Now }],
            "ongoing-end-before-now" => [first, current with { SleepEnd = Now.AddTicks(-1) }],
            "invent-ongoing-settling" => [first, Period(current.SleepStart, current.SleepEnd)],
            "overlap-recorded" => [Period(completed.Start.AddHours(-1), completed.End.Value.AddMinutes(1)), current],
            "settling-overlaps-recorded" => [first, Period(first.SleepEnd.AddMinutes(10), first.SleepEnd.AddHours(1)), current],
            _ => throw new InvalidOperationException()
        };
        Assert.False(Accepts(request, periods));
        Assert.True(Accepts(request, first, current));
    }

    [Fact]
    public void CompletedSleepOutsideTodayIsContextOnlyAndBoundaryAdjacencyIsAccepted()
    {
        var priorNight = Sleep(Midnight.AddHours(-2), Midnight);
        var ended = Sleep(Midnight, Midnight.AddHours(1));
        var request = Request() with { Records = [priorNight, ended] };
        var observed = Period(ended.Start, ended.End!.Value, true);
        var estimated = Period(ended.End.Value.AddMinutes(20), ended.End.Value.AddHours(1));
        Assert.True(Accepts(request, observed, estimated));
        Assert.False(Accepts(request, observed, estimated with { SootheStart = ended.End.Value.AddTicks(-1) }));
        Assert.False(Accepts(request, Period(priorNight.Start, priorNight.End!.Value, true), observed, estimated));
    }

    [Theory]
    [InlineData("next-day-start")]
    [InlineData("ends-at-today-start")]
    [InlineData("too-long")]
    [InlineData("after-next-noon")]
    [InlineData("reverse")]
    [InlineData("unsorted")]
    [InlineData("overlap")]
    [InlineData("settling-over-four-hours")]
    [InlineData("settling-reversed")]
    [InlineData("settling-after-start")]
    [InlineData("one-null")]
    public void WholeDayRejectsTemporalPartitionsWithoutRepairingOutput(string mutation)
    {
        var p = Period(Midnight.AddHours(4), Midnight.AddHours(5));
        SleepPredictionPeriod[] periods = mutation switch
        {
            "next-day-start" => [Period(Midnight.AddDays(1), Midnight.AddDays(1).AddHours(1))],
            "ends-at-today-start" => [Period(Midnight.AddHours(-2), Midnight)],
            "too-long" => [p with { SleepEnd = p.SleepStart.AddHours(24).AddTicks(1) }],
            "after-next-noon" => [Period(Midnight.AddHours(23), Midnight.AddDays(1).AddHours(12).AddTicks(1))],
            "reverse" => [p with { SleepEnd = p.SleepStart }],
            "unsorted" => [Period(Midnight.AddHours(8), Midnight.AddHours(9)), p],
            "overlap" => [p, p],
            "settling-over-four-hours" => [p with { SootheStart = p.SleepStart.AddHours(-4).AddTicks(-1) }],
            "settling-reversed" => [p with { SootheEnd = p.SootheStart }],
            "settling-after-start" => [p with { SootheEnd = p.SleepStart.AddTicks(1) }],
            "one-null" => [p with { SootheEnd = null }],
            _ => throw new InvalidOperationException()
        };
        Assert.False(Accepts(Request(), periods));
    }

    [Fact]
    public void WholeDayAllowsExactDurationSettlingAndPeriodCountLimits()
    {
        var exact = Period(Midnight.AddHours(-12), Midnight.AddHours(12));
        Assert.True(Accepts(Request(), exact with { SootheStart = exact.SleepStart.AddHours(-4) }));
        Assert.True(Accepts(Request(), Period(Midnight.AddHours(23), Midnight.AddDays(1).AddHours(12))));
        var periods = Enumerable.Range(0, 24).Select(i => Period(Midnight.AddHours(i).AddMinutes(20), Midnight.AddHours(i).AddMinutes(40))).ToArray();
        Assert.True(Accepts(Request(), periods));
        Assert.False(Accepts(Request(), [.. periods, Period(Midnight.AddHours(23).AddMinutes(55), Midnight.AddDays(1))]));
    }

    [Theory]
    [InlineData("unknown-field")]
    [InlineData("duplicate")]
    [InlineData("missing-null-field")]
    [InlineData("null-period")]
    [InlineData("unknown-status")]
    [InlineData("empty-ready")]
    [InlineData("nonempty-insufficient")]
    public void WholeDayOutputKeepsStrictShapeEvenForNullableAnchors(string mutation)
    {
        var record = Sleep(Now.AddHours(-2), Now.AddHours(-1));
        var request = Request() with { Records = [record] };
        var valid = Output(Period(record.Start, record.End!.Value, true));
        var invalid = mutation switch
        {
            "unknown-field" => valid.Replace("\"status\":", "\"explanation\":\"not permitted\",\"status\":"),
            "duplicate" => valid.Replace("\"status\":", "\"status\":\"ready\",\"status\":"),
            "missing-null-field" => valid.Replace(",\"sootheEnd\":null", ""),
            "null-period" => """{"status":"ready","periods":[null]}""",
            "unknown-status" => valid.Replace("ready", "maybe"),
            "empty-ready" => """{"status":"ready","periods":[]}""",
            "nonempty-insufficient" => valid.Replace("ready", "insufficient_data"),
            _ => throw new InvalidOperationException()
        };
        var bounds = SleepAiValidation.ValidateRequest(request, Now);
        Assert.False(SleepAiValidation.TryReadOutput(invalid, request, bounds, out _));
        Assert.True(SleepAiValidation.TryReadOutput(valid, request, bounds, out var parsed));
        Assert.Equal(record.Start, Assert.Single(parsed!.Periods).SleepStart);
    }

    [Fact]
    public async Task PreviousEstimateCanConflictWithUpdatedRecordsWithoutBecomingFacts()
    {
        var record = Sleep(Now.AddHours(-3), Now.AddHours(-2));
        var stale = Period(record.Start.AddMinutes(20), record.End!.Value.AddMinutes(20));
        var request = Request() with { Records = [record], PreviousEstimate = new() { GeneratedAt = Now.AddHours(-4), Periods = [stale] } };
        var periods = new[] { Period(record.Start, record.End.Value, true), Period(Now.AddHours(1), Now.AddHours(2)) };
        var provider = new Provider(Output(periods));
        var result = await Service(new(), provider).PredictAsync(User, request, default);
        Assert.Equal(periods, result.Periods); Assert.Equal(1, provider.Calls);
        Assert.NotEqual(stale.SleepStart, result.Periods[0].SleepStart);
    }

    [Theory]
    [InlineData("prior-day")]
    [InlineData("future-generated")]
    [InlineData("empty")]
    [InlineData("null-periods")]
    [InlineData("too-many")]
    [InlineData("not-today")]
    [InlineData("unsorted")]
    [InlineData("one-null")]
    public async Task InvalidPriorEstimateIsRejectedBeforeAuthorityOrPaidCall(string mutation)
    {
        var period = Period(Now.AddHours(-2), Now.AddHours(-1));
        var prior = new SleepPredictionPreviousEstimate { GeneratedAt = Now.AddHours(-3), Periods = [period] };
        prior = mutation switch
        {
            "prior-day" => prior with { GeneratedAt = Midnight.AddTicks(-1) },
            "future-generated" => prior with { GeneratedAt = Now.AddTicks(1) },
            "empty" => prior with { Periods = [] },
            "null-periods" => prior with { Periods = null! },
            "too-many" => prior with { Periods = Enumerable.Repeat(period, 25).ToArray() },
            "not-today" => prior with { Periods = [Period(Midnight.AddDays(1), Midnight.AddDays(1).AddHours(1))] },
            "unsorted" => prior with { Periods = [period, Period(period.SleepStart.AddHours(-2), period.SleepStart.AddHours(-1))] },
            "one-null" => prior with { Periods = [period with { SootheStart = null }] },
            _ => throw new InvalidOperationException()
        };
        var access = new Access(); var provider = new Provider("{}");
        var error = await Assert.ThrowsAsync<ApiException>(() => Service(access, provider).PredictAsync(User, Request() with { PreviousEstimate = prior }, default));
        Assert.Equal(422, error.Status); Assert.Equal("invalid_input", error.Code);
        Assert.Equal(0, access.Calls); Assert.Equal(0, provider.Calls);
    }

    [Fact]
    public void V2RequiresExplicitPriorFieldAndNewConsentAndPriorJsonStaysStrict()
    {
        var json = JsonSerializer.Serialize(Request(), SleepAiJson.Options);
        var omitted = json.Replace(",\"previousEstimate\":null", "");
        Assert.NotEqual(json, omitted);
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(JsonSerializer.Deserialize<SleepPredictionRequest>(omitted, SleepAiJson.Options)!, Now));
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(Request() with { ConsentVersion = "sleep-ai-v1" }, Now));
        Assert.NotNull(SleepAiValidation.ValidateRequest(Request(), Now));
        var prior = Request() with { PreviousEstimate = new() { GeneratedAt = Now, Periods = [Period(Now.AddHours(1), Now.AddHours(2))] } };
        json = JsonSerializer.Serialize(prior, SleepAiJson.Options);
        foreach (var invalid in new[] { json.Replace("\"generatedAt\":", "\"notes\":\"private\",\"generatedAt\":"),
            json.Replace("\"sleepStart\":", "\"recordId\":\"private\",\"sleepStart\":"),
            json.Replace("\"generatedAt\":", "\"generatedAt\":null,\"generatedAt\":"), json.Replace("+11:00", "") })
            Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<SleepPredictionRequest>(invalid, SleepAiJson.Options));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task LocalDayRolloverFailsClosedBeforeReturningOrStartingPaidWork(bool beforeCall)
    {
        var now = Midnight.AddDays(1).AddTicks(-1); var request = Request() with { Now = now };
        var clock = new Clock(beforeCall ? now.AddTicks(1) : now);
        var provider = new Provider("""{"status":"insufficient_data","periods":[]}""") { BeforeReturn = () => clock.Current = now.AddTicks(1) };
        var access = new Access();
        var error = await Assert.ThrowsAsync<ApiException>(() => Service(access, provider, clock).PredictAsync(User, request, default));
        Assert.Equal(409, error.Status); Assert.Equal("prediction_day_changed", error.Code);
        Assert.Equal(beforeCall ? 0 : 1, provider.Calls); Assert.Equal(beforeCall ? 0 : 2, access.Calls);
    }

    [Fact]
    public async Task LocalDayRolloverDuringAuthorizationDoesNotStartPaidWork()
    {
        var now = Midnight.AddDays(1).AddTicks(-1); var request = Request() with { Now = now };
        var clock = new Clock(now); var access = new Access { BeforeReturn = () => clock.Current = now.AddTicks(1) };
        var provider = new Provider("""{"status":"insufficient_data","periods":[]}""");
        var error = await Assert.ThrowsAsync<ApiException>(() => Service(access, provider, clock).PredictAsync(User, request, default));
        Assert.Equal(409, error.Status); Assert.Equal("prediction_day_changed", error.Code);
        Assert.Equal(1, access.Calls); Assert.Equal(0, provider.Calls);
    }

    [Fact]
    public async Task WholeDayReauthorizationRetryBudgetCancellationAndNoFallbackArePreserved()
    {
        var access = new Access { RejectAt = 2 }; var provider = new Provider(Output(Period(Now.AddHours(1), Now.AddHours(2))));
        var denied = await Assert.ThrowsAsync<ApiException>(() => Service(access, provider).PredictAsync(User, Request(), default));
        Assert.Equal("membership_revoked", denied.Code); Assert.Equal(1, provider.Calls); Assert.Equal(2, access.Calls);
        provider = new Provider("invalid"); access = new(); var options = Enabled(); options.MaxRequestsPerAccountPerHour = 2;
        var service = Service(access, provider, options: options);
        var invalid = await Assert.ThrowsAsync<ApiException>(() => service.PredictAsync(User, Request(), default));
        Assert.Equal(503, invalid.Status); Assert.Equal("ai_invalid_response", invalid.Code); Assert.Equal(4, access.Calls);
        Assert.Equal([false, true], provider.Retries);
        var quota = await Assert.ThrowsAsync<ApiException>(() => service.PredictAsync(User, Request(), default));
        Assert.Equal(429, quota.Status); Assert.Equal("ai_hourly_limit", quota.Code); Assert.Equal(2, provider.Calls);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.PredictAsync(User, Request(), new(true)));
        Assert.Equal(2, provider.Calls);
    }

    [Fact]
    public async Task WholeDayProviderSendsOnlyMinimizedPriorContextWithNullableStrictSchemaAndNoStore()
    {
        var request = Request() with { FamilyId = Guid.NewGuid(), MembershipId = Guid.NewGuid(), HistoryId = Guid.NewGuid(),
            PreviousEstimate = new() { GeneratedAt = Now, Periods = [Period(Now.AddHours(-2), Now.AddHours(-1), true)] } };
        var fake = new ChatFake(); var provider = new OpenAiSleepProvider(fake, Options.Create(Enabled()));
        Assert.Equal("{\"status\":\"insufficient_data\",\"periods\":[]}", await provider.GenerateAsync(request, SleepAiValidation.ValidateRequest(request, Now), false, default));
        using var payload = JsonDocument.Parse(fake.Messages![1].Text);
        Assert.Equal(["ageDays", "now", "previousEstimate", "records", "sleepEndLimit", "timeZone", "todayEnd", "todayStart"], payload.RootElement.EnumerateObject().Select(p => p.Name).Order().ToArray());
        Assert.Equal(JsonSerializer.SerializeToElement(request.PreviousEstimate, SleepAiJson.Options).GetRawText(), payload.RootElement.GetProperty("previousEstimate").GetRawText());
        Assert.DoesNotContain(request.FamilyId.ToString()!, fake.Messages[1].Text); Assert.DoesNotContain(request.InputRevision, fake.Messages[1].Text);
        Assert.DoesNotContain(request.ConsentVersion, fake.Messages[1].Text);
        Assert.Contains("New records always outrank it", fake.Messages[0].Text);
        Assert.Contains("both sootheStart and sootheEnd MUST be null", fake.Messages[0].Text);
        Assert.Equal("gpt-6-luna", fake.Options!.ModelId); Assert.Equal(4096, fake.Options.MaxOutputTokens);
        Assert.Null(fake.Options.Tools); Assert.Null(fake.Options.ConversationId); Assert.False(fake.Options.AllowBackgroundResponses);
        var raw = Assert.IsType<CreateResponseOptions>(fake.Options.RawRepresentationFactory!(fake));
        Assert.False(raw.StoredOutputEnabled); Assert.False(raw.BackgroundModeEnabled);
        var schema = OpenAiSleepProvider.WholeDayOutputSchema.GetProperty("properties").GetProperty("periods");
        Assert.Equal(24, schema.GetProperty("maxItems").GetInt32());
        Assert.Equal(["string", "null"], schema.GetProperty("items").GetProperty("properties").GetProperty("sootheStart").GetProperty("type").EnumerateArray().Select(x => x.GetString()!).ToArray());
    }

    [Fact]
    public async Task ActualWholeDaySdkWireUsesNullableSchemaAndNoStoreWithoutConversationOrTools()
    {
        using var transport = new WireHandler(); using var http = new HttpClient(transport);
        using var client = new ResponsesClient(new ApiKeyCredential("synthetic-not-real"), new ResponsesClientOptions
        {
            Transport = new HttpClientPipelineTransport(http), RetryPolicy = new ClientRetryPolicy(0),
            ClientLoggingOptions = new() { EnableLogging = false, EnableMessageLogging = false, EnableMessageContentLogging = false }
        }).AsIChatClient("gpt-6-luna");
        var request = Request();
        var result = await new OpenAiSleepProvider(client, Options.Create(Enabled())).GenerateAsync(request,
            SleepAiValidation.ValidateRequest(request, Now), false, default);
        Assert.Equal("{\"status\":\"insufficient_data\",\"periods\":[]}", result);
        using var wire = JsonDocument.Parse(transport.Body!); var root = wire.RootElement;
        Assert.Equal("gpt-6-luna", root.GetProperty("model").GetString());
        Assert.False(root.GetProperty("store").GetBoolean()); Assert.False(root.GetProperty("background").GetBoolean());
        Assert.False(root.TryGetProperty("previous_response_id", out _)); Assert.False(root.TryGetProperty("conversation", out _));
        Assert.False(root.TryGetProperty("tools", out var tools) && tools.GetArrayLength() > 0);
        Assert.False(root.TryGetProperty("temperature", out _)); Assert.Equal(4096, root.GetProperty("max_output_tokens").GetInt32());
        var format = root.GetProperty("text").GetProperty("format"); Assert.True(format.GetProperty("strict").GetBoolean());
        var periods = format.GetProperty("schema").GetProperty("properties").GetProperty("periods");
        // The SDK omits collection bounds from the wire schema;
        // the explicit server validator, exercised above, enforces the 24-period cap.
        Assert.Equal("array", periods.GetProperty("type").GetString());
        Assert.False(periods.GetProperty("items").GetProperty("additionalProperties").GetBoolean());
        Assert.Equal(["sleepEnd", "sleepStart", "sootheEnd", "sootheStart"], periods.GetProperty("items").GetProperty("required").EnumerateArray().Select(x => x.GetString()!).Order().ToArray());
        Assert.Equal(["string", "null"], periods.GetProperty("items").GetProperty("properties").GetProperty("sootheEnd").GetProperty("type").EnumerateArray().Select(x => x.GetString()!).ToArray());
        Assert.Contains("previousEstimate", transport.Body!); Assert.Equal(1, transport.Calls);
    }

    [Fact]
    public async Task HttpWholeDayCapabilitiesAndV2PreserveOldFieldsAndReturnNoStore()
    {
        var scenario = new Scenario(new SqlFixture()); var access = new Access();
        var period = Period(Now.AddHours(1), Now.AddHours(2)); var provider = new Provider(Output(period));
        await using var host = new TestHost(scenario.Config);
        await using var isolated = host.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<IOptions<SleepAiOptions>>(Options.Create(Enabled()));
            services.AddSingleton<TimeProvider>(new Clock(Now));
            services.AddScoped<ISleepAiAccess>(_ => access); services.AddScoped<ISleepAiProvider>(_ => provider);
        }));
        using var client = isolated.CreateClient(); client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(scenario.Owner));
        var caps = await client.GetFromJsonAsync<SleepPredictionCapabilities>("/v2/sleep-predictions/capabilities");
        Assert.Equal("sleep-ai-v1", caps!.ConsentVersion); Assert.Equal("sleep-ai-v2", caps.WholeDayConsentVersion);
        Assert.Equal(2, caps.WholeDaySchemaVersion); Assert.Equal("OpenAI", caps.Provider); Assert.True(caps.RequiresSignIn);
        using var response = await client.PostAsJsonAsync("/v2/sleep-predictions", Request());
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(["expiresAt", "generatedAt", "inputRevision", "periods", "schemaVersion", "status"], json.RootElement.EnumerateObject().Select(x => x.Name).Order().ToArray());
        var result = json.Deserialize<SleepPredictionResponse>(SleepAiJson.Options); Assert.Equal(2, result!.SchemaVersion); Assert.Equal(period, Assert.Single(result.Periods));
        Assert.Equal(2, access.Calls); Assert.Equal(1, provider.Calls);
    }

    [Fact]
    public void SchemaOneStillRejectsNullSettlingAndOngoingDespiteSharedNullableDto()
    {
        var request = Request() with { SchemaVersion = 1, ConsentVersion = "sleep-ai-v1" };
        var period = Period(Now.AddHours(1), Now.AddHours(2)); Assert.True(Accepts(request, period));
        Assert.False(Accepts(request, period with { SootheStart = null, SootheEnd = null }));
        Assert.False(Accepts(request with { Records = [Sleep(Now.AddHours(-1), null)] }, period));
        Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(request with { PreviousEstimate = new() { GeneratedAt = Now, Periods = [period] } }, Now));
    }

    [Fact]
    public async Task SchemaOneKeepsSkippedMidnightCompatibilityWhileWholeDayFailsClosed()
    {
        var now = DateTimeOffset.Parse("2018-11-04T12:00:00-02:00");
        var request = Request() with { SchemaVersion = 1, ConsentVersion = "sleep-ai-v1", Now = now, TimeZone = "America/Sao_Paulo" };
        var bounds = SleepAiValidation.ValidateRequest(request, now);
        Assert.Equal(DateTimeOffset.Parse("2018-10-28T00:00:00-03:00"), bounds.HistoryStart);
        Assert.Equal(DateTimeOffset.Parse("2018-11-05T00:00:00-02:00"), bounds.TodayEnd);
        Assert.Equal(DateTimeOffset.Parse("2018-11-05T12:00:00-02:00"), bounds.SleepEndLimit);
        var period = Period(now.AddHours(1), now.AddHours(2));
        var response = await Service(new(), new(Output(period)), new(now)).PredictAsync(User, request, default);
        Assert.Equal(1, response.SchemaVersion); Assert.Equal("ready", response.Status);
        Assert.Equal(period, Assert.Single(response.Periods)); Assert.Equal(now.AddMinutes(15), response.ExpiresAt);
        var error = Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(
            request with { SchemaVersion = 2, ConsentVersion = "sleep-ai-v2" }, now));
        Assert.Equal(422, error.Status); Assert.Equal("invalid_input", error.Code);
    }

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    { public DateTimeOffset Current { get; set; } = now; public override DateTimeOffset GetUtcNow() => Current; }
    private sealed class Access : ISleepAiAccess
    {
        public int Calls { get; private set; }
        public int RejectAt { get; init; }
        public Action? BeforeReturn { get; init; }
        public Task AuthorizeAsync(PilotIdentity user, SleepPredictionRequest request, CancellationToken ct)
        { Calls++; if (Calls == RejectAt) throw new ApiException(403, "membership_revoked"); BeforeReturn?.Invoke(); return Task.CompletedTask; }
    }
    private sealed class Provider(string output) : ISleepAiProvider
    {
        public int Calls { get; private set; }
        public List<bool> Retries { get; } = [];
        public Action? BeforeReturn { get; init; }
        public SleepPredictionRequest? LastRequest { get; private set; }
        public Task<string?> GenerateAsync(SleepPredictionRequest request, SleepAiTimeBounds bounds, bool retry, CancellationToken ct)
        { ct.ThrowIfCancellationRequested(); Calls++; LastRequest = request; Retries.Add(retry); BeforeReturn?.Invoke(); return Task.FromResult<string?>(output); }
    }
    private sealed class ChatFake : IChatClient
    {
        public List<ChatMessage>? Messages { get; private set; }
        public ChatOptions? Options { get; private set; }
        public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
        { Messages = messages.ToList(); Options = options; return Task.FromResult(new ChatResponse(new ChatMessage(ChatRole.Assistant, "{\"status\":\"insufficient_data\",\"periods\":[]}")) { FinishReason = ChatFinishReason.Stop }); }
        public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public object? GetService(Type type, object? key = null) => null;
        public void Dispose() { }
    }
    private sealed class WireHandler : HttpMessageHandler
    {
        public int Calls { get; private set; }
        public string? Body { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++; Body = await request.Content!.ReadAsStringAsync(ct);
            return new(HttpStatusCode.OK) { Content = JsonContent.Create(new
            {
                id = "resp_synthetic", @object = "response", created_at = 1791867600, status = "completed", model = "gpt-6-luna",
                output = new[] { new { type = "message", id = "msg_synthetic", status = "completed", role = "assistant",
                    content = new[] { new { type = "output_text", text = "{\"status\":\"insufficient_data\",\"periods\":[]}", annotations = Array.Empty<object>() } } } }
            }) };
        }
    }
}
