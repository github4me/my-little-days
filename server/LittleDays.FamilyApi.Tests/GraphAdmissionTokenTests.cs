using System.Collections.Concurrent;
using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace LittleDays.FamilyApi.Tests;

public sealed class GraphAdmissionTokenTests
{
    private const string Issuer = "fixture.onmicrosoft.com";

    [Fact]
    public async Task ActualMsalCacheReusesApplicationTokenButRechecksEveryUser()
    {
        var config = Config();
        using var handler = new DirectoryHandler(config);
        using var http = new HttpClient(handler);
        var tokens = new CachedGraphAdmissionTokens(new MsalGraphApplicationTokenSource(config, http), TimeProvider.System);
        var service = new GraphPublicIdentityAdmission(http, config, tokens);
        var a = Guid.NewGuid(); var b = Guid.NewGuid();
        await service.AdmitAsync(Principal(config, a), default);
        await service.AdmitAsync(Principal(config, b), default);
        Assert.Equal(1, handler.TokenRequests);
        Assert.Equal(4, handler.GraphRequests);
        Assert.Equal(2, handler.ObjectIds.Count);
        Assert.Null(http.DefaultRequestHeaders.Authorization);
        // Disabling a user is observed even while the service token remains valid.
        handler.Enabled = false;
        var error = await Assert.ThrowsAsync<ApiException>(() => service.AdmitAsync(Principal(config, a), default));
        Assert.Equal("identity_not_supported", error.Code);
        Assert.Equal(1, handler.TokenRequests);
        Assert.Equal(5, handler.GraphRequests);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task Graph401RefreshesOnceAndRestartsBothFreshIdentityChecks(int rejectedGraphCall)
    {
        var config = Config();
        using var handler = new DirectoryHandler(config) { RejectGraphCall = rejectedGraphCall };
        using var http = new HttpClient(handler);
        var tokens = new CachedGraphAdmissionTokens(new MsalGraphApplicationTokenSource(config, http), TimeProvider.System);
        var identity = await new GraphPublicIdentityAdmission(http, config, tokens).AdmitAsync(Principal(config, Guid.NewGuid()), default);
        Assert.NotEqual(Guid.Empty, identity.ObjectId);
        Assert.Equal(2, handler.TokenRequests);
        Assert.Equal(rejectedGraphCall + 2, handler.GraphRequests);
        Assert.Null(http.DefaultRequestHeaders.Authorization);
    }

    [Fact]
    public async Task RepeatedGraph401StopsAfterOneRefreshAndInvalidatesRejectedReplacement()
    {
        var config = Config();
        using var handler = new DirectoryHandler(config) { RejectAllGraph = true };
        using var http = new HttpClient(handler);
        var tokens = new CachedGraphAdmissionTokens(new MsalGraphApplicationTokenSource(config, http), TimeProvider.System);
        var service = new GraphPublicIdentityAdmission(http, config, tokens);
        var error = await Assert.ThrowsAsync<ApiException>(() => service.AdmitAsync(Principal(config, Guid.NewGuid()), default));
        Assert.Equal("identity_unavailable", error.Code);
        Assert.Equal(2, handler.TokenRequests);
        Assert.Equal(2, handler.GraphRequests);
        handler.RejectAllGraph = false;
        await service.AdmitAsync(Principal(config, Guid.NewGuid()), default);
        Assert.Equal(3, handler.TokenRequests);
    }

    [Fact]
    public async Task CachedServiceTokenDoesNotCacheEmailUniqueness()
    {
        var config = Config();
        using var handler = new DirectoryHandler(config);
        using var http = new HttpClient(handler);
        var tokens = new CachedGraphAdmissionTokens(new MsalGraphApplicationTokenSource(config, http), TimeProvider.System);
        var service = new GraphPublicIdentityAdmission(http, config, tokens);
        var principal = Principal(config, Guid.NewGuid());
        await service.AdmitAsync(principal, default);
        handler.DuplicateEmail = true;
        Assert.Equal("identity_not_supported", (await Assert.ThrowsAsync<ApiException>(() => service.AdmitAsync(principal, default))).Code);
        Assert.Equal(1, handler.TokenRequests);
        Assert.Equal(4, handler.GraphRequests);
    }

    [Fact]
    public async Task MsalRefreshFailureCannotFallBackToPreviouslyRejectedCredential()
    {
        var config = Config();
        using var handler = new DirectoryHandler(config);
        using var http = new HttpClient(handler);
        var tokens = new CachedGraphAdmissionTokens(new MsalGraphApplicationTokenSource(config, http), TimeProvider.System);
        var service = new GraphPublicIdentityAdmission(http, config, tokens);
        var principal = Principal(config, Guid.NewGuid());
        await service.AdmitAsync(principal, default);
        handler.RejectAllGraph = true;
        handler.TokenFailure = true;
        var error = await Assert.ThrowsAsync<ApiException>(() => service.AdmitAsync(principal, default));
        Assert.Equal("identity_unavailable", error.Code);
        Assert.Equal(3, handler.GraphRequests); // Only the rejected old credential, no fallback.
        Assert.DoesNotContain("private", error.ToString());
        var attempts = handler.TokenRequests;
        handler.RejectAllGraph = false;
        handler.TokenFailure = false;
        await service.AdmitAsync(principal, default);
        Assert.Equal(attempts + 1, handler.TokenRequests);
        Assert.Equal(5, handler.GraphRequests);
    }

    [Fact]
    public async Task ConcurrentAdmissionsHaveOneTokenAcquisitionAndIndependentBearerRequests()
    {
        var config = Config();
        using var handler = new DirectoryHandler(config) { TokenBarrier = new(TaskCreationOptions.RunContinuationsAsynchronously) };
        using var http = new HttpClient(handler);
        var tokens = new CachedGraphAdmissionTokens(new MsalGraphApplicationTokenSource(config, http), TimeProvider.System);
        var service = new GraphPublicIdentityAdmission(http, config, tokens);
        var ids = Enumerable.Range(0, 12).Select(_ => Guid.NewGuid()).ToArray();
        var tasks = ids.Select(id => service.AdmitAsync(Principal(config, id), default)).ToArray();
        await handler.TokenEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(1, handler.TokenRequests);
        handler.TokenBarrier.SetResult();
        var identities = await Task.WhenAll(tasks);
        Assert.Equal(ids.Order(), identities.Select(x => x.ObjectId).Order());
        Assert.Equal(1, handler.TokenRequests);
        Assert.Equal(ids.Length * 2, handler.GraphRequests);
        Assert.Equal(ids.Length, handler.ObjectIds.Count);
        Assert.Null(http.DefaultRequestHeaders.Authorization);
    }

    [Fact]
    public async Task CancellingOneCallerDoesNotCancelAnotherSharedAcquisition()
    {
        var clock = new TestClock();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var source = new Source(async (_, ct) =>
        {
            entered.TrySetResult();
            await release.Task.WaitAsync(ct);
            return new("fixture-token", clock.GetUtcNow().AddHours(1));
        });
        var tokens = new CachedGraphAdmissionTokens(source, clock);
        using var cancel = new CancellationTokenSource();
        var first = tokens.GetAsync(cancel.Token);
        await entered.Task;
        var second = tokens.GetAsync(default);
        cancel.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        release.SetResult();
        Assert.Equal("fixture-token", await second);
        Assert.Single(source.Forces);
    }

    [Fact]
    public async Task AcquisitionHasItsOwnDeadlineAndNextCallDoesNotTrustLateCache()
    {
        var late = new TaskCompletionSource<GraphApplicationToken>(TaskCreationOptions.RunContinuationsAsynchronously);
        var source = new Source((_, _) => late.Task);
        var tokens = new CachedGraphAdmissionTokens(source, TimeProvider.System, TimeSpan.FromMilliseconds(50));
        Assert.Equal("identity_unavailable", (await Assert.ThrowsAsync<ApiException>(() => tokens.GetAsync(default))).Code);
        late.SetResult(new("late-token", DateTimeOffset.UtcNow.AddHours(1)));
        source.Work = (force, _) => Task.FromResult(new GraphApplicationToken(force ? "fresh-token" : "late-token", DateTimeOffset.UtcNow.AddHours(1)));
        Assert.Equal("fresh-token", await tokens.GetAsync(default));
        Assert.Equal([false, true], source.Forces.ToArray());
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    [InlineData(30)]
    [InlineData(60)]
    public async Task ExpiredOrNearExpiryTokenNeverEscapesProvider(int seconds)
    {
        var clock = new TestClock();
        var source = new Source((_, _) => Task.FromResult(new GraphApplicationToken("fixture-token", clock.GetUtcNow().AddSeconds(seconds))));
        var tokens = new CachedGraphAdmissionTokens(source, clock);
        Assert.Equal("identity_unavailable", (await Assert.ThrowsAsync<ApiException>(() => tokens.GetAsync(default))).Code);
        source.Work = (force, _) => Task.FromResult(new GraphApplicationToken(force ? "refreshed-token" : "wrong", clock.GetUtcNow().AddHours(1)));
        Assert.Equal("refreshed-token", await tokens.GetAsync(default));
        Assert.Equal([false, true], source.Forces.ToArray());
    }

    [Fact]
    public async Task FailedRefreshDoesNotFallBackToRejectedTokenOrExposePrivateErrors()
    {
        var clock = new TestClock();
        var source = new Source((_, _) => Task.FromResult(new GraphApplicationToken("old-token", clock.GetUtcNow().AddHours(1))));
        var tokens = new CachedGraphAdmissionTokens(source, clock);
        Assert.Equal("old-token", await tokens.GetAsync(default));
        tokens.Reject("old-token");
        source.Work = (_, _) => throw new InvalidOperationException("private-secret-or-user@example.test");
        var error = await Assert.ThrowsAsync<ApiException>(() => tokens.GetAsync(default));
        Assert.Equal("identity_unavailable", error.Code);
        Assert.DoesNotContain("private-secret", error.ToString());
        source.Work = (force, _) => Task.FromResult(new GraphApplicationToken(force ? "new-token" : "old-token", clock.GetUtcNow().AddHours(1)));
        Assert.Equal("new-token", await tokens.GetAsync(default));
        tokens.Reject("old-token"); // Late rejection cannot evict the replacement.
        source.Work = (force, _) => Task.FromResult(new GraphApplicationToken(force ? "wrong" : "new-token", clock.GetUtcNow().AddHours(1)));
        Assert.Equal("new-token", await tokens.GetAsync(default));
        Assert.Equal([false, true, true, false], source.Forces.ToArray());
    }

    [Fact]
    public async Task RejectionDuringCachedAcquisitionCannotReturnInvalidatedToken()
    {
        var clock = new TestClock();
        var source = new Source((_, _) => Task.FromResult(new GraphApplicationToken("old-token", clock.GetUtcNow().AddHours(1))));
        var tokens = new CachedGraphAdmissionTokens(source, clock);
        await tokens.GetAsync(default);
        var paused = new TaskCompletionSource<GraphApplicationToken>(TaskCreationOptions.RunContinuationsAsynchronously);
        source.Work = (force, _) => force
            ? Task.FromResult(new GraphApplicationToken("new-token", clock.GetUtcNow().AddHours(1))) : paused.Task;
        var request = tokens.GetAsync(default);
        tokens.Reject("old-token");
        paused.SetResult(new("old-token", clock.GetUtcNow().AddHours(1)));
        Assert.Equal("new-token", await request);
        Assert.Equal([false, false, true], source.Forces.ToArray());
    }

    [Theory]
    [InlineData(true, true)]
    [InlineData(false, true)]
    [InlineData(false, false)]
    public async Task ExistingSharedAndSeparateCredentialsUseOneCacheWithFreshAdmissionChecks(bool reuse, bool sameId)
    {
        var config = Config();
        var deletionId = sameId ? config.Admission.GraphClientId : Guid.NewGuid();
        var values = new Dictionary<string, string?>
        {
            ["Admission:Mode"] = "Directory",
            ["Admission:LocalAccountIssuer"] = Issuer,
            ["Admission:EmailOtpOnly"] = "true",
            ["Admission:UseAccountDeletionCredentials"] = reuse.ToString(),
            ["AccountDeletion:GraphClientId"] = deletionId.ToString(),
            ["AccountDeletion:GraphClientSecret"] = "synthetic-shared-secret"
        };
        if (!reuse)
        {
            values["Admission:GraphClientId"] = config.Admission.GraphClientId.ToString();
            values["Admission:GraphClientSecret"] = config.Admission.GraphClientSecret;
        }
        var settings = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        config = config with { Admission = PublicIdentitySettings.Load(settings) };
        using var handler = new DirectoryHandler(config);
        var services = new ServiceCollection().AddPublicIdentityAdmission(config);
        services.AddHttpClient("GraphAdmissionToken").ConfigurePrimaryHttpMessageHandler(() => handler);
        using var provider = services.BuildServiceProvider();
        var tokens = provider.GetRequiredService<IGraphAdmissionTokenProvider>();
        Assert.IsType<CachedGraphAdmissionTokens>(tokens);
        Assert.Same(tokens, provider.GetRequiredService<IGraphAdmissionTokenProvider>());
        if (reuse)
        {
            Assert.Equal(deletionId, config.Admission.GraphClientId);
            Assert.Equal("synthetic-shared-secret", config.Admission.GraphClientSecret);
        }
        using var http = new HttpClient(handler, disposeHandler: false);
        var admission = new GraphPublicIdentityAdmission(http, config, tokens);
        var principal = Principal(config, Guid.NewGuid());
        await admission.AdmitAsync(principal, default);
        await admission.AdmitAsync(principal, default);
        Assert.Equal(1, handler.TokenRequests);
        Assert.Equal(4, handler.GraphRequests);
        handler.Enabled = false;
        Assert.Equal("identity_not_supported", (await Assert.ThrowsAsync<ApiException>(() =>
            admission.AdmitAsync(principal, default))).Code);
        Assert.Equal(1, handler.TokenRequests);
        Assert.Equal(5, handler.GraphRequests);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("not-a-guid")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    [InlineData("5c645f8d-c0ad-4c85-b56b-52154f405c8f")]
    public void ExplicitAdmissionCredentialsDoNotRequireASecondRegistrationToEnableCaching(string? deletionId)
    {
        var config = Config();
        var settings = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Admission:Mode"] = "Directory",
            ["Admission:LocalAccountIssuer"] = Issuer,
            ["Admission:EmailOtpOnly"] = "true",
            ["Admission:GraphClientId"] = config.Admission.GraphClientId.ToString(),
            ["Admission:GraphClientSecret"] = config.Admission.GraphClientSecret,
            ["AccountDeletion:GraphClientId"] = deletionId
        }).Build();
        config = config with { Admission = PublicIdentitySettings.Load(settings) };
        using var services = new ServiceCollection().AddPublicIdentityAdmission(config).BuildServiceProvider();
        var tokens = services.GetRequiredService<IGraphAdmissionTokenProvider>();
        Assert.IsType<CachedGraphAdmissionTokens>(tokens);
    }

    [Fact]
    public void StaticAdmissionDoesNotCreateAGraphTokenProvider()
    {
        var config = Config();
        config.Admission.Mode = "Static";
        using var services = new ServiceCollection().AddSingleton(config).AddPublicIdentityAdmission(config)
            .BuildServiceProvider();
        Assert.IsType<StaticPublicIdentityAdmission>(services.GetRequiredService<IPublicIdentityAdmission>());
        Assert.Null(services.GetService<IGraphAdmissionTokenProvider>());
    }

    private sealed class TestClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(2026, 9, 17, 0, 0, 0, TimeSpan.Zero);
    }

