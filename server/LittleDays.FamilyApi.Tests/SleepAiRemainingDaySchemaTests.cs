using System.ClientModel;
using System.ClientModel.Primitives;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Options;
using OpenAI.Responses;

#pragma warning disable OPENAI001

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiRemainingDaySchemaTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-18T20:15:35+11:00");
    private const string EmptyOutput = "{\"status\":\"insufficient_data\",\"periods\":[]}";

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RemainingDayWirePreservesExactStrictSchemaAndPrivacyOptions(bool retry)
    {
        using var transport = new WireHandler();
        using var http = new HttpClient(transport);
        using var client = new ResponsesClient(new ApiKeyCredential("synthetic-not-real"), new ResponsesClientOptions
        {
            Transport = new HttpClientPipelineTransport(http), RetryPolicy = new ClientRetryPolicy(0),
            ClientLoggingOptions = new() { EnableLogging = false, EnableMessageLogging = false, EnableMessageContentLogging = false }
        }).AsIChatClient("gpt-6-luna");
        var request = new SleepPredictionRequest
        {
            SchemaVersion = 3, ConsentVersion = "sleep-ai-v2", InputRevision = new('a', 64),
            FamilyId = null, MembershipId = null, HistoryId = null, AgeDays = 106,
            TimeZone = "Australia/Melbourne", Now = Now, Records = [], PreviousEstimate = null
        };
        var options = SleepAiJobTests.Enabled(); options.Model = "gpt-6-luna";
        var result = await new OpenAiSleepProvider(client, Options.Create(options)).GenerateAsync(
            request, SleepAiValidation.ValidateRequest(request, Now), retry, default);

        Assert.Equal(EmptyOutput, result); Assert.Equal(1, transport.Calls);
        using var wire = JsonDocument.Parse(transport.Body!);
        var root = wire.RootElement;
        var format = root.GetProperty("text").GetProperty("format");
        Assert.Equal("json_schema", format.GetProperty("type").GetString());
        Assert.Equal("sleep_prediction_remaining_day_v3", format.GetProperty("name").GetString());
        Assert.True(format.GetProperty("strict").GetBoolean());
        var schema = format.GetProperty("schema");
        Assert.True(JsonElement.DeepEquals(OpenAiSleepProvider.RemainingDayOutputSchema, schema));
        Assert.Equal(24, schema.GetProperty("properties").GetProperty("periods").GetProperty("maxItems").GetInt32());
        Assert.Equal(2, schema.GetProperty("properties").GetProperty("periods").GetProperty("items").GetProperty("anyOf").GetArrayLength());
        Assert.Equal("date-time", schema.GetProperty("$defs").GetProperty("timestamp").GetProperty("format").GetString());
        Assert.True(schema.GetProperty("$defs").GetProperty("timestamp").GetProperty("pattern").GetString()!.Length > 0);
        Assert.Equal("gpt-6-luna", root.GetProperty("model").GetString());
        Assert.False(root.GetProperty("store").GetBoolean()); Assert.False(root.GetProperty("background").GetBoolean());
        Assert.False(root.TryGetProperty("previous_response_id", out _)); Assert.False(root.TryGetProperty("conversation", out _));
        Assert.False(root.TryGetProperty("tools", out var tools) && tools.GetArrayLength() > 0);
        Assert.False(root.TryGetProperty("temperature", out _)); Assert.Equal(4096, root.GetProperty("max_output_tokens").GetInt32());
        var system = root.GetProperty("input").EnumerateArray().Single(item => item.GetProperty("role").GetString() == "system")
            .GetProperty("content")[0].GetProperty("text").GetString()!;
        Assert.StartsWith(OpenAiSleepProvider.RemainingDayInstructions, system);
        Assert.Equal(retry, system.Contains("previous response failed structural/temporal validation", StringComparison.Ordinal));
    }

    [Fact]
    public void RemainingDaySchemaRequiresCompleteSettlingPairsWithoutChangingResponseFields()
    {
        var schema = OpenAiSleepProvider.RemainingDayOutputSchema;
        AssertObject(schema, "status", "periods");
        Assert.False(schema.TryGetProperty("anyOf", out _));
        Assert.Equal(["ready", "insufficient_data"], schema.GetProperty("properties").GetProperty("status")
            .GetProperty("enum").EnumerateArray().Select(value => value.GetString()!).ToArray());
        var periods = schema.GetProperty("properties").GetProperty("periods");
        Assert.Equal("array", periods.GetProperty("type").GetString());
        Assert.Equal(0, periods.GetProperty("minItems").GetInt32());
        Assert.Equal(SleepAiValidation.MaxWholeDayPeriods, periods.GetProperty("maxItems").GetInt32());
        Assert.Equal(["#/$defs/futureSleep", "#/$defs/currentSleepRemainder"], periods.GetProperty("items")
            .GetProperty("anyOf").EnumerateArray().Select(value => value.GetProperty("$ref").GetString()!).ToArray());
        var definitions = schema.GetProperty("$defs");
        foreach (var name in new[] { "futureSleep", "currentSleepRemainder" })
        {
            var branch = definitions.GetProperty(name);
            AssertObject(branch, "sleepStart", "sleepEnd", "sootheStart", "sootheEnd");
            var properties = branch.GetProperty("properties");
            foreach (var field in new[] { "sleepStart", "sleepEnd" })
                Assert.Equal("#/$defs/timestamp", properties.GetProperty(field).GetProperty("$ref").GetString());
            foreach (var field in new[] { "sootheStart", "sootheEnd" })
                Assert.Equal(name == "futureSleep" ? "#/$defs/timestamp" : "null",
                    properties.GetProperty(field).GetProperty(name == "futureSleep" ? "$ref" : "type").GetString());
        }
        Assert.Contains("first period only", definitions.GetProperty("currentSleepRemainder").GetProperty("description").GetString());
        Assert.Contains("four hours", definitions.GetProperty("futureSleep").GetProperty("description").GetString());
        Assert.Contains("Temporal comparisons remain mandatory", schema.GetProperty("description").GetString());
    }

    [Fact]
    public void RemainingDaySchemaDescriptionsMatchPromptMinuteFloorInsufficientEvidenceAndTimezoneRules()
    {
        var schema = OpenAiSleepProvider.RemainingDayOutputSchema;
        var description = schema.GetProperty("description").GetString()!;
        Assert.Contains("currentMinute is request now rounded down to the start of its minute", description);
        Assert.Contains("sleepEnd must be strictly after exact now", description);
        var status = schema.GetProperty("properties").GetProperty("status").GetProperty("description").GetString()!;
        Assert.Contains("neither a usable timing anchor nor a repeatable sleep pattern exists; periods must be empty", status);
        Assert.Contains("possibly empty if no further sleep is supported before midnight", status);
        var definitions = schema.GetProperty("$defs");
        var future = definitions.GetProperty("futureSleep").GetProperty("description").GetString()!;
        Assert.Contains("currentMinute <= sootheStart < sootheEnd <= sleepStart < sleepEnd <= todayEnd", future);
        Assert.Contains("sleepEnd must still be strictly after exact now", future);
        Assert.DoesNotContain("Require now <= sootheStart", future);
        var timestamp = definitions.GetProperty("timestamp").GetProperty("description").GetString()!;
        Assert.Contains("correct offset for that instant in the supplied IANA timeZone, or the equivalent UTC instant with Z", timestamp);
        Assert.Contains("Interpret local clock times and calendar boundaries in the supplied IANA timeZone, including daylight-saving changes", timestamp);
        var current = definitions.GetProperty("currentSleepRemainder").GetProperty("description").GetString()!;
        Assert.Contains("Optional first period only", current);
        Assert.Contains("sleepStart must be in the same minute as request now", current);
        Assert.Contains("Both settling fields must be null", current);
    }

    [Theory]
    [InlineData("2026-10-18T20:30:00+11:00", true)]
    [InlineData("2026-10-18T09:30:00Z", true)]
    [InlineData("2026-10-18T20:30:35.1234567+11:00", true)]
    [InlineData("2026-10-18T20:30:00-14:00", true)]
    [InlineData("20:30", false)]
    [InlineData("2026-10-18T20:30+11:00", false)]
    [InlineData("2026-10-18T20:30:00", false)]
    [InlineData("2026-10-18T24:00:00+11:00", false)]
    [InlineData("2026-10-18T20:60:00+11:00", false)]
    [InlineData("2026-10-18T20:30:60+11:00", false)]
    [InlineData("2026-10-18T20:30:00.12345678+11:00", false)]
    [InlineData("2026-10-18T20:30:00+14:01", false)]
    public void RemainingDayTimestampSchemaRejectsAmbiguousOrUnsupportedRepresentations(string value, bool accepted)
    {
        var timestamp = OpenAiSleepProvider.RemainingDayOutputSchema.GetProperty("$defs").GetProperty("timestamp");
        Assert.Equal("string", timestamp.GetProperty("type").GetString());
        Assert.Equal("date-time", timestamp.GetProperty("format").GetString());
        Assert.Equal(accepted, Regex.IsMatch(value, timestamp.GetProperty("pattern").GetString()!, RegexOptions.CultureInvariant));
    }

    private static void AssertObject(JsonElement schema, params string[] fields)
    {
        Assert.Equal("object", schema.GetProperty("type").GetString());
        Assert.False(schema.GetProperty("additionalProperties").GetBoolean());
        Assert.Equal(fields.Order(), schema.GetProperty("properties").EnumerateObject().Select(property => property.Name).Order());
        Assert.Equal(fields.Order(), schema.GetProperty("required").EnumerateArray().Select(value => value.GetString()!).Order());
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
                id = "resp_synthetic", @object = "response", created_at = 1792314935, status = "completed", model = "gpt-6-luna",
                output = new[] { new { type = "message", id = "msg_synthetic", status = "completed", role = "assistant",
                    content = new[] { new { type = "output_text", text = EmptyOutput, annotations = Array.Empty<object>() } } } }
            }) };
        }
    }
}
