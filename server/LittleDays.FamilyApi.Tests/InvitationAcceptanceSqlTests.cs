using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi.Tests;

public sealed class InvitationAcceptanceSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [Fact]
    public void DefaultOperationRequestKeepsLegacySerializedShape()
    {
        var request = new OperationRequest(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Assert.Equal(JsonSerializer.Serialize(new { request.OperationId, request.MembershipId, request.HistoryId, request.TargetMembershipId }, options),
            JsonSerializer.Serialize(request, options));
    }

    [SqlFact]
    public async Task AcceptanceWithoutConsentLeavesMembershipInvitationsRevisionsAndReceiptUnchanged()
    {
        var s = new Scenario(sql);
        var chosen = await CreateChoice(s);
        var other = await CreateOtherInvitation(s.Caregiver.Email);
        var request = new OperationRequest(Guid.NewGuid());
        var before = await s.Call(x => x.FullSnapshot(s.Owner, chosen.FamilyId, default));
        var otherBefore = await other.Source.Call(x => x.Snapshot(other.Source.Owner, other.Family.Id, default));
        await Code("invitation_decline_consent_required", () => s.Call(x => x.AcceptInvitation(s.Caregiver,
            Assert.Single(chosen.Snapshot.Invitations).Id, request, default)));
        var after = await s.Call(x => x.FullSnapshot(s.Owner, chosen.FamilyId, default));
        var otherAfter = await other.Source.Call(x => x.Snapshot(other.Source.Owner, other.Family.Id, default));
        Assert.Equal(before.Revision, after.Revision);
        Assert.Equal(otherBefore.Revision, otherAfter.Revision);
        Assert.Equal("pending", Assert.Single(after.Invitations).Status);
        Assert.Equal("pending", Assert.Single(otherAfter.Invitations).Status);
        Assert.Empty((await s.Call(x => x.Me(s.Caregiver, default))).Families);
        await using var db = sql.Open();
        Assert.False(await db.Operations.AnyAsync(x => x.UserId == s.Caregiver.ObjectId && x.OperationId == request.OperationId));
    }

    [SqlFact]
    public async Task AcceptanceDeclinesOnlyOtherLiveInvitationsAndRetryLeavesLaterInvitationsAlone()
    {
        var s = new Scenario(sql);
        var chosen = await CreateChoice(s);
        var other = await CreateOtherInvitation(s.Caregiver.Email);
        var another = await CreateOtherInvitation(s.Caregiver.Email);
        var expired = await CreateOtherInvitation(s.Caregiver.Email);
        var closed = await CreateOtherInvitation(s.Caregiver.Email);
        var revokedId = Guid.NewGuid();
        var otherRecipientId = Guid.NewGuid();
        await using (var db = sql.Open())
        {
            (await db.Invitations.SingleAsync(x => x.Id == expired.Invitation.Invitation.Id)).ExpiresAt = DateTimeOffset.UtcNow.AddDays(-1);
            (await db.Families.SingleAsync(x => x.Id == closed.Family.Id)).DeletedAt = DateTimeOffset.UtcNow;
            db.Invitations.AddRange(
                new InvitationRow { Id = revokedId, FamilyId = other.Family.Id, Email = s.Caregiver.Email, Status = "revoked", CreatedAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddDays(30) },
                new InvitationRow { Id = otherRecipientId, FamilyId = other.Family.Id, Email = s.Other.Email, CreatedAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddDays(30) });
            await db.SaveChangesAsync();
        }
        var before = await other.Source.Call(x => x.Snapshot(other.Source.Owner, other.Family.Id, default));
        var anotherBefore = await another.Source.Call(x => x.Snapshot(another.Source.Owner, another.Family.Id, default));
        var chosenId = Assert.Single(chosen.Snapshot.Invitations).Id;
        var request = AcceptRequest(Guid.NewGuid());
        await using var host = new TestHost(s.Config, sql.ConnectionString);
        using var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(s.Caregiver));
        var response = await client.PostAsJsonAsync($"/v1/invitations/{chosenId}/accept", request);
        response.EnsureSuccessStatusCode();
        var grant = (await response.Content.ReadFromJsonAsync<FamilySummary>())!;
        Assert.Equal(chosen.FamilyId, grant.Id);
        var chosenAfter = await s.Call(x => x.FullSnapshot(s.Owner, chosen.FamilyId, default));
        Assert.Equal("accepted", Assert.Single(chosenAfter.Invitations).Status);
        Assert.Equal(2, chosenAfter.Members.Length);
        var after = await other.Source.Call(x => x.Snapshot(other.Source.Owner, other.Family.Id, default));
        var declined = after.Invitations.Single(x => x.Id == other.Invitation.Invitation.Id);
        Assert.Equal("declined", declined.Status);
        Assert.Equal("joined_family", declined.DeclineReason);
        Assert.Equal(long.Parse(before.Revision) + 1, long.Parse(after.Revision));
        var anotherAfter = await another.Source.Call(x => x.Snapshot(another.Source.Owner, another.Family.Id, default));
        Assert.Equal("joined_family", Assert.Single(anotherAfter.Invitations).DeclineReason);
        Assert.Equal(long.Parse(anotherBefore.Revision) + 1, long.Parse(anotherAfter.Revision));
        await using (var db = sql.Open())
        {
            Assert.Equal("pending", (await db.Invitations.SingleAsync(x => x.Id == expired.Invitation.Invitation.Id)).Status);
            Assert.Equal("pending", (await db.Invitations.SingleAsync(x => x.Id == closed.Invitation.Invitation.Id)).Status);
            Assert.Equal("revoked", (await db.Invitations.SingleAsync(x => x.Id == revokedId)).Status);
            Assert.Equal("pending", (await db.Invitations.SingleAsync(x => x.Id == otherRecipientId)).Status);
            var declinedRow = await db.Invitations.SingleAsync(x => x.Id == other.Invitation.Invitation.Id);
            Assert.Equal(s.Caregiver.ObjectId, declinedRow.RecipientUserId);
            Assert.Null(declinedRow.AcceptedMembershipId);
        }
        var fresh = await other.Source.Call(x => x.CreateInvitation(other.Source.Owner, other.Family.Id,
            other.Source.Invitation(other.Family, s.Caregiver.Email), default));
        var retried = await s.Call(x => x.AcceptInvitation(s.Caregiver, chosenId, request, default));
        Assert.Equal(grant.MembershipId, retried.MembershipId);
        await Code("already_in_family", () => s.Call(x => x.AcceptInvitation(s.Caregiver, fresh.Invitation.Id,
            AcceptRequest(Guid.NewGuid(), schema: null), default)));
        await Code("operation_reused", () => s.Call(x => x.AcceptInvitation(s.Caregiver, chosenId,
            AcceptRequest(request.OperationId, consent: false), default)));
        await Code("operation_reused", () => s.Call(x => x.AcceptInvitation(s.Caregiver, chosenId,
            AcceptRequest(request.OperationId, schema: 1), default)));
        var freshSnapshot = await other.Source.Call(x => x.Snapshot(other.Source.Owner, other.Family.Id, default));
        Assert.Equal("pending", freshSnapshot.Invitations.Single(x => x.Id == fresh.Invitation.Id).Status);
    }

    [SqlFact]
    public async Task AcceptanceFailureAfterSqlFlushRollsBackGrantDeclinesRevisionsAndReceipt()
    {
        var s = new Scenario(sql);
        var chosen = await CreateChoice(s);
        var other = await CreateOtherInvitation(s.Caregiver.Email);
        var before = await other.Source.Call(x => x.Snapshot(other.Source.Owner, other.Family.Id, default));
        var request = AcceptRequest(Guid.NewGuid());
        await using (var db = sql.Open())
        {
            db.SavedChanges += (_, _) => throw new InvalidOperationException("Simulated post-flush failure");
            await Assert.ThrowsAsync<InvalidOperationException>(() => new FamilyService(db, s.Config, TimeProvider.System)
                .AcceptInvitation(s.Caregiver, Assert.Single(chosen.Snapshot.Invitations).Id, request, default));
        }
        var chosenAfter = await s.Call(x => x.FullSnapshot(s.Owner, chosen.FamilyId, default));
        Assert.Equal(chosen.Snapshot.Revision, chosenAfter.Revision);
        Assert.Equal("pending", Assert.Single(chosenAfter.Invitations).Status);
        Assert.Single(chosenAfter.Members);
        var after = await other.Source.Call(x => x.Snapshot(other.Source.Owner, other.Family.Id, default));
        Assert.Equal(before.Revision, after.Revision);
        Assert.Equal("pending", Assert.Single(after.Invitations).Status);
        await using var verification = sql.Open();
        Assert.False(await verification.Operations.AnyAsync(x => x.UserId == s.Caregiver.ObjectId && x.OperationId == request.OperationId));
        Assert.False(await verification.Memberships.AnyAsync(x => x.UserId == s.Caregiver.ObjectId));
    }

    [SqlFact]
    public async Task FullClientRejectsLegacyFamilyBeforeGrantingOrDecliningAndLegacyCallerCanStillJoin()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var chosen = await s.Invite(family.Id);
        var other = await CreateOtherInvitation(s.Caregiver.Email);
        var before = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        await Code("family_schema_unsupported", () => s.Call(x => x.AcceptInvitation(s.Caregiver,
            chosen.Invitation.Id, AcceptRequest(Guid.NewGuid()), default)));
        var after = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        Assert.Equal(before.Revision, after.Revision);
        Assert.Single(after.Members);
        Assert.Equal("pending", Assert.Single(after.Invitations).Status);
        Assert.Equal("pending", Assert.Single((await other.Source.Call(x => x.Snapshot(other.Source.Owner, other.Family.Id, default))).Invitations).Status);
        var legacy = await s.Call(x => x.AcceptInvitation(s.Caregiver, chosen.Invitation.Id,
            AcceptRequest(Guid.NewGuid(), schema: null), default));
        Assert.Equal(family.Id, legacy.Id);
    }

    [SqlFact]
    public async Task LegacyCreationCannotBypassConsentButItsSuccessfulReceiptsStillReplay()
    {
        var s = new Scenario(sql);
        var request = new CreateFamilyRequest(Guid.NewGuid(), "Test baby");
        var family = await s.Call(x => x.CreateFamily(s.Owner, request, default));
        await s.Invite(family.Id);
        var rejected = new CreateFamilyRequest(Guid.NewGuid(), "Not created");
        await Code("invitation_decline_consent_required", () => s.Call(x => x.CreateFamily(s.Caregiver, rejected, default)));
        Assert.Empty((await s.Call(x => x.Me(s.Caregiver, default))).Families);
        Assert.Equal("pending", Assert.Single((await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).Invitations).Status);
        var receivedLater = await CreateOtherInvitation(s.Owner.Email);
        var retry = await s.Call(x => x.CreateFamily(s.Owner, request, default));
        Assert.Equal(family.MembershipId, retry.MembershipId);
        Assert.Equal("pending", Assert.Single((await receivedLater.Source.Call(x => x.Snapshot(receivedLater.Source.Owner, receivedLater.Family.Id, default))).Invitations).Status);
        await using var db = sql.Open();
        Assert.False(await db.Operations.AnyAsync(x => x.UserId == s.Caregiver.ObjectId && x.OperationId == rejected.OperationId));
    }

    [SqlFact]
    public async Task DefaultAcceptanceKeepsLegacyFingerprintAndDoesNotDeclineInvitationsOnRetry()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var invitation = await s.Invite(family.Id);
        var request = new OperationRequest(Guid.NewGuid());
        var grant = await s.Call(x => x.AcceptInvitation(s.Caregiver, invitation.Invitation.Id, request, default));
        var expected = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("accept-invitation:" +
            JsonSerializer.Serialize(new { request.OperationId, invitationId = invitation.Invitation.Id }, new JsonSerializerOptions(JsonSerializerDefaults.Web)))));
        await using (var db = sql.Open())
            Assert.Equal(expected, (await db.Operations.SingleAsync(x => x.UserId == s.Caregiver.ObjectId && x.OperationId == request.OperationId)).Fingerprint);
        var other = await CreateOtherInvitation(s.Caregiver.Email);
        var retry = await s.Call(x => x.AcceptInvitation(s.Caregiver, invitation.Invitation.Id, request, default));
        Assert.Equal(grant.MembershipId, retry.MembershipId);
        Assert.Equal("pending", Assert.Single((await other.Source.Call(x => x.Snapshot(other.Source.Owner, other.Family.Id, default))).Invitations).Status);
    }

    private static OperationRequest AcceptRequest(Guid operationId, bool consent = true, int? schema = 2) =>
        JsonSerializer.Deserialize<OperationRequest>(JsonSerializer.Serialize(new
        {
            OperationId = operationId, DeclineOtherInvitations = consent, RequiredSchemaVersion = schema
        }))!;

    private static Task<CreateFullFamilyResult> CreateChoice(Scenario s) => s.Call(x => x.CreateFullFamily(s.Owner,
        new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed([s.Caregiver.Email])), default));

    private async Task<(Scenario Source, FamilySummary Family, InvitationResult Invitation)> CreateOtherInvitation(string email)
    {
        var source = new Scenario(sql);
        var family = await source.Create();
        var invitation = await source.Call(x => x.CreateInvitation(source.Owner, family.Id, source.Invitation(family, email), default));
        return (source, family, invitation);
    }

    private static async Task Code<T>(string expected, Func<Task<T>> action) =>
        Assert.Equal(expected, (await Assert.ThrowsAsync<ApiException>(async () => { await action(); })).Code);
}
