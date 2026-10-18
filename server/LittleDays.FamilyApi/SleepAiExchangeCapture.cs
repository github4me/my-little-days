using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi;

// Restricted provider-wire evidence, separate from application logs and public
// prediction responses. Release configuration explicitly enables capture;
// no credentials/headers are copied.
public sealed record SleepAiExchange(int Attempt, int SchemaVersion, DateTimeOffset StartedAt,
    DateTimeOffset? FinishedAt, string RequestBody, string? ResponseBody,
    long RequestBytes, long ResponseBytes, bool RequestTruncated, bool ResponseTruncated,
    int? HttpStatus, string? ProviderRequestId, string Outcome, double DurationMs)
{
    public DateTimeOffset ExpiresAt => StartedAt.AddDays(7);
}

public sealed class SleepAiExchangeCapture(IOptions<SleepAiOptions> options, TimeProvider clock,
    ILogger<SleepAiExchangeCapture>? logger = null)
{
    public const int MaxBodyBytes = 1024 * 1024;
    private Func<SleepAiExchange, CancellationToken, Task<bool>>? persist;
    private int attempt, schemaVersion;

    internal void Start(SleepAiJobClaim claim, Func<SleepAiExchange, CancellationToken, Task<bool>> save)
    {
        persist = options.Value.FullRequestCaptureEnabled && claim.ExchangeCaptureHistoryEpoch is { } epoch &&
            epoch != Guid.Empty ? save : null;
        attempt = 0;
    }

    internal void BeginAttempt(int attemptNumber, int version)
    { attempt = attemptNumber; schemaVersion = version; }

    internal bool Enabled => persist is not null && attempt is 1 or 2;

    internal SleepAiExchange Create(byte[] request)
    {
        var body = Body(request);
        return new(attempt, schemaVersion, clock.GetUtcNow(), null, body.Text, null,
            request.LongLength, 0, body.Truncated, false, null, null, "dispatching", 0);
    }

    internal SleepAiExchange Finish(SleepAiExchange exchange, byte[]? response, int? status,
        string? requestId, string outcome, long started)
    {
        var body = response is null ? (Text: (string?)null, Truncated: false) : Body(response);
        return exchange with
        {
            FinishedAt = clock.GetUtcNow(), ResponseBody = body.Text, ResponseBytes = response?.LongLength ?? 0,
            ResponseTruncated = body.Truncated, HttpStatus = status,
            ProviderRequestId = requestId is { Length: > 0 and <= 200 } &&
                (string.IsNullOrEmpty(options.Value.ApiKey) || !requestId.Contains(options.Value.ApiKey, StringComparison.Ordinal)) &&
                Regex.IsMatch(requestId, @"\A[a-zA-Z0-9_.:-]+\z") ? requestId : null,
            Outcome = outcome, DurationMs = Math.Max(0, clock.GetElapsedTime(started).TotalMilliseconds)
        };
    }

    private (string Text, bool Truncated) Body(byte[] bytes)
    {
        var length = Math.Min(bytes.Length, MaxBodyBytes);
        // Trim only an incomplete UTF-8 sequence at the retained prefix boundary.
        var text = Encoding.UTF8.GetString(bytes, 0, length);
        if (length < bytes.Length) text = text.TrimEnd('\uFFFD');
        var key = options.Value.ApiKey;
        if (!string.IsNullOrEmpty(key)) text = text.Replace(key, "[REDACTED_API_KEY]", StringComparison.Ordinal);
        var expanded = text.Length > MaxBodyBytes;
        if (expanded) text = text[..(char.IsHighSurrogate(text[MaxBodyBytes - 1]) ? MaxBodyBytes - 1 : MaxBodyBytes)];
        return (text, bytes.Length > length || expanded);
    }

    internal async Task Save(SleepAiExchange exchange, CancellationToken ct)
    {
        if (persist is null) return;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        try { if (!await persist(exchange, timeout.Token)) Gap(exchange.Attempt, "not_retained"); }
        catch (Exception e) when (e is not OutOfMemoryException and not StackOverflowException and not AccessViolationException)
        { Gap(exchange.Attempt, "storage_error"); }
    }

    private void Gap(int number, string reason)
    {
        try { logger?.LogWarning(new EventId(4101, "SleepAiCaptureGap"),
            "SleepAiCaptureGap Attempt={Attempt} Reason={Reason}", number, reason); }
        catch (Exception) { /* Observability must never break generation. */ }
    }
}

// The non-streaming SDK buffers these JSON bodies too. ReadAsByteArrayAsync
// caches content so the SDK receives exactly the same bytes after inspection.
// The retained diagnostic prefix is bounded; oversized bodies carry their
// original byte count and explicit truncation, never a false completeness claim.
internal sealed class SleepAiCaptureHandler(SleepAiExchangeCapture capture, TimeProvider clock,
    HttpMessageHandler inner) : DelegatingHandler(inner)
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        if (!capture.Enabled) return await base.SendAsync(request, ct);
        var requestBody = await Read(request.Content, ct);
        var exchange = capture.Create(requestBody.Bytes);
        if (requestBody.Unavailable) exchange = exchange with { RequestTruncated = true, RequestBytes = request.Content?.Headers.ContentLength ?? -1 };
        await capture.Save(exchange, ct);
        var started = clock.GetTimestamp();
        try
        {
            var response = await base.SendAsync(request, ct);
            var responseBody = await Read(response.Content, ct);
            var id = response.Headers.TryGetValues("x-request-id", out var values) ? values.FirstOrDefault() : null;
            exchange = capture.Finish(exchange, responseBody.Bytes, (int)response.StatusCode, id,
                response.IsSuccessStatusCode ? "response_received" : "http_error", started);
            if (responseBody.Unavailable) exchange = exchange with { ResponseBody = null, ResponseTruncated = true,
                ResponseBytes = response.Content.Headers.ContentLength ?? -1, Outcome = "response_read_failed" };
            await capture.Save(exchange, ct);
            return response;
        }
        catch (Exception error)
        {
            exchange = capture.Finish(exchange, null, null, null,
                error is OperationCanceledException ? "cancelled" : "transport_error", started);
            // A cancelled HTTP token must not suppress the diagnostic receipt.
            using var receiptTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await capture.Save(exchange, receiptTimeout.Token);
            throw;
        }
    }

    private static async Task<(byte[] Bytes, bool Unavailable)> Read(HttpContent? content, CancellationToken ct)
    {
        if (content is null) return ([], false);
        try { return (await content.ReadAsByteArrayAsync(ct), false); }
        catch (Exception e) when (e is not OutOfMemoryException and not StackOverflowException and not AccessViolationException)
        { return ([], true); }
    }
}

// DI owns this client for one worker scope. The factory pools only the inner
// transport; payload capture state never crosses accounts or worker scopes.
internal sealed class SleepAiProviderHttpClient : IDisposable
{
    public HttpClient Client { get; }
    public SleepAiProviderHttpClient(SleepAiExchangeCapture capture, TimeProvider clock, IHttpMessageHandlerFactory factory)
    { Client = new(new SleepAiCaptureHandler(capture, clock, factory.CreateHandler("SleepAiProviderWire"))); }
    public void Dispose() => Client.Dispose();
}
