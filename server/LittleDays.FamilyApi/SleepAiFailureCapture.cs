namespace LittleDays.FamilyApi;

// Bounded, metadata-only failure evidence. Legacy body fields remain for source
// compatibility but are always empty; this collector never persists to SQL.
public sealed record SleepAiFailedAttempt(int Attempt, string Reason, int? PeriodIndex,
    string? ResponseText, int OriginalLength, bool Truncated, DateTimeOffset OccurredAt,
    double DurationMs, string Model)
{
    public IReadOnlyList<string> Fields { get; init; } = [];
    public DateTimeOffset ExpiresAt => OccurredAt.Add(SleepAiFailureCapture.Retention);
}

public sealed class SleepAiFailureCapture(TimeProvider clock, SleepAiDiagnostics? diagnostics = null) : IDisposable
{
    // Retained only for compatibility with existing optional client fields.
    public const string ConsentVersion = "sleep-ai-failed-output-v1";
    public const int MaxResponseChars = 16 * 1024;
    public static readonly TimeSpan Retention = TimeSpan.FromDays(7);
    private readonly List<SleepAiFailedAttempt> attempts = [];
    private bool enabled;
    private string? rejectedReason;
    public IReadOnlyList<SleepAiFailedAttempt> Attempts => attempts.AsReadOnly();

    // Compatibility entry point. An epoch no longer authorizes body capture.
    public void StartAutomaticCapture(Guid? historyEpoch)
    {
        Dispose();
        enabled = historyEpoch is { } epoch && epoch != Guid.Empty;
    }

    internal void StartMetadata()
    {
        Dispose();
        enabled = true;
    }

    internal void BeginAttempt()
    {
        rejectedReason = null;
    }

    internal void RejectProviderResponse(string? text, string reason)
    {
        if (!enabled) return;
        rejectedReason = reason is "incomplete_response" or "non_text_response" or "continuation_response"
            ? reason : "invalid_output";
    }

    internal void Record(int attempt, string reason, int? periodIndex, string? responseText,
        TimeSpan duration, string model, IReadOnlyList<string>? fields = null)
    {
        if (!enabled || attempt is < 1 or > 2 || attempts.Any(x => x.Attempt == attempt)) return;
        var category = rejectedReason ?? (SleepAiOutputFailure.IsKnownReason(reason) ||
            reason is "ai_timeout" or "ai_provider_busy" or "ai_provider_unavailable" ? reason : "invalid_output");
        var safeIndex = periodIndex is >= 0 and < SleepAiValidation.MaxWholeDayPeriods ? periodIndex : null;
        var metadata = new SleepAiFailedAttempt(attempt, category, safeIndex,
            null, 0, false, clock.GetUtcNow(),
            double.IsFinite(duration.TotalMilliseconds) ? Math.Clamp(duration.TotalMilliseconds, 0, 120000) : 0,
            model.Length <= 100 && (model == SleepAiOptions.SelectedModel ||
                System.Text.RegularExpressions.Regex.IsMatch(model, @"^[a-zA-Z0-9.-]+-\d{4}-\d{2}-\d{2}$")) ? model : "unknown")
        {
            Fields = SafeFields(category, safeIndex, category == reason ? fields : null)
        };
        attempts.Add(metadata);
        diagnostics?.OutputFailure(metadata.Attempt, metadata.Reason, metadata.PeriodIndex, metadata.Fields, metadata.DurationMs);
        BeginAttempt();
    }

    internal static IReadOnlyList<string> SafeFields(string reason, int? periodIndex, IReadOnlyList<string>? fields)
    {
        if (reason is "ai_timeout" or "ai_provider_busy" or "ai_provider_unavailable") return ["$provider"];
        // Never persist arbitrary JSON property names, exception paths or input
        // values. A malformed metadata list falls back to the fixed reason map.
        if (fields is { Count: > 0 and <= 4 } && fields.All(field => field is not null && field.Length <= 64 &&
            (field is "$" or "$.status" or "$.periods" ||
             System.Text.RegularExpressions.Regex.IsMatch(field,
                 @"\A\$\.periods\[(?:[0-9]|1[0-9]|2[0-3])\](?:\.(?:sleepStart|sleepEnd|sootheStart|sootheEnd))?\z"))))
            return Array.AsReadOnly(fields.Distinct(StringComparer.Ordinal).ToArray());
        return SleepAiOutputFailure.FieldsFor(reason, periodIndex);
    }

    public void Dispose()
    {
        enabled = false; attempts.Clear(); BeginAttempt();
    }
}
