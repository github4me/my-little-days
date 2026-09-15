using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace LittleDays.FamilyApi.Tests;

public sealed class PublicIdentityAdmissionTests
{
    private readonly Guid userId = Guid.NewGuid();
    private readonly Guid tenantId = Guid.NewGuid();
    private const string Issuer = "familytest.onmicrosoft.com";

    [Fact]
    public async Task ResolvesExactEnabledLocalIdentityWithoutTrustingClaimsOrContactAddresses()
    {
        var account = Account();
        account["mail"] = "someone-else@example.test";
        account["otherMails"] = new JsonArray("unverified@example.test");
        account["displayName"] = " \u202eParent\n ";
        using var handler = Handler(account);
        using var http = new HttpClient(handler);
        var identity = await new GraphPublicIdentityAdmission(http, Config()).AdmitAsync(Principal(), default);
        Assert.Equal(userId, identity.ObjectId);
        Assert.Equal("parent@example.test", identity.Email);
        Assert.Equal("Parent", identity.DisplayName);
        Assert.Equal(3, handler.Requests.Count);
        Assert.Contains($"/users/{userId:D}?$select=", handler.Requests[1]);
        Assert.DoesNotContain("someone-else", string.Join(" ", handler.Requests));
        var filterUrl = Uri.UnescapeDataString(handler.Requests[2]);
        Assert.Contains("issuerAssignedId eq 'parent@example.test'", filterUrl);
        Assert.Contains($"issuer eq '{Issuer}'", filterUrl);
        Assert.Equal(2, handler.BearerCount);
    }

    [Theory]
    [InlineData("disabled")]
    [InlineData("different_id")]
    [InlineData("administrator")]
    [InlineData("wrong_issuer")]
    [InlineData("no_local_email")]
    [InlineData("multiple_emails")]
    [InlineData("federation")]
    [InlineData("username")]
    [InlineData("malformed_email")]
    public async Task UnsupportedOrAmbiguousIdentityNeverUsesContactAddressFallback(string scenario)
    {
        var account = Account();
        var identities = account["identities"]!.AsArray();
        switch (scenario)
        {
            case "disabled": account["accountEnabled"] = false; break;
            case "different_id": account["id"] = Guid.NewGuid().ToString(); break;
            case "administrator": account["creationType"] = null; break;
            case "wrong_issuer": identities[0]!["issuer"] = "another.onmicrosoft.com"; break;
            case "no_local_email": identities.Clear(); break;
            case "multiple_emails": identities.Add(identities[0]!.DeepClone()); break;
            case "federation": identities.Add(new JsonObject { ["signInType"] = "federated", ["issuer"] = "google.com", ["issuerAssignedId"] = "parent@example.test" }); break;
            case "username": identities[0]!["signInType"] = "userName"; break;
            case "malformed_email": identities[0]!["issuerAssignedId"] = "Parent <parent@example.test>"; break;
        }
        account["mail"] = "parent@example.test";
        using var handler = Handler(account);
        using var http = new HttpClient(handler);
        var error = await Assert.ThrowsAsync<ApiException>(() => new GraphPublicIdentityAdmission(http, Config()).AdmitAsync(Principal(), default));
        Assert.Equal("identity_not_supported", error.Code);
        Assert.Equal(403, error.Status);
        Assert.Equal(2, handler.Requests.Count);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("duplicate")]
    [InlineData("pagination")]
    [InlineData("wrong_issuer")]
    [InlineData("different_id")]
    public async Task DirectoryEmailLookupMustReturnOneExactRevalidatedObject(string scenario)
    {
        var account = Account();
        var matches = new JsonObject { ["value"] = new JsonArray(account.DeepClone()) };
        switch (scenario)
        {
            case "missing": matches["value"] = new JsonArray(); break;
            case "duplicate": matches["value"]!.AsArray().Add(account.DeepClone()); break;
            case "pagination": matches["@odata.nextLink"] = "https://attacker.example.test"; break;
            case "wrong_issuer": matches["value"]![0]!["identities"]![0]!["issuer"] = "another.onmicrosoft.com"; break;
            case "different_id": matches["value"]![0]!["id"] = Guid.NewGuid().ToString(); break;
        }
        using var handler = new ScriptedHandler(Token(), Json(account), Json(matches));
        using var http = new HttpClient(handler);
        Assert.Equal("identity_not_supported", (await Assert.ThrowsAsync<ApiException>(() =>
            new GraphPublicIdentityAdmission(http, Config()).AdmitAsync(Principal(), default))).Code);
        Assert.Equal(3, handler.Requests.Count);
    }

