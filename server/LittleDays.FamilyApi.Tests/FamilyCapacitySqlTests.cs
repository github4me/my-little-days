using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi.Tests;

public sealed class FamilyCapacitySqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task CreationAllowsFiveInviteesButRejectsSixWithoutWritingFamilyOrDecliningInbox()
    {
        var s = new Scenario(sql);
        s.Config.Pilot.MaxMembers = 20; // Existing deployment configuration cannot expand the product limit.
        var source = await s.Create();
        var received = await s.Invite(source.Id);
        var request = new CreateFullFamilyRequest(Guid.NewGuid(), "family-sharing-v1",
            FullDomainTests.Seed(Emails(6)), DeclinePendingInvitations: true);
        await Code("invitation_limit", () => s.Call(x => x.CreateFullFamily(s.Caregiver, request, default)));
        var me = await s.Call(x => x.Me(s.Caregiver, default));
        Assert.Empty(me.Families);
        Assert.Equal(received.Invitation.Id, Assert.Single(me.PendingInvitations).Id);

        var valid = request with { OperationId = Guid.NewGuid(), Seed = FullDomainTests.Seed(Emails(5)) };
        var created = await s.Call(x => x.CreateFullFamily(s.Caregiver, valid, default));
        Assert.Single(created.Snapshot.Members);
        Assert.Equal(5, created.Snapshot.Invitations.Length);
        Assert.All(created.Snapshot.Invitations, x => Assert.Equal("pending", x.Status));
        s.Config.Pilot.MaxMembers = 2;
        var replay = await s.Call(x => x.CreateFullFamily(s.Caregiver, valid, default));
        Assert.Equal(created.FamilyId, replay.FamilyId);
        Assert.Equal(5, replay.Snapshot.Invitations.Length);
    }

    [SqlFact]
    public async Task FiveReservationsBlockNewEmailButAllowReplacementAndDurableRetry()
    {
        var s = new Scenario(sql);
        s.Config.Pilot.MaxMembers = 20;
        var family = await s.Create();
        var originalRequest = s.Invitation(family, "person0@example.test");
        var original = await s.Call(x => x.CreateInvitation(s.Owner, family.Id, originalRequest, default));
        foreach (var email in Emails(5).Skip(1)) await Invite(s, family, email);
        await Code("invitation_limit", () => Invite(s, family, "extra@example.test"));
        var replacement = await Invite(s, family, " PERSON0@EXAMPLE.TEST ");
        Assert.NotEqual(original.Invitation.Id, replacement.Invitation.Id);
        var replay = await s.Call(x => x.CreateInvitation(s.Owner, family.Id, originalRequest, default));
        Assert.Equal(original.Invitation.Id, replay.Invitation.Id);
        Assert.Equal("revoked", replay.Invitation.Status);
        var snapshot = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        Assert.Equal(5, snapshot.Invitations.Count(x => x.Status == "pending"));
    }

    [SqlFact]
    public async Task ActiveMembersAndPendingInvitationsShareSlotsAndLeavingReleasesOne()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var invitation = await s.Invite(family.Id);
        var member = await s.Accept(invitation);
        foreach (var email in Emails(4)) await Invite(s, family, email);
        await Code("invitation_limit", () => Invite(s, family, "extra@example.test"));
        await Code("invitation_already_created", () => Invite(s, family, s.Caregiver.Email));
        await s.Call(x => x.Leave(s.Caregiver, family.Id, s.Context(member), default));
        await Invite(s, family, "extra@example.test");
        var snapshot = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        Assert.Single(snapshot.Members, x => x.Status == "active");
        Assert.Equal(5, snapshot.Invitations.Count(x => x.Status == "pending"));
    }

    [SqlFact]
    public async Task DeclinedRevokedAndExpiredInvitationsReleaseTheirReservation()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var declined = await s.Invite(family.Id);
        var revoked = await Invite(s, family, s.Other.Email);
        foreach (var email in Emails(3)) await Invite(s, family, email);
        await Code("invitation_limit", () => Invite(s, family, "extra@example.test"));
        await s.Call(x => x.DeclineInvitation(s.Caregiver, declined.Invitation.Id, new(Guid.NewGuid()), default));
        await Invite(s, family, "after-decline@example.test");
        await s.Call(x => x.RevokeInvitation(s.Owner, family.Id, revoked.Invitation.Id, s.Context(family), default));
        await Invite(s, family, "after-revoke@example.test");
        await using (var db = sql.Open())
        {
            var expiring = await db.Invitations.SingleAsync(x => x.FamilyId == family.Id && x.Email == "person0@example.test");
            expiring.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
            await db.SaveChangesAsync();
        }
        await Invite(s, family, "after-expiry@example.test");
        await Code("invitation_limit", () => Invite(s, family, "still-full@example.test"));
    }

    [SqlFact]
    public async Task ConcurrentInvitationsCannotReserveMoreThanFiveSlots()
    {
        var s = new Scenario(sql);
        s.Config.Pilot.MaxMembers = 20;
        var family = await s.Create();
        var outcomes = await Task.WhenAll(Emails(6).Select(async email =>
        {
            try { await Invite(s, family, email); return "accepted"; }
            catch (ApiException error) { return error.Code; }
        }));
        Assert.Equal(5, outcomes.Count(x => x == "accepted"));
        Assert.Equal("invitation_limit", Assert.Single(outcomes, x => x != "accepted"));
        Assert.Equal(5, (await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).Invitations.Length);
    }

    [SqlFact]
    public async Task LegacyReservedInvitationsCanFillButNeverExceedSixActiveMembers()
    {
        var s = new Scenario(sql);
        s.Config.Pilot.MaxMembers = 20;
        var family = await s.Create();
        var first = await s.Invite(family.Id);
        var second = await Invite(s, family, s.Other.Email);
        await using (var db = sql.Open())
        {
            for (var i = 0; i < 4; i++) db.Memberships.Add(new MembershipRow
            {
                Id = Guid.NewGuid(), FamilyId = family.Id, UserId = Guid.NewGuid(),
                Email = $"legacy{i}@example.test", DisplayName = "Legacy member", GrantedAt = DateTimeOffset.UtcNow
            });
            await db.SaveChangesAsync();
        }
        // Six reservations already existed before the new policy: preserve them, but only one member slot is free.
        var outcomes = await Task.WhenAll(new[] { (s.Caregiver, first), (s.Other, second) }.Select(async pair =>
        {
            try
            {
                await s.Call(x => x.AcceptInvitation(pair.Item1, pair.Item2.Invitation.Id, new(Guid.NewGuid()), default));
                return "accepted";
            }
            catch (ApiException error) { return error.Code; }
        }));
        Assert.Single(outcomes, x => x == "accepted");
        Assert.Equal("invitation_limit", Assert.Single(outcomes, x => x != "accepted"));
        var snapshot = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        Assert.Equal(6, snapshot.Members.Count(x => x.Status == "active"));
        Assert.Single(snapshot.Invitations, x => x.Status == "pending");
        await Code("invitation_limit", () => Invite(s, family, "new-person@example.test"));
    }

    [SqlFact]
    public async Task LegacyPendingForAnActiveMemberDoesNotConsumeAnExtraSlot()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        await s.Accept(await s.Invite(family.Id));
        await using (var db = sql.Open())
        {
            db.Invitations.Add(new InvitationRow
            {
                Id = Guid.NewGuid(), FamilyId = family.Id, Email = s.Caregiver.Email,
                CreatedAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddDays(30)
            });
            await db.SaveChangesAsync();
        }
        foreach (var email in Emails(4)) await Invite(s, family, email);
        await Code("invitation_limit", () => Invite(s, family, "one-too-many@example.test"));
        var snapshot = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        Assert.Equal(2, snapshot.Members.Count(x => x.Status == "active"));
        Assert.Equal(5, snapshot.Invitations.Count(x => x.Status == "pending"));
    }

    private static string[] Emails(int count) => Enumerable.Range(0, count).Select(i => $"person{i}@example.test").ToArray();
    private static Task<InvitationResult> Invite(Scenario s, FamilySummary family, string email) =>
        s.Call(x => x.CreateInvitation(s.Owner, family.Id, s.Invitation(family, email), default));
    private static async Task Code<T>(string code, Func<Task<T>> action) =>
        Assert.Equal(code, (await Assert.ThrowsAsync<ApiException>(async () => { await action(); })).Code);
}
