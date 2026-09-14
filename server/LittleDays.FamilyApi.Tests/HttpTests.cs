using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace LittleDays.FamilyApi.Tests;

public sealed class HttpTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [Fact]
    public async Task JwtRequiresSignatureIssuerAudienceExpiryTenantScopeClientAndAdmission()
    {
        var s = new Scenario(sql);
        await using var host = new TestHost(s.Config);
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
        await AssertCode(client, HttpStatusCode.Unauthorized, "unauthorized");
        var invalid = new[]
        {
            host.Token(s.Owner, issuer: "https://wrong.example.test"),
            host.Token(s.Owner, audience: Guid.NewGuid().ToString()),
            host.Token(s.Owner, expires: DateTime.UtcNow.AddMinutes(-5)),
            host.Token(s.Owner, tenant: Guid.NewGuid()),
            host.Token(s.Owner, scope: "openid profile"),
            host.Token(s.Owner, clientId: Guid.NewGuid()),
            host.Token(s.Owner, version: "1.0"),
            host.Token(s.Owner, wrongKey: true)
        };
        foreach (var token in invalid)
        {
            client.DefaultRequestHeaders.Authorization = new("Bearer", token);
            await AssertCode(client, HttpStatusCode.Unauthorized, "unauthorized");
        }
        // An unlisted immutable object ID stays unadmitted even if its email claim names the owner.
        client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(new() { ObjectId = Guid.NewGuid(), Email = s.Owner.Email }));
        await AssertCode(client, HttpStatusCode.Forbidden, "pilot_not_admitted");
    }

    [Fact]
    public async Task LegacyShareLinkIsRemovedAndRatesAreBounded()
    {
        var s = new Scenario(sql);
        s.Config.Pilot.RequestsPerMinute = 2;
        await using var host = new TestHost(s.Config);
        using var client = host.CreateClient();
        var landing = await client.GetAsync("/join");
        Assert.Equal(HttpStatusCode.NotFound, landing.StatusCode);
        Assert.Equal("no-store", landing.Headers.CacheControl!.ToString());
        Assert.Equal("no-referrer", Assert.Single(landing.Headers.GetValues("Referrer-Policy")));
        await client.GetAsync("/join");
        var limited = await client.GetAsync("/join");
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.Equal("rate_limited", (await limited.Content.ReadFromJsonAsync<ErrorBody>())!.Code);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
    }

    [SqlFact]
    public async Task HttpWireFlowAndConditionalSnapshotReauthorizeAfterRevocation()
    {
        var s = new Scenario(sql);
        await using var host = new TestHost(s.Config, sql.ConnectionString);
        using var owner = host.CreateClient();
        owner.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(s.Owner));
        var me = await owner.GetFromJsonAsync<MeResult>("/v1/me");
        Assert.Equal(s.Owner.Email, me!.User.Email);
        var familyResponse = await owner.PostAsJsonAsync("/v1/families", new CreateFamilyRequest(Guid.NewGuid(), "Test baby"));
        familyResponse.EnsureSuccessStatusCode();
        var family = (await familyResponse.Content.ReadFromJsonAsync<FamilySummary>())!;
        var inviteResponse = await owner.PostAsJsonAsync($"/v1/families/{family.Id}/invitations", s.Invitation(family, s.Caregiver.Email));
        inviteResponse.EnsureSuccessStatusCode();
        var invite = (await inviteResponse.Content.ReadFromJsonAsync<InvitationResult>())!;
        using var caregiver = host.CreateClient();
        caregiver.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(s.Caregiver));
        var accepted = await caregiver.PostAsJsonAsync($"/v1/invitations/{invite.Invitation.Id}/accept", new OperationRequest(Guid.NewGuid()));
        accepted.EnsureSuccessStatusCode();
        var grant = (await accepted.Content.ReadFromJsonAsync<FamilySummary>())!;
        var op = s.CreateFeed(grant);
        var feedResponse = await caregiver.PostAsJsonAsync($"/v1/families/{family.Id}/feed-operations", op);
        feedResponse.EnsureSuccessStatusCode();
        var snapshotResponse = await caregiver.GetAsync($"/v1/families/{family.Id}/snapshot");
        snapshotResponse.EnsureSuccessStatusCode();
        var snapshot = (await snapshotResponse.Content.ReadFromJsonAsync<FamilySnapshot>())!;
        Assert.Single(snapshot.Feeds);
        var etag = snapshotResponse.Headers.ETag!;
        caregiver.DefaultRequestHeaders.IfNoneMatch.Add(etag);
        Assert.Equal(HttpStatusCode.NotModified, (await caregiver.GetAsync($"/v1/families/{family.Id}/snapshot")).StatusCode);
        var removed = await owner.PostAsJsonAsync($"/v1/families/{family.Id}/members/{s.Caregiver.ObjectId}/remove", s.Context(family, target: grant.MembershipId));
        removed.EnsureSuccessStatusCode();
        var revoked = await caregiver.GetAsync($"/v1/families/{family.Id}/snapshot");
        Assert.Equal(HttpStatusCode.Forbidden, revoked.StatusCode);
        Assert.Equal("membership_revoked", (await revoked.Content.ReadFromJsonAsync<ErrorBody>())!.Code);
        var retry = await caregiver.PostAsJsonAsync($"/v1/families/{family.Id}/feed-operations", op);
        Assert.Equal(HttpStatusCode.Forbidden, retry.StatusCode);
        Assert.DoesNotContain("Test baby", await revoked.Content.ReadAsStringAsync());
        var bad = await owner.PostAsJsonAsync($"/v1/families/{family.Id}/leave", new { operationId = "invalid-guid" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, bad.StatusCode);
        var tooLarge = await owner.PostAsJsonAsync("/v1/families", new CreateFamilyRequest(Guid.NewGuid(), new string('x', 18000)));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, tooLarge.StatusCode);
    }

    [SqlFact]
    public async Task DeletionReceiptWorksWithoutLoginAndCannotExposeFamilyOrIdentityData()
    {
        var s = new Scenario(sql);
        await using var host = new TestHost(s.Config, sql.ConnectionString);
        using var authenticated = host.CreateClient();
        authenticated.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(s.Owner));
        var secret = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        var request = new DeleteAccountRequest(Guid.NewGuid(), secret);
        var response = await authenticated.PostAsJsonAsync("/v1/account/delete", request);
        response.EnsureSuccessStatusCode();
        var deletion = (await response.Content.ReadFromJsonAsync<AccountDeletion>())!;
        Assert.Equal(request.OperationId, deletion.DeletionId);
        Assert.Equal("pending", deletion.Status);
        using var anonymous = host.CreateClient();
        var receipt = await anonymous.PostAsJsonAsync("/v1/account-deletion-status", new DeletionStatusRequest(deletion.DeletionId, secret));
        receipt.EnsureSuccessStatusCode();
        Assert.Equal(deletion, await receipt.Content.ReadFromJsonAsync<AccountDeletion>());
        Assert.Equal("no-store", receipt.Headers.CacheControl!.ToString());
        var body = await receipt.Content.ReadAsStringAsync();
        Assert.DoesNotContain(s.Owner.Email, body);
        Assert.DoesNotContain(s.Owner.ObjectId.ToString(), body);
        Assert.DoesNotContain(secret, body);
        var wrong = await anonymous.PostAsJsonAsync("/v1/account-deletion-status", new DeletionStatusRequest(deletion.DeletionId, new string('a', 64)));
        Assert.Equal(HttpStatusCode.NotFound, wrong.StatusCode);
        var missing = await anonymous.PostAsJsonAsync("/v1/account-deletion-status", new DeletionStatusRequest(Guid.NewGuid(), secret));
        Assert.Equal(await wrong.Content.ReadAsStringAsync(), await missing.Content.ReadAsStringAsync());
        var blocked = await authenticated.PostAsJsonAsync("/v1/families", new CreateFamilyRequest(Guid.NewGuid(), "Not created"));
        Assert.Equal(HttpStatusCode.Gone, blocked.StatusCode);
        Assert.Equal("account_deleted", (await blocked.Content.ReadFromJsonAsync<ErrorBody>())!.Code);
    }

    [SqlFact]
    public async Task RemovingLastBindingKeepsPublicDeletionReceiptAvailableButAdmitsNobody()
    {
        var s = new Scenario(sql);
        var deletedUser = s.Owner;
        var secret = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
        var deletion = await s.Call(x => x.DeleteAccount(deletedUser, new(Guid.NewGuid(), secret), default));
        s.Config.Pilot.Identities = [];
        var loaded = PilotConfiguration.Load(new ConfigurationBuilder().AddInMemoryCollection(TestHost.Values(s.Config)).Build());
        Assert.Empty(loaded.Pilot.Identities);
        await using var host = new TestHost(s.Config, sql.ConnectionString);
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
        var receipt = await client.PostAsJsonAsync("/v1/account-deletion-status", new DeletionStatusRequest(deletion.DeletionId, secret));
        receipt.EnsureSuccessStatusCode();
        Assert.Equal(deletion, await receipt.Content.ReadFromJsonAsync<AccountDeletion>());
        client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(deletedUser));
        await AssertCode(client, HttpStatusCode.Forbidden, "pilot_not_admitted");
    }

    [Fact]
    public void ConfigurationRejectsMissingAndAmbiguousBindingsAndUntrustedEmailClaims()
    {
        Assert.Throws<InvalidOperationException>(() => PilotConfiguration.Load(new ConfigurationBuilder().Build()));
        var s = new Scenario(sql);
        var values = TestHost.Values(s.Config);
        var valid = PilotConfiguration.Load(new ConfigurationBuilder().AddInMemoryCollection(values).Build());
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim("oid", s.Owner.ObjectId.ToString()), new Claim("email", "forged@example.test")]));
        Assert.Equal(s.Owner.Email, valid.Admit(principal).Email);
        var single = TestHost.Values(s.Config with { Pilot = new PilotSettings { Identities = [s.Owner] } });
        Assert.Single(PilotConfiguration.Load(new ConfigurationBuilder().AddInMemoryCollection(single).Build()).Pilot.Identities);
        values["Pilot:Identities:1:ObjectId"] = s.Owner.ObjectId.ToString();
        Assert.Throws<InvalidOperationException>(() => PilotConfiguration.Load(new ConfigurationBuilder().AddInMemoryCollection(values).Build()));
    }

    private static async Task AssertCode(HttpClient client, HttpStatusCode status, string code)
    {
        var response = await client.GetAsync("/v1/me");
        Assert.Equal(status, response.StatusCode);
        Assert.Equal(code, (await response.Content.ReadFromJsonAsync<ErrorBody>())!.Code);
    }
    private sealed record ErrorBody(string Code);
}