    [Theory]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.Redirect)]
    public async Task GraphErrorsRemainUnavailableWithoutPrivateDetails(HttpStatusCode status)
    {
        using var handler = new ScriptedHandler(Token(), new(status) { Content = new StringContent("private-error@example.test") });
        using var http = new HttpClient(handler);
        var error = await Assert.ThrowsAsync<ApiException>(() => new GraphPublicIdentityAdmission(http, Config()).AdmitAsync(Principal(), default));
        Assert.Equal(503, error.Status);
        Assert.Equal("identity_unavailable", error.Code);
        Assert.DoesNotContain("private-error", error.ToString());
    }

    [Theory]
    [InlineData("tenant")]
    [InlineData("oid")]
    [InlineData("anonymous")]
    public async Task InvalidPrincipalNeverContactsGraph(string scenario)
    {
        var principal = scenario == "anonymous" ? new ClaimsPrincipal() : Principal();
        if (scenario == "tenant") ((ClaimsIdentity)principal.Identity!).RemoveClaim(principal.FindFirst("tid"));
        if (scenario == "oid") ((ClaimsIdentity)principal.Identity!).RemoveClaim(principal.FindFirst("oid"));
        using var handler = new ScriptedHandler();
        using var http = new HttpClient(handler);
        Assert.Equal(401, (await Assert.ThrowsAsync<ApiException>(() =>
            new GraphPublicIdentityAdmission(http, Config()).AdmitAsync(principal, default))).Status);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public void DisplayNameHasBoundedUnicodeLengthAndSafeFallback()
    {
        var account = Account();
        account["displayName"] = string.Concat(Enumerable.Repeat("\U0001f476", 100));
        using var json = JsonDocument.Parse(account.ToJsonString());
        var identity = GraphPublicIdentityAdmission.ParseLocalAccount(json.RootElement, userId, Issuer);
        Assert.Equal(80, identity.DisplayName.Length);
        Assert.True(char.IsLowSurrogate(identity.DisplayName[^1]));
        account["displayName"] = "\u202e\n";
        using var fallback = JsonDocument.Parse(account.ToJsonString());
        Assert.Equal("Family member", GraphPublicIdentityAdmission.ParseLocalAccount(fallback.RootElement, userId, Issuer).DisplayName);
    }

    [Fact]
    public void AdmissionMustBeConfiguredAndStaticModeCannotBeInferredFromBindings()
    {
        Assert.Throws<InvalidOperationException>(() => PublicIdentitySettings.Load(Settings(new())));
        var values = DirectoryValues();
        Assert.Equal("Directory", PublicIdentitySettings.Load(Settings(values)).Mode);
        foreach (var key in new[] { "Admission:EmailOtpOnly", "Admission:LocalAccountIssuer", "Admission:GraphClientId", "Admission:GraphClientSecret" })
        {
            var missing = new Dictionary<string, string?>(values);
            missing.Remove(key);
            Assert.ThrowsAny<Exception>(() => PublicIdentitySettings.Load(Settings(missing)));
        }
        var invalidIssuer = new Dictionary<string, string?>(values) { ["Admission:LocalAccountIssuer"] = "https://attacker.example.test" };
        Assert.Throws<InvalidOperationException>(() => PublicIdentitySettings.Load(Settings(invalidIssuer)));
        Assert.Equal("Static", PublicIdentitySettings.Load(Settings(new() { ["Admission:Mode"] = "Static" })).Mode);
    }

    [Fact]
    public void CredentialReuseMustBeExplicitAndReleaseDeletionCannotBeUnconfigured()
    {
        var values = DirectoryValues();
        values.Remove("Admission:GraphClientId");
        values.Remove("Admission:GraphClientSecret");
        values["AccountDeletion:GraphClientId"] = Guid.NewGuid().ToString();
        values["AccountDeletion:GraphClientSecret"] = "fixture-secret";
        Assert.Throws<InvalidOperationException>(() => PublicIdentitySettings.Load(Settings(values)));
        values["Admission:UseAccountDeletionCredentials"] = "true";
        Assert.Equal("fixture-secret", PublicIdentitySettings.Load(Settings(values)).GraphClientSecret);
        Assert.Throws<InvalidOperationException>(() => new ServiceCollection().AddAccountIdentityDeletion(Settings(new()), Config()));
    }

    [Fact]
    public void RequestIdentityHasNoUnauthenticatedDefault()
    {
        var context = new DefaultHttpContext();
        Assert.Throws<ApiException>(() => PublicIdentityAdmission.Get(context));
        var identity = new PilotIdentity { ObjectId = userId, Email = "parent@example.test" };
        PublicIdentityAdmission.Set(context, identity);
        Assert.Same(identity, PublicIdentityAdmission.Get(context));
    }

    private ClaimsPrincipal Principal() => new(new ClaimsIdentity(new[]
    {
        new Claim("oid", userId.ToString()), new Claim("tid", tenantId.ToString()),
        new Claim("email", "untrusted@example.test"), new Claim("preferred_username", "untrusted@example.test")
    }, "fixture"));

    private PilotConfiguration Config() => new(new() { TenantId = tenantId }, new(), new())
    {
        Admission = PublicIdentitySettings.Load(Settings(DirectoryValues()))
    };

    private static Dictionary<string, string?> DirectoryValues() => new()
    {
        ["Admission:Mode"] = "Directory", ["Admission:LocalAccountIssuer"] = Issuer,
        ["Admission:EmailOtpOnly"] = "true", ["Admission:GraphClientId"] = Guid.NewGuid().ToString(),
        ["Admission:GraphClientSecret"] = "fixture-secret"
    };
    private static IConfiguration Settings(Dictionary<string, string?> values) => new ConfigurationBuilder().AddInMemoryCollection(values).Build();
    private JsonObject Account() => new()
    {
        ["id"] = userId.ToString(), ["accountEnabled"] = true, ["creationType"] = "LocalAccount", ["displayName"] = "Parent",
        ["identities"] = new JsonArray(new JsonObject
        {
            ["signInType"] = "emailAddress", ["issuer"] = Issuer, ["issuerAssignedId"] = " Parent@Example.Test "
        }, new JsonObject { ["signInType"] = "userPrincipalName", ["issuer"] = Issuer, ["issuerAssignedId"] = "not-an-email-proof" })
    };
    private static ScriptedHandler Handler(JsonObject account) => new(Token(), Json(account),
        Json(new JsonObject { ["value"] = new JsonArray(account.DeepClone()) }));
    private static HttpResponseMessage Token() => new(HttpStatusCode.OK)
    {
        Content = new StringContent("{\"token_type\":\"Bearer\",\"access_token\":\"fixture-token\"}", Encoding.UTF8, "application/json")
    };
    private static HttpResponseMessage Json(JsonNode body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json")
    };
    private sealed class ScriptedHandler(params HttpResponseMessage[] responses) : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> pending = new(responses);
        public List<string> Requests { get; } = [];
        public int BearerCount { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add($"{request.Method} {request.RequestUri!.AbsoluteUri}");
            if (request.Method == HttpMethod.Get)
            {
                Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
                Assert.Equal("fixture-token", request.Headers.Authorization.Parameter);
                BearerCount++;
            }
            return Task.FromResult(pending.Dequeue());
        }
    }
}
