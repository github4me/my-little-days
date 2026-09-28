using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace LittleDays.FamilyApi.Tests;

public sealed class FullDomainTests
{
    public static JsonElement Json(string json) => JsonSerializer.Deserialize<JsonElement>(json);
    public static JsonElement[] Entries() =>
    [
        Json("""{"id":"local-bottle","type":"feed","start":"2026-09-01T10:00:00.123+10:00","end":"2026-09-01T10:10:00.123+10:00","feedKind":"formula","amount":123.456,"note":"Milk note"}"""),
        Json("""{"id":"local-breast","type":"feed","start":"2026-09-01T10:00:00Z","end":"2026-09-01T10:10:00Z","feedKind":"breast-both","note":"Direct feeding"}"""),
        Json("""{"id":"local-diaper","type":"diaper","start":"2026-09-01T10:00:00Z","diaperKind":"mixed","note":""}"""),
        Json("""{"id":"local-sleep","type":"sleep","start":"2026-09-01T10:00:00Z","end":"2026-09-01T11:00:00Z","note":"Nap"}"""),
        Json("""{"id":"local-growth","type":"growth","start":"2026-09-01T10:00:00Z","weight":6.12345,"length":61.789,"head":40.125,"note":"Measurement"}"""),
        Json("""{"id":"local-milestone","type":"milestone","start":"2026-09-01T10:00:00Z","title":"First smile","note":"A milestone"}""")
    ];
    public static JsonElement Care() => Json("""{"id":"care-id","kind":"temperature","time":"2026-09-01T10:00:00Z","temperature":36.789,"method":"armpit","note":"Care note"}""");
    public static JsonElement Supplement() => Json("""{"id":"supp-id","kind":"supplement","time":"2026-09-01T10:00:00Z","supplements":["vitamin-d","probiotics","other"],"otherSupplement":"Prescribed product","note":"Given as advised"}""");

    [Fact]
    public void SupplementsValidateChoicesNamesAndSeedRoundTrip()
    {
        FullDomainValidation.CareRecord(Supplement());
        Assert.Equal(Supplement().GetRawText(), Assert.Single(FullDomainValidation.Seed(Seed(care: [Supplement()])).CareRecords).GetRawText());
        foreach (var choices in new[] { "[]", "[\"vitamin-d\",\"vitamin-d\"]", "[\"unknown\"]", "[42]", "null", "[\"vitamin-d\"]" })
        {
            var invalid = JsonNode.Parse(Supplement().GetRawText())!;
            invalid["supplements"] = JsonNode.Parse(choices);
            Assert.Throws<ApiException>(() => FullDomainValidation.CareRecord(Json(invalid.ToJsonString())));
        }
        foreach (var name in new[] { "", "  ", new string('x', 101) })
        {
            var invalid = JsonNode.Parse(Supplement().GetRawText())!;
            invalid["otherSupplement"] = name;
            Assert.Throws<ApiException>(() => FullDomainValidation.CareRecord(Json(invalid.ToJsonString())));
        }
    }

    [Fact]
    public void OldClientCareProjectionOmitsSupplementsWithoutMutatingStoredSnapshot()
    {
        var author = Guid.NewGuid();
        var original = new FullFamilySnapshot(2, new("Baby", "", "unspecified"), [],
            [new(Care(), "version", author, author), new(Supplement(), "version", author, author)],
            null!, Guid.NewGuid(), "1", [], [], [], null);
        var legacy = original.ForCareSchema(1);
        Assert.Equal(1, legacy.CareSchemaVersion);
        Assert.Equal("temperature", Assert.Single(legacy.CareRecords).Record.GetProperty("kind").GetString());
        Assert.Equal(2, original.CareRecords.Length);
        Assert.False(original.CrossMemberTimerCompletionEnabled);
        Assert.Same(original, original.ForCareSchema(2));
    }
    public static JsonElement Profile() => Json("""{"name":"宝宝 Luna","birthDate":"2026-01-15","sex":"female"}""");
    public static JsonElement Seed(string[]? emails = null, JsonElement[]? entries = null, JsonElement[]? care = null)
    {
        entries ??= Entries(); care ??= [Care()];
        return JsonSerializer.SerializeToElement(new
        {
            schemaVersion = 1,
            source = new { schemaVersion = 1, profile = Profile(), entries, careRecords = care },
            inviteeEmails = emails ?? [],
            counts = new { feed = entries.Count(x => x.GetProperty("type").GetString() == "feed"),
                diaper = entries.Count(x => x.GetProperty("type").GetString() == "diaper"),
                sleep = entries.Count(x => x.GetProperty("type").GetString() == "sleep"),
                growth = entries.Count(x => x.GetProperty("type").GetString() == "growth"),
                milestone = entries.Count(x => x.GetProperty("type").GetString() == "milestone"), care = care.Length, total = entries.Length + care.Length }
        });
    }