// Test-only metadata supply: the production JWT signature/issuer/audience/lifetime and claim
// checks still run. No authentication bypass or static token exists in the deployable project.
public sealed class TestHost(PilotConfiguration config, string? connection = null) : WebApplicationFactory<Program>
{
    private readonly RSA rsa = RSA.Create(2048);
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        foreach (var pair in Values(config)) builder.UseSetting(pair.Key, pair.Value);
        builder.UseSetting("ConnectionStrings:FamilyDatabase", connection ?? "Server=unconfigured.invalid;Database=unused;Integrated Security=true");
        builder.ConfigureTestServices(services => services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
        {
            var metadata = new OpenIdConnectConfiguration { Issuer = config.Entra.Authority };
            metadata.SigningKeys.Add(new RsaSecurityKey(rsa) { KeyId = "fixture" });
            options.ConfigurationManager = new StaticConfigurationManager<OpenIdConnectConfiguration>(metadata);
        }));
    }

    public string Token(PilotIdentity user, string? issuer = null, string? audience = null, DateTime? expires = null,
        Guid? tenant = null, Guid? clientId = null, string scope = "Family.ReadWrite", string version = "2.0", bool wrongKey = false)
    {
        using var otherKey = wrongKey ? RSA.Create(2048) : null;
        var key = new RsaSecurityKey(otherKey ?? rsa) { KeyId = "fixture" };
        var jwt = new JwtSecurityToken(issuer ?? config.Entra.Authority, audience ?? config.Entra.Audience.ToString(),
            [new Claim("oid", user.ObjectId.ToString()), new Claim("tid", (tenant ?? config.Entra.TenantId).ToString()),
             new Claim("azp", (clientId ?? config.Entra.MobileClientId).ToString()), new Claim("scp", scope),
             new Claim("ver", version), new Claim("email", user.Email)],
            DateTime.UtcNow.AddHours(-1), expires ?? DateTime.UtcNow.AddMinutes(10), new SigningCredentials(key, SecurityAlgorithms.RsaSha256));
        return new JwtSecurityTokenHandler().WriteToken(jwt);
    }

    public static Dictionary<string, string?> Values(PilotConfiguration config)
    {
        var values = new Dictionary<string, string?>
        {
            ["Entra:TenantId"] = config.Entra.TenantId.ToString(),
            ["Entra:Audience"] = config.Entra.Audience.ToString(),
            ["Entra:MobileClientId"] = config.Entra.MobileClientId.ToString(),
            ["Family:PublicBaseUrl"] = config.Family.PublicBaseUrl,
            ["Family:HistoryId"] = config.Family.HistoryId.ToString(),
            ["Pilot:RequestsPerMinute"] = config.Pilot.RequestsPerMinute.ToString(),
            ["AccountDeletion:WorkerEnabled"] = "false"
        };
        for (var i = 0; i < config.Pilot.Identities.Length; i++)
        {
            values[$"Pilot:Identities:{i}:ObjectId"] = config.Pilot.Identities[i].ObjectId.ToString();
            values[$"Pilot:Identities:{i}:Email"] = config.Pilot.Identities[i].Email;
            values[$"Pilot:Identities:{i}:DisplayName"] = config.Pilot.Identities[i].DisplayName;
        }
        return values;
    }
    protected override void Dispose(bool disposing) { base.Dispose(disposing); if (disposing) rsa.Dispose(); }
}
