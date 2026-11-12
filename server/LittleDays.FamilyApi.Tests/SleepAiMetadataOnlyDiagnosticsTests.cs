using Microsoft.Extensions.Logging;
using System.Text.Json;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiMetadataOnlyDiagnosticsTests
{
    [Fact]
    public void FailureEventContainsOnlySanitizedBoundedMetadataNotResponseOrExceptionText()
    {
        var logs = new TimingLogs(); var clock = new TimingClock();
        using var capture = new SleepAiFailureCapture(clock, new(logs, clock));
        capture.StartMetadata();
        capture.Record(1, "private exception reason", 99, "private provider response",
            TimeSpan.MaxValue, "private-model-or-key", ["$.privateChildName"]);

        var value = Assert.Single(logs.Events);
        Assert.Equal(4102, Assert.Single(logs.Ids));
        Assert.Equal(LogLevel.Information, Assert.Single(logs.Levels));
        Assert.Equal("invalid_output", value["Reason"]); Assert.Null(value["PeriodIndex"]);
        Assert.Equal("$", value["Fields"]); Assert.Equal(1, value["Attempt"]);
        Assert.Equal(120000d, value["DurationMs"]);
        Assert.Equal(new[] { "{OriginalFormat}", "Attempt", "DurationMs", "Fields", "Job", "PeriodIndex", "Reason", "Run" }.Order(), value.Keys.Order());
        Assert.All(logs.Exceptions, Assert.Null);
        foreach (var secret in new[] { "private exception reason", "private provider response", "private-model-or-key", "privateChildName" })
        {
            Assert.DoesNotContain(secret, logs.Text);
            Assert.DoesNotContain(secret, JsonSerializer.Serialize(logs.Events));
        }
        var attempt = Assert.Single(capture.Attempts);
        Assert.Null(attempt.ResponseText); Assert.Equal(0, attempt.OriginalLength); Assert.False(attempt.Truncated);
    }

    [Fact]
    public void ValidationFailureEventPreservesCanonicalFieldsIndexAndMeasuredTime()
    {
        var logs = new TimingLogs(); var clock = new TimingClock();
        var diagnostics = new SleepAiDiagnostics(logs, clock); var jobId = Guid.NewGuid();
        diagnostics.SetJob(jobId, 2);
        using var capture = new SleepAiFailureCapture(clock, diagnostics); capture.StartMetadata();
        string[] fields = ["$.periods[3].sootheStart", "$.periods[3].sootheEnd"];
        capture.Record(2, "predicted_sleep_missing_settling", 3, "private failed prediction",
            TimeSpan.FromMilliseconds(125.456), SleepAiOptions.SelectedModel, fields);
        fields[0] = "private-mutated-field";

        var value = Assert.Single(logs.Events);
        Assert.Equal("predicted_sleep_missing_settling", value["Reason"]);
        Assert.Equal(3, value["PeriodIndex"]); Assert.Equal(2, value["Run"]); Assert.Equal(2, value["Attempt"]);
        Assert.Equal("$.periods[3].sootheStart,$.periods[3].sootheEnd", value["Fields"]);
        Assert.Equal(125.46d, value["DurationMs"]);
        Assert.Matches("^[A-F0-9]{24}$", Assert.IsType<string>(value["Job"]));
        Assert.DoesNotContain(jobId.ToString(), logs.Text); Assert.DoesNotContain(jobId.ToString("N"), logs.Text);
        Assert.DoesNotContain("private failed prediction", logs.Text); Assert.DoesNotContain("private-mutated-field", logs.Text);
    }

    [Fact]
    public void DuplicateOrOutOfRangeAttemptsDoNotMultiplyMetadataLogs()
    {
        var logs = new TimingLogs(); var clock = new TimingClock();
        using var capture = new SleepAiFailureCapture(clock, new(logs, clock)); capture.StartMetadata();
        foreach (var attempt in new[] { 0, 1, 1, 2, 3 })
            capture.Record(attempt, "invalid_json", null, "private failed prediction", TimeSpan.Zero, SleepAiOptions.SelectedModel);

        Assert.Equal(new[] { 1, 2 }, logs.Events.Select(x => Assert.IsType<int>(x["Attempt"])));
        Assert.Equal(new[] { 4102, 4102 }, logs.Ids);
        Assert.Equal(new[] { 1, 2 }, capture.Attempts.Select(x => x.Attempt));
        Assert.DoesNotContain("private failed prediction", logs.Text);
    }

    [Theory]
    [InlineData("incomplete_response", "incomplete_response", "$provider")]
    [InlineData("non_text_response", "non_text_response", "$provider")]
    [InlineData("continuation_response", "continuation_response", "$provider")]
    [InlineData("private rejection reason", "invalid_output", "$")]
    public void RejectedProviderResponseLogsOnlyAllowedReason(string reason, string expected, string expectedFields)
    {
        var logs = new TimingLogs(); var clock = new TimingClock();
        using var capture = new SleepAiFailureCapture(clock, new(logs, clock)); capture.StartMetadata();
        capture.RejectProviderResponse("private rejected response", reason);
        capture.Record(1, "invalid_json", null, null, TimeSpan.FromMilliseconds(50), SleepAiOptions.SelectedModel);

        var value = Assert.Single(logs.Events);
        Assert.Equal(expected, value["Reason"]); Assert.Equal(50d, value["DurationMs"]);
        Assert.Equal(expectedFields, value["Fields"]); Assert.Null(value["PeriodIndex"]);
        Assert.DoesNotContain("private rejected response", logs.Text);
        Assert.DoesNotContain("private rejection reason", logs.Text);
        Assert.Null(Assert.Single(capture.Attempts).ResponseText);
    }

    [Fact]
    public void ThrowingMetadataLoggerDoesNotFailCollectionOrDropSafeAttemptDetails()
    {
        var logs = new TimingLogs { Throw = true }; var clock = new TimingClock();
        using var capture = new SleepAiFailureCapture(clock, new(logs, clock)); capture.StartMetadata();
        capture.Record(1, "ai_timeout", null, "private timeout body", TimeSpan.FromSeconds(3), SleepAiOptions.SelectedModel);

        var attempt = Assert.Single(capture.Attempts);
        Assert.Equal("ai_timeout", attempt.Reason); Assert.Equal(new[] { "$provider" }, attempt.Fields);
        Assert.Equal(3000d, attempt.DurationMs); Assert.Null(attempt.ResponseText);
        Assert.Empty(logs.Events);
    }

    [Fact]
    public void StartingMetadataWithoutLegacyEpochClearsOldAttemptAndRejectionState()
    {
        var logs = new TimingLogs(); var clock = new TimingClock();
        using var capture = new SleepAiFailureCapture(clock, new(logs, clock));
        capture.StartAutomaticCapture(null);
        capture.Record(1, "invalid_output", null, "disabled response", TimeSpan.Zero, SleepAiOptions.SelectedModel);
        Assert.Empty(capture.Attempts); Assert.Empty(logs.Events);

        capture.StartMetadata();
        capture.Record(2, "invalid_output", null, "old response", TimeSpan.Zero, SleepAiOptions.SelectedModel);
        capture.RejectProviderResponse("old rejection", "incomplete_response");
        capture.StartMetadata();
        capture.Record(1, "invalid_json", null, "new response", TimeSpan.FromMilliseconds(1), SleepAiOptions.SelectedModel);

        var attempt = Assert.Single(capture.Attempts);
        Assert.Equal(1, attempt.Attempt); Assert.Equal("invalid_json", attempt.Reason);
        Assert.Null(attempt.ResponseText); Assert.Equal(1d, attempt.DurationMs);
        Assert.Equal(new[] { 2, 1 }, logs.Events.Select(x => Assert.IsType<int>(x["Attempt"])));
        Assert.Equal("invalid_json", logs.Events.Last()["Reason"]);
    }
}
