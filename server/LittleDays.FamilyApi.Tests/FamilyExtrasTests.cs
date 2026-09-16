using System.Text.Json;
using System.Text.Json.Nodes;

namespace LittleDays.FamilyApi.Tests;

public sealed class FamilyExtrasTests
{
    public const string Png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=";
    public static JsonElement[] Extras() =>
    [
        JsonSerializer.SerializeToElement(new { id = "avatar", kind = "avatar", dataUrl = Png }),
        FullDomainTests.Json("""{"id":"play-selection","kind":"play-selection","selection":{"included":["faces"],"excluded":["mirror"]}}"""),
        FullDomainTests.Json("""{"id":"check-1","kind":"play-checkin","day":"2026-09-16","activityId":"faces"}"""),
        FullDomainTests.Json("""{"id":"reminder-1","kind":"reminder","settings":{"kind":"feed","mode":"once","title":"Milk","minutes":20,"dailyTime":"","silent":true},"onceAt":"2026-09-16T01:30:00.000Z"}"""),
        FullDomainTests.Json("""{"id":"reminder-settings","kind":"reminder-settings","settings":{"kind":"sleep","mode":"daily","title":"Bedtime","minutes":30,"dailyTime":"19:30","silent":false}}""")
    ];
    public static JsonElement Seed(string[]? emails = null, JsonElement[]? extras = null)
    {
        var node = JsonNode.Parse(FullDomainTests.Seed(emails).GetRawText())!;
        node["extrasSchemaVersion"] = 1;
        node["extraRecords"] = JsonSerializer.SerializeToNode(extras ?? Extras());
        return FullDomainTests.Json(node.ToJsonString());
    }
    public static FullRecordOperation Operation(JsonElement? extra, string id = "check-1", string kind = "create", string? version = null) =>
        JsonSerializer.Deserialize<FullRecordOperation>(JsonSerializer.Serialize(new
        {
            operationId = Guid.NewGuid(), recordId = id, membershipId = Guid.NewGuid(), historyId = Guid.NewGuid(),
            kind, collection = "extra", baseVersion = version, entry = (object?)null, careRecord = (object?)null, extraRecord = extra
        }), new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    [Fact]
    public void SeedAcceptsPhotoReminderAndPlayDataWithoutRequiringLegacySeedsToChange()
    {
        FullDomainValidation.Seed(Seed());
        FullDomainValidation.Seed(FullDomainTests.Seed());
        foreach (var extra in Extras())
            Assert.Equal(extra.GetRawText(), FullDomainValidation.Operation(Operation(extra, extra.GetProperty("id").GetString()!))!.Value.GetRawText());
    }

    [Theory]
    [InlineData("""{"id":"avatar","kind":"avatar","dataUrl":"file:///private/baby.jpg"}""")]
    [InlineData("""{"id":"avatar","kind":"avatar","dataUrl":"https://external.test/baby.jpg"}""")]
    [InlineData("""{"id":"avatar","kind":"avatar","dataUrl":"data:image/png;base64,aGVsbG8="}""")]
    [InlineData("""{"id":"other","kind":"avatar","dataUrl":null}""")]
    [InlineData("""{"id":"avatar","kind":"play-checkin","day":"2026-09-16","activityId":"faces"}""")]
    [InlineData("""{"id":"check-1","kind":"play-checkin","day":"2026-02-30","activityId":"faces"}""")]
    [InlineData("""{"id":"check-1","kind":"play-checkin","day":"2026-09-16","activityId":"faces","recordedBy":"fake"}""")]
    [InlineData("""{"id":"play-selection","kind":"play-selection","selection":{"included":["faces","faces"],"excluded":[]}}""")]
    [InlineData("""{"id":"play-selection","kind":"play-selection","selection":{"included":["faces"],"excluded":["faces"]}}""")]
    [InlineData("""{"id":"reminder-1","kind":"reminder","settings":{"kind":"feed","mode":"once","title":"Milk","minutes":20,"dailyTime":"","silent":true}}""")]
    [InlineData("""{"id":"reminder-1","kind":"reminder","settings":{"kind":"feed","mode":"daily","title":"Milk","minutes":20,"dailyTime":"25:00","silent":true}}""")]
    [InlineData("""{"id":"reminder-1","kind":"reminder","settings":{"kind":"feed","mode":"after-feed","title":"Milk","minutes":0,"dailyTime":"","silent":true}}""")]
    public void SeedRejectsUnsafeOrAmbiguousExtras(string text) =>
        Assert.Equal("invalid_input", Assert.Throws<ApiException>(() => FullDomainValidation.Seed(Seed(extras: [FullDomainTests.Json(text)]))).Code);

    [Fact]
    public void ExtrasRequirePairedVersionAndUniqueIdsAndSingletonsCannotBeDeleted()
    {
        var node = JsonNode.Parse(Seed().GetRawText())!;
        node.AsObject().Remove("extrasSchemaVersion");
        Assert.Throws<ApiException>(() => FullDomainValidation.Seed(FullDomainTests.Json(node.ToJsonString())));
        Assert.Throws<ApiException>(() => FullDomainValidation.Seed(Seed(extras: [Extras()[0], Extras()[0]])));
        foreach (var id in new[] { "avatar", "play-selection", "reminder-settings" })
            Assert.Throws<ApiException>(() => FullDomainValidation.Operation(Operation(null, id, "delete", "AAAAAAAAAAE=")));
        Assert.Null(FullDomainValidation.Operation(Operation(null, "check-1", "delete", "AAAAAAAAAAE=")));
    }
}
