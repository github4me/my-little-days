using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi.Tests;

// Every test in this class requires actual SQL Server. SqlFact reports explicit skips
// when no disposable database is available; in-memory providers cannot prove these rules.
public sealed class FullHistorySqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    private static CreateFullFamilyRequest Request(string[]? emails = null, JsonElement[]? entries = null) =>
        new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed(emails, entries));
    private static JsonElement WithId(JsonElement value, string id)
    {
        var node = JsonNode.Parse(value.GetRawText())!;
        node["id"] = id;
        return FullDomainTests.Json(node.ToJsonString());
    }
    private static FullRecordOperation Create(Scenario s, FamilySummary grant, JsonElement entry) =>
        new(Guid.NewGuid(), entry.GetProperty("id").GetString()!, grant.MembershipId, s.Config.Family.HistoryId, "create", "entry", null, entry, null);

    [SqlFact]
    public async Task PendingInvitationsRequireExplicitCreationConsentAndRemainUntouchedOnFailure()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var invitation = await s.Invite(family.Id);
        var request = Request([s.Other.Email]);
        await Code("invitation_decline_consent_required", () => s.Call(x => x.CreateFullFamily(s.Caregiver, request, default)));
        Assert.Single((await s.Call(x => x.Me(s.Caregiver, default))).PendingInvitations);
        Assert.Empty((await s.Call(x => x.Me(s.Caregiver, default))).Families);
        Assert.Equal("pending", Assert.Single((await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).Invitations).Status);
    }

    [SqlFact]
    public async Task CreationFailureAfterSqlFlushRollsBackFamilyAndAutomaticDeclines()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        await s.Invite(family.Id);
        var before = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        await using (var db = sql.Open())
        {
            // Fail after SQL has written the new family, receipt and invitation state,
            // but before the shared transaction commits. Nothing may escape rollback.
            db.SavedChanges += (_, _) => throw new InvalidOperationException("Simulated post-flush failure");
            var service = new FamilyService(db, s.Config, TimeProvider.System);
            await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateFullFamily(s.Caregiver,
                WithDeclineConsent(Request([s.Other.Email])), default));
        }
        var after = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        Assert.Equal(before.Revision, after.Revision);
        Assert.Equal("pending", Assert.Single(after.Invitations).Status);
        Assert.Empty((await s.Call(x => x.Me(s.Caregiver, default))).Families);
        Assert.Single((await s.Call(x => x.Me(s.Caregiver, default))).PendingInvitations);
    }

    [SqlFact]
    public async Task JoinedMemberCannotCreateASecondFamilyEvenWithDeclineConsent()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        await s.Accept(await s.Invite(family.Id));
        await Code("already_in_family", () => s.Call(x => x.CreateFullFamily(s.Caregiver,
            WithDeclineConsent(Request([s.Other.Email])), default)));
        Assert.Equal(family.Id, Assert.Single((await s.Call(x => x.Me(s.Caregiver, default))).Families).Id);
    }

    private static CreateFullFamilyRequest WithDeclineConsent(CreateFullFamilyRequest request) =>
        JsonSerializer.Deserialize<CreateFullFamilyRequest>(JsonSerializer.Serialize(new
        {
            request.OperationId, request.ConsentRevision, request.Seed, DeclinePendingInvitations = true
        }))!;

    [SqlFact]
    public async Task CreatingFamilyDeclinesOnlyLiveReceivedInvitationsAtomicallyAndRetryDoesNotDeclineNewOnes()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var invitation = await s.Invite(family.Id);
        var expiredId = Guid.NewGuid();
        var revokedId = Guid.NewGuid();
        var otherId = Guid.NewGuid();
        await using (var db = sql.Open())
        {
            db.Invitations.AddRange(
                new InvitationRow { Id = expiredId, FamilyId = family.Id, Email = s.Caregiver.Email, Status = "expired", CreatedAt = DateTimeOffset.UtcNow.AddDays(-31), ExpiresAt = DateTimeOffset.UtcNow.AddDays(-1) },
                new InvitationRow { Id = revokedId, FamilyId = family.Id, Email = s.Caregiver.Email, Status = "revoked", CreatedAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddDays(30) },
                new InvitationRow { Id = otherId, FamilyId = family.Id, Email = s.Other.Email, CreatedAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddDays(30) });
            await db.SaveChangesAsync();
        }
        var before = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        var request = WithDeclineConsent(Request([s.Other.Email]));
        var created = await s.Call(x => x.CreateFullFamily(s.Caregiver, request, default));
        var after = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        var declined = after.Invitations.Single(x => x.Id == invitation.Invitation.Id);
        Assert.Equal("expired", after.Invitations.Single(x => x.Id == expiredId).Status);
        Assert.Equal("revoked", after.Invitations.Single(x => x.Id == revokedId).Status);
        Assert.Equal("pending", after.Invitations.Single(x => x.Id == otherId).Status);
        Assert.Equal("declined", declined.Status);
        Assert.Equal("created_family", JsonSerializer.SerializeToElement(declined).GetProperty("DeclineReason").GetString());
        Assert.NotEqual(before.Revision, after.Revision);
        Assert.Equal("pending", Assert.Single(created.Snapshot.Invitations).Status);
        await Code("invitation_unavailable", () => s.Accept(invitation));
        var fresh = await s.Invite(family.Id);
        Assert.Empty((await s.Call(x => x.Me(s.Caregiver, default))).PendingInvitations);
        var retried = await s.Call(x => x.CreateFullFamily(s.Caregiver, request, default));
        Assert.Equal(created.FamilyId, retried.FamilyId);
        Assert.Equal("pending", (await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).Invitations.Single(x => x.Id == fresh.Invitation.Id).Status);
        await Code("already_in_family", () => s.Call(x => x.CreateFullFamily(s.Caregiver, WithDeclineConsent(Request([s.Other.Email])), default)));
        Assert.Equal("pending", (await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).Invitations.Single(x => x.Id == fresh.Invitation.Id).Status);
    }

    [SqlFact]
    public async Task SeedAndConcurrentRetriesHaveOneAtomicDurableFamilyAndNoSnapshotInReceipt()
    {
        var s = new Scenario(sql);
        var request = Request([s.Caregiver.Email]);
        var results = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => s.Call(x => x.CreateFullFamily(s.Owner, request, default))));
        var first = results[0];
        Assert.Single(results.Select(x => x.FamilyId).Distinct());
        Assert.Single(results.Select(x => x.MembershipId).Distinct());
        Assert.Single(results.Select(x => x.SeedDigest).Distinct());
        Assert.Equal(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(request.Seed.GetRawText()))).ToLowerInvariant(), first.SeedDigest);
        Assert.Equal(6, first.Snapshot.Entries.Length);
        Assert.Single(first.Snapshot.CareRecords);
        Assert.Single(first.Snapshot.Invitations);
        Assert.Equal(FullDomainValidation.Profile(FullDomainTests.Profile()), first.Snapshot.Profile);
        Assert.All(first.Snapshot.Entries, x => Assert.Equal(s.Owner.ObjectId, x.RecordedBy));
        Assert.Equal(123.456m, first.Snapshot.Entries.Single(x => x.Entry.GetProperty("id").GetString() == "local-bottle").Entry.GetProperty("amount").GetDecimal());
        await using var db = sql.Open();
        Assert.Equal(7, await db.FamilyRecords.CountAsync(x => x.FamilyId == first.FamilyId));
        var receipt = Assert.Single(await db.Operations.Where(x => x.UserId == s.Owner.ObjectId).ToArrayAsync());
        Assert.DoesNotContain("Luna", receipt.ResultJson);
        Assert.DoesNotContain("Milk", receipt.ResultJson);
        Assert.DoesNotContain(s.Caregiver.Email, receipt.ResultJson);
        Assert.True(receipt.ResultJson.Length < 100);
        Assert.Contains(first.SeedDigest, receipt.ResultJson);
        await Code("operation_reused", () => s.Call(x => x.CreateFullFamily(s.Owner, request with { Seed = FullDomainTests.Seed() }, default)));
        await Code("already_in_family", () => s.Call(x => x.CreateFullFamily(s.Owner, Request(), default)));
    }

    [SqlFact]
    public async Task SeedCommitDigestSurvivesLaterEditsAndRetryReturnsCurrentAuthorizedSnapshot()
    {
        var s = new Scenario(sql);
        var request = Request();
        var created = await s.Call(x => x.CreateFullFamily(s.Owner, request, default));
        var entry = created.Snapshot.Entries[0];
        await s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId,
            new(Guid.NewGuid(), entry.Entry.GetProperty("id").GetString()!, created.MembershipId, created.HistoryId,
                "delete", "entry", entry.Version, null, null), default));
        var retry = await s.Call(x => x.CreateFullFamily(s.Owner, request, default));
        Assert.Equal(created.SeedDigest, retry.SeedDigest);
        Assert.Equal(created.MembershipId, retry.MembershipId);
        Assert.Equal(created.Snapshot.Entries.Length - 1, retry.Snapshot.Entries.Length);
        Assert.NotEqual(created.Snapshot.Revision, retry.Snapshot.Revision);
    }

    [SqlFact]
    public async Task InvalidSeedLeavesNoFamilyGrantRecordsInvitationOrReceipt()
    {
        var s = new Scenario(sql);
        var invalid = JsonNode.Parse(FullDomainTests.Seed([s.Caregiver.Email]).GetRawText())!;
        invalid["counts"]!["care"] = 0;
        await Code("invalid_input", () => s.Call(x => x.CreateFullFamily(s.Owner,
            new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Json(invalid.ToJsonString())), default)));
        await using var db = sql.Open();
        Assert.False(await db.Memberships.AnyAsync(x => x.UserId == s.Owner.ObjectId));
        Assert.False(await db.Operations.AnyAsync(x => x.UserId == s.Owner.ObjectId));
        Assert.False(await db.Invitations.AnyAsync(x => x.Email == s.Caregiver.Email));
        var retry = await s.Call(x => x.CreateFullFamily(s.Owner, Request(), default));
        Assert.Equal(7, retry.Snapshot.Entries.Length + retry.Snapshot.CareRecords.Length);
    }

    [SqlFact]
    public async Task SourceIdsRemainDistinctAcrossCaseTrailingSpacesAndCollections()
    {
        var s = new Scenario(sql);
        var entry = FullDomainTests.Entries()[2];
        var source = new[] { WithId(entry, "id"), WithId(entry, "ID"), WithId(entry, "id "), WithId(entry, "care-id") };
        var family = await s.Call(x => x.CreateFullFamily(s.Owner, Request(entries: source), default));
        Assert.Equal(4, family.Snapshot.Entries.Length);
        Assert.Single(family.Snapshot.CareRecords);
        Assert.Equal(source.Select(x => x.GetProperty("id").GetString()).Order(StringComparer.Ordinal),
            family.Snapshot.Entries.Select(x => x.Entry.GetProperty("id").GetString()).Order(StringComparer.Ordinal));
    }

    [SqlFact]
    public async Task InvitationAcceptDownloadsOwnerHistoryAndLegacyWritesCannotAlterIt()
    {
        var s = new Scenario(sql);
        var created = await s.Call(x => x.CreateFullFamily(s.Owner, Request([s.Caregiver.Email]), default));
        var invited = Assert.Single((await s.Call(x => x.Me(s.Caregiver, default))).PendingInvitations);
        var grant = await s.Call(x => x.AcceptInvitation(s.Caregiver, invited.Id, new(Guid.NewGuid()), default));
        var snapshot = await s.Call(x => x.FullSnapshot(s.Caregiver, created.FamilyId, default));
        Assert.Equal(created.Snapshot.Entries.Length, snapshot.Entries.Length);
        Assert.All(snapshot.Entries, x => Assert.Equal(s.Owner.ObjectId, x.RecordedBy));
        Assert.Empty(snapshot.Invitations);
        await Code("family_schema_unsupported", () => s.Call(x => x.ApplyFeed(s.Owner, created.FamilyId, s.CreateFeed(created.Snapshot.Family), default)));
        await Code("family_schema_unsupported", () => s.Call(x => x.UpdateProfile(s.Owner, created.FamilyId,
            new(Guid.NewGuid(), snapshot.Family.ProfileVersion, "Legacy", null, created.MembershipId, created.HistoryId), default)));
        var legacyScenario = new Scenario(sql);
        var legacy = await legacyScenario.Create();
        await Code("family_schema_unsupported", () => legacyScenario.Call(x => x.FullSnapshot(legacyScenario.Owner, legacy.Id, default)));
        Assert.Equal(grant.MembershipId, snapshot.Family.MembershipId);
    }

    [SqlFact]
    public async Task PermissionsRowversionsTombstonesAndIndependentRunningTimersAreEnforced()
    {
        var s = new Scenario(sql);
        var created = await s.Call(x => x.CreateFullFamily(s.Owner, Request([s.Caregiver.Email]), default));
        var grant = await s.Call(x => x.AcceptInvitation(s.Caregiver, Assert.Single(created.Snapshot.Invitations).Id, new(Guid.NewGuid()), default));
        var ownerEntry = created.Snapshot.Entries[0];
        var forbidden = new FullRecordOperation(Guid.NewGuid(), ownerEntry.Entry.GetProperty("id").GetString()!, grant.MembershipId,
            created.HistoryId, "delete", "entry", ownerEntry.Version, null, null);
        await Code("record_forbidden", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId, forbidden, default)));
        var timer = FullDomainTests.Json("""{"id":"timer-caregiver","type":"sleep","start":"2026-09-01T10:00:00Z","note":""}""");
        var operation = Create(s, grant, timer);
        var receipt = await s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId, operation, default));
        Assert.Equal(receipt, await s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId, operation, default)));
        await s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId,
            Create(s, created.Snapshot.Family, WithId(timer, "timer-owner")), default));
        var before = await s.Call(x => x.FullSnapshot(s.Owner, created.FamilyId, default));
        Assert.Equal(2, before.Entries.Count(x => x.Entry.GetProperty("type").GetString() == "sleep" && !x.Entry.TryGetProperty("end", out _)));
        var own = before.Entries.Single(x => x.Entry.GetProperty("id").GetString() == "timer-caregiver");
        var update = operation with { OperationId = Guid.NewGuid(), Kind = "update", BaseVersion = own.Version };
        var racing = await Task.WhenAll(Capture(() => s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId, update, default))),
            Capture(() => s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId, update with { OperationId = Guid.NewGuid(), MembershipId = created.MembershipId }, default))));
        Assert.Single(racing, x => x is null);
        Assert.Single(racing, x => x?.Code == "record_changed");
        var after = (await s.Call(x => x.FullSnapshot(s.Owner, created.FamilyId, default))).Entries.Single(x => x.Entry.GetProperty("id").GetString() == "timer-caregiver");
        Assert.NotEqual(own.Version, after.Version);
        Assert.Equal(s.Caregiver.ObjectId, after.RecordedBy);
        await s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId, update with
            { OperationId = Guid.NewGuid(), MembershipId = created.MembershipId, Kind = "delete", BaseVersion = after.Version, Entry = null }, default));
        await Code("record_changed", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId, operation with { OperationId = Guid.NewGuid() }, default)));
        await Code("history_changed", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId, operation with { HistoryId = Guid.NewGuid() }, default)));
        await s.Remove(created.Snapshot.Family, s.Caregiver.ObjectId);
        await Code("membership_revoked", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId, operation, default)));
        var regrant = await s.Accept(await s.Invite(created.FamilyId));
        Assert.NotEqual(grant.MembershipId, regrant.MembershipId);
        await Code("membership_changed", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, created.FamilyId, operation, default)));
    }

    [SqlFact]
    public async Task ProfileIncludesSexUsesVersionAndRequiresOwner()
    {
        var s = new Scenario(sql);
        var created = await s.Call(x => x.CreateFullFamily(s.Owner, Request([s.Caregiver.Email]), default));
        var grant = await s.Call(x => x.AcceptInvitation(s.Caregiver, Assert.Single(created.Snapshot.Invitations).Id, new(Guid.NewGuid()), default));
        var before = await s.Call(x => x.FullSnapshot(s.Owner, created.FamilyId, default));
        var request = new FullProfileRequest(Guid.NewGuid(), created.MembershipId, created.HistoryId, before.Family.ProfileVersion,
            FullDomainTests.Json("""{"name":"Updated","birthDate":"2026-02-01","sex":"male"}"""));
        await Code("forbidden", () => s.Call(x => x.UpdateFullProfile(s.Caregiver, created.FamilyId, request with { MembershipId = grant.MembershipId }, default)));
        var updated = await s.Call(x => x.UpdateFullProfile(s.Owner, created.FamilyId, request, default));
        Assert.NotEqual(before.Family.ProfileVersion, updated.ProfileVersion);
        Assert.Equal(updated, await s.Call(x => x.UpdateFullProfile(s.Owner, created.FamilyId, request, default)));
        await Code("profile_changed", () => s.Call(x => x.UpdateFullProfile(s.Owner, created.FamilyId, request with { OperationId = Guid.NewGuid() }, default)));
        var after = await s.Call(x => x.FullSnapshot(s.Owner, created.FamilyId, default));
        Assert.Equal("male", after.Profile.Sex);
        Assert.Equal("Updated", after.Profile.Name);
    }

    [SqlFact]
    public async Task HttpLargeSeedAndConditionalFullSnapshotReauthorizeAfterRemoval()
    {
        var s = new Scenario(sql);
        await using var host = new TestHost(s.Config, sql.ConnectionString);
        using var owner = host.CreateClient();
        owner.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", host.Token(s.Owner));
        var note = JsonNode.Parse(FullDomainTests.Entries()[2].GetRawText())!;
        note["note"] = new string('宝', 10000);
        var request = Request([s.Caregiver.Email], [FullDomainTests.Json(note.ToJsonString())]);
        var wireSeed = request.Seed.GetRawText();
        var body = "{\"operationId\":\"" + request.OperationId + "\",\"consentRevision\":\"family-sharing-v1\",\"seed\":" + wireSeed + "}";
        var response = await owner.PostAsync("/v2/families", new StringContent(body, System.Text.Encoding.UTF8, "application/json"));
        response.EnsureSuccessStatusCode();
        var created = (await response.Content.ReadFromJsonAsync<CreateFullFamilyResult>())!;
        Assert.Equal(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(wireSeed))).ToLowerInvariant(), created.SeedDigest);
        using var member = host.CreateClient();
        member.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", host.Token(s.Caregiver));
        var accepted = await member.PostAsJsonAsync($"/v1/invitations/{Assert.Single(created.Snapshot.Invitations).Id}/accept", new OperationRequest(Guid.NewGuid()));
        accepted.EnsureSuccessStatusCode();
        var grant = (await accepted.Content.ReadFromJsonAsync<FamilySummary>())!;
        var snapshot = await member.GetAsync($"/v2/families/{created.FamilyId}/snapshot");
        snapshot.EnsureSuccessStatusCode();
        member.DefaultRequestHeaders.IfNoneMatch.Add(snapshot.Headers.ETag!);
        Assert.Equal(HttpStatusCode.NotModified, (await member.GetAsync($"/v2/families/{created.FamilyId}/snapshot")).StatusCode);
        var remove = await owner.PostAsJsonAsync($"/v1/families/{created.FamilyId}/members/{s.Caregiver.ObjectId}/remove", s.Context(created.Snapshot.Family, target: grant.MembershipId));
        remove.EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync($"/v2/families/{created.FamilyId}/snapshot")).StatusCode);
    }

    private static async Task Code<T>(string expected, Func<Task<T>> action) =>
        Assert.Equal(expected, (await Assert.ThrowsAsync<ApiException>(async () => { await action(); })).Code);
    private static async Task<ApiException?> Capture<T>(Func<Task<T>> action)
    {
        try { await action(); return null; } catch (ApiException error) { return error; }
    }
}
