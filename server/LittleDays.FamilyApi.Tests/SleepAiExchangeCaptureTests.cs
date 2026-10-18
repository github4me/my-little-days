using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using System.ClientModel;
using System.ClientModel.Primitives;
using OpenAI.Responses;

#pragma warning disable OPENAI001

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiExchangeCaptureTests
{
    private const string Request = "{\"model\":\"gpt-6-luna\",\"input\":[{\"role\":\"system\",\"content\":\"full prompt\"},{\"role\":\"user\",\"content\":\"historical records + previous estimate 🌙\"}],\"store\":false}";
    private const string Response = "{\"id\":\"resp_synthetic\",\"output\":[{\"text\":\"complete synthetic output\"}],\"usage\":{\"input_tokens\":123}}";
    private static readonly Guid Epoch = Guid.NewGuid();

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task DisabledOrUnstampedCaptureDoesNotCollectAndLeavesHttpUnchanged(bool enabled, bool stamped)
    {
        var f = new Fixture(enabled, stamped);
        using var result = await f.Send();
        Assert.Equal(Response, await result.Content.ReadAsStringAsync());
        Assert.Equal(Request, f.Wire.Request); Assert.Empty(f.Saved);
        Assert.Equal(1, f.Wire.Calls);
    }

    [Fact]
    public async Task CapturesExactRequestBeforeDispatchAndFullResponseWithoutHeadersOrApiKey()
    {
        var f = new Fixture();
        f.Wire.Before = () =>
        {
            var before = Assert.Single(f.Saved);
            Assert.Equal("dispatching", before.Outcome); Assert.Equal(Request, before.RequestBody);
            Assert.Null(before.ResponseBody); Assert.Null(before.FinishedAt);
            f.Clock.Advance(TimeSpan.FromMilliseconds(200));
        };
        using var response = await f.Send();
        Assert.Equal(Response, await response.Content.ReadAsStringAsync());
        Assert.Equal(Request, f.Wire.Request);
        Assert.Equal(2, f.Saved.Count);
        var done = f.Saved.Last();
        Assert.Equal(Response, done.ResponseBody); Assert.Equal(200, done.HttpStatus);
        Assert.Equal("req_synthetic-123", done.ProviderRequestId);
        Assert.Equal("response_received", done.Outcome); Assert.Equal(3, done.SchemaVersion);
        Assert.Equal(200, done.DurationMs);
        Assert.Equal(Encoding.UTF8.GetByteCount(Request), done.RequestBytes);
        Assert.Equal(Encoding.UTF8.GetByteCount(Response), done.ResponseBytes);
        Assert.Equal(done.StartedAt.AddDays(7), done.ExpiresAt); Assert.Equal(f.Clock.Now, done.FinishedAt);
        Assert.False(done.RequestTruncated); Assert.False(done.ResponseTruncated);
        var stored = JsonSerializer.Serialize(f.Saved);
        Assert.DoesNotContain("Bearer", stored); Assert.DoesNotContain("header-only-private-value", stored);
        Assert.DoesNotContain(f.Options.ApiKey, stored);
    }

    [Theory]
    [InlineData(400)]
    [InlineData(401)]
    [InlineData(429)]
    [InlineData(500)]
    public async Task HttpErrorsRetainStatusFullErrorBodyAndRequestWhileRedactingKnownKey(int status)
    {
        var f = new Fixture(); f.Wire.Status = status;
        f.Wire.Output = "{\"error\":{\"code\":\"invalid_json_schema\",\"param\":\"text.format.schema\",\"message\":\"synthetic-key-do-not-retain\"}}";
        using var response = await f.Send();
        Assert.Equal(f.Wire.Output, await response.Content.ReadAsStringAsync());
        var done = f.Saved.Last();
        Assert.Equal(status, done.HttpStatus); Assert.Equal("http_error", done.Outcome);
        Assert.Contains("invalid_json_schema", done.ResponseBody); Assert.Contains("text.format.schema", done.ResponseBody);
        Assert.Contains("[REDACTED_API_KEY]", done.ResponseBody); Assert.DoesNotContain(f.Options.ApiKey, done.ResponseBody);
        Assert.Equal(Request, done.RequestBody); Assert.Equal(2, f.Saved.Count);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task TransportAndCancellationKeepRequestAndSafeFailureWithoutChangingException(bool cancel)
    {
        var f = new Fixture();
        var error = cancel ? (Exception)new OperationCanceledException("private-exception") : new HttpRequestException("private-exception");
        f.Wire.Error = error;
        var caught = await Record.ExceptionAsync(() => f.Send());
        Assert.Same(error, caught); Assert.Equal(2, f.Saved.Count);
        var done = f.Saved.Last(); Assert.Equal(Request, done.RequestBody); Assert.Null(done.ResponseBody);
        Assert.Null(done.HttpStatus); Assert.Equal(cancel ? "cancelled" : "transport_error", done.Outcome);
        Assert.DoesNotContain("private-exception", JsonSerializer.Serialize(f.Saved));
    }

    [Fact]
    public async Task BrokenDiagnosticStoreCannotFailOrRetryGeneration()
    {
        var f = new Fixture(); f.SaveError = true;
        using var response = await f.Send();
        Assert.Equal(Response, await response.Content.ReadAsStringAsync()); Assert.Equal(1, f.Wire.Calls);
    }

    [Fact]
    public async Task InitialRepairAndConcurrentScopesKeepSeparateBodiesAndAttemptNumbers()
    {
        var first = new Fixture(); var other = new Fixture(); other.Wire.Output = "other-scope-response";
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        first.Wire.BeforeAsync = async () => { entered.SetResult(); await release.Task; };
        var pendingFirst = first.Send(); await entered.Task;
        using var otherResponse = await other.Send();
        release.SetResult(); using var one = await pendingFirst;
        first.Wire.BeforeAsync = null;
        first.Capture.BeginAttempt(2, 3); first.Wire.Output = "repaired-output";
        using var two = await first.Send();
        Assert.Equal(new[] { 1, 1, 2, 2 }, first.Saved.Select(x => x.Attempt));
        Assert.Equal(Response, first.Saved[1].ResponseBody); Assert.Equal("repaired-output", first.Saved[3].ResponseBody);
        Assert.All(other.Saved, x => Assert.Equal(1, x.Attempt));
        Assert.Equal("other-scope-response", other.Saved.Last().ResponseBody);
        Assert.DoesNotContain("repaired-output", JsonSerializer.Serialize(other.Saved));
    }

    [Fact]
    public void RegistrationKeepsCollectorAndWireClientScopedAndCaptureDisabledByDefault()
    {
        Assert.False(new SleepAiOptions().FullRequestCaptureEnabled);
        var services = new ServiceCollection(); services.AddLogging(); services.AddSingleton<TimeProvider>(TimeProvider.System);
        services.AddSleepAi(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["SleepAi:Enabled"] = "true", ["SleepAi:ChildDataProcessingApproved"] = "true",
            ["SleepAi:ZeroDataRetentionApproved"] = "true", ["SleepAi:HardSpendControlVerified"] = "true",
            ["SleepAi:ApiKey"] = "synthetic-never-used"
        }).Build());
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
        using var first = provider.CreateScope(); using var second = provider.CreateScope();
        Assert.NotSame(first.ServiceProvider.GetRequiredService<SleepAiExchangeCapture>(), second.ServiceProvider.GetRequiredService<SleepAiExchangeCapture>());
        Assert.NotSame(first.ServiceProvider.GetRequiredService<IChatClient>(), second.ServiceProvider.GetRequiredService<IChatClient>());
        Assert.Same(first.ServiceProvider.GetRequiredService<IChatClient>(), first.ServiceProvider.GetRequiredService<IChatClient>());
        Assert.False(first.ServiceProvider.GetRequiredService<IOptions<SleepAiOptions>>().Value.FullRequestCaptureEnabled);
    }

    [Fact]
    public void ReleaseConfigurationEnablesFullCaptureWithoutChangingAiQuotasOrModel()
    {
        var config = new ConfigurationBuilder().SetBasePath(AppContext.BaseDirectory).AddJsonFile("appsettings.json").Build();
        var value = config.GetSection("SleepAi").Get<SleepAiOptions>()!;
        Assert.True(value.FullRequestCaptureEnabled);
        Assert.Equal(30, value.MaxRequestsPerAccountPerHour);
        Assert.Equal(50, value.MaxConcurrentRequests);
        Assert.Equal(200, value.MaxRequestsPerInstancePerDay);
        Assert.Equal("gpt-6-luna", value.Model);
        Assert.False(value.Enabled); // Existing deployment gates are not bypassed.
    }

    [Fact]
    public async Task ActualSdkRequestAndErrorResponseAreRetainedBeforeSdkConvertsError()
    {
        var f = new Fixture(); f.Wire.Status = 400;
        f.Wire.Output = "{\"error\":{\"type\":\"invalid_request_error\",\"code\":\"invalid_json_schema\",\"message\":\"Synthetic invalid schema\",\"param\":\"text.format.schema\"}}";
        using var http = new HttpClient(new SleepAiCaptureHandler(f.Capture, f.Clock, f.Wire));
        using var client = new ResponsesClient(new ApiKeyCredential(f.Options.ApiKey), new ResponsesClientOptions
        {
            Transport = new HttpClientPipelineTransport(http), RetryPolicy = new ClientRetryPolicy(0),
            ClientLoggingOptions = new() { EnableLogging = false, EnableMessageLogging = false, EnableMessageContentLogging = false }
        }).AsIChatClient(SleepAiOptions.SelectedModel);
        var request = SleepAiJobTests.Request(f.Clock.Now).Request with { SchemaVersion = 3 };
        var provider = new OpenAiSleepProvider(client, Options.Create(f.Options), exchanges: f.Capture);
        await Assert.ThrowsAsync<ClientResultException>(() => provider.GenerateAsync(request,
            SleepAiValidation.ValidateRequest(request, request.Now), false, default));
        Assert.Equal(1, f.Wire.Calls); Assert.Equal(2, f.Saved.Count);
        var captured = f.Saved.Last(); Assert.Equal(f.Wire.Request, captured.RequestBody);
        Assert.Equal(f.Wire.Output, captured.ResponseBody); Assert.Equal(400, captured.HttpStatus);
        using var body = JsonDocument.Parse(captured.RequestBody);
        Assert.Equal(SleepAiOptions.SelectedModel, body.RootElement.GetProperty("model").GetString());
        Assert.False(body.RootElement.GetProperty("store").GetBoolean());
        Assert.Equal("sleep_prediction_remaining_day_v3", body.RootElement.GetProperty("text").GetProperty("format").GetProperty("name").GetString());
        Assert.DoesNotContain(f.Options.ApiKey, captured.RequestBody);
    }

    [Fact]
    public async Task UnknownLengthChunkedResponseIsCapturedAndRemainsReadable()
    {
        var f = new Fixture(); f.Wire.UnknownLength = true;
        using var response = await f.Send();
        Assert.Equal(Response, await response.Content.ReadAsStringAsync());
        Assert.Equal(Response, f.Saved.Last().ResponseBody); Assert.False(f.Saved.Last().ResponseTruncated);
    }

    [Fact]
    public async Task UnreadableResponseHasStatusAndExplicitCaptureGapInsteadOfFalseEmptySuccess()
    {
        var f = new Fixture(); f.Wire.Unreadable = true;
        await Assert.ThrowsAsync<HttpRequestException>(() => f.Send());
        var saved = f.Saved.Last(); Assert.Equal(200, saved.HttpStatus);
        Assert.Equal("response_read_failed", saved.Outcome); Assert.Null(saved.ResponseBody);
        Assert.True(saved.ResponseTruncated); Assert.Equal(-1, saved.ResponseBytes);
        Assert.DoesNotContain("private-read-error", JsonSerializer.Serialize(f.Saved));
    }

    [Fact]
    public async Task Utf8PrefixDoesNotLeaveBrokenEmojiAndApiKeyCannotLeakAsRequestId()
    {
        var f = new Fixture(); f.Wire.RequestId = f.Options.ApiKey;
        f.Wire.Output = new string('x', SleepAiExchangeCapture.MaxBodyBytes - 1) + "🌙";
        using var response = await f.Send();
        Assert.Equal(f.Wire.Output, await response.Content.ReadAsStringAsync());
        var saved = f.Saved.Last(); Assert.Equal(new string('x', SleepAiExchangeCapture.MaxBodyBytes - 1), saved.ResponseBody);
        Assert.True(saved.ResponseTruncated); Assert.Null(saved.ProviderRequestId);
        Assert.Equal(SleepAiExchangeCapture.MaxBodyBytes + 3, saved.ResponseBytes);
    }

    [Theory]
    [InlineData(-1, false)]
    [InlineData(0, false)]
    [InlineData(1, true)]
    public async Task SizeBoundsRetainExactByteCountAndExplicitTruncation(int extra, bool truncated)
    {
        var f = new Fixture(); f.Wire.Output = new('x', SleepAiExchangeCapture.MaxBodyBytes + extra);
        using var response = await f.Send();
        Assert.Equal(f.Wire.Output, await response.Content.ReadAsStringAsync());
        var done = f.Saved.Last(); Assert.Equal(truncated, done.ResponseTruncated);
        Assert.Equal(f.Wire.Output.Length, done.ResponseBytes);
        Assert.Equal(f.Wire.Output[..Math.Min(f.Wire.Output.Length, SleepAiExchangeCapture.MaxBodyBytes)], done.ResponseBody);
    }

    private sealed class Fixture
    {
        public TraceClock Clock { get; } = new();
        public SleepAiOptions Options { get; } = new() { ApiKey = "synthetic-key-do-not-retain" };
        public List<SleepAiExchange> Saved { get; } = [];
        public Wire Wire { get; } = new();
        public SleepAiExchangeCapture Capture { get; }
        public bool SaveError { get; set; }
        public Fixture(bool enabled = true, bool stamped = true)
        {
            Options.FullRequestCaptureEnabled = enabled;
            Capture = new(Microsoft.Extensions.Options.Options.Create(Options), Clock);
            Capture.Start(new(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), SleepAiJobTests.Request(Clock.Now).Request)
                { ExchangeCaptureHistoryEpoch = stamped ? Epoch : null }, (value, ct) =>
                { if (SaveError) throw new InvalidOperationException("private-store-error"); Saved.Add(value); return Task.FromResult(true); });
            Capture.BeginAttempt(1, 3);
        }
        public async Task<HttpResponseMessage> Send()
        {
            using var http = new HttpClient(new SleepAiCaptureHandler(Capture, Clock, Wire));
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://example.invalid/v1/responses")
                { Content = new StringContent(Request, Encoding.UTF8, "application/json") };
            request.Headers.Authorization = new("Bearer", Options.ApiKey);
            request.Headers.Add("private-header", "header-only-private-value");
            return await http.SendAsync(request);
        }
    }

    private sealed class Wire : HttpMessageHandler
    {
        public int Calls, Status = 200;
        public string? Request;
        public string Output = Response;
        public Action? Before;
        public Func<Task>? BeforeAsync;
        public Exception? Error;
        public bool UnknownLength;
        public bool Unreadable;
        public string RequestId = "req_synthetic-123";
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Calls++; Before?.Invoke(); Request = await request.Content!.ReadAsStringAsync(ct);
            if (BeforeAsync is not null) await BeforeAsync();
            if (Error is not null) throw Error;
            var response = new HttpResponseMessage((HttpStatusCode)Status) { Content = Unreadable ? new BrokenContent() : UnknownLength
                ? new StreamContent(new UnknownLengthStream(Encoding.UTF8.GetBytes(Output))) : new StringContent(Output, Encoding.UTF8, "application/json") };
            response.Headers.Add("x-request-id", RequestId);
            response.Headers.Add("private-response-header", "header-only-private-value");
            return response;
        }
    }

    private sealed class UnknownLengthStream(byte[] bytes) : MemoryStream(bytes)
    { public override bool CanSeek => false; }

    private sealed class BrokenContent : HttpContent
    {
        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
            throw new IOException("private-read-error");
        protected override bool TryComputeLength(out long length) { length = 0; return false; }
    }

    private sealed class TraceClock : TimeProvider
    {
        public DateTimeOffset Now { get; private set; } = DateTimeOffset.Parse("2026-10-18T12:00:00Z");
        public void Advance(TimeSpan elapsed) => Now += elapsed;
        public override DateTimeOffset GetUtcNow() => Now;
        public override long GetTimestamp() => Now.UtcTicks;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
    }
}
