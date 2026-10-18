using System.Text.Json;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiMinuteValidationTests
{
    private static readonly DateTimeOffset Day = DateTimeOffset.Parse("2026-10-18T00:00:00Z");
    private static readonly DateTimeOffset Now = Day.AddHours(12).AddSeconds(30);
    private static SleepPredictionRecord Sleep(DateTimeOffset start, DateTimeOffset? end) => new()
    { Kind = "sleep", Start = start, End = end, Ongoing = end is null, FeedKind = null, AmountMl = null };
    private static SleepPredictionPeriod Period(DateTimeOffset start, DateTimeOffset end) => new()
    { SleepStart = start, SleepEnd = end, SootheStart = null, SootheEnd = null };
    private static SleepPredictionRequest Request(params SleepPredictionRecord[] records) => new()
    {
        SchemaVersion = 2, InputRevision = new('c', 64), ConsentVersion = "sleep-ai-v2",
        FamilyId = null, MembershipId = null, HistoryId = null, AgeDays = 100,
        TimeZone = "UTC", Now = Now, Records = records, PreviousEstimate = null
    };
    private static bool Read(SleepPredictionRequest request, SleepPredictionPeriod[] periods,
        out SleepPredictionModelOutput? output, out SleepAiOutputFailure? failure) =>
        SleepAiValidation.TryReadOutput(JsonSerializer.Serialize(new SleepPredictionModelOutput
        { Status = "ready", Periods = periods }, SleepAiJson.Options), request,
        SleepAiValidation.ValidateRequest(request, Now), out output, out failure);

    [Fact]
    public void MinuteMatchingCannotReuseOneRecordedSleepForTwoOutputPeriods()
    {
        var record = Sleep(Day.AddHours(9).AddSeconds(5), Day.AddHours(9).AddSeconds(55));
        var request = Request(record);
        var original = JsonSerializer.Serialize(request, SleepAiJson.Options);
        var complete = Period(record.Start, record.End!.Value);
        Assert.True(Read(request, [complete], out var accepted, out var acceptedFailure));
        Assert.Null(acceptedFailure); Assert.Equal(complete, Assert.Single(accepted!.Periods));

        Assert.False(Read(request,
            [Period(record.Start, record.Start.AddSeconds(10)), Period(record.Start.AddSeconds(20), record.End.Value)],
            out _, out var failure));
        Assert.Equal("recorded_sleep_ambiguous", failure!.Reason);
        Assert.Equal(1, failure.PeriodIndex);
        Assert.Equal(new[] { "$.periods[1].sleepStart", "$.periods[1].sleepEnd" }, failure.Fields);
        Assert.Equal(original, JsonSerializer.Serialize(request, SleepAiJson.Options));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(11)]
    [InlineData(-4)]
    public void RecordedSleepMatchesSameMinuteAcrossSecondsFractionsAndOffsetsWithoutMutation(int offsetHours)
    {
        var observed = Sleep(Day.AddHours(3).AddMinutes(11).AddSeconds(6).AddMilliseconds(376),
            Day.AddHours(6).AddMinutes(40).AddSeconds(54).AddMilliseconds(636));
        var request = Request(observed);
        var original = JsonSerializer.Serialize(request, SleepAiJson.Options);
        var period = Period(Day.AddHours(3).AddMinutes(11).ToOffset(TimeSpan.FromHours(offsetHours)),
            Day.AddHours(6).AddMinutes(40).ToOffset(TimeSpan.FromHours(offsetHours)));

        Assert.True(Read(request, [period], out var result, out var failure));
        Assert.Null(failure); Assert.Equal(period, Assert.Single(result!.Periods));
        Assert.Equal(original, JsonSerializer.Serialize(request, SleepAiJson.Options));
    }

    [Theory]
    [InlineData(true, -1)]
    [InlineData(true, 1)]
    [InlineData(false, -1)]
    [InlineData(false, 1)]
    public void RecordedSleepRejectsDifferentMinuteEvenAcrossOneMillisecondBoundary(bool changeStart, int direction)
    {
        var observed = Sleep(Day.AddHours(8).AddSeconds(direction > 0 ? 59 : 0),
            Day.AddHours(9).AddSeconds(direction > 0 ? 59 : 0));
        if (direction > 0) observed = observed with
        { Start = observed.Start.AddMilliseconds(999), End = observed.End!.Value.AddMilliseconds(999) };
        var period = Period(observed.Start, observed.End!.Value);
        period = changeStart ? period with { SleepStart = period.SleepStart.AddMilliseconds(direction) }
            : period with { SleepEnd = period.SleepEnd.AddMilliseconds(direction) };
        Assert.False(Read(Request(observed), [period], out _, out var failure));
        Assert.Equal("predicted_sleep_missing_settling", failure!.Reason);
        Assert.Equal(0, failure.PeriodIndex);
        Assert.Equal(new[] { "$.periods[0].sootheStart", "$.periods[0].sootheEnd" }, failure.Fields);
    }

    [Fact]
    public void OngoingSleepMatchesStartMinuteButStillRequiresFutureWake()
    {
        var observed = Sleep(Now.AddMinutes(-30).AddMilliseconds(376), null);
        var period = Period(Day.AddHours(11).AddMinutes(30), Now.AddTicks(1));
        Assert.True(Read(Request(observed), [period], out var output, out var failure));
        Assert.Null(failure); Assert.Equal(period, Assert.Single(output!.Periods));
        Assert.False(Read(Request(observed), [period with { SleepEnd = Now }], out _, out failure));
        Assert.Equal("predicted_sleep_missing_settling", failure!.Reason);
    }

    [Fact]
    public void TouchingRecordedBoundariesAcceptMinutePrecisionWithoutFalseOverlap()
    {
        var boundary = Day.AddHours(10).AddSeconds(45).AddMilliseconds(500);
        var first = Sleep(Day.AddHours(9).AddSeconds(12), boundary);
        var next = Sleep(boundary, Day.AddHours(11).AddSeconds(30));
        var periods = new[] { Period(Day.AddHours(9), Day.AddHours(10)), Period(Day.AddHours(10), Day.AddHours(11)) };
        Assert.True(Read(Request(first, next), periods, out var output, out var failure));
        Assert.Null(failure); Assert.Equal(periods, output!.Periods);
    }

    [Fact]
    public void SameMinuteMatchingDoesNotCollapseDistinctRecordedIntervals()
    {
        var first = Sleep(Day.AddHours(9).AddSeconds(5), Day.AddHours(9).AddSeconds(15));
        var next = Sleep(Day.AddHours(9).AddSeconds(25), Day.AddHours(9).AddSeconds(35));
        Assert.False(Read(Request(first, next), [Period(Day.AddHours(9), Day.AddHours(9).AddSeconds(59))],
            out _, out var failure));
        Assert.Equal("recorded_sleep_ambiguous", failure!.Reason);
        Assert.Equal(new[] { "$.periods[0].sleepStart", "$.periods[0].sleepEnd" }, failure.Fields);
    }

    [Fact]
    public void MinuteMatchingDoesNotRelaxOutputOverlapOrZeroDuration()
    {
        var first = Sleep(Day.AddHours(9), Day.AddHours(10));
        var next = Sleep(Day.AddHours(10), Day.AddHours(11));
        Assert.False(Read(Request(first, next), [Period(first.Start, first.End!.Value),
            Period(next.Start.AddTicks(-1), next.End!.Value)], out _, out var failure));
        Assert.Equal("period_overlap", failure!.Reason);
        Assert.False(Read(Request(), [Period(Day.AddHours(9), Day.AddHours(9))], out _, out failure));
        Assert.Equal("sleep_order", failure!.Reason);
    }

    [Theory]
    [InlineData("{}", "$.status")]
    [InlineData("{\"status\":\"ready\"}", "$.periods")]
    [InlineData("{\"status\":2,\"periods\":[]}", "$.status")]
    [InlineData("{\"status\":\"ready\",\"periods\":\"wrong\"}", "$.periods")]
    [InlineData("{\"status\":\"ready\",\"periods\":[{}]}", "$.periods[0].sleepStart")]
    [InlineData("{\"status\":\"ready\",\"status\":\"ready\",\"periods\":[]}", "$.status")]
    [InlineData("{\"status\":\"ready\",\"periods\":[],\"private-unknown-key\":\"secret\"}", "$")]
    public void SchemaFailuresRecordOnlyCanonicalFields(string json, string field)
    {
        var request = Request();
        Assert.False(SleepAiValidation.TryReadOutput(json, request,
            SleepAiValidation.ValidateRequest(request, Now), out _, out var failure));
        Assert.Equal("invalid_schema", failure!.Reason);
        Assert.Equal(new[] { field }, failure.Fields);
        Assert.DoesNotContain("private-unknown-key", JsonSerializer.Serialize(failure));
        Assert.DoesNotContain("secret", JsonSerializer.Serialize(failure));
    }

    [Theory]
    [InlineData("sleepStart")]
    [InlineData("sleepEnd")]
    [InlineData("sootheStart")]
    [InlineData("sootheEnd")]
    public void InvalidTimestampIdentifiesItsExactOutputField(string field)
    {
        var json = JsonSerializer.Serialize(new { status = "ready", periods = new[] {
            new Dictionary<string, object?> { ["sleepStart"] = "2026-10-18T14:00:00Z",
                ["sleepEnd"] = "2026-10-18T15:00:00Z", ["sootheStart"] = "2026-10-18T13:40:00Z",
                ["sootheEnd"] = "2026-10-18T13:55:00Z", [field] = "2026-10-18T14:00:00" } } });
        var request = Request();
        Assert.False(SleepAiValidation.TryReadOutput(json, request,
            SleepAiValidation.ValidateRequest(request, Now), out _, out var failure));
        Assert.Equal("invalid_schema", failure!.Reason);
        Assert.Equal(new[] { $"$.periods[0].{field}" }, failure.Fields);
    }
}
