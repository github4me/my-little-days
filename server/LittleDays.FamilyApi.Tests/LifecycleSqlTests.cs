using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi.Tests;

public sealed class LifecycleSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task InviteBeforeRegistrationDoesNotGrantAccessAndDeclineRequiresVerifiedRecipient()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var futureEmail = $"future.{Guid.NewGuid():N}@example.test";
        var invitation = await s.Call(x => x.CreateInvitation(s.Owner, family.Id, s.Invitation(family, futureEmail.ToUpperInvariant()), default));
        Assert.Equal(futureEmail, invitation.Invitation.Email);
        Assert.InRange(invitation.Invitation.ExpiresAt - DateTimeOffset.UtcNow, TimeSpan.FromDays(29.99), TimeSpan.FromDays(30));
        await Code("invitation_unavailable", () => s.Call(x => x.DeclineInvitation(s.Other, invitation.Invitation.Id, new(Guid.NewGuid()), default)));
        var registered = new PilotIdentity { ObjectId = Guid.NewGuid(), Email = futureEmail, DisplayName = "Future relative" };
        s.Config.Pilot.Identities = [.. s.Config.Pilot.Identities, registered];
        var me = await s.Call(x => x.Me(registered, default));
        Assert.Empty(me.Families);
        Assert.Equal(invitation.Invitation.Id, Assert.Single(me.PendingInvitations).Id);
        await Code("membership_revoked", () => s.Call(x => x.Snapshot(registered, family.Id, default)));
        var decline = new OperationRequest(Guid.NewGuid());
        await s.Call(x => x.DeclineInvitation(registered, invitation.Invitation.Id, decline, default));
        await s.Call(x => x.DeclineInvitation(registered, invitation.Invitation.Id, decline, default));
        Assert.Empty((await s.Call(x => x.Me(registered, default))).PendingInvitations);
        Assert.Contains((await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).Invitations, x => x.Status == "declined");
        await Code("invitation_unavailable", () => s.Call(x => x.AcceptInvitation(registered, invitation.Invitation.Id, new(Guid.NewGuid()), default)));
    }

    [SqlFact]
    public async Task SimultaneousAcceptanceFromTwoFamiliesHasExactlyOneWinner()
    {
        var s = new Scenario(sql);
        var first = await s.Create();
        var second = await s.Call(x => x.CreateFamily(s.Other, new(Guid.NewGuid(), "Other family"), default));
        var invitationA = await s.Invite(first.Id);
        var invitationB = await s.Call(x => x.CreateInvitation(s.Other, second.Id, s.Invitation(second, s.Caregiver.Email), default));
        var results = await Task.WhenAll(
            Capture(() => s.Call(x => x.AcceptInvitation(s.Caregiver, invitationA.Invitation.Id, new(Guid.NewGuid(), DeclineOtherInvitations: true), default))),
            Capture(() => s.Call(x => x.AcceptInvitation(s.Caregiver, invitationB.Invitation.Id, new(Guid.NewGuid(), DeclineOtherInvitations: true), default))));
        Assert.Single(results, x => x is null);
        Assert.Single(results, x => x == "invitation_unavailable");
        Assert.Single((await s.Call(x => x.Me(s.Caregiver, default))).Families);
        var snapshots = new[]
        {
            await s.Call(x => x.Snapshot(s.Owner, first.Id, default)),
            await s.Call(x => x.Snapshot(s.Other, second.Id, default))
        };
        Assert.Single(snapshots.SelectMany(x => x.Invitations), x => x.Status == "accepted");
        Assert.Single(snapshots.SelectMany(x => x.Invitations), x => x.Status == "declined" && x.DeclineReason == "joined_family");
    }

    [SqlFact]
    public async Task OnlyAuthorOrAdminMayModifyRecordsAndDepartureKeepsContributions()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var caregiver = await s.Accept(await s.Invite(family.Id));
        var otherInvite = await s.Call(x => x.CreateInvitation(s.Owner, family.Id, s.Invitation(family, s.Other.Email), default));
        var other = await s.Call(x => x.AcceptInvitation(s.Other, otherInvite.Invitation.Id, new(Guid.NewGuid()), default));
        var create = s.CreateFeed(caregiver);
        await s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, create, default));
        var feed = Assert.Single((await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).Feeds);
        var change = create with { OperationId = Guid.NewGuid(), Kind = "update", BaseVersion = feed.Version, Feed = Scenario.Feed(150) };
        await Code("record_forbidden", () => s.Call(x => x.ApplyFeed(s.Other, family.Id, change with { MembershipId = other.MembershipId }, default)));
        await Code("record_forbidden", () => s.Call(x => x.ApplyFeed(s.Other, family.Id, change with { MembershipId = other.MembershipId, Kind = "delete", Feed = null }, default)));
        await s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, change, default));
        await s.Leave(s.Caregiver, family.Id);
        var snapshot = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        feed = Assert.Single(snapshot.Feeds);
        Assert.Equal(150, feed.Amount);
        Assert.Contains(snapshot.Members, x => x.Id == s.Caregiver.ObjectId && x.Status == "left");
        var viewer = await s.Call(x => x.Snapshot(s.Other, family.Id, default));
        Assert.All(viewer.Members, x => Assert.Null(x.Email));
        Assert.DoesNotContain(viewer.Members, x => x.Status != "active");
        await s.Call(x => x.ApplyFeed(s.Owner, family.Id, change with { OperationId = Guid.NewGuid(), MembershipId = family.MembershipId,
            BaseVersion = feed.Version, Kind = "delete", Feed = null }, default));
        Assert.Empty((await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).Feeds);
    }

    [SqlFact]
    public async Task ProfileIsOwnerOnlyVersionedAndSavedOnlyOnExplicitOperation()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        await s.Accept(await s.Invite(family.Id));
        var before = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        var request = new ProfileRequest(Guid.NewGuid(), before.Family.ProfileVersion, "Changed baby", "2026-01-01", family.MembershipId, s.Config.Family.HistoryId);
        await Code("forbidden", () => s.Call(x => x.UpdateProfile(s.Caregiver, family.Id, request, default)));
        var updated = await s.Call(x => x.UpdateProfile(s.Owner, family.Id, request, default));
        Assert.Equal("Changed baby", updated.BabyName);
        Assert.Equal("2026-01-01", updated.BabyBirthDate);
        Assert.Equal(updated, await s.Call(x => x.UpdateProfile(s.Owner, family.Id, request, default)));
        await Code("profile_changed", () => s.Call(x => x.UpdateProfile(s.Owner, family.Id, request with { OperationId = Guid.NewGuid() }, default)));
        await Code("invalid_input", () => s.Call(x => x.UpdateProfile(s.Owner, family.Id, request with { OperationId = Guid.NewGuid(), BabyBirthDate = "2026-02-30" }, default)));
    }

    [SqlFact]
    public async Task TransferRequiresNomineeAcceptanceAndChangesRolesAtomically()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var caregiver = await s.Accept(await s.Invite(family.Id));
        var nomination = new NominateOwnerRequest(Guid.NewGuid(), s.Caregiver.ObjectId, family.MembershipId, s.Config.Family.HistoryId);
        var transfer = await s.Call(x => x.NominateOwner(s.Owner, family.Id, nomination, default));
        Assert.Equal(transfer, await s.Call(x => x.NominateOwner(s.Owner, family.Id, nomination, default)));
        Assert.Equal("owner", (await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).Family.Role);
        Assert.Equal("caregiver", (await s.Call(x => x.Snapshot(s.Caregiver, family.Id, default))).Family.Role);
        await Code("family_owner_cannot_delete", () => s.Call(x => x.DeleteAccount(s.Owner, DeleteRequest(), default)));
        await Code("transfer_unavailable", () => s.Call(x => x.AcceptOwnership(s.Owner, family.Id, transfer.Id, s.Context(family), default)));
        var accept = s.Context(caregiver);
        await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => s.Call(x => x.AcceptOwnership(s.Caregiver, family.Id, transfer.Id, accept, default))));
        var snapshot = await s.Call(x => x.Snapshot(s.Caregiver, family.Id, default));
        Assert.Equal("owner", snapshot.Family.Role);
        Assert.Equal(caregiver.MembershipId, snapshot.Family.MembershipId);
        Assert.Single(snapshot.Members, x => x.Role == "owner" && x.Status == "active");
        Assert.Equal("caregiver", (await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).Family.Role);
        Assert.Null(snapshot.OwnershipTransfer);
        await Code("forbidden", () => s.Call(x => x.CreateInvitation(s.Owner, family.Id, s.Invitation(family, s.Other.Email), default)));
        await s.Leave(s.Owner, family.Id);
    }

    [SqlFact]
    public async Task RemovedNomineeCannotAcceptOldTransferAfterRejoin()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var caregiver = await s.Accept(await s.Invite(family.Id));
        var transfer = await s.Call(x => x.NominateOwner(s.Owner, family.Id, new(Guid.NewGuid(), s.Caregiver.ObjectId, family.MembershipId, s.Config.Family.HistoryId), default));
        await s.Remove(family, s.Caregiver.ObjectId);
        caregiver = await s.Accept(await s.Invite(family.Id));
        await Code("transfer_unavailable", () => s.Call(x => x.AcceptOwnership(s.Caregiver, family.Id, transfer.Id, s.Context(caregiver), default)));
        Assert.Null((await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).OwnershipTransfer);
        var replacement = await s.Call(x => x.NominateOwner(s.Owner, family.Id, new(Guid.NewGuid(), s.Caregiver.ObjectId, family.MembershipId, s.Config.Family.HistoryId), default));
        var cancel = s.Context(family);
        await s.Call(x => x.CancelOwnership(s.Owner, family.Id, replacement.Id, cancel, default));
        await s.Call(x => x.CancelOwnership(s.Owner, family.Id, replacement.Id, cancel, default));
        await Code("transfer_unavailable", () => s.Call(x => x.AcceptOwnership(s.Caregiver, family.Id, replacement.Id, s.Context(caregiver), default)));
    }

    [SqlFact]
    public async Task ClosingFamilyImmediatelyRevokesThenPurgesAndAllowsOwnerAccountDeletion()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var caregiver = await s.Accept(await s.Invite(family.Id));
        await s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, s.CreateFeed(caregiver), default));
        var close = s.Context(family);
        await Code("family_has_members", () => s.Call(x => x.CloseFamily(s.Owner, family.Id, close, default)));
        await Code("family_owner_cannot_delete", () => s.Call(x => x.DeleteAccount(s.Owner, DeleteRequest(), default)));
        await s.Remove(family, s.Caregiver.ObjectId);
        await s.Call(x => x.CloseFamily(s.Owner, family.Id, close, default));
        await s.Call(x => x.CloseFamily(s.Owner, family.Id, close, default));
        await Code("membership_revoked", () => s.Call(x => x.Snapshot(s.Owner, family.Id, default)));
        Assert.Empty((await s.Call(x => x.Me(s.Owner, default))).Families);
        await RunCleanup(s, new IdentityDeletionStub());
        await using (var db = sql.Open())
        {
            var tombstone = await db.Families.SingleAsync(x => x.Id == family.Id);
            Assert.NotNull(tombstone.DeletedAt);
            Assert.Equal("", tombstone.BabyName);
            Assert.Empty(await db.Feeds.Where(x => x.FamilyId == family.Id).ToArrayAsync());
            Assert.Empty(await db.Memberships.Where(x => x.FamilyId == family.Id).ToArrayAsync());
        }
        await s.Call(x => x.CloseFamily(s.Owner, family.Id, close, default));
        await Code("operation_reused", () => s.Call(x => x.CreateFamily(s.Owner, new(close.OperationId, "No reuse"), default)));
        Assert.Equal("pending", (await s.Call(x => x.DeleteAccount(s.Owner, DeleteRequest(), default))).Status);
    }

    [SqlFact]
    public async Task AccountDeletionImmediatelyDisablesPurgesContributionsAndWaitsForDirectoryConfirmation()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var caregiver = await s.Accept(await s.Invite(family.Id));
        var own = s.CreateFeed(caregiver);
        await s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, own, default));
        await s.Call(x => x.ApplyFeed(s.Owner, family.Id, s.CreateFeed(family), default));
        var delete = DeleteRequest();
        var result = await s.Call(x => x.DeleteAccount(s.Caregiver, delete, default));
        Assert.Equal(result, await s.Call(x => x.DeleteAccount(s.Caregiver, delete, default)));
        Assert.Equal("pending", result.Status);
        await Code("account_deleted", () => s.Call(x => x.Snapshot(s.Caregiver, family.Id, default)));
        await Code("account_deleted", () => s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, own, default)));
        await Code("account_deleted", () => s.Call(x => x.CreateFamily(s.Caregiver, new(Guid.NewGuid(), "New"), default)));
        Assert.Empty((await s.Call(x => x.Me(s.Caregiver, default))).Families);
        Assert.False(await RunCleanup(s, new UnconfiguredAccountIdentityDeletion()));
        Assert.Equal("awaiting_identity_deletion", (await s.Call(x => x.DeletionStatus(new(result.DeletionId, delete.ReceiptSecret), default))).Status);
        var retained = Assert.Single((await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).Feeds);
        Assert.Equal(s.Owner.ObjectId, retained.RecordedBy);
        await using (var db = sql.Open())
        {
            Assert.Empty(await db.Memberships.Where(x => x.UserId == s.Caregiver.ObjectId).ToArrayAsync());
            Assert.Empty(await db.Invitations.Where(x => x.Email == s.Caregiver.Email).ToArrayAsync());
            Assert.Empty(await db.Operations.Where(x => x.UserId == s.Caregiver.ObjectId).ToArrayAsync());
            Assert.DoesNotContain(delete.ReceiptSecret, (await db.AccountDeletions.SingleAsync(x => x.UserId == s.Caregiver.ObjectId)).ReceiptHash);
        }
        var directory = new IdentityDeletionStub();
        await RunCleanup(s, directory);
        await RunCleanup(s, directory);
        Assert.Contains(s.Caregiver.ObjectId, directory.Deleted);
        Assert.Equal("completed", (await s.Call(x => x.DeletionStatus(new(result.DeletionId, delete.ReceiptSecret), default))).Status);
        await Code("deletion_unavailable", () => s.Call(x => x.DeletionStatus(new(result.DeletionId, new string('a', 64)), default)));
        await Code("account_deleted", () => s.Call(x => x.Snapshot(s.Caregiver, family.Id, default)));
    }

    [SqlFact]
    public async Task DeletedEditorsContentIsRemovedRatherThanOnlyRemovingAttribution()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var caregiver = await s.Accept(await s.Invite(family.Id));
        var create = s.CreateFeed(caregiver);
        await s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, create, default));
        var feed = Assert.Single((await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).Feeds);
        await s.Call(x => x.ApplyFeed(s.Owner, family.Id, create with { OperationId = Guid.NewGuid(), MembershipId = family.MembershipId,
            Kind = "update", BaseVersion = feed.Version, Feed = Scenario.Feed(111) with { Note = "Deleted user's contributed note" } }, default));
        var transfer = await s.Call(x => x.NominateOwner(s.Owner, family.Id, new(Guid.NewGuid(), s.Caregiver.ObjectId, family.MembershipId, s.Config.Family.HistoryId), default));
        await s.Call(x => x.AcceptOwnership(s.Caregiver, family.Id, transfer.Id, s.Context(caregiver), default));
        await s.Call(x => x.DeleteAccount(s.Owner, DeleteRequest(), default));
        await RunCleanup(s, new IdentityDeletionStub());
        Assert.Empty((await s.Call(x => x.Snapshot(s.Caregiver, family.Id, default))).Feeds);
    }

    [SqlFact]
    public async Task UnsentLeaveAndRemovalAreBoundToOriginalMembershipAndHistory()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var first = await s.Accept(await s.Invite(family.Id));
        var unsentLeave = s.Context(first);
        var unsentRemoval = s.Context(family, target: first.MembershipId);
        await s.Remove(family, s.Caregiver.ObjectId);
        var current = await s.Accept(await s.Invite(family.Id));
        await Code("membership_changed", () => s.Call(x => x.Leave(s.Caregiver, family.Id, unsentLeave, default)));
        await Code("member_changed", () => s.Call(x => x.RemoveMember(s.Owner, family.Id, s.Caregiver.ObjectId, unsentRemoval, default)));
        await Code("history_changed", () => s.Call(x => x.Leave(s.Caregiver, family.Id, s.Context(current) with { HistoryId = Guid.NewGuid() }, default)));
        await Code("invalid_input", () => s.Call(x => x.Leave(s.Caregiver, family.Id, new(Guid.NewGuid()), default)));
        Assert.Equal(current.MembershipId, (await s.Call(x => x.Snapshot(s.Caregiver, family.Id, default))).Family.MembershipId);
    }

    [SqlFact]
    public async Task FailedDirectoryJobDoesNotStarveOthersAndMetadataCleanupChangesRevision()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        await s.Accept(await s.Invite(family.Id));
        var otherInvite = await s.Call(x => x.CreateInvitation(s.Owner, family.Id, s.Invitation(family, s.Other.Email), default));
        await s.Call(x => x.AcceptInvitation(s.Other, otherInvite.Invitation.Id, new(Guid.NewGuid()), default));
        var first = await s.Call(x => x.DeleteAccount(s.Caregiver, DeleteRequest(), default));
        var second = await s.Call(x => x.DeleteAccount(s.Other, DeleteRequest(), default));
        var before = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        Assert.Contains(before.Members, x => x.Id == s.Caregiver.ObjectId);
        var provider = new OneFailureIdentityDeletion(s.Caregiver.ObjectId);
        Assert.False(await RunCleanup(s, provider));
        var after = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        Assert.True(long.Parse(after.Revision) > long.Parse(before.Revision));
        Assert.Single(after.Members);
        Assert.Empty(after.Invitations);
        await using var db = sql.Open();
        Assert.Equal("awaiting_identity_deletion", (await db.AccountDeletions.SingleAsync(x => x.OperationId == first.DeletionId)).Status);
        Assert.Equal("completed", (await db.AccountDeletions.SingleAsync(x => x.OperationId == second.DeletionId)).Status);
        Assert.Contains(s.Other.ObjectId, provider.Deleted);
    }

    [SqlFact]
    public async Task ProfileAndNominationRespectCapacityButLeavingAndClosureRemainAvailable()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var caregiver = await s.Accept(await s.Invite(family.Id));
        s.Config.Pilot.MaxOperationsPerFamily = 1;
        var snapshot = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        await Code("invalid_input", () => s.Call(x => x.UpdateProfile(s.Owner, family.Id,
            new(Guid.NewGuid(), snapshot.Family.ProfileVersion, "Changed", null, family.MembershipId, s.Config.Family.HistoryId), default)));
        await Code("invalid_input", () => s.Call(x => x.NominateOwner(s.Owner, family.Id,
            new(Guid.NewGuid(), s.Caregiver.ObjectId, family.MembershipId, s.Config.Family.HistoryId), default)));
        await s.Call(x => x.Leave(s.Caregiver, family.Id, s.Context(caregiver), default));
        await s.Call(x => x.CloseFamily(s.Owner, family.Id, s.Context(family), default));
    }

    [SqlFact]
    public async Task InvitationLimitKeepsEveryPendingInvitationManageableAndAllowsReplacement()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        await using (var db = sql.Open())
        {
            for (var i = 0; i < 100; i++)
                db.Invitations.Add(new InvitationRow { Id = Guid.NewGuid(), FamilyId = family.Id, Email = $"person{i}@example.test",
                    CreatedAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddDays(30) });
            await db.SaveChangesAsync();
        }
        await Code("invitation_limit", () => s.Call(x => x.CreateInvitation(s.Owner, family.Id, s.Invitation(family, "one-more@example.test"), default)));
        await s.Call(x => x.CreateInvitation(s.Owner, family.Id, s.Invitation(family, "person0@example.test"), default));
        var snapshot = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        Assert.Equal(100, snapshot.Invitations.Length);
        Assert.All(snapshot.Invitations, x => Assert.Equal("pending", x.Status));
    }

    private async Task<bool> RunCleanup(Scenario scenario, IAccountIdentityDeletion provider)
    {
        await using var db = sql.Open();
        return await new DeletionProcessor(db, scenario.Config, TimeProvider.System, provider).Process(default);
    }
    private static DeleteAccountRequest DeleteRequest() => new(Guid.NewGuid(), Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N"));
    private static async Task Code<T>(string expected, Func<Task<T>> action) =>
        Assert.Equal(expected, (await Assert.ThrowsAsync<ApiException>(async () => { await action(); })).Code);
    private static async Task<string?> Capture<T>(Func<Task<T>> action)
    {
        try { await action(); return null; } catch (ApiException error) { return error.Code; }
    }
    private sealed class IdentityDeletionStub : IAccountIdentityDeletion
    {
        public HashSet<Guid> Deleted { get; } = [];
        public Task DeleteIdentityAsync(Guid id, CancellationToken ct) { Deleted.Add(id); return Task.CompletedTask; }
    }
    private sealed class OneFailureIdentityDeletion(Guid failure) : IAccountIdentityDeletion
    {
        public HashSet<Guid> Deleted { get; } = [];
        public Task DeleteIdentityAsync(Guid id, CancellationToken ct)
        {
            if (id == failure) throw new InvalidOperationException("Synthetic directory failure");
            Deleted.Add(id); return Task.CompletedTask;
        }
    }
}
