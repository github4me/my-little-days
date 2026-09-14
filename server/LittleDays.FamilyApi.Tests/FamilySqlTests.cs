using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi.Tests;

public sealed class FamilySqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task SnapshotKeepsAllPendingInvitesWhenTerminalHistoryExceedsDisplayLimit()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var pending = await s.Invite(family.Id);
        await using (var db = sql.Open())
        {
            for (var i = 0; i < 110; i++)
                db.Invitations.Add(new InvitationRow
                {
                    Id = Guid.NewGuid(),
                    FamilyId = family.Id,
                    RecipientUserId = s.Other.ObjectId,
                    Email = s.Other.Email,
                    Status = "revoked",
                    CreatedAt = DateTimeOffset.UtcNow,
                    ExpiresAt = DateTimeOffset.UtcNow.AddHours(48)
                });
            await db.SaveChangesAsync();
        }
        var snapshot = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        Assert.Equal(100, snapshot.Invitations.Length);
        Assert.Contains(snapshot.Invitations, x => x.Id == pending.Invitation.Id && x.Status == "pending");
    }

    [SqlFact]
    public async Task MigrationCommandRunsSeparatelyWithOnlyDatabaseConfiguration()
    {
        var start = new System.Diagnostics.ProcessStartInfo("dotnet")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        start.ArgumentList.Add(typeof(Program).Assembly.Location);
        start.ArgumentList.Add("--migrate");
        foreach (var key in start.Environment.Keys.Where(x => x.StartsWith("Entra__", StringComparison.OrdinalIgnoreCase) ||
            x.StartsWith("Family__", StringComparison.OrdinalIgnoreCase) || x.StartsWith("Pilot__", StringComparison.OrdinalIgnoreCase)).ToArray())
            start.Environment.Remove(key);
        start.Environment["ConnectionStrings__FamilyDatabase"] = sql.ConnectionString;
        using var process = System.Diagnostics.Process.Start(start)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await process.WaitForExitAsync(timeout.Token);
        await Task.WhenAll(stdout, stderr);
        Assert.Equal(0, process.ExitCode);
    }

    [SqlFact]
    public async Task MigrationAndConcurrentFamilyCreationHaveOneDurableResult()
    {
        var s = new Scenario(sql);
        var request = new CreateFamilyRequest(Guid.NewGuid(), "Test baby");
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => s.Call(x => x.CreateFamily(s.Owner, request, default))));
        Assert.Single(results.Select(x => x.Id).Distinct());
        Assert.Single(results.Select(x => x.MembershipId).Distinct());
        await Code("operation_reused", () => s.Call(x => x.CreateFamily(s.Owner, request with { BabyName = "Other" }, default)));
        await Code("already_in_family", () => s.Create());
        await using var db = sql.Open();
        Assert.True(await db.Database.CanConnectAsync());
        Assert.Single(await db.Memberships.Where(x => x.UserId == s.Owner.ObjectId && x.Active).ToArrayAsync());
        Assert.Single(await db.Operations.Where(x => x.UserId == s.Owner.ObjectId).ToArrayAsync());
    }

    [SqlFact]
    public async Task EmailInvitationIsDiscoverableBoundRetryableSingleUseAndExpiresAfterThirtyDays()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var operationId = Guid.NewGuid();
        var request = s.Invitation(family, s.Caregiver.Email, operationId);
        var invite = await s.Call(x => x.CreateInvitation(s.Owner, family.Id, request, default));
        Assert.Equal(invite, await s.Call(x => x.CreateInvitation(s.Owner, family.Id, request, default)));
        await Code("invitation_unavailable", () => s.Call(x => x.AcceptInvitation(s.Other, invite.Invitation.Id, new(Guid.NewGuid()), default)));
        await Code("invitation_unavailable", () => s.Call(x => x.AcceptInvitation(s.Caregiver, Guid.NewGuid(), new(Guid.NewGuid()), default)));
        Assert.Single((await s.Call(x => x.Me(s.Caregiver, default))).PendingInvitations);
        Assert.Empty((await s.Call(x => x.Me(s.Other, default))).PendingInvitations);
        await using (var db = sql.Open())
        {
            var row = await db.Invitations.SingleAsync(x => x.Id == invite.Invitation.Id);
            Assert.Null(row.RecipientUserId);
            var receipt = await db.Operations.SingleAsync(x => x.OperationId == operationId && x.UserId == s.Owner.ObjectId);
            Assert.DoesNotContain(s.Caregiver.Email, receipt.ResultJson);
            Assert.DoesNotContain("inviteUrl", receipt.ResultJson);
        }
        var second = await s.Invite(family.Id);
        await Code("invitation_unavailable", () => s.Accept(invite));
        await s.Call(x => x.RevokeInvitation(s.Owner, family.Id, second.Invitation.Id, s.Context(family), default));
        await Code("invitation_unavailable", () => s.Accept(second));
        var third = await s.Invite(family.Id);
        await Code("invitation_unavailable", () => sql.Call(s.Config,
            x => x.AcceptInvitation(s.Caregiver, third.Invitation.Id, new(Guid.NewGuid()), default),
            new FixedClock(DateTimeOffset.UtcNow.AddDays(31))));
        var grant = await s.Accept(third);
        await Code("forbidden", () => s.Call(x => x.CreateInvitation(s.Caregiver, family.Id, s.Invitation(family, s.Other.Email), default)));
        await Code("invitation_unavailable", () => s.Accept(third));
        Assert.Equal("caregiver", grant.Role);
    }

    [SqlFact]
    public async Task ConcurrentAcceptanceDoesNotGrantTwiceOrReactivateAfterRemoval()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var invite = await s.Invite(family.Id);
        var acceptId = Guid.NewGuid();
        var grants = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => s.Accept(invite, acceptId)));
        Assert.Single(grants.Select(x => x.MembershipId).Distinct());
        var oldOperation = s.CreateFeed(grants[0]);
        await s.Remove(family, s.Caregiver.ObjectId);
        await Code("membership_revoked", () => s.Accept(invite, acceptId));
        await Code("membership_revoked", () => s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, oldOperation, default)));
        var newInvite = await s.Invite(family.Id);
        var newGrant = await s.Accept(newInvite);
        Assert.NotEqual(grants[0].MembershipId, newGrant.MembershipId);
        await Code("membership_changed", () => s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, oldOperation, default)));
        await Code("membership_changed", () => s.Accept(invite, acceptId));
        await Code("invitation_unavailable", () => s.Accept(invite));
    }

    [SqlFact]
    public async Task RemovalRevokesUnusedInvitesAndLeaveCannotOrphanOrReplayAgainstRegrant()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var invite = await s.Invite(family.Id);
        await s.Call(x => x.RevokeInvitation(s.Owner, family.Id, invite.Invitation.Id, s.Context(family), default));
        await Code("invitation_unavailable", () => s.Accept(invite));
        await Code("forbidden", () => s.Leave(s.Owner, family.Id));
        await Code("invalid_input", () => s.Remove(family, s.Owner.ObjectId));
        var grant = await s.Accept(await s.Invite(family.Id));
        var leave = s.Context(grant);
        await s.Call(x => x.Leave(s.Caregiver, family.Id, leave, default));
        await s.Call(x => x.Leave(s.Caregiver, family.Id, leave, default));
        var regrant = await s.Accept(await s.Invite(family.Id));
        await s.Call(x => x.Leave(s.Caregiver, family.Id, leave, default));
        var snapshot = await s.Call(x => x.Snapshot(s.Caregiver, family.Id, default));
        Assert.Equal(regrant.MembershipId, snapshot.Family.MembershipId);
        Assert.NotEqual(grant.MembershipId, regrant.MembershipId);
        Assert.Empty(snapshot.Invitations);
    }

    [SqlFact]
    public async Task ConcurrentFeedUpdatesUseSqlRowversionAndRetainTombstones()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var caregiver = await s.Accept(await s.Invite(family.Id));
        var create = s.CreateFeed(caregiver);
        var receipt = await s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, create, default));
        Assert.Equal(receipt, await s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, create, default)));
        await Code("operation_reused", () => s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, create with { Feed = Scenario.Feed(99) }, default)));
        var snapshot = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        var version = Assert.Single(snapshot.Feeds).Version;
        Assert.Equal(8, Convert.FromBase64String(version).Length);
        var first = create with { OperationId = Guid.NewGuid(), MembershipId = family.MembershipId, Kind = "update", BaseVersion = version, Feed = Scenario.Feed(110) };
        var second = first with { OperationId = Guid.NewGuid(), MembershipId = caregiver.MembershipId, Feed = Scenario.Feed(120) };
        var updates = await Task.WhenAll(Capture(() => s.Call(x => x.ApplyFeed(s.Owner, family.Id, first, default))),
            Capture(() => s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, second, default))));
        Assert.Single(updates, x => x is null);
        Assert.Single(updates, x => x?.Code == "record_changed" && x.Status == 412);
        var after = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        Assert.Equal(long.Parse(snapshot.Revision) + 1, long.Parse(after.Revision));
        var feed = Assert.Single(after.Feeds);
        Assert.NotEqual(version, feed.Version);
        var delete = create with { OperationId = Guid.NewGuid(), MembershipId = family.MembershipId, Kind = "delete", BaseVersion = feed.Version, Feed = null };
        await s.Call(x => x.ApplyFeed(s.Owner, family.Id, delete, default));
        Assert.Empty((await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).Feeds);
        await Code("record_changed", () => s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, create with { OperationId = Guid.NewGuid() }, default)));
        Assert.Equal(receipt, await s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, create, default)));
    }

    [SqlFact]
    public async Task IdenticalUpdateStillConsumesSqlRowversionBeforeAnotherOperation()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var create = s.CreateFeed(family);
        await s.Call(x => x.ApplyFeed(s.Owner, family.Id, create, default));
        var before = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        var feed = Assert.Single(before.Feeds);
        var exact = create with
        {
            OperationId = Guid.NewGuid(),
            Kind = "update",
            BaseVersion = feed.Version,
            Feed = new(feed.Start, feed.End, feed.Amount, feed.Note)
        };
        await s.Call(x => x.ApplyFeed(s.Owner, family.Id, exact, default));
        var after = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        Assert.NotEqual(feed.Version, Assert.Single(after.Feeds).Version);
        await Code("record_changed", () => s.Call(x => x.ApplyFeed(s.Owner, family.Id,
            exact with { OperationId = Guid.NewGuid(), Feed = Scenario.Feed(200) }, default)));
    }

    [SqlFact]
    public async Task IndependentOverlappingRecordsSurviveAndHistoryAndBoundsFailClosed()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var feed = Scenario.Feed();
        var create = s.CreateFeed(family, feed);
        var other = s.CreateFeed(family, feed);
        await Task.WhenAll(s.Call(x => x.ApplyFeed(s.Owner, family.Id, create, default)), s.Call(x => x.ApplyFeed(s.Owner, family.Id, other, default)));
        Assert.Equal(2, (await s.Call(x => x.Snapshot(s.Owner, family.Id, default))).Feeds.Length);
        await Code("history_changed", () => s.Call(x => x.ApplyFeed(s.Owner, family.Id, create with { OperationId = Guid.NewGuid(), HistoryId = Guid.NewGuid() }, default)));
        s.Config.Family.HistoryId = Guid.NewGuid();
        await Code("history_changed", () => s.Call(x => x.ApplyFeed(s.Owner, family.Id, create, default)));
        foreach (var invalid in new[] { feed with { Amount = -1 }, feed with { Amount = 2001 }, feed with { Amount = 0.001m },
            feed with { End = feed.Start.AddSeconds(-1) }, feed with { End = DateTimeOffset.UtcNow.AddMinutes(3) }, feed with { Note = new string('x', 501) } })
            await Code("invalid_input", () => s.Call(x => x.ApplyFeed(s.Owner, family.Id, s.CreateFeed(family, invalid), default)));
        s.Config.Pilot.MaxFeeds = 2;
        await Code("invalid_input", () => s.Call(x => x.ApplyFeed(s.Owner, family.Id, s.CreateFeed(family), default)));
    }

    [SqlFact]
    public async Task WriteCapacityNeverPreventsRevocationOrLeavingAndExpiryChangesRevision()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var grant = await s.Accept(await s.Invite(family.Id));
        var pending = await s.Call(x => x.CreateInvitation(s.Owner, family.Id, s.Invitation(family, s.Other.Email), default));
        s.Config.Pilot.MaxOperationsPerFamily = 1;
        await Code("invalid_input", () => s.Call(x => x.ApplyFeed(s.Owner, family.Id, s.CreateFeed(family), default)));
        await s.Call(x => x.RevokeInvitation(s.Owner, family.Id, pending.Invitation.Id, s.Context(family), default));
        await s.Remove(family, s.Caregiver.ObjectId);
        await Code("membership_revoked", () => s.Call(x => x.Snapshot(s.Caregiver, family.Id, default)));
        await Code("member_changed", () => s.Remove(family, s.Caregiver.ObjectId));
        await Code("invitation_unavailable", () => s.Call(x => x.RevokeInvitation(s.Owner, family.Id, pending.Invitation.Id, s.Context(family), default)));
        s.Config.Pilot.MaxOperationsPerFamily = 100000;
        await s.Accept(await s.Invite(family.Id));
        s.Config.Pilot.MaxOperationsPerFamily = 1;
        await s.Leave(s.Caregiver, family.Id);
        s.Config.Pilot.MaxOperationsPerFamily = 100000;
        var expiring = await s.Invite(family.Id);
        var before = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        Assert.Contains(before.Invitations, x => x.Id == expiring.Invitation.Id && x.Status == "pending");
        var after = await sql.Call(s.Config, x => x.Snapshot(s.Owner, family.Id, default), new FixedClock(DateTimeOffset.UtcNow.AddDays(31)));
        Assert.Contains(after.Invitations, x => x.Id == expiring.Invitation.Id && x.Status == "expired");
        Assert.Equal(long.Parse(before.Revision) + 1, long.Parse(after.Revision));
    }

    [SqlFact]
    public async Task ConcurrentRemovalAndWriteHaveAnAtomicOrderAndPostRemovalRetryFails()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var caregiver = await s.Accept(await s.Invite(family.Id));
        var create = s.CreateFeed(caregiver);
        var results = await Task.WhenAll(Capture(() => s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, create, default))),
            Capture(() => s.Remove(family, s.Caregiver.ObjectId)));
        Assert.Null(results[1]);
        Assert.True(results[0] is null || results[0]?.Code == "membership_revoked");
        await Code("membership_revoked", () => s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, create, default)));
        var snapshot = await s.Call(x => x.Snapshot(s.Owner, family.Id, default));
        Assert.Single(snapshot.Members, x => x.Status == "active");
        Assert.Contains(snapshot.Members, x => x.Id == s.Caregiver.ObjectId && x.Status == "removed");
        Assert.Equal(results[0] is null ? 1 : 0, snapshot.Feeds.Length);
    }

    private static async Task Code<T>(string expected, Func<Task<T>> action) =>
        Assert.Equal(expected, (await Assert.ThrowsAsync<ApiException>(async () => { await action(); })).Code);
    private static async Task<ApiException?> Capture<T>(Func<Task<T>> action)
    {
        try { await action(); return null; } catch (ApiException error) { return error; }
    }
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
}
