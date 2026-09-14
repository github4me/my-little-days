using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace LittleDays.FamilyApi;

public interface IAccountIdentityDeletion
{
    // Completion means the directory identity is permanently absent, not merely disabled.
    Task DeleteIdentityAsync(Guid objectId, CancellationToken ct);
}

public static class AccountIdentityDeletionRegistration
{
    public static IServiceCollection AddAccountIdentityDeletion(this IServiceCollection services,
        IConfiguration configuration, PilotConfiguration pilot)
    {
        var clientId = configuration["AccountDeletion:GraphClientId"];
        var secret = configuration["AccountDeletion:GraphClientSecret"];
        if (string.IsNullOrWhiteSpace(clientId) && string.IsNullOrWhiteSpace(secret))
            return services.AddSingleton<IAccountIdentityDeletion, UnconfiguredAccountIdentityDeletion>();
        if (!Guid.TryParse(clientId, out var id) || id == Guid.Empty || string.IsNullOrWhiteSpace(secret) ||
            secret.StartsWith("@Microsoft.KeyVault(", StringComparison.Ordinal))
            throw new InvalidOperationException("Account deletion directory credentials are incomplete.");

        services.AddSingleton(new AccountDeletionDirectorySettings(pilot.Entra.TenantId, id, secret,
            pilot.Pilot.Identities.Select(x => x.ObjectId).ToHashSet()));
        services.AddHttpClient<IAccountIdentityDeletion, GraphAccountIdentityDeletion>(client =>
        {
            client.Timeout = TimeSpan.FromSeconds(20);
            client.MaxResponseContentBufferSize = 64 * 1024;
        }).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false
        }).RemoveAllLoggers();
        return services;
    }
}

public sealed class UnconfiguredAccountIdentityDeletion : IAccountIdentityDeletion
{
    public Task DeleteIdentityAsync(Guid objectId, CancellationToken ct) =>
        Task.FromException(new InvalidOperationException("identity_deletion_not_configured"));
}

// Server-only settings. Initial release uses restricted App Service settings; never serialize or log this object.
public sealed class AccountDeletionDirectorySettings(Guid tenantId, Guid clientId, string clientSecret,
    IReadOnlySet<Guid> admittedUsers)
{
    public Guid TenantId { get; } = tenantId;
    public Guid ClientId { get; } = clientId;
    public string ClientSecret { get; } = clientSecret;
    public IReadOnlySet<Guid> AdmittedUsers { get; } = admittedUsers;
}

public sealed class GraphAccountIdentityDeletion(HttpClient http, AccountDeletionDirectorySettings settings)
    : IAccountIdentityDeletion
{
    public async Task DeleteIdentityAsync(Guid objectId, CancellationToken ct)
    {
        // The controlled pilot can delete only a verified customer identity admitted to this app.
        // No endpoint, tenant, user principal name, or object ID comes from a deletion request body.
        if (objectId == Guid.Empty || !settings.AdmittedUsers.Contains(objectId) ||
            settings.TenantId == Guid.Empty || settings.ClientId == Guid.Empty)
            throw new InvalidOperationException("identity_deletion_not_admitted");
        try
        {
            var token = await Token(ct);
            var active = await Send(HttpMethod.Delete, $"users/{objectId:D}", token, ct);
            RequireDeletedOrMissing(active);
            var deleted = await Send(HttpMethod.Delete, $"directory/deletedItems/{objectId:D}", token, ct);
            RequireDeletedOrMissing(deleted);
            if (deleted == HttpStatusCode.NoContent) return;

            // A newly deleted user can take time to become visible in deletedItems. Keep the
            // durable job pending instead of mistaking that transient 404 for permanent deletion.
            if (active == HttpStatusCode.NoContent)
                throw new InvalidOperationException("identity_deletion_pending");
            if (await Send(HttpMethod.Get, $"users/{objectId:D}?$select=id", token, ct) != HttpStatusCode.NotFound ||
                await Send(HttpMethod.Get, $"directory/deletedItems/{objectId:D}?$select=id", token, ct) != HttpStatusCode.NotFound)
                throw new InvalidOperationException("identity_deletion_pending");
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception)
        {
            // OAuth/Graph errors may contain credentials, identifiers or private tenant details.
            // The durable worker reports a generic failure and retries; never mark success here.
            throw new InvalidOperationException("identity_deletion_pending");
        }
    }

    private async Task<string> Token(CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"https://login.microsoftonline.com/{settings.TenantId:D}/oauth2/v2.0/token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = settings.ClientId.ToString("D"),
                ["client_secret"] = settings.ClientSecret,
                ["grant_type"] = "client_credentials",
                ["scope"] = "https://graph.microsoft.com/.default"
            })
        };
        using var response = await http.SendAsync(request, ct);
        if (response.StatusCode != HttpStatusCode.OK)
            throw new InvalidOperationException("identity_deletion_pending");
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        if (!json.RootElement.TryGetProperty("token_type", out var type) ||
            !string.Equals(type.GetString(), "Bearer", StringComparison.OrdinalIgnoreCase) ||
            !json.RootElement.TryGetProperty("access_token", out var value) ||
            value.GetString() is not { Length: > 0 and <= 16384 } token)
            throw new InvalidOperationException("identity_deletion_pending");
        return token;
    }

    private async Task<HttpStatusCode> Send(HttpMethod method, string relative, string token, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, $"https://graph.microsoft.com/v1.0/{relative}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await http.SendAsync(request, ct);
        return response.StatusCode;
    }

    private static void RequireDeletedOrMissing(HttpStatusCode status)
    {
        if (status is not (HttpStatusCode.NoContent or HttpStatusCode.NotFound))
            throw new InvalidOperationException("identity_deletion_pending");
    }
}
