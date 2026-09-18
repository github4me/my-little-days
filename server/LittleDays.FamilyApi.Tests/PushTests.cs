using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Configuration;

namespace LittleDays.FamilyApi.Tests;

public sealed class PushTests
{
    internal static PushSettings Settings() => new()
    {
        RegistrationEnabled = true, EventCreationEnabled = true, DeliveryEnabled = true,
        AllowAllUsers = true,
        ProjectId = Guid.NewGuid(), TokenEncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        AccessToken = "test-only-provider-token"
    };
    internal static string Secret() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    internal static RegisterPushRequest Registration(PushSettings settings, FamilySummary family, Guid history, string secret,
        int generation = 0, string? token = null) => new(Guid.NewGuid(), secret, generation,
            token ?? "ExpoPushToken[" + Guid.NewGuid().ToString("N") + "]", settings.ProjectId, "ios", "en", true,
            ["feed", "diaper", "sleep"], family.Id, family.MembershipId, history);

    [Fact]
    public void ConfigurationIsOffByDefaultAndRejectsMissingStableSecrets()
    {
        var empty = new ConfigurationBuilder().Build();
        var settings = PushSettings.Load(empty);
        Assert.False(settings.RegistrationEnabled || settings.EventCreationEnabled || settings.DeliveryEnabled);
        Assert.False(settings.AllowAllUsers);
        Assert.False(settings.Allows(Guid.NewGuid()));
        Assert.Throws<InvalidOperationException>(() => PushSettings.Load(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Push:RegistrationEnabled"] = "true" }).Build()));
    }

    [Theory]
    [InlineData("RegistrationEnabled")]
    [InlineData("EventCreationEnabled")]
    [InlineData("DeliveryEnabled")]
    public void EnabledGateRequiresExplicitCohortOrSeparateBroadRolloutConsent(string gate)
    {
        var user = Guid.NewGuid();
        var values = new Dictionary<string, string?>
        {
            [$"Push:{gate}"] = "true", ["Push:ProjectId"] = Guid.NewGuid().ToString(),
            ["Push:TokenEncryptionKey"] = Settings().TokenEncryptionKey,
            ["Push:AccessToken"] = "test-only-provider-token"
        };
        PushSettings Load() => PushSettings.Load(new ConfigurationBuilder().AddInMemoryCollection(values).Build());
        Assert.Throws<InvalidOperationException>(Load);
        values["Push:AllowedUserIds:0"] = user.ToString();
        var cohort = Load();
        Assert.True(cohort.Allows(user));
        Assert.False(cohort.Allows(Guid.NewGuid()));
        values.Remove("Push:AllowedUserIds:0");
        values["Push:AllowAllUsers"] = "true";
        var broad = Load();
        Assert.True(broad.Allows(Guid.NewGuid()));
        Assert.False(broad.Allows(Guid.Empty));
    }

    [Fact]
    public void EncryptionSurvivesInstanceRestartButRejectsDifferentProjectOrModifiedCiphertext()
    {
        var settings = Settings();
        var cipher = new PushTokenProtector(settings).Protect("ExpoPushToken[synthetic-only]");
        Assert.DoesNotContain("synthetic", cipher);
        Assert.Equal("ExpoPushToken[synthetic-only]", new PushTokenProtector(settings).Unprotect(cipher));
        var changed = Convert.FromBase64String(cipher); changed[^1] ^= 1;
        Assert.ThrowsAny<CryptographicException>(() => new PushTokenProtector(settings).Unprotect(Convert.ToBase64String(changed)));
        settings.ProjectId = Guid.NewGuid();
        Assert.ThrowsAny<CryptographicException>(() => new PushTokenProtector(settings).Unprotect(cipher));
    }

    [Fact]
    public void DeviceSecretAndCategoryValidationRejectMalformedUnboundedAndDuplicateValues()
    {
        var settings = Settings(); var id = Guid.NewGuid();
        var family = new FamilySummary(Guid.NewGuid(), "Test", "caregiver", Guid.NewGuid(), null, "");
        var request = Registration(settings, family, Guid.NewGuid(), Secret());
        PushPolicy.Validate(request, id, settings);
        Assert.Throws<ApiException>(() => PushPolicy.Validate(request with { InstallationSecret = "short" }, id, settings));
        Assert.Throws<ApiException>(() => PushPolicy.Validate(request with { Categories = ["feed", "feed"] }, id, settings));
        Assert.Throws<ApiException>(() => PushPolicy.Validate(request with { Categories = ["growth"] }, id, settings));
        Assert.Throws<ApiException>(() => PushPolicy.Validate(request with { ProjectId = Guid.NewGuid() }, id, settings));
        Assert.Throws<ApiException>(() => PushPolicy.Validate(request with { ExpoPushToken = "https://example.test" }, id, settings));
        Assert.True(PushPolicy.SecretMatches(request.InstallationSecret, PushPolicy.Hash(request.InstallationSecret)));
        Assert.False(PushPolicy.SecretMatches(Secret(), PushPolicy.Hash(request.InstallationSecret)));
        Assert.Equal(7, PushPolicy.CategoryMask(["feed", "diaper", "sleep"]));
    }

    [Fact]
    public void LiveSleepDelayUsesBothCapturedStartAndServerCommit()
    {
        var now = DateTimeOffset.Parse("2026-09-18T10:00:00Z");
        var past = JsonSerializer.SerializeToElement(new { type = "sleep", start = now.AddHours(-1) });
        Assert.Equal(now.AddMinutes(1), PushPolicy.NotBefore(past, now));
        var future = JsonSerializer.SerializeToElement(new { type = "sleep", start = now.AddSeconds(20) });
        Assert.Equal(now.AddSeconds(80), PushPolicy.NotBefore(future, now));
        var stopped = JsonSerializer.SerializeToElement(new { type = "sleep", start = now.AddMinutes(-1), end = now });
        Assert.Equal(now, PushPolicy.NotBefore(stopped, now));
        Assert.Null(PushPolicy.ActiveTimer(stopped));
    }

    [Theory]
    [InlineData("{\"data\":{\"status\":\"ok\",\"id\":\"ticket\"}}", null, "accepted")]
    [InlineData("{\"data\":{\"ticket\":{\"status\":\"ok\"}}}", "ticket", "sent")]
    [InlineData("{\"data\":{}}", "ticket", "retry")]
    [InlineData("{\"data\":{\"status\":\"error\",\"details\":{\"error\":\"DeviceNotRegistered\"}}}", null, "unregistered")]
    [InlineData("{\"data\":{\"status\":\"error\",\"details\":{\"error\":\"MessageRateExceeded\"}}}", null, "retry")]
    [InlineData("{\"data\":{\"status\":\"error\",\"details\":{\"error\":\"InvalidCredentials\"}}}", null, "failed")]
    [InlineData("{\"data\":{\"status\":\"ok\"}}", null, "retry")]
    [InlineData("{\"data\":[]}", null, "retry")]
    public void ProviderTicketsAndReceiptsAreDistinctAndErrorsAreSanitized(string json, string? receipt, string outcome)
    {
        var result = ExpoPushGateway.Parse(FullDomainTests.Json(json), receipt);
        Assert.Equal(outcome, result.Outcome);
    }
}
