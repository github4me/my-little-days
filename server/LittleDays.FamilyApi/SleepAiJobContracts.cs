using System.Runtime.CompilerServices;
using System.Text.Json.Serialization;

[assembly: InternalsVisibleTo("LittleDays.FamilyApi.Tests")]

namespace LittleDays.FamilyApi;

/// <summary>Explicitly consents to short-lived server storage for a durable prediction.</summary>
public sealed record CreateSleepPredictionJobRequest(Guid OperationId, string ConsentVersion,
    Guid ConsentGeneration, SleepPredictionRequest Request)
{
    // Compatibility only: capture is now a server policy, not gated on this
    // optional field. Omit null to preserve the legacy idempotency fingerprint.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? DiagnosticsConsentVersion { get; init; }
}

/// <summary>Durable job metadata; only a completed, unexpired job contains a prediction.</summary>
public sealed record SleepPredictionJobResponse(Guid JobId, string InputRevision, string Status,
    DateTimeOffset RequestNow, DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset ExpiresAt,
    SleepPredictionResponse? Prediction, string? ErrorCode);

/// <summary>Availability and initial AI consent version for short-lived SQL storage.</summary>
public sealed record SleepPredictionJobCapabilities(bool Enabled, string ConsentVersion)
{
    public int RemainingDaySchemaVersion { get; init; } = 3;
    public string RemainingDayConsentVersion { get; init; } = SleepAiValidation.WholeDayConsentVersion;
    // Kept for old clients; no separate diagnostic opt-in is required.
    public string DiagnosticsConsentVersion { get; init; } = SleepAiFailureCapture.ConsentVersion;
    public int DiagnosticsRetentionDays { get; init; } = 7;
}

public static class SleepAiJobPolicy
{
    public const string ConsentVersion = "sleep-ai-jobs-v1";
    public static bool IsTerminal(string status) => status is "completed" or "failed" or "cancelled" or "expired";
    public static SleepAiTimeBounds Validate(CreateSleepPredictionJobRequest value, DateTimeOffset now)
    {
        if (value.OperationId == Guid.Empty || value.ConsentGeneration == Guid.Empty ||
            value.ConsentVersion != ConsentVersion || value.Request is null || value.Request.SchemaVersion is not (2 or 3) ||
            value.DiagnosticsConsentVersion is not null && value.DiagnosticsConsentVersion != SleepAiFailureCapture.ConsentVersion)
            throw new ApiException(422, "invalid_input");
        return SleepAiValidation.ValidateRequest(value.Request, now);
    }
    public static string SafeError(string code) => code switch
    {
        "ai_timeout" or "ai_invalid_response" or "ai_provider_busy" or "ai_provider_unavailable" or
        "ai_hourly_limit" or "ai_daily_limit" or "ai_busy" or "prediction_day_changed" or
        "account_deleted" or "membership_revoked" or "membership_changed" or "history_changed" or
        "ai_consent_revoked" or "recovery_blocked" => code,
        _ => "ai_provider_unavailable"
    };
}
