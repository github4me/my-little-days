using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace LittleDays.FamilyApi;

/// <summary>Minimized, explicitly consented sleep/feed input. Contains no names, notes or record identifiers.</summary>
public sealed record SleepPredictionRequest
{
    public required int SchemaVersion { get; init; }
    public required string InputRevision { get; init; }
    public required string ConsentVersion { get; init; }
    public required Guid? FamilyId { get; init; }
    public required Guid? MembershipId { get; init; }
    public required Guid? HistoryId { get; init; }
    public required int AgeDays { get; init; }
    public required string TimeZone { get; init; }
    public required DateTimeOffset Now { get; init; }
    public required SleepPredictionRecord[] Records { get; init; }
    private SleepPredictionPreviousEstimate? previousEstimate;
    public SleepPredictionPreviousEstimate? PreviousEstimate
    {
        get => previousEstimate;
        init { previousEstimate = value; PreviousEstimateSpecified = true; }
    }
    // Schema 2 requires an explicit null on the first request, not an omitted field.
    [JsonIgnore]
    public bool PreviousEstimateSpecified { get; private init; }
}

/// <summary>A bounded prior AI plan used only as untrusted context, never as observed sleep.</summary>
public sealed record SleepPredictionPreviousEstimate
{
    public required DateTimeOffset GeneratedAt { get; init; }
    public required SleepPredictionPeriod[] Periods { get; init; }
}

/// <summary>A sleep interval or feeding event, with only information needed for prediction.</summary>
public sealed record SleepPredictionRecord
{
    public required string Kind { get; init; }
    public required DateTimeOffset Start { get; init; }
    public required DateTimeOffset? End { get; init; }
    public required bool Ongoing { get; init; }
    public required string? FeedKind { get; init; }
    public required decimal? AmountMl { get; init; }
}

/// <summary>An AI-generated whole sleep period and the range in which to begin settling.</summary>
public sealed record SleepPredictionPeriod
{
    public required DateTimeOffset SleepStart { get; init; }
    public required DateTimeOffset SleepEnd { get; init; }
    public required DateTimeOffset? SootheStart { get; init; }
    public required DateTimeOffset? SootheEnd { get; init; }
}

/// <summary>Validated AI output tied to the exact client input revision, never a local estimate.</summary>
public sealed record SleepPredictionResponse(int SchemaVersion, string InputRevision, string Status,
    DateTimeOffset GeneratedAt, DateTimeOffset ExpiresAt, SleepPredictionPeriod[] Periods);

/// <summary>Availability of the optional explicitly consented cloud AI service.</summary>
public sealed record SleepPredictionCapabilities(bool Enabled, string ConsentVersion, string Provider, bool RequiresSignIn,
    int WholeDaySchemaVersion = 2, string WholeDayConsentVersion = "sleep-ai-v2");

/// <summary>Strict provider-only schema. Operational status unavailable is owned by the service, not the model.</summary>
public sealed record SleepPredictionModelOutput
{
    public required string Status { get; init; }
    public required SleepPredictionPeriod[] Periods { get; init; }
}

public static class SleepAiJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        AllowDuplicateProperties = false,
        NumberHandling = JsonNumberHandling.Strict,
        MaxDepth = 8,
        Converters = { new OffsetTimestampConverter() }
    };

    // Require an explicit offset; do not silently interpret unqualified wall times
    // in the API host's timezone, especially across daylight-saving transitions.
    private sealed class OffsetTimestampConverter : JsonConverter<DateTimeOffset>
    {
        public override DateTimeOffset Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options)
        {
            var value = reader.TokenType == JsonTokenType.String ? reader.GetString() : null;
            if (value is null || value.Length > 40 ||
                !Regex.IsMatch(value, @"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$", RegexOptions.CultureInvariant) ||
                !DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var result))
                throw new JsonException("An explicit timestamp offset is required.");
            return result;
        }

        public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) => writer.WriteStringValue(value);
    }
}

public sealed record SleepAiTimeBounds(DateTimeOffset HistoryStart, DateTimeOffset TodayStart,
    DateTimeOffset TodayEnd, DateTimeOffset SleepEndLimit);

