using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi.Tests;

public sealed class FamilyExtrasSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    private static CreateFullFamilyRequest Request(Scenario s, JsonElement[]? extras = null) =>
        new(Guid.NewGuid(), "family-sharing-v1", FamilyExtrasTests.Seed([s.Caregiver.Email], extras));
    private static FullRecordOperation Operation(Scenario s, FamilySummary grant, JsonElement extra) =>
        FamilyExtrasTests.Operation(extra, extra.GetProperty("id").GetString()!) with
        { MembershipId = grant.MembershipId, HistoryId = s.Config.Family.HistoryId };
    private static JsonElement Checkin(string id) => JsonSerializer.SerializeToElement(new { id, kind = "play-checkin", day = "2026-09-16", activityId = "faces" });

    [SqlFact]
    public async Task CreationAndJoinPreserveAllExtrasAndRetryDoesNotDuplicateOrPersistPrivateReceiptData()
    {
        var s = new Scenario(sql);
        var request = Request(s);
        var created = await s.Call(x => x.CreateFullFamily(s.Owner, request, default));
        Assert.Equal(1, created.Snapshot.ExtrasSchemaVersion);
        Assert.Equal(5, created.Snapshot.ExtraRecords!.Length);
        Assert.All(created.Snapshot.ExtraRecords, x => Assert.Equal(s.Owner.ObjectId, x.RecordedBy));
        var retry = await s.Call(x => x.CreateFullFamily(s.Owner, request, default));
        Assert.Equal(created.FamilyId, retry.FamilyId);
        Assert.Equal(5, retry.Snapshot.ExtraRecords!.Length);
        await s.Call(x => x.AcceptInvitation(s.Caregiver, Assert.Single(created.Snapshot.Invitations).Id, new(Guid.NewGuid()), default));
        var joined = await s.Call(x => x.FullSnapshot(s.Caregiver, created.FamilyId, default));
        Assert.Equal(FamilyExtrasTests.Png, joined.ExtraRecords!.Single(x => x.Record.GetProperty("kind").GetString() == "avatar").Record.GetProperty("dataUrl").GetString());
        Assert.Equal("2026-09-16T01:30:00.000Z", joined.ExtraRecords!.Single(x => x.Record.GetProperty("kind").GetString() == "reminder").Record.GetProperty("onceAt").GetString());
        await using var db = sql.Open();
        Assert.Equal(5, await db.FamilyRecords.CountAsync(x => x.FamilyId == created.FamilyId && x.Collection == "extra"));
        var receipt = await db.Operations.SingleAsync(x => x.OperationId == request.OperationId && x.UserId == s.Owner.ObjectId);
        Assert.DoesNotContain("data:image", receipt.ResultJson);
        Assert.DoesNotContain("faces", receipt.ResultJson);
    }

    [SqlFact]
    public async Task SingletonChangesRequireCurrentOwnerAndMemberRecordsRetainAuthorAndFirstActWins()
    {
        var s = new Scenario(sql);
        var created = await s.Call(x => x.CreateFullFamily(s.Owner, Request(s), default));
        var grant = await s.Call(x => x.AcceptInvitation(s.Caregiver, Assert.Single(created.Snapshot.Invitations).Id, new(Guid.NewGuid()), default));
        var avatar = created.Snapshot.ExtraRecords!.Single(x => x.Record.GetProperty("id").GetString() == "avatar");
        var clear = FullDomainTests.Json("""{"id":"avatar","kind":"avatar","dataUrl":null}""");
        var update = Operation(s, grant, clear) with { Kind = "update", BaseVersion = avatar.Version };
        await Code("record_forbidden", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId, update, default)));
        await s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId, update with { MembershipId = created.MembershipId }, default));
        var create = Operation(s, grant, Checkin("member-check"));
        var accepted = await s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId, create, default));
        Assert.Equal(accepted, await s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId, create, default)));
        var before = (await s.Call(x => x.FullSnapshot(s.Owner, created.FamilyId, default))).ExtraRecords!.Single(x => x.Record.GetProperty("id").GetString() == "member-check");
        var edit = create with { OperationId = Guid.NewGuid(), Kind = "update", BaseVersion = before.Version };
        var racing = await Task.WhenAll(Capture(() => s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId, edit, default))),
            Capture(() => s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId, edit with { OperationId = Guid.NewGuid(), MembershipId = created.MembershipId }, default))));
        Assert.Single(racing, x => x is null);
        Assert.Single(racing, x => x?.Code == "record_changed");
        var current = (await s.Call(x => x.FullSnapshot(s.Owner, created.FamilyId, default))).ExtraRecords!.Single(x => x.Record.GetProperty("id").GetString() == "member-check");
        Assert.Equal(s.Caregiver.ObjectId, current.RecordedBy);
        Assert.NotEqual(before.Version, current.Version);
        await s.Call(x => x.RemoveMember(s.Owner, created.FamilyId, s.Caregiver.ObjectId, s.Context(created.Snapshot.Family, target: grant.MembershipId), default));
        await Code("membership_revoked", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId, create, default)));
        Assert.Contains((await s.Call(x => x.FullSnapshot(s.Owner, created.FamilyId, default))).ExtraRecords!, x => x.Record.GetProperty("id").GetString() == "member-check");
    }

    [SqlFact]
    public async Task ExtraKindCannotBeChangedAndCrossFamilyOperationsCannotLeakRecords()
    {
        var s = new Scenario(sql);
        var created = await s.Call(x => x.CreateFullFamily(s.Owner, Request(s), default));
        var before = created.Snapshot.ExtraRecords!.Single(x => x.Record.GetProperty("id").GetString() == "check-1");
        var reminder = JsonSerializer.SerializeToElement(new { id = "check-1", kind = "reminder", settings = new { kind = "feed", mode = "daily", title = "Feed", minutes = 30, dailyTime = "09:00", silent = true } });
        await Code("invalid_input", () => s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId,
            Operation(s, created.Snapshot.Family, reminder) with { Kind = "update", BaseVersion = before.Version }, default)));
        var other = new Scenario(sql);
        var unrelated = await other.Call(x => x.CreateFullFamily(other.Owner, Request(other), default));
        await Code("membership_revoked", () => s.Call(x => x.ApplyFullRecord(s.Owner, unrelated.FamilyId, Operation(s, created.Snapshot.Family, Checkin("cross-family")), default)));
        Assert.DoesNotContain((await other.Call(x => x.FullSnapshot(other.Owner, unrelated.FamilyId, default))).ExtraRecords!, x => x.Record.GetProperty("id").GetString() == "cross-family");
    }

    [SqlFact]
    public async Task PhotoLargerThanOldRecordLimitUploadsThroughHttpAndIsRemovedOnFamilyClosure()
    {
        var s = new Scenario(sql);
        await using var host = new TestHost(s.Config, sql.ConnectionString);
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", host.Token(s.Owner));
        var created = await s.Call(x => x.CreateFullFamily(s.Owner, Request(s), default));
        var bytes = new byte[100000];
        bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff;
        var dataUrl = "data:image/jpeg;base64," + Convert.ToBase64String(bytes);
        var photo = JsonSerializer.SerializeToElement(new { id = "avatar", kind = "avatar", dataUrl });
        var before = created.Snapshot.ExtraRecords!.Single(x => x.Record.GetProperty("id").GetString() == "avatar");
        var operation = Operation(s, created.Snapshot.Family, photo) with { Kind = "update", BaseVersion = before.Version };
        var response = await client.PostAsJsonAsync($"/v2/families/{created.FamilyId}/record-operations", operation);
        response.EnsureSuccessStatusCode();
        var snapshot = (await client.GetFromJsonAsync<FullFamilySnapshot>($"/v2/families/{created.FamilyId}/snapshot"))!;
        Assert.Equal(dataUrl, snapshot.ExtraRecords!.Single(x => x.Record.GetProperty("id").GetString() == "avatar").Record.GetProperty("dataUrl").GetString());
        await s.Call(x => x.CloseFamily(s.Owner, created.FamilyId, s.Context(snapshot.Family), default));
        await using var db = sql.Open();
        Assert.True(await new DeletionProcessor(db, s.Config, TimeProvider.System, new UnconfiguredAccountIdentityDeletion()).Process(default));
        Assert.Empty(await db.FamilyRecords.Where(x => x.FamilyId == created.FamilyId).ToArrayAsync());
    }

    [SqlFact]
    public async Task OldSnapshotEtagRefreshesAdditiveExtrasEvenWithoutRecordChanges()
    {
        var s = new Scenario(sql);
        var created = await s.Call(x => x.CreateFullFamily(s.Owner, new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed()), default));
        await using var host = new TestHost(s.Config, sql.ConnectionString);
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", host.Token(s.Owner));
        client.DefaultRequestHeaders.IfNoneMatch.ParseAdd($"\"v2:{created.HistoryId:D}:{created.Snapshot.Revision}:{created.MembershipId:D}\"");
        var response = await client.GetAsync($"/v2/families/{created.FamilyId}/snapshot");
        Assert.Equal(System.Net.HttpStatusCode.OK, response.StatusCode);
        var snapshot = (await response.Content.ReadFromJsonAsync<FullFamilySnapshot>())!;
        Assert.Equal(1, snapshot.ExtrasSchemaVersion);
        Assert.Empty(snapshot.ExtraRecords!);
        client.DefaultRequestHeaders.IfNoneMatch.Clear();
        client.DefaultRequestHeaders.IfNoneMatch.Add(response.Headers.ETag!);
        Assert.Equal(System.Net.HttpStatusCode.NotModified, (await client.GetAsync($"/v2/families/{created.FamilyId}/snapshot")).StatusCode);
    }

    [SqlFact]
    public async Task MemberCannotCreateSingletonButNewOwnerCanEditFormerOwnersSingleton()
    {
        var s = new Scenario(sql);
        var created = await s.Call(x => x.CreateFullFamily(s.Owner, Request(s, []), default));
        var grant = await s.Call(x => x.AcceptInvitation(s.Caregiver, Assert.Single(created.Snapshot.Invitations).Id, new(Guid.NewGuid()), default));
        var photo = FamilyExtrasTests.Extras()[0];
        await Code("record_forbidden", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId, Operation(s, grant, photo), default)));
        await s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId, Operation(s, created.Snapshot.Family, photo), default));
        var transfer = await s.Call(x => x.NominateOwner(s.Owner, created.FamilyId,
            new(Guid.NewGuid(), s.Caregiver.ObjectId, created.MembershipId, created.HistoryId), default));
        await s.Call(x => x.AcceptOwnership(s.Caregiver, created.FamilyId, transfer.Id, s.Context(grant), default));
        var before = (await s.Call(x => x.FullSnapshot(s.Caregiver, created.FamilyId, default))).ExtraRecords!.Single();
        var clear = FullDomainTests.Json("""{"id":"avatar","kind":"avatar","dataUrl":null}""");
        await Code("record_forbidden", () => s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId,
            Operation(s, created.Snapshot.Family, clear) with { Kind = "update", BaseVersion = before.Version }, default)));
        await s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId,
            Operation(s, grant, clear) with { Kind = "update", BaseVersion = before.Version }, default));
        Assert.Equal(JsonValueKind.Null, (await s.Call(x => x.FullSnapshot(s.Caregiver, created.FamilyId, default))).ExtraRecords!.Single().Record.GetProperty("dataUrl").ValueKind);
    }

    [SqlFact]
    public async Task UnsupportedExtrasJoinVersionDoesNotCreateMembershipOrConsumeInvitation()
    {
        var s = new Scenario(sql);
        var created = await s.Call(x => x.CreateFullFamily(s.Owner, Request(s), default));
        var invitation = Assert.Single(created.Snapshot.Invitations);
        var unsupported = JsonSerializer.Deserialize<OperationRequest>("""{"operationId":"11111111-3333-4444-aaaa-000000000001","requiredSchemaVersion":2,"requiredExtrasSchemaVersion":2}""", new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        await Code("family_schema_unsupported", () => s.Call(x => x.AcceptInvitation(s.Caregiver, invitation.Id, unsupported, default)));
        Assert.Empty((await s.Call(x => x.Me(s.Caregiver, default))).Families);
        Assert.Single((await s.Call(x => x.Me(s.Caregiver, default))).PendingInvitations);
        var supported = JsonSerializer.Deserialize<OperationRequest>("""{"operationId":"11111111-3333-4444-aaaa-000000000002","requiredSchemaVersion":2,"requiredExtrasSchemaVersion":1}""", new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        var grant = await s.Call(x => x.AcceptInvitation(s.Caregiver, invitation.Id, supported, default));
        var retried = await s.Call(x => x.AcceptInvitation(s.Caregiver, invitation.Id, supported, default));
        Assert.Equal(grant.Id, retried.Id);
        Assert.Equal(grant.MembershipId, retried.MembershipId);
        Assert.Equal(5, (await s.Call(x => x.FullSnapshot(s.Caregiver, created.FamilyId, default))).ExtraRecords!.Length);
    }

    [SqlFact]
    public async Task OldRecordPayloadFingerprintIsByteCompatibleAfterAddingExtras()
    {
        var s = new Scenario(sql);
        var created = await s.Call(x => x.CreateFullFamily(s.Owner, new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed()), default));
        var operation = new FullRecordOperation(Guid.NewGuid(), "legacy-check", created.MembershipId, created.HistoryId, "create", "care", null, null,
            FullDomainTests.Json("""{"id":"legacy-check","kind":"wash","time":"2026-09-16T00:00:00Z","note":""}"""));
        await s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId, operation, default));
        var oldOperation = new { operation.OperationId, operation.RecordId, operation.MembershipId, operation.HistoryId,
            operation.Kind, operation.Collection, operation.BaseVersion, operation.Entry, operation.CareRecord };
        var serialized = JsonSerializer.Serialize(new { familyId = created.FamilyId, operation = oldOperation }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var oldHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("record-v2:" + serialized)));
        await using var db = sql.Open();
        var receipt = await db.Operations.SingleAsync(x => x.OperationId == operation.OperationId && x.UserId == s.Owner.ObjectId);
        Assert.Equal(oldHash, receipt.Fingerprint);
        Assert.Empty(created.Snapshot.ExtraRecords!);
    }

    private static async Task Code<T>(string expected, Func<Task<T>> action) =>
        Assert.Equal(expected, (await Assert.ThrowsAsync<ApiException>(async () => { await action(); })).Code);
    private static async Task<ApiException?> Capture<T>(Func<Task<T>> action)
    {
        try { await action(); return null; } catch (ApiException error) { return error; }
    }
}
