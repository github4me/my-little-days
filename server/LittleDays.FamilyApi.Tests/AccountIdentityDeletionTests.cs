using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace LittleDays.FamilyApi.Tests;

public sealed class AccountIdentityDeletionTests
{
    private readonly Guid userId = Guid.NewGuid();
    private readonly Guid tenantId = Guid.NewGuid();
    private readonly Guid clientId = Guid.NewGuid();

    [Fact]
    public async Task DeletesOnlyExactAdmittedUserThenPermanentlyPurgesDirectoryObject()
    {
        using var handler = new ScriptedHandler(HttpStatusCode.NoContent, HttpStatusCode.NoContent);
        using var http = new HttpClient(handler);
        await Provider(http).DeleteIdentityAsync(userId, default);
        Assert.Equal(new[]
        {
            $"POST https://login.microsoftonline.com/{tenantId:D}/oauth2/v2.0/token",
            $"DELETE https://graph.microsoft.com/v1.0/users/{userId:D}",
            $"DELETE https://graph.microsoft.com/v1.0/directory/deletedItems/{userId:D}"
        }, handler.Requests);
        Assert.Equal(2, handler.BearerCount);
        Assert.Contains("grant_type=client_credentials", handler.TokenBody);
        Assert.Contains($"client_id={clientId:D}", handler.TokenBody);
    }

    [Fact]
    public async Task RetryAfterLostResponseConfirmsBothActiveAndDeletedIdentityAbsent()
    {
        using var handler = new ScriptedHandler(HttpStatusCode.NotFound, HttpStatusCode.NotFound,
            HttpStatusCode.NotFound, HttpStatusCode.NotFound);
        using var http = new HttpClient(handler);
        await Provider(http).DeleteIdentityAsync(userId, default);
        Assert.Equal(5, handler.Requests.Count);
        Assert.Contains($"GET https://graph.microsoft.com/v1.0/users/{userId:D}?$select=id", handler.Requests);
        Assert.Contains($"GET https://graph.microsoft.com/v1.0/directory/deletedItems/{userId:D}?$select=id", handler.Requests);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.Redirect)]
    public async Task FailedDirectoryDeletionNeverReportsCompletion(HttpStatusCode status)
    {
        using var handler = new ScriptedHandler(status);
        using var http = new HttpClient(handler);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Provider(http).DeleteIdentityAsync(userId, default));
        Assert.Equal("identity_deletion_pending", error.Message);
        Assert.Null(error.InnerException);
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task NewlySoftDeletedButNotYetVisibleIdentityStaysPending()
    {
        using var handler = new ScriptedHandler(HttpStatusCode.NoContent, HttpStatusCode.NotFound);
        using var http = new HttpClient(handler);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Provider(http).DeleteIdentityAsync(userId, default));
        Assert.Equal(3, handler.Requests.Count);
    }

    [Fact]
    public async Task ActiveOrRecoverableIdentityCannotBeMarkedDeleted()
    {
        using var handler = new ScriptedHandler(HttpStatusCode.NotFound, HttpStatusCode.NotFound,
            HttpStatusCode.NotFound, HttpStatusCode.OK);
        using var http = new HttpClient(handler);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Provider(http).DeleteIdentityAsync(userId, default));
    }

    [Fact]
    public async Task UnadmittedIdentityNeverMakesAnyNetworkRequest()
    {
        using var handler = new ScriptedHandler();
        using var http = new HttpClient(handler);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Provider(http).DeleteIdentityAsync(Guid.NewGuid(), default));
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task DirectServerSettingsConfigureDeletionWithoutKeyVault()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AccountDeletion:GraphClientId"] = clientId.ToString(),
            ["AccountDeletion:GraphClientSecret"] = "fixture-only-not-a-real-secret"
        }).Build();
        var pilot = new PilotConfiguration(new() { TenantId = tenantId }, new(), new()
        {
            Identities = [new() { ObjectId = userId }]
        });
        var services = new ServiceCollection();
        services.AddAccountIdentityDeletion(configuration, pilot);
        using var handler = new ScriptedHandler(HttpStatusCode.NoContent, HttpStatusCode.NoContent);
        services.AddHttpClient(nameof(IAccountIdentityDeletion))
            .ConfigurePrimaryHttpMessageHandler(() => handler);
        using var provider = services.BuildServiceProvider();

        await provider.GetRequiredService<IAccountIdentityDeletion>().DeleteIdentityAsync(userId, default);

        Assert.Equal(3, handler.Requests.Count);
        Assert.Contains($"client_id={clientId:D}", handler.TokenBody);
        Assert.Contains("client_secret=fixture-only-not-a-real-secret", handler.TokenBody);
        Assert.EndsWith($"DELETE https://graph.microsoft.com/v1.0/directory/deletedItems/{userId:D}", handler.Requests[^1]);
    }

    [Fact]
    public async Task MissingDirectoryConfigurationFailsClosed()
    {
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            new UnconfiguredAccountIdentityDeletion().DeleteIdentityAsync(userId, default));
        var services = new ServiceCollection();
        var pilot = new PilotConfiguration(new() { TenantId = tenantId }, new(), new());
        var unresolvedSecret = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["AccountDeletion:GraphClientId"] = clientId.ToString(),
            ["AccountDeletion:GraphClientSecret"] = "@Microsoft.KeyVault(SecretUri=https://example.invalid/secret)"
        }).Build();
        Assert.Throws<InvalidOperationException>(() => services.AddAccountIdentityDeletion(unresolvedSecret, pilot));
    }

    private GraphAccountIdentityDeletion Provider(HttpClient http) =>
        new(http, new(tenantId, clientId, "fixture-only-not-a-real-secret", new HashSet<Guid> { userId }));

    private sealed class ScriptedHandler(params HttpStatusCode[] responses) : HttpMessageHandler
    {
        private readonly Queue<HttpStatusCode> statuses = new(responses);
        public List<string> Requests { get; } = [];
        public string TokenBody { get; private set; } = "";
        public int BearerCount { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add($"{request.Method} {request.RequestUri!.AbsoluteUri}");
            if (request.Method == HttpMethod.Post)
            {
                TokenBody = await request.Content!.ReadAsStringAsync(ct);
                Assert.Null(request.Headers.Authorization);
                return new(HttpStatusCode.OK)
                {
                    Content = new StringContent("{\"token_type\":\"Bearer\",\"access_token\":\"fixture-token\"}", Encoding.UTF8, "application/json")
                };
            }
            Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
            Assert.Equal("fixture-token", request.Headers.Authorization.Parameter);
            BearerCount++;
            return new(statuses.Dequeue());
        }
    }
}
