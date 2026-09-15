using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LittleDays.FamilyApi;

public sealed class PublicIdentitySettings
{
    public string Mode { get; set; } = "Directory";
    public string LocalAccountIssuer { get; set; } = "";
    // Deployment contract: the mobile application's linked user flow must use email OTP only.
    // Graph's emailAddress identity describes a login name, not a per-session OTP claim.
    public bool EmailOtpOnly { get; set; }
    public bool UseAccountDeletionCredentials { get; set; }
    public Guid GraphClientId { get; set; }
    public string GraphClientSecret { get; set; } = "";

    public static PublicIdentitySettings Load(IConfiguration configuration)
    {
        var settings = configuration.GetSection("Admission").Get<PublicIdentitySettings>() ?? new();
        if (settings.Mode is not ("Directory" or "Static"))
            throw new InvalidOperationException("Admission:Mode must be Directory or Static.");
        if (settings.Mode == "Static") return settings;
        settings.LocalAccountIssuer = settings.LocalAccountIssuer.Trim().ToLowerInvariant();
        if (!Regex.IsMatch(settings.LocalAccountIssuer, @"\A[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.onmicrosoft\.com\z") ||
            !settings.EmailOtpOnly)
            throw new InvalidOperationException("Directory admission requires the customer tenant's default issuer and an email-OTP-only user flow.");
        if (settings.UseAccountDeletionCredentials)
        {
            if (settings.GraphClientId != Guid.Empty || settings.GraphClientSecret.Length != 0)
                throw new InvalidOperationException("Choose separate admission credentials or explicit deletion-credential reuse.");
            Guid.TryParse(configuration["AccountDeletion:GraphClientId"], out var clientId);
            settings.GraphClientId = clientId;
            settings.GraphClientSecret = configuration["AccountDeletion:GraphClientSecret"] ?? "";
        }
        if (settings.GraphClientId == Guid.Empty || string.IsNullOrWhiteSpace(settings.GraphClientSecret) ||
            settings.GraphClientSecret.StartsWith("@Microsoft.KeyVault(", StringComparison.Ordinal))
            throw new InvalidOperationException("Directory admission credentials are incomplete.");
        return settings;
    }
}

public interface IPublicIdentityAdmission
{
    Task<PilotIdentity> AdmitAsync(ClaimsPrincipal principal, CancellationToken ct);
}

public static class PublicIdentityAdmission
{
    private static readonly object ContextKey = new();
    public static void Set(HttpContext context, PilotIdentity identity) => context.Items[ContextKey] = identity;
    public static PilotIdentity Get(HttpContext context) => context.Items[ContextKey] as PilotIdentity
        ?? throw new ApiException(401, "unauthorized");

    public static IServiceCollection AddPublicIdentityAdmission(this IServiceCollection services,
        IConfiguration configuration, PilotConfiguration config)
    {
        if (config.Admission.Mode == "Static")
            return services.AddSingleton<IPublicIdentityAdmission, StaticPublicIdentityAdmission>();
        services.AddHttpClient<IPublicIdentityAdmission, GraphPublicIdentityAdmission>(client =>
        {
            client.Timeout = TimeSpan.FromSeconds(15);
            client.MaxResponseContentBufferSize = 64 * 1024;
        }).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false
        }).RemoveAllLoggers();
        return services;
    }

    public static Guid ObjectId(ClaimsPrincipal principal, Guid tenantId)
    {
        if (principal.Identity?.IsAuthenticated != true ||
            !Guid.TryParse(principal.FindFirstValue("tid"), out var tenant) || tenant != tenantId ||
            !Guid.TryParse(principal.FindFirstValue("oid"), out var objectId) || objectId == Guid.Empty)
            throw new ApiException(401, "unauthorized");
        return objectId;
    }
}

public sealed class StaticPublicIdentityAdmission(PilotConfiguration config) : IPublicIdentityAdmission
{
    public Task<PilotIdentity> AdmitAsync(ClaimsPrincipal principal, CancellationToken ct)
    {
        PublicIdentityAdmission.ObjectId(principal, config.Entra.TenantId);
        return Task.FromResult(config.Admit(principal));
    }
}

