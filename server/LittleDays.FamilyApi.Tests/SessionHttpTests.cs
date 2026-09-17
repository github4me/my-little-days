using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace LittleDays.FamilyApi.Tests;

public sealed class SessionHttpTests
{
    [Fact]
    public async Task SessionRecognizesOnlyTokenWithoutResolvingDirectoryOrDatabase()
    {
        var scenario = new Scenario(new SqlFixture());
        await using var host = new TestHost(scenario.Config);
        await using var isolated = host.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddScoped<PilotDatabase>(_ => throw new InvalidOperationException("SQL must not be resolved."));
            services.AddScoped<IPublicIdentityAdmission>(_ => throw new InvalidOperationException("Directory must not be resolved."));
        }));
        using var client = isolated.CreateClient();
        // Token recognition is deliberately not static admission or a directory-enabled check.
        var unknown = new PilotIdentity { ObjectId = Guid.NewGuid(), Email = "untrusted-claim@example.test" };
        client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(unknown));
        using var response = await client.GetAsync("/v1/session");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        Assert.Equal("no-referrer", Assert.Single(response.Headers.GetValues("Referrer-Policy")));
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(["accountAccess", "familyAccess", "status", "userId"],
            body.RootElement.EnumerateObject().Select(property => property.Name).Order().ToArray());
        Assert.Equal("token_valid", body.RootElement.GetProperty("status").GetString());
        Assert.Equal(unknown.ObjectId, body.RootElement.GetProperty("userId").GetGuid());
        Assert.Equal("pending", body.RootElement.GetProperty("accountAccess").GetString());
        Assert.Equal("pending", body.RootElement.GetProperty("familyAccess").GetString());
        // /me remains a separate, authoritative operation. No successful session can bypass it.
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/v1/me")).StatusCode);
    }

    [Fact]
    public async Task SessionRequiresTheSameSignatureIssuerAudienceExpiryTenantClientScopeAndObjectId()
    {
        var scenario = new Scenario(new SqlFixture());
        await using var host = new TestHost(scenario.Config);
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/v1/session")).StatusCode);
        var invalid = new[]
        {
            host.Token(scenario.Owner, issuer: "https://wrong.example.test"),
            host.Token(scenario.Owner, audience: Guid.NewGuid().ToString()),
            host.Token(scenario.Owner, expires: DateTime.UtcNow.AddMinutes(-5)),
            host.Token(scenario.Owner, tenant: Guid.NewGuid()),
            host.Token(scenario.Owner, clientId: Guid.NewGuid()),
            host.Token(scenario.Owner, scope: "openid profile"),
            host.Token(scenario.Owner, version: "1.0"),
            host.Token(scenario.Owner, wrongKey: true),
            host.Token(new PilotIdentity { ObjectId = Guid.Empty, Email = scenario.Owner.Email })
        };
        foreach (var token in invalid)
        {
            client.DefaultRequestHeaders.Authorization = new("Bearer", token);
            using var response = await client.GetAsync("/v1/session");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.Equal("unauthorized", (await response.Content.ReadFromJsonAsync<ErrorBody>())!.Code);
        }
    }

    [Fact]
    public async Task SessionIsRateLimitedAndDoesNotBypassRestoreMaintenance()
    {
        var scenario = new Scenario(new SqlFixture());
        scenario.Config.Pilot.RequestsPerMinute = 2;
        await using var host = new TestHost(scenario.Config);
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(scenario.Owner));
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/v1/session")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/v1/session")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.GetAsync("/v1/session")).StatusCode);

        await using var blocked = new TestHost(scenario.Config, overrides: new Dictionary<string, string?> { ["Recovery:Blocked"] = "true" });
        using var blockedClient = blocked.CreateClient();
        blockedClient.DefaultRequestHeaders.Authorization = new("Bearer", blocked.Token(scenario.Owner));
        using var response = await blockedClient.GetAsync("/v1/session");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("recovery_blocked", (await response.Content.ReadFromJsonAsync<ErrorBody>())!.Code);
    }

    private sealed record ErrorBody(string Code);
}
