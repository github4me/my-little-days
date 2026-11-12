using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi;

// Legacy shape retained for compatibility and bounded cleanup of existing rows.
// This version never captures or persists new provider request/response bodies.
public sealed record SleepAiExchange(int Attempt, int SchemaVersion, DateTimeOffset StartedAt,
    DateTimeOffset? FinishedAt, string RequestBody, string? ResponseBody,
    long RequestBytes, long ResponseBytes, bool RequestTruncated, bool ResponseTruncated,
    int? HttpStatus, string? ProviderRequestId, string Outcome, double DurationMs)
{
    public DateTimeOffset ExpiresAt => StartedAt.AddDays(7);
}

public sealed class SleepAiExchangeCapture
{
    public const int MaxBodyBytes = 1024 * 1024;
    public SleepAiExchangeCapture(IOptions<SleepAiOptions> options, TimeProvider clock,
        ILogger<SleepAiExchangeCapture>? logger = null) { }

    internal void Start(SleepAiJobClaim claim, Func<SleepAiExchange, CancellationToken, Task<bool>> save) { }
    internal void BeginAttempt(int attemptNumber, int version) { }
    internal bool Enabled => false;
}

// Source-compatible pass-through: no eager reads, snapshots, extra awaits or
// receipt writes. Only the provider SDK consumes the HTTP response body.
internal sealed class SleepAiCaptureHandler : DelegatingHandler
{
    public SleepAiCaptureHandler(SleepAiExchangeCapture capture, TimeProvider clock,
        HttpMessageHandler inner) : base(inner) { }
}

// DI owns this client for one worker scope; the factory pools the transport.
internal sealed class SleepAiProviderHttpClient : IDisposable
{
    public HttpClient Client { get; }
    public SleepAiProviderHttpClient(IHttpMessageHandlerFactory factory)
    { Client = new(factory.CreateHandler("SleepAiProviderWire"), disposeHandler: false); }
    public void Dispose() => Client.Dispose();
}