/// <summary>Fixed validation category and optional output-period position, never input values or JSON exception details.</summary>
public sealed record SleepAiOutputFailure(string Reason, int? PeriodIndex = null)
{
    public static bool IsKnownReason(string reason) => reason is
        "invalid_output" or "response_missing" or "response_too_large" or "invalid_json" or "invalid_schema" or
        "output_missing" or "periods_missing" or "invalid_status" or "too_many_periods" or
        "insufficient_data_with_periods" or "empty_periods" or "ongoing_sleep_unsupported" or
        "period_missing" or "sleep_order" or "sleep_bounds" or "sleep_duration" or "period_overlap" or
        "settling_missing" or "settling_incomplete" or "settling_before_now" or "settling_order" or
        "settling_after_sleep" or "settling_too_early" or "settling_overlap" or
        "recorded_sleep_overlap" or "recorded_sleep_has_settling" or "predicted_sleep_missing_settling" or
        "recorded_sleep_missing";
}

public static class SleepAiValidation
{
    public const string ConsentVersion = "sleep-ai-v1";
    public const string WholeDayConsentVersion = "sleep-ai-v2";
    public const int MaxRecords = 512;
    public const int MaxPeriods = 12;
    public const int MaxWholeDayPeriods = 24;

    public static SleepAiTimeBounds ValidateRequest(SleepPredictionRequest request, DateTimeOffset serverNow)
    {
        if (request.SchemaVersion is not (1 or 2) ||
            request.ConsentVersion != (request.SchemaVersion == 2 ? WholeDayConsentVersion : ConsentVersion) ||
            request.SchemaVersion == 1 && request.PreviousEstimate is not null ||
            request.SchemaVersion == 2 && !request.PreviousEstimateSpecified ||
            request.InputRevision is null || !Regex.IsMatch(request.InputRevision, "^[a-fA-F0-9]{64}$", RegexOptions.CultureInvariant) ||
            request.AgeDays is < 0 or > 2191 || request.Records is null || request.Records.Length > MaxRecords ||
            request.TimeZone is null || request.TimeZone.Length > 100 ||
            Math.Abs((request.Now - serverNow).TotalMinutes) > 5) Invalid();
        var context = new[] { request.FamilyId, request.MembershipId, request.HistoryId };
        if (context.Any(x => x == Guid.Empty) || context.Any(x => x is null) && context.Any(x => x is not null)) Invalid();
        TimeZoneInfo zone;
        try
        {
            // IANA IDs (including UTC) only; no server-local or Windows alias inference.
            if (request.TimeZone != "UTC" && !request.TimeZone.Contains('/')) Invalid();
            zone = TimeZoneInfo.FindSystemTimeZoneById(request.TimeZone);
        }
        catch (TimeZoneNotFoundException) { throw new ApiException(422, "invalid_input"); }
        catch (InvalidTimeZoneException) { throw new ApiException(422, "invalid_input"); }
        var date = TimeZoneInfo.ConvertTime(request.Now, zone).Date;
        // Schema 1 never resolves today's midnight; preserve its behavior in
        // zones that skip/duplicate that boundary. Only whole-day plans use it.
        var bounds = new SleepAiTimeBounds(LocalInstant(date.AddDays(-7), zone),
            request.SchemaVersion == 2 ? LocalInstant(date, zone) : default,
            LocalInstant(date.AddDays(1), zone), LocalInstant(date.AddDays(1).AddHours(12), zone));
        if (request.SchemaVersion == 2 && request.PreviousEstimate is { } prior &&
            (prior.GeneratedAt < bounds.TodayStart || prior.GeneratedAt > request.Now ||
             !ValidWholeDayPeriods(prior.Periods, bounds))) Invalid();
        foreach (var record in request.Records)
        {
            if (record is null || record.Kind is not ("sleep" or "feed") || record.Start > request.Now ||
                record.End > request.Now || record.End < record.Start || record.Ongoing && record.End is not null) Invalid();
            if (record.Kind == "sleep")
            {
                if (record.FeedKind is not null || record.AmountMl is not null || record.End == record.Start || record.Ongoing != (record.End is null) ||
                    record.Start < bounds.HistoryStart.AddHours(-24) || record.End <= bounds.HistoryStart ||
                    (record.End ?? request.Now) - record.Start > TimeSpan.FromHours(24)) Invalid();
            }
            else if (record.Start < bounds.HistoryStart || record.FeedKind is not ("formula" or "expressed" or "breast") ||
                     record.AmountMl is < 0 or > 2000 || record.FeedKind == "breast" && record.AmountMl is not null ||
                     record.FeedKind is "formula" or "expressed" && record.AmountMl is null ||
                     (record.End ?? (record.Ongoing ? request.Now : record.Start)) - record.Start > TimeSpan.FromHours(24)) Invalid();
        }
        // Legacy clients retain their strict contract. Whole-day requests pass
        // overlapping manual records unchanged so only the model interprets them.
        if (request.SchemaVersion == 1)
        {
            var sleep = request.Records.Where(x => x.Kind == "sleep").OrderBy(x => x.Start).ToArray();
            for (var i = 1; i < sleep.Length; i++)
                if (sleep[i].Start < (sleep[i - 1].End ?? request.Now)) Invalid();
        }
        return bounds;
    }

