namespace LittleDays.FamilyApi;

// Private, bounded output-only evidence. Never serialize this into application
// logs or the client prediction response. SQL persistence rechecks authorization.
public sealed record SleepAiFailedAttempt(int Attempt, string Reason, int? PeriodIndex,
    string? ResponseText, int OriginalLength, bool Truncated, DateTimeOffset OccurredAt,
    double DurationMs, string Model)
{
    public DateTimeOffset ExpiresAt => OccurredAt.Add(SleepAiFailureCapture.Retention);
}

public sealed class SleepAiFailureCapture(TimeProvider clock) : IDisposable
{
    // Retained only for compatibility with existing optional client fields.
    public const string ConsentVersion = "sleep-ai-failed-output-v1";
    public const int MaxResponseChars = 16 * 1024;
    public static readonly TimeSpan Retention = TimeSpan.FromDays(7);
    private readonly List<SleepAiFailedAttempt> attempts = [];
    private bool enabled;
    private string? rejectedText;
    private int rejectedLength;
    private string? rejectedReason;
    public IReadOnlyList<SleepAiFailedAttempt> Attempts => attempts.AsReadOnly();

    // The server stamps each new, authorized AI job with the current history
    // epoch. Null means pre-policy or lifecycle-suppressed: never backfill it.
    // This is an operator policy, not a claim that the user gave extra consent.
    public void StartAutomaticCapture(Guid? historyEpoch)
    {
        Dispose();
        enabled = historyEpoch is { } epoch && epoch != Guid.Empty;
    }

    internal void BeginAttempt()
    {
        rejectedText = null; rejectedLength = 0; rejectedReason = null;
    }

    internal void RejectProviderResponse(string? text, string reason)
    {
        if (!enabled) return;
        rejectedReason = reason is "incomplete_response" or "non_text_response" or "continuation_response"
            ? reason : "invalid_output";
        rejectedLength = text?.Length ?? 0;
        rejectedText = Bound(text);
    }

    internal void Record(int attempt, string reason, int? periodIndex, string? responseText,
        TimeSpan duration, string model)
    {
        if (!enabled || attempt is < 1 or > 2 || attempts.Any(x => x.Attempt == attempt)) return;
        var originalLength = responseText?.Length ?? rejectedLength;
        var bounded = responseText is null ? rejectedText : Bound(responseText);
        var category = rejectedReason ?? (SleepAiOutputFailure.IsKnownReason(reason) ||
            reason is "ai_timeout" or "ai_provider_busy" or "ai_provider_unavailable" ? reason : "invalid_output");
        attempts.Add(new(attempt, category, periodIndex is >= 0 and < SleepAiValidation.MaxWholeDayPeriods ? periodIndex : null,
            bounded, originalLength, originalLength > (bounded?.Length ?? 0), clock.GetUtcNow(),
            double.IsFinite(duration.TotalMilliseconds) ? Math.Clamp(duration.TotalMilliseconds, 0, 120000) : 0,
            model.Length <= 100 && (model == SleepAiOptions.SelectedModel ||
                System.Text.RegularExpressions.Regex.IsMatch(model, @"^[a-zA-Z0-9.-]+-\d{4}-\d{2}-\d{2}$")) ? model : "unknown"));
        BeginAttempt();
    }

    private static string? Bound(string? text)
    {
        if (text is null || text.Length <= MaxResponseChars) return text;
        var length = char.IsHighSurrogate(text[MaxResponseChars - 1]) ? MaxResponseChars - 1 : MaxResponseChars;
        return text[..length];
    }

    public void Dispose()
    {
        enabled = false; attempts.Clear(); BeginAttempt();
    }
}