    [Fact]
    public void SeedPreservesAllRecordKindsOriginalTimesIdsAndDecimalValues()
    {
        var seed = FullDomainValidation.Seed(Seed([" OTHER@EXAMPLE.TEST "]));
        Assert.Equal("other@example.test", Assert.Single(seed.InviteeEmails));
        Assert.Equal(6, seed.Entries.Length);
        Assert.Equal(123.456m, seed.Entries[0].GetProperty("amount").GetDecimal());
        Assert.Equal(6.12345m, seed.Entries[4].GetProperty("weight").GetDecimal());
        Assert.Equal("2026-09-01T10:00:00.123+10:00", seed.Entries[0].GetProperty("start").GetString());
        Assert.Equal("local-bottle", seed.Entries[0].GetProperty("id").GetString());
        Assert.Equal("female", seed.Profile.Sex);
        Assert.Equal(36.789m, Assert.Single(seed.CareRecords).GetProperty("temperature").GetDecimal());
    }

    [Theory]
    [InlineData("{\"id\":\"x\",\"type\":\"feed\",\"start\":\"2026-01-01T01:00:00Z\",\"feedKind\":\"formula\",\"amount\":2000.0001,\"note\":\"\"}")]
    [InlineData("{\"id\":\"x\",\"type\":\"feed\",\"start\":\"2026-01-01T01:00:00Z\",\"feedKind\":\"breast-left\",\"amount\":1,\"note\":\"\"}")]
    [InlineData("{\"id\":\"x\",\"type\":\"sleep\",\"start\":\"2026-01-01T01:00:00Z\",\"end\":\"2026-01-01T00:00:00Z\",\"note\":\"\"}")]
    [InlineData("{\"id\":\"x\",\"type\":\"growth\",\"start\":\"2026-01-01T01:00:00Z\",\"note\":\"\"}")]
    [InlineData("{\"id\":\"x\",\"type\":\"growth\",\"start\":\"2026-01-01T01:00:00Z\",\"weight\":0.09,\"note\":\"\"}")]
    [InlineData("{\"id\":\"x\",\"type\":\"diaper\",\"start\":\"2026-02-30T01:00:00Z\",\"diaperKind\":\"wet\",\"note\":\"\"}")]
    [InlineData("{\"id\":\"x\",\"type\":\"diaper\",\"start\":\"2026-01-01T01:00:00\",\"diaperKind\":\"wet\",\"note\":\"\"}")]
    [InlineData("{\"id\":\"x\",\"type\":\"diaper\",\"start\":\"2026-01-01T24:00:00Z\",\"diaperKind\":\"wet\",\"note\":\"\"}")]
    [InlineData("{\"id\":\"x\",\"type\":\"milestone\",\"start\":\"2026-01-01T01:00:00Z\",\"title\":\" \",\"note\":\"\"}")]
    [InlineData("{\"id\":\"x\",\"type\":\"sleep\",\"start\":\"2026-01-01T01:00:00Z\",\"note\":\"\",\"recordedBy\":\"attacker\"}")]
    [InlineData("{\"id\":\"x\",\"id\":\"y\",\"type\":\"sleep\",\"start\":\"2026-01-01T01:00:00Z\",\"note\":\"\"}")]
    public void InvalidOrUnknownEntryFieldsFailIndependentlyOfClient(string entry) =>
        Assert.Equal("invalid_input", Assert.Throws<ApiException>(() => FullDomainValidation.Entry(Json(entry))).Code);