    public static bool TryReadOutput(string? json, SleepPredictionRequest request, SleepAiTimeBounds bounds, out SleepPredictionModelOutput? output)
        => TryReadOutput(json, request, bounds, out output, out _);

    public static bool TryReadOutput(string? json, SleepPredictionRequest request, SleepAiTimeBounds bounds,
        out SleepPredictionModelOutput? output, out SleepAiOutputFailure? failure)
    {
        output = null;
        failure = null;
        if (json is null) return Reject(out failure, "response_missing");
        if (json.Length > 16 * 1024) return Reject(out failure, "response_too_large");
        try { output = JsonSerializer.Deserialize<SleepPredictionModelOutput>(json, SleepAiJson.Options); }
        catch (JsonException)
        {
            // Inspect syntax only after the original strict deserializer rejects it.
            // Never retain exception messages, paths or input-derived values.
            try { using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = SleepAiJson.Options.MaxDepth }); }
            catch (JsonException) { return Reject(out failure, "invalid_json"); }
            return Reject(out failure, "invalid_schema");
        }
        if (output is null) return Reject(out failure, "output_missing");
        if (output.Periods is null) return Reject(out failure, "periods_missing");
        if (output.Status is not ("ready" or "insufficient_data")) return Reject(out failure, "invalid_status");
        if (output.Periods.Length > (request.SchemaVersion == 2 ? MaxWholeDayPeriods : MaxPeriods))
            return Reject(out failure, "too_many_periods");
        if (output.Status == "insufficient_data")
            return output.Periods.Length == 0 || Reject(out failure, "insufficient_data_with_periods");
        if (request.SchemaVersion == 2) return ValidWholeDayOutput(output.Periods, request, bounds, out failure);
        if (output.Periods.Length == 0) return Reject(out failure, "empty_periods");
        if (request.Records.Any(x => x.Kind == "sleep" && x.Ongoing)) return Reject(out failure, "ongoing_sleep_unsupported");
        DateTimeOffset? previousEnd = null;
        for (var index = 0; index < output.Periods.Length; index++)
        {
            var period = output.Periods[index];
            if (period is null) return Reject(out failure, "period_missing");
            if (period.SootheStart is null || period.SootheEnd is null) return Reject(out failure, "settling_missing", index);
            if (period.SootheStart < request.Now) return Reject(out failure, "settling_before_now", index);
            if (period.SootheEnd <= period.SootheStart) return Reject(out failure, "settling_order", index);
            if (period.SootheEnd > period.SleepStart) return Reject(out failure, "settling_after_sleep", index);
            if (period.SleepStart >= period.SleepEnd) return Reject(out failure, "sleep_order", index);
            if (period.SleepStart >= bounds.TodayEnd || period.SleepEnd > bounds.SleepEndLimit)
                return Reject(out failure, "sleep_bounds", index);
            if (period.SootheStart < previousEnd) return Reject(out failure, "settling_overlap", index);
            if (request.Records.Where(x => x.Kind == "sleep").Any(x =>
                period.SootheStart < (x.End ?? request.Now) && period.SleepEnd > x.Start))
                return Reject(out failure, "recorded_sleep_overlap", index);
            previousEnd = period.SleepEnd;
        }
        return true;
    }

    private static bool ValidWholeDayPeriods(SleepPredictionPeriod[]? periods, SleepAiTimeBounds bounds)
        => ValidWholeDayPeriods(periods, bounds, out _);

    private static bool ValidWholeDayPeriods(SleepPredictionPeriod[]? periods, SleepAiTimeBounds bounds,
        out SleepAiOutputFailure? failure)
    {
        failure = null;
        if (periods is null) return Reject(out failure, "periods_missing");
        if (periods.Length == 0) return Reject(out failure, "empty_periods");
        if (periods.Length > MaxWholeDayPeriods) return Reject(out failure, "too_many_periods");
        DateTimeOffset? previousEnd = null;
        for (var index = 0; index < periods.Length; index++)
        {
            var period = periods[index];
            if (period is null) return Reject(out failure, "period_missing");
            if (period.SleepStart < bounds.TodayStart.AddHours(-24) || period.SleepStart >= bounds.TodayEnd ||
                period.SleepEnd <= bounds.TodayStart) return Reject(out failure, "sleep_bounds", index);
            if (period.SleepStart >= period.SleepEnd) return Reject(out failure, "sleep_order", index);
            if (period.SleepEnd > bounds.SleepEndLimit) return Reject(out failure, "sleep_bounds", index);
            if (period.SleepEnd - period.SleepStart > TimeSpan.FromHours(24)) return Reject(out failure, "sleep_duration", index);
            if (period.SleepStart < previousEnd) return Reject(out failure, "period_overlap", index);
            if ((period.SootheStart is null) != (period.SootheEnd is null)) return Reject(out failure, "settling_incomplete", index);
            if (period.SootheStart is { } soothe)
            {
                if (soothe >= period.SootheEnd) return Reject(out failure, "settling_order", index);
                if (period.SootheEnd > period.SleepStart) return Reject(out failure, "settling_after_sleep", index);
                if (soothe < period.SleepStart.AddHours(-4)) return Reject(out failure, "settling_too_early", index);
                if (soothe < previousEnd) return Reject(out failure, "settling_overlap", index);
            }
            previousEnd = period.SleepEnd;
        }
        return true;
    }

    private static bool ValidWholeDayOutput(SleepPredictionPeriod[] periods, SleepPredictionRequest request, SleepAiTimeBounds bounds,
        out SleepAiOutputFailure? failure)
    {
        if (!ValidWholeDayPeriods(periods, bounds, out failure)) return false;
        var sleep = request.Records.Where(record => record.Kind == "sleep").ToArray();
        // Classify evidence only: never merge, trim, deduplicate or choose a
        // recorded boundary locally. Index identity keeps duplicate occurrences.
        var uncertain = sleep.Select((record, index) => sleep.Where((_, other) => other != index).Any(other =>
            record.Start < (other.End ?? request.Now) && other.Start < (record.End ?? request.Now))).ToArray();
        var isolated = sleep.Where((_, index) => !uncertain[index]).ToArray();
        var conflicting = sleep.Where((_, index) => uncertain[index]).ToArray();
        for (var index = 0; index < periods.Length; index++)
        {
            var period = periods[index];
            var anchor = isolated.FirstOrDefault(record => record.Start == period.SleepStart &&
                (record.Ongoing ? period.SleepEnd > request.Now : record.End == period.SleepEnd));
            // A model's reconciliation is an estimate, not a new recorded fact.
            // It may omit unusable conflict evidence; only already-started,
            // intersecting evidence permits no retrospective settling advice.
            var conflictAnchor = anchor is null && period.SleepStart <= request.Now && conflicting.Any(record =>
                period.SleepStart < (record.End ?? request.Now) && period.SleepEnd > record.Start);
            if (anchor is not null || conflictAnchor)
            {
                if (period.SootheStart is not null) return Reject(out failure, "recorded_sleep_has_settling", index);
            }
            else if (period.SootheStart is null) return Reject(out failure, "predicted_sleep_missing_settling", index);
            var start = period.SootheStart ?? period.SleepStart;
            if (isolated.Any(record => !ReferenceEquals(record, anchor) &&
                start < (record.End ?? request.Now) && period.SleepEnd > record.Start))
                return Reject(out failure, "recorded_sleep_overlap", index);
        }
        // Unambiguous observed sleep stays exact. Conflicting inputs are left
        // for the model to judge, never required as contradictory exact anchors.
        return isolated.Where(record => record.End is null || record.End > bounds.TodayStart)
            .All(record => periods.Any(period => period.SleepStart == record.Start &&
                (record.Ongoing ? period.SleepEnd > request.Now : period.SleepEnd == record.End))) ||
            Reject(out failure, "recorded_sleep_missing");
    }

    private static bool Reject(out SleepAiOutputFailure? failure, string reason, int? periodIndex = null)
    {
        failure = new(reason, periodIndex);
        return false;
    }

    private static DateTimeOffset LocalInstant(DateTime value, TimeZoneInfo zone)
    {
        // Rare skipped/ambiguous local midnights cannot be safely guessed.
        if (zone.IsInvalidTime(value) || zone.IsAmbiguousTime(value)) Invalid();
        return new DateTimeOffset(value, zone.GetUtcOffset(value));
    }
    [System.Diagnostics.CodeAnalysis.DoesNotReturn]
    private static void Invalid() => throw new ApiException(422, "invalid_input");
}