public sealed class GraphPublicIdentityAdmission(HttpClient http, PilotConfiguration config) : IPublicIdentityAdmission
{
    public async Task<PilotIdentity> AdmitAsync(ClaimsPrincipal principal, CancellationToken ct)
    {
        var objectId = PublicIdentityAdmission.ObjectId(principal, config.Entra.TenantId);
        if (config.Admission.Mode != "Directory" || !config.Admission.EmailOtpOnly)
            throw new ApiException(503, "identity_unavailable");
        try
        {
            var token = await Token(ct);
            using var user = await Get($"users/{objectId:D}?$select=id,accountEnabled,creationType,displayName,identities", token, ct);
            var identity = ParseLocalAccount(user.RootElement, objectId, config.Admission.LocalAccountIssuer);
            // Graph ignores the issuer in emailAddress filters. Revalidate the returned object,
            // require one exact match, and fail closed on pagination/ambiguous directory state.
            var filter = $"identities/any(i:i/issuerAssignedId eq '{identity.Email.Replace("'", "''")}' and i/issuer eq '{config.Admission.LocalAccountIssuer}')";
            using var matches = await Get($"users?$select=id,accountEnabled,creationType,displayName,identities&$top=2&$filter={Uri.EscapeDataString(filter)}", token, ct);
            if (matches.RootElement.TryGetProperty("@odata.nextLink", out _) ||
                !matches.RootElement.TryGetProperty("value", out var users) || users.ValueKind != JsonValueKind.Array || users.GetArrayLength() != 1)
                throw new ApiException(403, "identity_not_supported");
            var verified = ParseLocalAccount(users[0], objectId, config.Admission.LocalAccountIssuer);
            if (verified.Email != identity.Email) throw new ApiException(403, "identity_not_supported");
            return identity;
        }
        catch (ApiException) { throw; }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception)
        {
            // Graph/OAuth bodies can contain private identity and tenant information.
            throw new ApiException(503, "identity_unavailable");
        }
    }

    public static PilotIdentity ParseLocalAccount(JsonElement user, Guid objectId, string issuer)
    {
        if (user.ValueKind != JsonValueKind.Object ||
            !Guid.TryParse(String(user, "id"), out var id) || id != objectId || id == Guid.Empty ||
            !user.TryGetProperty("accountEnabled", out var enabled) || enabled.ValueKind != JsonValueKind.True ||
            String(user, "creationType") != "LocalAccount" ||
            !user.TryGetProperty("identities", out var identities) || identities.ValueKind != JsonValueKind.Array)
            throw new ApiException(403, "identity_not_supported");
        string? email = null;
        foreach (var identity in identities.EnumerateArray())
        {
            if (identity.ValueKind != JsonValueKind.Object) throw new ApiException(403, "identity_not_supported");
            var signInType = String(identity, "signInType");
            // Directory-generated UPNs are not mailbox proof; other login methods are unsupported.
            if (signInType == "userPrincipalName") continue;
            if (signInType != "emailAddress" || email is not null ||
                !string.Equals(String(identity, "issuer"), issuer, StringComparison.OrdinalIgnoreCase))
                throw new ApiException(403, "identity_not_supported");
            email = PilotConfiguration.NormalizeEmail(String(identity, "issuerAssignedId"));
            if (!PilotConfiguration.IsEmail(email)) throw new ApiException(403, "identity_not_supported");
        }
        if (email is null) throw new ApiException(403, "identity_not_supported");
        return new() { ObjectId = objectId, Email = email, DisplayName = DisplayName(String(user, "displayName")) };
    }

    private static string? String(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static string DisplayName(string? name)
    {
        var result = new StringBuilder();
        foreach (var rune in (name ?? "").EnumerateRunes())
        {
            if (Rune.GetUnicodeCategory(rune) is UnicodeCategory.Control or UnicodeCategory.Format or UnicodeCategory.Surrogate) continue;
            if (result.Length + rune.Utf16SequenceLength > 80) break;
            result.Append(rune.ToString());
        }
        var clean = result.ToString().Trim();
        return clean.Length == 0 ? "Family member" : clean;
    }

    private async Task<string> Token(CancellationToken ct)
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
        if (!string.Equals(String(json.RootElement, "token_type"), "Bearer", StringComparison.OrdinalIgnoreCase) ||
            String(json.RootElement, "access_token") is not { Length: > 0 and <= 16384 } token)
            throw new ApiException(503, "identity_unavailable");
        return token;
    }

    private async Task<JsonDocument> Get(string relative, string token, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"https://graph.microsoft.com/v1.0/{relative}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await http.SendAsync(request, ct);
        if (response.StatusCode == HttpStatusCode.NotFound) throw new ApiException(403, "identity_not_supported");
        if (response.StatusCode != HttpStatusCode.OK) throw new ApiException(503, "identity_unavailable");
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
    }
}
