using System.Net;
using System.Text.Json;
using Microsoft.Identity.Client;

namespace LittleDays.FamilyApi;

// This credential represents the server application, not a user or membership.
// Neither this provider nor MSAL stores directory results or authorization state.
public interface IGraphAdmissionTokenProvider
{
    Task<string> GetAsync(CancellationToken ct);
    void Reject(string token);
}

public sealed class GraphApplicationToken(string value, DateTimeOffset expiresAt)
{
    public string Value { get; } = value;
    public DateTimeOffset ExpiresAt { get; } = expiresAt;
    public override string ToString() => "[Graph application token redacted]";
}

public interface IGraphApplicationTokenSource
{
    Task<GraphApplicationToken> AcquireAsync(bool forceRefresh, CancellationToken ct);
}

public sealed class MsalGraphApplicationTokenSource : IGraphApplicationTokenSource
{
    private readonly IConfidentialClientApplication application;
    public MsalGraphApplicationTokenSource(PilotConfiguration config, HttpClient http)
    {
        // One immutable tenant/client/Graph-scope binding per singleton. No cache
        // serialization, distributed cache, logging callback or user token cache.
        application = ConfidentialClientApplicationBuilder.Create(config.Admission.GraphClientId.ToString("D"))
            .WithAuthority(AzureCloudInstance.AzurePublic, config.Entra.TenantId.ToString("D"))
            .WithClientSecret(config.Admission.GraphClientSecret)
            .WithHttpClientFactory(new TokenHttpClientFactory(http))
            .Build();
    }

    public async Task<GraphApplicationToken> AcquireAsync(bool forceRefresh, CancellationToken ct)
    {
        var result = await application.AcquireTokenForClient(["https://graph.microsoft.com/.default"])
            .WithForceRefresh(forceRefresh).ExecuteAsync(ct);
        return new(result.AccessToken, result.ExpiresOn);
    }

    private sealed class TokenHttpClientFactory(HttpClient http) : IMsalHttpClientFactory
    {
        public HttpClient GetHttpClient() => http;
    }
}

// MSAL owns the application token cache. This wrapper coordinates refreshes and
// prevents a known-rejected/expired token from becoming a fallback after failure.
public sealed class CachedGraphAdmissionTokens(IGraphApplicationTokenSource source, TimeProvider clock,
    TimeSpan? acquisitionTimeout = null) : IGraphAdmissionTokenProvider
{
    private readonly object gate = new();
    private readonly TimeSpan timeout = acquisitionTimeout ?? TimeSpan.FromSeconds(15);
    private Task<string>? pending;
    private string? lastReturned;
    private bool forceRefresh;
    private long generation;

    public Task<string> GetAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        TaskCompletionSource<string>? start = null;
        Task<string> result;
        lock (gate)
        {
            if (pending is null)
            {
                start = new(TaskCreationOptions.RunContinuationsAsynchronously);
                pending = start.Task;
            }
            result = pending;
        }
        if (start is not null) _ = Acquire(start);
        // One disconnected caller must not cancel another caller's shared work.
        // The underlying request has its own fixed, bounded deadline below.
        return result.WaitAsync(ct);
    }

    public void Reject(string token)
    {
        lock (gate)
        {
            // A late 401 for an older token must not evict a newer replacement.
            if (lastReturned != token) return;
            lastReturned = null;
            forceRefresh = true;
            generation++;
        }
    }

    private async Task Acquire(TaskCompletionSource<string> completion)
    {
        using var deadline = new CancellationTokenSource(timeout, clock);
        try
        {
            while (true)
            {
                long version;
                bool force;
                lock (gate) { version = generation; force = forceRefresh; }
                var result = await source.AcquireAsync(force, deadline.Token).WaitAsync(deadline.Token);
                deadline.Token.ThrowIfCancellationRequested();
                if (result.Value is not { Length: > 0 and <= 16384 } ||
                    result.ExpiresAt <= clock.GetUtcNow().AddMinutes(1))
                    throw new InvalidOperationException("Application token lifetime is unavailable.");
                lock (gate)
                {
                    // A concurrent Graph rejection may have invalidated the token
                    // while MSAL was returning it from cache. Never publish it.
                    if (version != generation) continue;
                    deadline.Token.ThrowIfCancellationRequested();
                    lastReturned = result.Value;
                    forceRefresh = false;
                    pending = null;
                    completion.TrySetResult(result.Value);
                    return;
                }
            }
        }
        catch (Exception)
        {
            lock (gate)
            {
                // Even if an SDK/HTTP implementation completes after timeout,
                // the next attempt cannot trust a late result in MSAL's cache.
                forceRefresh = true;
                lastReturned = null;
                pending = null;
                completion.TrySetException(new ApiException(503, "identity_unavailable"));
            }
        }
    }
}

// Compatibility fallback for direct callers without an injected token provider.
// The deployed Directory-mode service uses the singleton MSAL cache above,
// including when admission reuses the existing directory/deletion registration.
public sealed class UncachedGraphAdmissionTokens(HttpClient http, PilotConfiguration config) : IGraphAdmissionTokenProvider
{
    public void Reject(string token) { }
    public async Task<string> GetAsync(CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"https://login.microsoftonline.com/{config.Entra.TenantId:D}/oauth2/v2.0/token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = config.Admission.GraphClientId.ToString("D"),
                ["client_secret"] = config.Admission.GraphClientSecret,
                ["grant_type"] = "client_credentials",
                ["scope"] = "https://graph.microsoft.com/.default"
            })
        };
        using var response = await http.SendAsync(request, ct);
        if (response.StatusCode != HttpStatusCode.OK) throw new ApiException(503, "identity_unavailable");
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        if (!json.RootElement.TryGetProperty("token_type", out var type) ||
            !string.Equals(type.GetString(), "Bearer", StringComparison.OrdinalIgnoreCase) ||
            !json.RootElement.TryGetProperty("access_token", out var value) ||
            value.ValueKind != JsonValueKind.String || value.GetString() is not { Length: > 0 and <= 16384 } token)
            throw new ApiException(503, "identity_unavailable");
        return token;
    }
}