    [Fact]
    public void SeedRejectsDuplicateIdsWrongCountsUnsupportedFieldsAndRunningTimers()
    {
        var duplicate = Seed(entries: [Entries()[0], Entries()[0]]);
        Assert.Throws<ApiException>(() => FullDomainValidation.Seed(duplicate));
        var wrong = JsonNode.Parse(Seed().GetRawText())!;
        wrong["counts"]!["total"] = 100;
        Assert.Throws<ApiException>(() => FullDomainValidation.Seed(Json(wrong.ToJsonString())));
        wrong = JsonNode.Parse(Seed().GetRawText())!;
        wrong["source"]!["profile"]!["photo"] = "hidden";
        Assert.Throws<ApiException>(() => FullDomainValidation.Seed(Json(wrong.ToJsonString())));
        foreach (var entry in new[] {
            Json("""{"id":"timer","type":"feed","start":"2026-09-01T10:00:00Z","feedKind":"expressed","amount":0,"feedRunning":true,"note":""}"""),
            Json("""{"id":"timer","type":"sleep","start":"2026-09-01T10:00:00Z","note":""}""") })
        {
            FullDomainValidation.Entry(entry);
            Assert.Equal("running_timers", Assert.Throws<ApiException>(() => FullDomainValidation.Seed(Seed(entries: [entry]))).Code);
        }
    }

    [Fact]
    public void NotesMatchOfflineTenThousandCharacterLimitAndSeedHasHardByteLimit()
    {
        var record = JsonNode.Parse(Entries()[2].GetRawText())!;
        record["note"] = new string('宝', 10000);
        FullDomainValidation.Entry(Json(record.ToJsonString()));
        record["note"] = new string('x', 10001);
        Assert.Throws<ApiException>(() => FullDomainValidation.Entry(Json(record.ToJsonString())));
        var huge = JsonSerializer.SerializeToElement(new { schemaVersion = 1, padding = new string('x', FullDomainValidation.MaxSeedBytes) });
        Assert.Throws<ApiException>(() => FullDomainValidation.Seed(huge));
    }

    [Fact]
    public void CareBoundsAndOperationPayloadCannotSpoofAuthorOrChangeRecordId()
    {
        var care = JsonNode.Parse(Care().GetRawText())!;
        care["temperature"] = 45.01;
        Assert.Throws<ApiException>(() => FullDomainValidation.CareRecord(Json(care.ToJsonString())));
        care["temperature"] = 36.7;
        care["recordedBy"] = Guid.NewGuid().ToString();
        Assert.Throws<ApiException>(() => FullDomainValidation.CareRecord(Json(care.ToJsonString())));
        var operation = new FullRecordOperation(Guid.NewGuid(), "care-id", Guid.NewGuid(), Guid.NewGuid(), "create", "care", null, null, Care());
        FullDomainValidation.Operation(operation);
        Assert.Throws<ApiException>(() => FullDomainValidation.Operation(operation with { RecordId = "other-id" }));
        Assert.Throws<ApiException>(() => FullDomainValidation.Operation(operation with { Entry = Entries()[0] }));
        Assert.Throws<ApiException>(() => FullDomainValidation.Operation(operation with { Kind = "delete", BaseVersion = "AAAAAAAAAAE=" }));
    }

    [Fact]
    public async Task CapabilitiesRequiresRealJwtAndAdmissionButNoDatabase()
    {
        var s = new Scenario(new SqlFixture());
        await using var host = new TestHost(s.Config);
        using var client = host.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/v2/capabilities")).StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", host.Token(s.Owner));
        var capabilities = await client.GetFromJsonAsync<FullFamilyCapabilities>("/v2/capabilities");
        Assert.Equal(2, capabilities!.SchemaVersion);
        Assert.Equal(FullDomainValidation.RecordKinds, capabilities.RecordKinds);
        Assert.Equal(33554432, capabilities.MaxSeedBytes);
        Assert.Equal(1, capabilities.ExtrasSchemaVersion);
        Assert.True(capabilities.ConflictReplacementEnabled);
    }
}
