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
        // Do not infer missing intervals or resolve conflicting sleep records.
        var sleep = request.Records.Where(x => x.Kind == "sleep").OrderBy(x => x.Start).ToArray();
        for (var i = 1; i < sleep.Length; i++)
            if (sleep[i].Start < (sleep[i - 1].End ?? request.Now)) Invalid();
        return bounds;
    }

    public static bool TryReadOutput(string? json, SleepPredictionRequest request, SleepAiTimeBounds bounds, out SleepPredictionModelOutput? output)
    {
        output = null;
        if (json is null || json.Length > 16 * 1024) return false;
        try { output = JsonSerializer.Deserialize<SleepPredictionModelOutput>(json, SleepAiJson.Options); }
        catch (JsonException) { return false; }
        if (output is null || output.Periods is null || output.Status is not ("ready" or "insufficient_data") ||
            output.Periods.Length > (request.SchemaVersion == 2 ? MaxWholeDayPeriods : MaxPeriods)) return false;
        if (output.Status == "insufficient_data") return output.Periods.Length == 0;
        if (request.SchemaVersion == 2) return ValidWholeDayOutput(output.Periods, request, bounds);
        if (output.Periods.Length == 0 || request.Records.Any(x => x.Kind == "sleep" && x.Ongoing)) return false;
        DateTimeOffset? previousEnd = null;
        foreach (var period in output.Periods)
        {
            if (period is null || period.SootheStart is null || period.SootheEnd is null ||
                period.SootheStart < request.Now || period.SootheEnd <= period.SootheStart ||
                period.SootheEnd > period.SleepStart || period.SleepStart >= period.SleepEnd ||
                period.SleepStart >= bounds.TodayEnd || period.SleepEnd > bounds.SleepEndLimit ||
                period.SootheStart < previousEnd) return false;
            if (request.Records.Where(x => x.Kind == "sleep").Any(x =>
                period.SootheStart < (x.End ?? request.Now) && period.SleepEnd > x.Start)) return false;
            previousEnd = period.SleepEnd;
        }
        return true;
    }

    private static bool ValidWholeDayPeriods(SleepPredictionPeriod[]? periods, SleepAiTimeBounds bounds)
    {
        if (periods is null || periods.Length is < 1 or > MaxWholeDayPeriods) return false;
        DateTimeOffset? previousEnd = null;
        foreach (var period in periods)
        {
            if (period is null || period.SleepStart < bounds.TodayStart.AddHours(-24) ||
                period.SleepStart >= bounds.TodayEnd || period.SleepEnd <= bounds.TodayStart ||
                period.SleepStart >= period.SleepEnd || period.SleepEnd > bounds.SleepEndLimit ||
                period.SleepEnd - period.SleepStart > TimeSpan.FromHours(24) || period.SleepStart < previousEnd) return false;
            if ((period.SootheStart is null) != (period.SootheEnd is null)) return false;
            if (period.SootheStart is { } soothe &&
                (soothe >= period.SootheEnd || period.SootheEnd > period.SleepStart ||
                 soothe < period.SleepStart.AddHours(-4) || soothe < previousEnd)) return false;
            previousEnd = period.SleepEnd;
        }
        return true;
    }

    private static bool ValidWholeDayOutput(SleepPredictionPeriod[] periods, SleepPredictionRequest request, SleepAiTimeBounds bounds)
    {
        if (!ValidWholeDayPeriods(periods, bounds)) return false;
        var sleep = request.Records.Where(record => record.Kind == "sleep").ToArray();
        foreach (var period in periods)
        {
            var anchor = sleep.FirstOrDefault(record => record.Start == period.SleepStart &&
                (record.Ongoing ? period.SleepEnd > request.Now : record.End == period.SleepEnd));
            // Observed/ongoing segments have no invented settling advice. Every
            // unobserved segment must retain its actual AI-generated settling range.
            if (anchor is null ? period.SootheStart is null : period.SootheStart is not null) return false;
            var start = period.SootheStart ?? period.SleepStart;
            if (sleep.Any(record => !ReferenceEquals(record, anchor) &&
                start < (record.End ?? request.Now) && period.SleepEnd > record.Start)) return false;
        }
        // A partial future-only answer cannot masquerade as a whole-day plan.
        return sleep.Where(record => record.End is null || record.End > bounds.TodayStart)
            .All(record => periods.Any(period => period.SleepStart == record.Start &&
                (record.Ongoing ? period.SleepEnd > request.Now : period.SleepEnd == record.End)));
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
