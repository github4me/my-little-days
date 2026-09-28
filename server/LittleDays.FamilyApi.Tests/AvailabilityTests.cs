using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace LittleDays.FamilyApi.Tests;

public sealed class AvailabilityTests
{
    [Fact]
    public void AggregateBudgetIncludesEnvelopeAndMetadataAndHasExplicitBoundaryErrors()
    {
        var liveBytes = FamilyAvailability.MaxSnapshotBytes - FamilyAvailability.SnapshotMetadataReserve - FamilyAvailability.RecordEnvelopeReserve;
        FamilyAvailability.RequireBudget(FamilyAvailability.MaxStoredRecordBytes, liveBytes, FamilyAvailability.MaxRecords, 1);
        Code("family_storage_limit", () => FamilyAvailability.RequireBudget(FamilyAvailability.MaxStoredRecordBytes + 1, 0, 0, 0));
        Code("family_snapshot_limit", () => FamilyAvailability.RequireBudget(0, liveBytes + 1, 1, 1));
        Code("family_record_limit", () => FamilyAvailability.RequireBudget(0, 0, FamilyAvailability.MaxRecords + 1, 0));
    }

    [Theory]
    [InlineData('\u2028')]
    [InlineData('\u3000')]
    [InlineData('\uE000')]
    [InlineData('\u00A0')]
    public void ResponseMeasurementIncludesUnicodeEscapingAndCanonicalBytesRemainStable(char character)
    {
        var raw = "{\"title\":\"" + new string(character, 100) + "\"}";
        var measured = FamilyAvailability.MeasureRecordResponse(raw);
        Assert.True(measured > Encoding.UTF8.GetByteCount(raw));
        using var document = JsonDocument.Parse(raw);
        var canonical = JsonSerializer.Serialize(document.RootElement, FamilyAvailability.SnapshotJson);
        Assert.Equal(Encoding.UTF8.GetByteCount(canonical), measured);
        Assert.Equal(measured, FamilyAvailability.MeasureRecordResponse(canonical));
    }

    [Fact]
    public void PhotoBase64IsNotHtmlEscapedAndActualResponseHasAHardLimit()
    {
        var raw = "{\"dataUrl\":\"data:image/jpeg;base64,++++////\"}";
        Assert.Equal(Encoding.UTF8.GetByteCount(raw), FamilyAvailability.MeasureRecordResponse(raw));
        Code("family_snapshot_limit", () => FamilyAvailability.RequireResponseBudget(new { value = new string('a', (int)FamilyAvailability.MaxSnapshotBytes) }));
    }

    [Fact]
    public async Task ManualRecoveryGateBlocksEveryApiSurfaceButNotLivenessAndPausesCleanup()
    {
        var config = new PilotConfiguration(new() { TenantId = Guid.NewGuid(), Audience = Guid.NewGuid(), MobileClientId = Guid.NewGuid() },
            new() { PublicBaseUrl = "https://pilot.example.test", HistoryId = Guid.NewGuid() }, new());
        await using var host = new TestHost(config, overrides: new Dictionary<string, string?> { ["Recovery:Blocked"] = "true" });
        using var client = host.CreateClient();
        foreach (var path in new[] { "/v1/me", "/v2/capabilities", "/v2/families/11111111-1111-1111-1111-111111111111/snapshot" })
        {
            var response = await client.GetAsync(path);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
            Assert.Contains("recovery_blocked", await response.Content.ReadAsStringAsync());
        }
        var receipt = await client.PostAsync("/v1/account-deletion-status", new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, receipt.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/health/ready")).StatusCode);

        var settings = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Recovery:Blocked"] = "true" }).Build();
        var gate = new RecoveryGate(settings);
        await using var db = new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer("Server=unconfigured.invalid;Database=unused;Integrated Security=true").Options);
        Assert.False(await new DeletionProcessor(db, config, TimeProvider.System, new UnconfiguredAccountIdentityDeletion(), gate).Process(default));
        settings["Recovery:Blocked"] = "false";
        Assert.False(gate.Blocked);
        Assert.False(new RecoveryGate(new ConfigurationBuilder().Build()).Blocked);
    }

    private static void Code(string code, Action action) => Assert.Equal(code, Assert.Throws<ApiException>(action).Code);
}
