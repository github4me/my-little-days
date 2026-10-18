using System.Text.Json;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiOutputFailureTests
{
    private static readonly DateTimeOffset Midnight = DateTimeOffset.Parse("2026-10-18T00:00:00Z");
    private static readonly DateTimeOffset Now = Midnight.AddHours(12);
    private static SleepPredictionRequest Request(int schema = 2) => new()
    {
        SchemaVersion = schema, InputRevision = new('a', 64),
        ConsentVersion = schema == 2 ? "sleep-ai-v2" : "sleep-ai-v1",
        FamilyId = null, MembershipId = null, HistoryId = null,
        AgeDays = 100, TimeZone = "UTC", Now = Now, Records = [], PreviousEstimate = null
    };
    private static SleepPredictionPeriod Period(DateTimeOffset? start = null, DateTimeOffset? end = null) => new()
    {
        SleepStart = start ?? Now.AddHours(2), SleepEnd = end ?? Now.AddHours(3),
        SootheStart = (start ?? Now.AddHours(2)).AddMinutes(-20),
        SootheEnd = (start ?? Now.AddHours(2)).AddMinutes(-5)
    };
    private static SleepPredictionRecord Sleep(DateTimeOffset start, DateTimeOffset? end) => new()
    { Kind = "sleep", Start = start, End = end, Ongoing = end is null, FeedKind = null, AmountMl = null };
    private static string Output(params SleepPredictionPeriod[] periods) => JsonSerializer.Serialize(
        new SleepPredictionModelOutput { Status = "ready", Periods = periods }, SleepAiJson.Options);

    [Theory]
    [InlineData("invalid_output", "$")]
    [InlineData("response_missing", "$")]
    [InlineData("response_too_large", "$")]
    [InlineData("invalid_json", "$")]
    [InlineData("invalid_schema", "$")]
    [InlineData("output_missing", "$")]
    [InlineData("periods_missing", "$.periods")]
    [InlineData("invalid_status", "$.status")]
    [InlineData("too_many_periods", "$.periods")]
    [InlineData("insufficient_data_with_periods", "$.status|$.periods")]
    [InlineData("empty_periods", "$.periods")]
    [InlineData("ongoing_sleep_unsupported", "$.periods")]
    [InlineData("period_missing", "$.periods[3]")]
    [InlineData("sleep_order", "$.periods[3].sleepStart|$.periods[3].sleepEnd")]
    [InlineData("sleep_bounds", "$.periods[3].sleepStart|$.periods[3].sleepEnd")]
    [InlineData("sleep_duration", "$.periods[3].sleepStart|$.periods[3].sleepEnd")]
    [InlineData("period_overlap", "$.periods[3].sleepStart|$.periods[3].sleepEnd")]
    [InlineData("settling_missing", "$.periods[3].sootheStart|$.periods[3].sootheEnd")]
    [InlineData("settling_incomplete", "$.periods[3].sootheStart|$.periods[3].sootheEnd")]
    [InlineData("settling_before_now", "$.periods[3].sootheStart")]
    [InlineData("settling_order", "$.periods[3].sootheStart|$.periods[3].sootheEnd")]
    [InlineData("settling_after_sleep", "$.periods[3].sootheEnd|$.periods[3].sleepStart")]
    [InlineData("settling_too_early", "$.periods[3].sootheStart|$.periods[3].sleepStart")]
    [InlineData("settling_overlap", "$.periods[3].sootheStart")]
    [InlineData("recorded_sleep_overlap", "$.periods[3].sootheStart|$.periods[3].sleepStart|$.periods[3].sleepEnd")]
    [InlineData("recorded_sleep_has_settling", "$.periods[3].sootheStart|$.periods[3].sootheEnd")]
    [InlineData("predicted_sleep_missing_settling", "$.periods[3].sootheStart|$.periods[3].sootheEnd")]
    [InlineData("recorded_sleep_missing", "$.periods")]
    [InlineData("recorded_sleep_ambiguous", "$.periods[3].sleepStart|$.periods[3].sleepEnd")]
    public void EveryValidationReasonHasItsExpectedCanonicalFields(string reason, string fields)
    {
        Assert.True(SleepAiOutputFailure.IsKnownReason(reason));
        Assert.Equal(fields.Split('|'), new SleepAiOutputFailure(reason, 3).Fields);
    }

    [Theory]
    [InlineData("ai_timeout")]
    [InlineData("ai_provider_busy")]
    [InlineData("ai_provider_unavailable")]
    [InlineData("incomplete_response")]
    [InlineData("non_text_response")]
    [InlineData("continuation_response")]
    public void ProviderFailuresIdentifyProviderRatherThanOutputFields(string reason)
    {
        Assert.Equal(new[] { "$provider" }, SleepAiOutputFailure.FieldsFor(reason, null));
    }

    private static void Rejects(string? json, SleepPredictionRequest request, string reason, int? index = null)
    {
        var bounds = SleepAiValidation.ValidateRequest(request, request.Now);
        var originalRequest = JsonSerializer.Serialize(request, SleepAiJson.Options);
        Assert.False(SleepAiValidation.TryReadOutput(json, request, bounds, out var output, out var failure));
        Assert.Equal(reason, failure!.Reason);
        Assert.Equal(index, failure.PeriodIndex);
        Assert.NotEmpty(failure.Fields);
        Assert.True(SleepAiOutputFailure.IsKnownReason(failure!.Reason));
        Assert.InRange(failure.Reason.Length, 1, 64);
        Assert.False(SleepAiValidation.TryReadOutput(json, request, bounds, out var legacyOutput));
        Assert.Equal(JsonSerializer.Serialize(output, SleepAiJson.Options), JsonSerializer.Serialize(legacyOutput, SleepAiJson.Options));
        Assert.Equal(originalRequest, JsonSerializer.Serialize(request, SleepAiJson.Options));
    }

    public static IEnumerable<object?[]> EnvelopeFailures()
    {
        foreach (var schema in new[] { 1, 2 })
        {
            yield return [schema, null, "response_missing"];
            yield return [schema, new string(' ', 16 * 1024 + 1), "response_too_large"];
            yield return [schema, "", "invalid_json"];
            yield return [schema, "{\"private-record-value\":", "invalid_json"];
            yield return [schema, "{\"status\":\"ready\",}", "invalid_json"];
            yield return [schema, "{}", "invalid_schema"];
            yield return [schema, "[]", "invalid_schema"];
            yield return [schema, "{\"status\":\"ready\",\"periods\":[],\"private-field\":\"private-record-value\"}", "invalid_schema"];
            yield return [schema, "{\"status\":\"ready\",\"status\":\"ready\",\"periods\":[]}", "invalid_schema"];
            yield return [schema, "{\"status\":\"ready\",\"periods\":\"private-record-value\"}", "invalid_schema"];
            yield return [schema, "null", "output_missing"];
            yield return [schema, "{\"status\":\"ready\",\"periods\":null}", "periods_missing"];
            yield return [schema, "{\"status\":\"private-record-value\",\"periods\":[]}", "invalid_status"];
            yield return [schema, "{\"status\":null,\"periods\":[]}", "invalid_status"];
            yield return [schema, "{\"status\":\"ready\",\"periods\":[]}", "empty_periods"];
            yield return [schema, "{\"status\":\"ready\",\"periods\":[null]}", "period_missing"];
            yield return [schema, Output(Period()).Replace("2026-10-18T14:00:00+00:00", "2026-10-18T14:00:00"), "invalid_schema"];
        }
    }

    [Theory]
    [MemberData(nameof(EnvelopeFailures))]
    public void EnvelopeFailuresReturnOnlyFixedReasonsWithoutInputOrJsonPaths(int schema, string? json, string reason)
    {
        Rejects(json, Request(schema), reason, reason == "period_missing" ? 0 : null);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public void StatusCountAndResponseSizeBoundariesPreserveTheOriginalContract(int schema)
    {
        var request = Request(schema);
        var bounds = SleepAiValidation.ValidateRequest(request, Now);
        var limit = schema == 2 ? SleepAiValidation.MaxWholeDayPeriods : SleepAiValidation.MaxPeriods;
        Rejects(Output(Enumerable.Repeat(Period(), limit + 1).ToArray()), request, "too_many_periods");
        Rejects(Output(Period()).Replace("\"ready\"", "\"insufficient_data\""), request, "insufficient_data_with_periods");
        const string insufficient = "{\"status\":\"insufficient_data\",\"periods\":[]}";
        foreach (var json in new[] { insufficient, insufficient.PadRight(16 * 1024) })
        {
            Assert.True(SleepAiValidation.TryReadOutput(json, request, bounds, out var output, out var failure));
            Assert.Null(failure); Assert.Equal("insufficient_data", output!.Status); Assert.Empty(output.Periods);
            Assert.True(SleepAiValidation.TryReadOutput(json, request, bounds, out _));
        }
        var periods = Enumerable.Range(0, limit).Select(index =>
        {
            var start = (schema == 2 ? Midnight : Now).AddHours(index).AddMinutes(30);
            return Period(start, start.AddMinutes(10));
        }).ToArray();
        Assert.True(SleepAiValidation.TryReadOutput(Output(periods), request, bounds, out var accepted, out var acceptedFailure));
        Assert.Null(acceptedFailure); Assert.Equal(periods, accepted!.Periods);
    }

    [Theory]
    [InlineData("missing-start", "settling_missing")]
    [InlineData("missing-end", "settling_missing")]
    [InlineData("before-now", "settling_before_now")]
    [InlineData("settling-equal", "settling_order")]
    [InlineData("settling-reversed", "settling_order")]
    [InlineData("settling-after-sleep", "settling_after_sleep")]
    [InlineData("sleep-equal", "sleep_order")]
    [InlineData("sleep-reversed", "sleep_order")]
    [InlineData("start-midnight", "sleep_bounds")]
    [InlineData("end-limit", "sleep_bounds")]
    public void LegacyPeriodFailuresIdentifyTheOutputPeriod(string shape, string reason)
    {
        var period = Period();
        period = shape switch
        {
            "missing-start" => period with { SootheStart = null },
            "missing-end" => period with { SootheEnd = null },
            "before-now" => period with { SootheStart = Now.AddTicks(-1) },
            "settling-equal" => period with { SootheEnd = period.SootheStart },
            "settling-reversed" => period with { SootheEnd = period.SootheStart!.Value.AddTicks(-1) },
            "settling-after-sleep" => period with { SootheEnd = period.SleepStart.AddTicks(1) },
            "sleep-equal" => period with { SleepEnd = period.SleepStart },
            "sleep-reversed" => period with { SleepEnd = period.SleepStart.AddTicks(-1) },
            "start-midnight" => Period(Midnight.AddDays(1), Midnight.AddDays(1).AddHours(1)),
            "end-limit" => period with { SleepEnd = Midnight.AddDays(1).AddHours(12).AddTicks(1) },
            _ => throw new InvalidOperationException()
        };
        Rejects(Output(period), Request(1), reason, 0);
    }

    [Fact]
    public void LegacyOngoingInputHasNoInputIndexAndSettlingCollisionUsesTheSecondOutputIndex()
    {
        Rejects(Output(Period()), Request(1) with { Records = [Sleep(Now.AddHours(-1), null)] }, "ongoing_sleep_unsupported");
        var first = Period();
        var second = Period(first.SleepEnd.AddMinutes(30), first.SleepEnd.AddHours(1)) with
        { SootheStart = first.SleepEnd.AddTicks(-1) };
        Rejects(Output(first, second), Request(1), "settling_overlap", 1);
    }

    [Theory]
    [InlineData("start-before-bound", "sleep_bounds")]
    [InlineData("start-midnight", "sleep_bounds")]
    [InlineData("end-at-today-start", "sleep_bounds")]
    [InlineData("end-after-limit", "sleep_bounds")]
    [InlineData("sleep-equal", "sleep_order")]
    [InlineData("sleep-reversed", "sleep_order")]
    [InlineData("overlong", "sleep_duration")]
    [InlineData("missing-start", "settling_incomplete")]
    [InlineData("missing-end", "settling_incomplete")]
    [InlineData("settling-equal", "settling_order")]
    [InlineData("settling-reversed", "settling_order")]
    [InlineData("settling-after-sleep", "settling_after_sleep")]
    [InlineData("settling-too-early", "settling_too_early")]
    [InlineData("missing-predicted-settling", "predicted_sleep_missing_settling")]
    public void WholeDayPeriodFailuresIdentifyTheOutputPeriod(string shape, string reason)
    {
        var period = Period();
        period = shape switch
        {
            "start-before-bound" => Period(Midnight.AddHours(-24).AddTicks(-1), Midnight.AddHours(1)),
            "start-midnight" => Period(Midnight.AddDays(1), Midnight.AddDays(1).AddHours(1)),
            "end-at-today-start" => Period(Midnight.AddHours(-2), Midnight),
            "end-after-limit" => period with { SleepEnd = Midnight.AddDays(1).AddHours(12).AddTicks(1) },
            "sleep-equal" => period with { SleepEnd = period.SleepStart },
            "sleep-reversed" => period with { SleepEnd = period.SleepStart.AddTicks(-1) },
            "overlong" => Period(Midnight.AddHours(-1), Midnight.AddHours(23).AddTicks(1)),
            "missing-start" => period with { SootheStart = null },
            "missing-end" => period with { SootheEnd = null },
            "settling-equal" => period with { SootheEnd = period.SootheStart },
            "settling-reversed" => period with { SootheEnd = period.SootheStart!.Value.AddTicks(-1) },
            "settling-after-sleep" => period with { SootheEnd = period.SleepStart.AddTicks(1) },
            "settling-too-early" => period with { SootheStart = period.SleepStart.AddHours(-4).AddTicks(-1) },
            "missing-predicted-settling" => period with { SootheStart = null, SootheEnd = null },
            _ => throw new InvalidOperationException()
        };
        Rejects(Output(period), Request(), reason, 0);
    }

    [Theory]
    [InlineData(false, "period_overlap")]
    [InlineData(true, "settling_overlap")]
    public void WholeDayDistinguishesSleepOverlapFromSettlingOverlap(bool settling, string reason)
    {
        var first = Period();
        var second = settling
            ? Period(first.SleepEnd.AddMinutes(30), first.SleepEnd.AddHours(1)) with { SootheStart = first.SleepEnd.AddTicks(-1) }
            : Period(first.SleepEnd.AddTicks(-1), first.SleepEnd.AddHours(1));
        Rejects(Output(first, second), Request(), reason, 1);
    }

    [Theory]
    [InlineData("missing", "recorded_sleep_missing", null)]
    [InlineData("settling", "recorded_sleep_has_settling", 0)]
    [InlineData("overlap", "recorded_sleep_overlap", 0)]
    [InlineData("ongoing-missing", "recorded_sleep_missing", null)]
    public void WholeDayAnchorFailuresNeverExposeAnInputRecordIndex(string shape, string reason, int? index)
    {
        var record = Sleep(Midnight, Midnight.AddHours(6));
        var request = Request() with { Records = [record] };
        var periods = new[] { Period() };
        switch (shape)
        {
            case "settling": periods = [Period(record.Start, record.End)]; break;
            case "overlap": periods = [Period(Midnight.AddHours(5), Midnight.AddHours(7))]; break;
            case "ongoing-missing": request = request with { Records = [Sleep(Now.AddHours(-1), null)] }; break;
        }
        Rejects(Output(periods), request, reason, index);
    }

    [Fact]
    public void WholeDayConflictAnchorsStillRequireNoRetrospectiveSettlingAndLeaveRawRecordsUnchanged()
    {
        var request = Request() with { Records = [Sleep(Midnight.AddHours(8), Midnight.AddHours(10)),
            Sleep(Midnight.AddHours(9), Midnight.AddHours(11))] };
        var inferred = Period(Midnight.AddHours(8.5), Midnight.AddHours(10.5));
        Rejects(Output(inferred), request, "recorded_sleep_has_settling", 0);
        inferred = inferred with { SootheStart = null, SootheEnd = null };
        var original = JsonSerializer.Serialize(request, SleepAiJson.Options);
        Assert.True(SleepAiValidation.TryReadOutput(Output(inferred), request,
            SleepAiValidation.ValidateRequest(request, Now), out var output, out var failure));
        Assert.Null(failure); Assert.Equal(inferred, Assert.Single(output!.Periods));
        Assert.Equal(original, JsonSerializer.Serialize(request, SleepAiJson.Options));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public void SuccessfulBoundaryOutputsHaveNoFailureAndPreserveExactPeriods(int schema)
    {
        var request = Request(schema);
        var bounds = SleepAiValidation.ValidateRequest(request, Now);
        var first = Period(Now.AddHours(2), Now.AddHours(3)) with { SootheStart = Now, SootheEnd = Now.AddHours(2) };
        var second = Period(bounds.TodayEnd.AddTicks(-1), bounds.SleepEndLimit) with
        { SootheStart = bounds.TodayEnd.AddHours(-4).AddTicks(-1) };
        var expected = new[] { first, second };
        var json = Output(expected);
        Assert.True(SleepAiValidation.TryReadOutput(json, request, bounds, out var output, out var failure));
        Assert.Null(failure); Assert.Equal("ready", output!.Status); Assert.Equal(expected, output.Periods);
        Assert.True(SleepAiValidation.TryReadOutput(json, request, bounds, out var legacyOutput));
        Assert.Equal(expected, legacyOutput!.Periods);
    }

    [Fact]
    public void WholeDayCompletedOngoingAndTwentyFourHourAnchorsRemainAccepted()
    {
        var record = Sleep(Midnight.AddHours(-23), Midnight.AddHours(1));
        var ongoing = Sleep(Now.AddHours(-1), null);
        var request = Request() with { Records = [record, ongoing] };
        var expected = new[]
        {
            Period(record.Start, record.End) with { SootheStart = null, SootheEnd = null },
            Period(ongoing.Start, Now.AddTicks(1)) with { SootheStart = null, SootheEnd = null },
            Period()
        };
        Assert.True(SleepAiValidation.TryReadOutput(Output(expected), request,
            SleepAiValidation.ValidateRequest(request, Now), out var output, out var failure));
        Assert.Null(failure); Assert.Equal(expected, output!.Periods);
    }

    [Fact]
    public void PreviousEstimateValidationStillRejectsInvalidPeriodsWithoutChangingTheRequestContract()
    {
        var prior = new SleepPredictionPreviousEstimate { GeneratedAt = Now.AddMinutes(-1), Periods = [Period()] };
        var request = Request() with { PreviousEstimate = prior };
        Assert.NotNull(SleepAiValidation.ValidateRequest(request, Now));
        var invalid = request with { PreviousEstimate = prior with { Periods = [Period() with { SootheEnd = null }] } };
        var error = Assert.Throws<ApiException>(() => SleepAiValidation.ValidateRequest(invalid, Now));
        Assert.Equal("invalid_input", error.Code);
    }

    [Theory]
    [InlineData("invalid_output", true)]
    [InlineData("recorded_sleep_missing", true)]
    [InlineData("private-record-value", false)]
    [InlineData("$.periods[2].sleepStart", false)]
    [InlineData("invalid_json\nprivate-record-value", false)]
    [InlineData("INVALID_JSON", false)]
    [InlineData("", false)]
    public void FailureReasonAllowlistRejectsUntrustedOrUnexpectedText(string reason, bool known)
    {
        Assert.Equal(known, SleepAiOutputFailure.IsKnownReason(reason));
    }
}