    private sealed class Source(Func<bool, CancellationToken, Task<GraphApplicationToken>> work) : IGraphApplicationTokenSource
    {
        public Func<bool, CancellationToken, Task<GraphApplicationToken>> Work { get; set; } = work;
        public ConcurrentQueue<bool> Forces { get; } = new();
        public Task<GraphApplicationToken> AcquireAsync(bool forceRefresh, CancellationToken ct)
        {
            Forces.Enqueue(forceRefresh);
            return Work(forceRefresh, ct);
        }
    }

    private static PilotConfiguration Config() => new(new() { TenantId = Guid.NewGuid() }, new(), new())
    {
        Admission = new() { Mode = "Directory", LocalAccountIssuer = Issuer, EmailOtpOnly = true,
            GraphClientId = Guid.NewGuid(), GraphClientSecret = "synthetic-test-secret" }
    };
    private static ClaimsPrincipal Principal(PilotConfiguration config, Guid id) => new(new ClaimsIdentity([
        new Claim("tid", config.Entra.TenantId.ToString()), new Claim("oid", id.ToString())], "fixture"));

    private sealed class DirectoryHandler(PilotConfiguration config) : HttpMessageHandler
    {
        private int tokenRequests;
        private int graphRequests;
        public int TokenRequests => tokenRequests;
        public int GraphRequests => graphRequests;
        public int RejectGraphCall { get; init; }
        public bool RejectAllGraph { get; set; }
        public bool Enabled { get; set; } = true;
        public bool DuplicateEmail { get; set; }
        public bool TokenFailure { get; set; }
        public TaskCompletionSource? TokenBarrier { get; init; }
        public TaskCompletionSource TokenEntered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public ConcurrentDictionary<Guid, bool> ObjectIds { get; } = new();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var uri = request.RequestUri!;
            if (uri.Host == "login.microsoftonline.com" || uri.Host == "login.windows.net")
            {
                Assert.Null(request.Headers.Authorization);
                if (uri.AbsolutePath.EndsWith("/token", StringComparison.Ordinal))
                {
                    var form = (await request.Content!.ReadAsStringAsync(ct)).Split('&')
                        .Select(part => part.Split('=', 2))
                        .ToDictionary(part => Uri.UnescapeDataString(part[0]), part => Uri.UnescapeDataString(part[1]));
                    Assert.Equal(config.Admission.GraphClientId.ToString("D"), form["client_id"]);
                    Assert.Equal(config.Admission.GraphClientSecret, form["client_secret"]);
                    Assert.Equal("https://graph.microsoft.com/.default", form["scope"]);
                    var count = Interlocked.Increment(ref tokenRequests);
                    TokenEntered.TrySetResult();
                    if (TokenBarrier is not null) await TokenBarrier.Task.WaitAsync(ct);
                    if (TokenFailure) return new(HttpStatusCode.BadRequest)
                    { Content = new StringContent("{\"error\":\"invalid_client\",\"error_description\":\"private fixture secret\"}") };
                    return Json(new { token_type = "Bearer", access_token = $"fixture-token-{count}", expires_in = 3600, ext_expires_in = 3600 });
                }
                if (uri.AbsolutePath.Contains("discovery/instance", StringComparison.Ordinal))
                    return Json(new { tenant_discovery_endpoint = $"https://login.microsoftonline.com/{config.Entra.TenantId:D}/v2.0/.well-known/openid-configuration",
                        metadata = new[] { new { preferred_network = "login.microsoftonline.com", preferred_cache = "login.windows.net", aliases = new[] { "login.microsoftonline.com", "login.windows.net", "login.microsoft.com", "sts.windows.net" } } } });
                return Json(new { token_endpoint = $"https://login.microsoftonline.com/{config.Entra.TenantId:D}/oauth2/v2.0/token",
                    authorization_endpoint = $"https://login.microsoftonline.com/{config.Entra.TenantId:D}/oauth2/v2.0/authorize", issuer = $"https://login.microsoftonline.com/{config.Entra.TenantId:D}/v2.0" });
            }
            Assert.Equal("graph.microsoft.com", uri.Host);
            Assert.Equal(HttpMethod.Get, request.Method);
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.StartsWith("fixture-token-", request.Headers.Authorization?.Parameter);
            var graphCall = Interlocked.Increment(ref graphRequests);
            if (RejectAllGraph || graphCall == RejectGraphCall) return new(HttpStatusCode.Unauthorized);
            Guid id;
            var matches = uri.AbsolutePath == "/v1.0/users";
            if (matches)
            {
                var query = Uri.UnescapeDataString(uri.Query);
                var start = query.IndexOf("issuerAssignedId eq '", StringComparison.Ordinal) + "issuerAssignedId eq '".Length;
                id = Guid.Parse(query.Substring(start, 32));
            }
            else
            {
                id = Guid.Parse(uri.Segments[^1]);
                ObjectIds.TryAdd(id, true);
            }
            var account = new { id, accountEnabled = Enabled, creationType = "LocalAccount", displayName = "Synthetic member",
                identities = new[] { new { signInType = "emailAddress", issuer = Issuer, issuerAssignedId = $"{id:N}@example.test" } } };
            return matches ? Json(new { value = DuplicateEmail ? new[] { account, account } : [account] }) : Json(account);
        }
        private static HttpResponseMessage Json<T>(T value) => new(HttpStatusCode.OK)
        { Content = new StringContent(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json") };
    }
}
