using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

namespace LittleDays.FamilyApi.Tests;

public sealed class RecordEditingPolicyTests
{
    private static FullRecordOperation Update(string collection = "entry", string? id = null)
    {
        var value = collection switch
        {
            "care" => FullDomainTests.Care(),
            "extra" => FullDomainTests.Json("""{"id":"checkin","kind":"play-checkin","day":"2026-10-24","activityId":"face"}"""),
            _ => FullDomainTests.Entries()[0]
        };
        return new(Guid.NewGuid(), id ?? value.GetProperty("id").GetString()!, Guid.NewGuid(), Guid.NewGuid(),
            "update", collection, "AAAAAAAAAAE=", collection == "entry" ? value : null,
            collection == "care" ? value : null, collection == "extra" ? value : null,
            EditPolicy: RecordEditingPolicy.LastServerSaveWins);
    }

    [Theory]
    [InlineData("entry")]
    [InlineData("care")]
    [InlineData("extra")]
    public void SharedCollectionsAcceptExplicitCollaborativeUpdates(string collection)
    {
        var operation = Update(collection);
        Assert.True(RecordEditingPolicy.IsCollaborativeUpdate(operation));
        var value = FullDomainValidation.Operation(operation);
        Assert.Equal(operation.RecordId, value!.Value.GetProperty("id").GetString());
    }

    [Theory]
    [InlineData("avatar")]
    [InlineData("play-selection")]
    [InlineData("reminder-settings")]
    public void OwnerOnlySingletonsNeverAcceptCollaborativePolicy(string id)
    {
        var operation = Update("extra", id);
        Assert.False(RecordEditingPolicy.IsCollaborativeUpdate(operation));
        Assert.Equal("invalid_input", Assert.Throws<ApiException>(() => FullDomainValidation.Operation(operation)).Code);
    }

    [Theory]
    [InlineData("create")]
    [InlineData("delete")]
    [InlineData("unknown")]
    public void PolicyDoesNotBypassCreateDeleteOrInvalidKindValidation(string kind)
    {
        var operation = Update() with { Kind = kind, BaseVersion = kind == "create" ? null : "AAAAAAAAAAE=" };
        Assert.False(RecordEditingPolicy.IsCollaborativeUpdate(operation));
        Assert.Equal("invalid_input", Assert.Throws<ApiException>(() => FullDomainValidation.Operation(operation)).Code);
    }

    [Fact]
    public void UnknownPolicyReviewedReplacementAndInvalidVersionCannotOptIn()
    {
        foreach (var operation in new[] {
            Update() with { EditPolicy = "unknown" },
            Update() with { ReplacesOperationId = Guid.NewGuid() },
            Update() with { BaseVersion = "not-a-rowversion" },
            Update() with { Collection = "profile" }
        })
            Assert.Equal("invalid_input", Assert.Throws<ApiException>(() => FullDomainValidation.Operation(operation)).Code);
    }

    [Fact]
    public void LegacyOperationSerializationOmitsNewPolicyToPreserveReceiptFingerprints()
    {
        var operation = Update() with { EditPolicy = null };
        var legacy = new { operation.OperationId, operation.RecordId, operation.MembershipId, operation.HistoryId,
            operation.Kind, operation.Collection, operation.BaseVersion, operation.Entry, operation.CareRecord };
        Assert.Equal(JsonSerializer.Serialize(legacy), JsonSerializer.Serialize(operation));
        Assert.False(RecordEditingPolicy.IsCollaborativeUpdate(operation));
        FullDomainValidation.Operation(operation);
        var collaborative = operation with { EditPolicy = RecordEditingPolicy.LastServerSaveWins };
        Assert.Equal(RecordEditingPolicy.LastServerSaveWins,
            JsonSerializer.SerializeToElement(collaborative).GetProperty("EditPolicy").GetString());
    }

    [Theory]
    [InlineData("entry")]
    [InlineData("care")]
    [InlineData("extra")]
    public void SharedDeletesRemainVersionedAndHaveNoLastSavePolicy(string collection)
    {
        var operation = Update(collection) with { Kind = "delete", Entry = null, CareRecord = null, ExtraRecord = null, EditPolicy = null };
        Assert.Null(FullDomainValidation.Operation(operation));
        Assert.False(RecordEditingPolicy.IsCollaborativeUpdate(operation));
        Assert.Equal("invalid_input", Assert.Throws<ApiException>(() => FullDomainValidation.Operation(operation with { BaseVersion = null })).Code);
    }

    [Fact]
    public async Task CapabilitiesAdvertiseCollaborationOnlyAfterAuthentication()
    {
        var s = new Scenario(new SqlFixture());
        await using var host = new TestHost(s.Config);
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/v2/capabilities")).StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", host.Token(s.Owner));
        var capabilities = await client.GetFromJsonAsync<FullFamilyCapabilities>("/v2/capabilities");
        Assert.NotNull(capabilities);
        Assert.True(capabilities.CollaborativeEditingEnabled);
        Assert.Equal(2, capabilities.SchemaVersion);
    }
}
