using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.EntityFrameworkCore;
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
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task CaptureStaysDisabledEvenWithLegacyEnabledConfigurationAndEpoch(bool enabled, bool stamped)
    {
        var f = new Fixture(enabled, stamped);
        using var result = await f.Send();
        Assert.Equal(Response, await result.Content.ReadAsStringAsync());
        Assert.Equal(Request, f.Wire.Request); Assert.Empty(f.Saved);
        Assert.Equal(1, f.Wire.Calls);
        Assert.False(f.Options.FullRequestCaptureEnabled);
        Assert.False(f.Capture.Enabled);
    }

    [Fact]
    public async Task RequestAndResponseAreForwardedWithoutPreDispatchOrCompletionSnapshots()
    {
        var f = new Fixture();
        f.Wire.Before = () =>
        {
            Assert.Empty(f.Saved);
            Assert.Equal(0, f.SaveCalls);
            f.Clock.Advance(TimeSpan.FromMilliseconds(200));
        };
        using var response = await f.Send();
        Assert.Equal(Response, await response.Content.ReadAsStringAsync());
        Assert.Equal(Request, f.Wire.Request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("req_synthetic-123", Assert.Single(response.Headers.GetValues("x-request-id")));
        Assert.Empty(f.Saved); Assert.Equal(0, f.SaveCalls);
        var stored = JsonSerializer.Serialize(f.Saved);
        Assert.DoesNotContain("Bearer", stored); Assert.DoesNotContain("header-only-private-value", stored);
        Assert.DoesNotContain(f.Options.ApiKey, stored);
    }

    [Theory]
    [InlineData(400)]
    [InlineData(401)]
    [InlineData(429)]
    [InlineData(500)]
    public async Task HttpErrorsPreserveStatusAndBodyForProviderWithoutCapturingEither(int status)
    {
        var f = new Fixture(); f.Wire.Status = status;
        f.Wire.Output = "{\"error\":{\"code\":\"invalid_json_schema\",\"param\":\"text.format.schema\",\"message\":\"synthetic-key-do-not-retain\"}}";
        using var response = await f.Send();
        Assert.Equal(f.Wire.Output, await response.Content.ReadAsStringAsync());
        Assert.Equal(status, (int)response.StatusCode);
        Assert.Equal(Request, f.Wire.Request); Assert.Equal(1, f.Wire.Calls);
        Assert.Empty(f.Saved); Assert.Equal(0, f.SaveCalls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task TransportAndCancellationPropagateOriginalExceptionWithoutCaptureWrites(bool cancel)
    {
        var f = new Fixture();
        var error = cancel ? (Exception)new OperationCanceledException("private-exception") : new HttpRequestException("private-exception");
        f.Wire.Error = error;
        var caught = await Record.ExceptionAsync(() => f.Send());
        Assert.Same(error, caught); Assert.Equal(1, f.Wire.Calls);
        Assert.Equal(Request, f.Wire.Request); Assert.Empty(f.Saved); Assert.Equal(0, f.SaveCalls);
        Assert.DoesNotContain("private-exception", JsonSerializer.Serialize(f.Saved));
    }

    [Fact]
    public async Task RetiredDiagnosticStoreIsNotInvokedAndCannotFailOrRetryGeneration()
    {
        var f = new Fixture(); f.SaveError = true;
        using var response = await f.Send();
        Assert.Equal(Response, await response.Content.ReadAsStringAsync()); Assert.Equal(1, f.Wire.Calls);
        Assert.Equal(0, f.SaveCalls); Assert.Empty(f.Saved);
    }

    [Fact]
    public async Task InitialRepairAndConcurrentScopesForwardTheirOwnBodiesWithoutCapturingAttempts()
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
        Assert.Equal(Response, await one.Content.ReadAsStringAsync());
        Assert.Equal("repaired-output", await two.Content.ReadAsStringAsync());
        Assert.Equal("other-scope-response", await otherResponse.Content.ReadAsStringAsync());
        Assert.Equal(2, first.Wire.Calls); Assert.Equal(1, other.Wire.Calls);
        Assert.Empty(first.Saved); Assert.Empty(other.Saved);
        Assert.Equal(0, first.SaveCalls); Assert.Equal(0, other.SaveCalls);
    }

    [Fact]
    public void RegistrationKeepsWireClientScopedAndIgnoresLegacyCaptureEnableSetting()
    {
        Assert.False(new SleepAiOptions().FullRequestCaptureEnabled);
        var services = new ServiceCollection(); services.AddLogging(); services.AddSingleton<TimeProvider>(TimeProvider.System);
        services.AddSleepAi(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["SleepAi:Enabled"] = "true", ["SleepAi:ChildDataProcessingApproved"] = "true",
            ["SleepAi:ZeroDataRetentionApproved"] = "true", ["SleepAi:HardSpendControlVerified"] = "true",
            ["SleepAi:ApiKey"] = "synthetic-never-used", ["SleepAi:FullRequestCaptureEnabled"] = "true"
        }).Build());
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
        using var first = provider.CreateScope(); using var second = provider.CreateScope();
        Assert.NotSame(first.ServiceProvider.GetRequiredService<SleepAiExchangeCapture>(), second.ServiceProvider.GetRequiredService<SleepAiExchangeCapture>());
        Assert.NotSame(first.ServiceProvider.GetRequiredService<IChatClient>(), second.ServiceProvider.GetRequiredService<IChatClient>());
        Assert.Same(first.ServiceProvider.GetRequiredService<IChatClient>(), first.ServiceProvider.GetRequiredService<IChatClient>());
        Assert.False(first.ServiceProvider.GetRequiredService<IOptions<SleepAiOptions>>().Value.FullRequestCaptureEnabled);
    }

    [Fact]
    public void ReleaseConfigurationDisablesFullCaptureWithoutChangingAiQuotasOrModel()
    {
        var config = new ConfigurationBuilder().SetBasePath(AppContext.BaseDirectory).AddJsonFile("appsettings.json").Build();
        var value = config.GetSection("SleepAi").Get<SleepAiOptions>()!;
        Assert.False(value.FullRequestCaptureEnabled);
        Assert.Equal(30, value.MaxRequestsPerAccountPerHour);
        Assert.Equal(50, value.MaxConcurrentRequests);
        Assert.Equal(200, value.MaxRequestsPerInstancePerDay);
        Assert.Equal("gpt-6-luna", value.Model);
        Assert.False(value.Enabled); // Existing deployment gates are not bypassed.
    }

    [Fact]
    public async Task ActualSdkRequestAndErrorResponseRemainUsableWithoutDiagnosticRetention()
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
        Assert.Equal(1, f.Wire.Calls); Assert.Empty(f.Saved); Assert.Equal(0, f.SaveCalls);
        var wireRequest = Assert.IsType<string>(f.Wire.Request);
        using var body = JsonDocument.Parse(wireRequest);
        Assert.Equal(SleepAiOptions.SelectedModel, body.RootElement.GetProperty("model").GetString());
        Assert.False(body.RootElement.GetProperty("store").GetBoolean());
        Assert.Equal("sleep_prediction_remaining_day_v3", body.RootElement.GetProperty("text").GetProperty("format").GetProperty("name").GetString());
        Assert.DoesNotContain(f.Options.ApiKey, wireRequest);
    }

    [Fact]
    public async Task UnknownLengthChunkedResponseRemainsReadableWithoutCapture()
    {
        var f = new Fixture(); f.Wire.UnknownLength = true;
        using var response = await f.Send();
        Assert.Equal(Response, await response.Content.ReadAsStringAsync());
        Assert.Empty(f.Saved); Assert.Equal(0, f.SaveCalls);
    }

    [Fact]
    public async Task UnreadableResponseIsNotEagerlyBufferedBeforeTheCallerReadsIt()
    {
        var f = new Fixture(); f.Wire.Unreadable = true;
        using var response = await f.Send(HttpCompletionOption.ResponseHeadersRead);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var content = Assert.IsType<BrokenContent>(response.Content);
        Assert.Equal(0, content.Reads);
        await Assert.ThrowsAsync<HttpRequestException>(() => response.Content.ReadAsStringAsync());
        Assert.Equal(1, content.Reads); Assert.Empty(f.Saved); Assert.Equal(0, f.SaveCalls);
        Assert.DoesNotContain("private-read-error", JsonSerializer.Serialize(f.Saved));
    }

    [Fact]
    public async Task LargeUtf8ResponseAndSensitiveHeaderAreNotCopiedIntoCapture()
    {
        var f = new Fixture(); f.Wire.RequestId = f.Options.ApiKey;
        f.Wire.Output = new string('x', SleepAiExchangeCapture.MaxBodyBytes - 1) + "🌙";
        using var response = await f.Send();
        Assert.Equal(f.Wire.Output, await response.Content.ReadAsStringAsync());
        Assert.Equal(f.Options.ApiKey, Assert.Single(response.Headers.GetValues("x-request-id")));
        Assert.Empty(f.Saved); Assert.Equal(0, f.SaveCalls);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    [InlineData(1)]
    public async Task ResponseAroundLegacyCaptureSizeLimitIsForwardedWithoutTruncationOrRetention(int extra)
    {
        var f = new Fixture(); f.Wire.Output = new('x', SleepAiExchangeCapture.MaxBodyBytes + extra);
        using var response = await f.Send();
        Assert.Equal(f.Wire.Output, await response.Content.ReadAsStringAsync());
        Assert.Empty(f.Saved); Assert.Equal(0, f.SaveCalls);
    }

    [Fact]
    public async Task RetiredExchangeStoreReturnsFalseWithoutADatabaseProviderOrTransaction()
    {
        // Deliberately no EF provider: a query or transaction would fail this test.
        await using var db = new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>().Options);
        var scenario = new Scenario(new SqlFixture()); var clock = new TraceClock();
        var options = SleepAiJobTests.Enabled(); options.FullRequestCaptureEnabled = true;
        var store = new SleepAiJobStore(db, new FamilyService(db, scenario.Config, clock),
            new(new ConfigurationBuilder().Build()), clock, Options.Create(options));
        var claim = new SleepAiJobClaim(scenario.Owner.ObjectId, Guid.NewGuid(), Guid.NewGuid(),
            SleepAiJobTests.Request(clock.Now).Request) { ExchangeCaptureHistoryEpoch = scenario.Config.Family.HistoryId };
        var exchange = new SleepAiExchange(1, 2, clock.Now, null, Request, Response, Request.Length,
            Response.Length, false, false, 200, "synthetic-provider-id", "response_received", 200);
        Assert.False(await store.StoreExchange(claim, exchange, default));
    }

    private sealed class Fixture
    {
        public TraceClock Clock { get; } = new();
        public SleepAiOptions Options { get; } = new() { ApiKey = "synthetic-key-do-not-retain" };
        public List<SleepAiExchange> Saved { get; } = [];
        public Wire Wire { get; } = new();
        public SleepAiExchangeCapture Capture { get; }
        public bool SaveError { get; set; }
        public int SaveCalls { get; private set; }
        public Fixture(bool enabled = true, bool stamped = true)
        {
            Options.FullRequestCaptureEnabled = enabled;
            Capture = new(Microsoft.Extensions.Options.Options.Create(Options), Clock);
            Capture.Start(new(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), SleepAiJobTests.Request(Clock.Now).Request)
                { ExchangeCaptureHistoryEpoch = stamped ? Epoch : null }, (value, ct) =>
                { SaveCalls++; if (SaveError) throw new InvalidOperationException("private-store-error"); Saved.Add(value); return Task.FromResult(true); });
            Capture.BeginAttempt(1, 3);
        }
        public async Task<HttpResponseMessage> Send(HttpCompletionOption completion = HttpCompletionOption.ResponseContentRead)
        {
            using var http = new HttpClient(new SleepAiCaptureHandler(Capture, Clock, Wire));
            using var request = new HttpRequestMessage(HttpMethod.Post, "https://example.invalid/v1/responses")
                { Content = new StringContent(Request, Encoding.UTF8, "application/json") };
            request.Headers.Authorization = new("Bearer", Options.ApiKey);
            request.Headers.Add("private-header", "header-only-private-value");
            return await http.SendAsync(request, completion);
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
        public int Reads { get; private set; }
        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context)
        { Reads++; throw new IOException("private-read-error"); }
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
