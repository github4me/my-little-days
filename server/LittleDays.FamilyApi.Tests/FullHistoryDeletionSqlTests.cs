using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi.Tests;

public sealed class FullHistoryDeletionSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task AccountDeletionPreservesSharedRecordsAndAnonymizesOnlyTheDeletedAccount()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var caregiver = await s.Accept(await s.Invite(family.Id));
        await using (var db = sql.Open())
        {
            var now = DateTimeOffset.UtcNow;
            var conflict = Record(family.Id, "entry", "conflict", s.Caregiver.ObjectId, s.Caregiver.ObjectId);
            conflict.ConflictReplacedBy = s.Caregiver.ObjectId;
            conflict.ConflictPreviousEditedBy = s.Caregiver.ObjectId;
            conflict.ConflictReplacedAt = now;
            conflict.ConflictPreviousJson = "{\"id\":\"conflict\",\"type\":\"sleep\",\"start\":\"2026-10-25T20:00:00Z\"}";
            var tombstone = Record(family.Id, "entry", "deleted", s.Caregiver.ObjectId, s.Caregiver.ObjectId);
            tombstone.Deleted = true;
            tombstone.RecordJson = "{}";
            db.FamilyRecords.AddRange(conflict, tombstone,
                Record(family.Id, "entry", "authored", s.Caregiver.ObjectId, s.Owner.ObjectId),
                Record(family.Id, "care", "edited", s.Owner.ObjectId, s.Caregiver.ObjectId),
                Record(family.Id, "entry", "retained", s.Owner.ObjectId, s.Owner.ObjectId),
                Record(family.Id, "entry", "ended-only", s.Owner.ObjectId, s.Owner.ObjectId,
                    s.Caregiver.ObjectId));
            db.FamilyNotificationEvents.Add(new FamilyNotificationEventRow
            {
                Id = Guid.NewGuid(), FamilyId = family.Id, HistoryId = s.Config.Family.HistoryId,
                ActorUserId = s.Owner.ObjectId, OperationId = Guid.NewGuid(), Category = "sleep",
                RecordIdHash = Hash("ended-only"), CreatedAt = now, NotBeforeAt = now,
                ExpiresAt = now.AddHours(24)
            });
            await db.SaveChangesAsync();
        }
        await s.Call(x => x.Leave(s.Caregiver, family.Id, s.Context(caregiver), default));
        await using (var db = sql.Open()) Assert.Equal(6, await db.FamilyRecords.CountAsync(x => x.FamilyId == family.Id));
        var deletion = await s.Call(x => x.DeleteAccount(s.Caregiver, Request(), default));
        long beforeCleanup;
        await using (var db = sql.Open())
        {
            var authorization = new DurableAccountDeletionAuthorization(db);
            Assert.False(await authorization.HasPendingRequestAsync(s.Caregiver.ObjectId, default));
            Assert.True((await db.FamilyNotificationEvents.SingleAsync(x => x.FamilyId == family.Id)).Cancelled);
            beforeCleanup = (await db.Families.SingleAsync(x => x.Id == family.Id)).Revision;
        }
        var provider = new UnconfiguredAccountIdentityDeletion();
        await using (var db = sql.Open()) Assert.False(await new DeletionProcessor(db, s.Config, TimeProvider.System, provider).Process(default));
        await using (var db = sql.Open())
        {
            var retained = await db.FamilyRecords.Where(x => x.FamilyId == family.Id).OrderBy(x => x.Id).ToArrayAsync();
            Assert.Equal(["authored", "conflict", "deleted", "edited", "ended-only", "retained"], retained.Select(x => x.Id));
            Assert.All(retained.Where(x => !x.Deleted), x => Assert.Equal("{\"private\":\"content\"}", x.RecordJson));
            Assert.Equal(Guid.Empty, retained.Single(x => x.Id == "authored").RecordedBy);
            Assert.Equal(s.Owner.ObjectId, retained.Single(x => x.Id == "authored").LastEditedBy);
            Assert.Equal(s.Owner.ObjectId, retained.Single(x => x.Id == "edited").RecordedBy);
            Assert.Equal(Guid.Empty, retained.Single(x => x.Id == "edited").LastEditedBy);
            Assert.Equal(s.Owner.ObjectId, retained.Single(x => x.Id == "retained").RecordedBy);
            Assert.Equal(s.Owner.ObjectId, retained.Single(x => x.Id == "retained").LastEditedBy);
            var conflict = retained.Single(x => x.Id == "conflict");
            Assert.Equal(Guid.Empty, conflict.ConflictReplacedBy);
            Assert.Equal(Guid.Empty, conflict.ConflictPreviousEditedBy);
            Assert.NotNull(conflict.ConflictReplacedAt);
            Assert.Equal("{\"id\":\"conflict\",\"type\":\"sleep\",\"start\":\"2026-10-25T20:00:00Z\"}", conflict.ConflictPreviousJson);
            var tombstone = retained.Single(x => x.Id == "deleted");
            Assert.True(tombstone.Deleted);
            Assert.Equal("{}", tombstone.RecordJson);
            Assert.Equal(Guid.Empty, tombstone.RecordedBy);
            Assert.Equal(Guid.Empty, tombstone.LastEditedBy);
            Assert.All(retained, x => Assert.Null(x.TimerEndedBy));
            Assert.Equal(beforeCleanup + 1, (await db.Families.SingleAsync(x => x.Id == family.Id)).Revision);
            var job = await db.AccountDeletions.SingleAsync(x => x.OperationId == deletion.DeletionId);
            Assert.Equal("awaiting_identity_deletion", job.Status);
            Assert.Null(job.PendingEmail);
            var authorization = new DurableAccountDeletionAuthorization(db);
            Assert.True(await authorization.HasPendingRequestAsync(s.Caregiver.ObjectId, default));
            Assert.False(await authorization.HasPendingRequestAsync(s.Owner.ObjectId, default));
            Assert.Empty(await db.Memberships.Where(x => x.UserId == s.Caregiver.ObjectId).ToArrayAsync());
        }
    }

    [SqlFact]
    public async Task RemainingMembersCanReadAndEditRetainedRecordsButCannotResurrectDeletedIds()
    {
        var s = new Scenario(sql);
        var family = await s.Call(x => x.CreateFullFamily(s.Owner,
            new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed([s.Caregiver.Email])), default));
        var member = await s.Call(x => x.AcceptInvitation(s.Caregiver, Assert.Single(family.Snapshot.Invitations).Id,
            new(Guid.NewGuid()), default));
        var edited = family.Snapshot.Entries[0];
        var value = JsonNode.Parse(edited.Entry.GetRawText())!;
        value["note"] = "Shared change to keep";
        var save = new FullRecordOperation(Guid.NewGuid(), value["id"]!.GetValue<string>(), member.MembershipId,
            family.HistoryId, "update", "entry", edited.Version, FullDomainTests.Json(value.ToJsonString()), null,
            EditPolicy: RecordEditingPolicy.LastServerSaveWins);
        await s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId, save, default));
        var removed = family.Snapshot.Entries[1];
        var deletedId = removed.Entry.GetProperty("id").GetString()!;
        var delete = new FullRecordOperation(Guid.NewGuid(), deletedId, member.MembershipId, family.HistoryId,
            "delete", "entry", removed.Version, null, null, EditPolicy: RecordEditingPolicy.FirstDeleteWins);
        await s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId, delete, default));
        await s.Call(x => x.DeleteAccount(s.Caregiver, Request(), default));
        await using (var db = sql.Open())
            Assert.True(await new DeletionProcessor(db, s.Config, TimeProvider.System, new CompleteDeletion()).Process(default));

        var snapshot = await s.Call(x => x.FullSnapshot(s.Owner, family.FamilyId, default));
        var retained = snapshot.Entries.Single(x => x.Entry.GetProperty("id").GetString() == save.RecordId);
        Assert.Equal("Shared change to keep", retained.Entry.GetProperty("note").GetString());
        Assert.Equal(s.Owner.ObjectId, retained.RecordedBy);
        Assert.Equal(Guid.Empty, retained.LastEditedBy);
        Assert.DoesNotContain(snapshot.Entries, x => x.Entry.GetProperty("id").GetString() == deletedId);
        Assert.Equal("account_deleted", (await Assert.ThrowsAsync<ApiException>(() => s.Call(x =>
            x.FullSnapshot(s.Caregiver, family.FamilyId, default)))).Code);

        value["note"] = "Remaining member can still edit";
        await s.Call(x => x.ApplyFullRecord(s.Owner, family.FamilyId, save with {
            OperationId = Guid.NewGuid(), MembershipId = family.MembershipId,
            Entry = FullDomainTests.Json(value.ToJsonString())
        }, default));
        snapshot = await s.Call(x => x.FullSnapshot(s.Owner, family.FamilyId, default));
        Assert.Equal("Remaining member can still edit", snapshot.Entries.Single(x =>
            x.Entry.GetProperty("id").GetString() == save.RecordId).Entry.GetProperty("note").GetString());

        foreach (var kind in new[] { "update", "create" })
        {
            var resurrect = new FullRecordOperation(Guid.NewGuid(), deletedId, family.MembershipId, family.HistoryId,
                kind, "entry", kind == "create" ? null : removed.Version, removed.Entry, null,
                EditPolicy: RecordEditingPolicy.LastServerSaveWins);
            Assert.Equal("record_changed", (await Assert.ThrowsAsync<ApiException>(() => s.Call(x =>
                x.ApplyFullRecord(s.Owner, family.FamilyId, resurrect, default)))).Code);
        }
        var repeatedDelete = delete with { OperationId = Guid.NewGuid(), MembershipId = family.MembershipId };
        var receipt = await s.Call(x => x.ApplyFullRecord(s.Owner, family.FamilyId, repeatedDelete, default));
        Assert.Equal(snapshot.Revision, receipt.Revision);
        Assert.Equal(receipt, await s.Call(x => x.ApplyFullRecord(s.Owner, family.FamilyId, repeatedDelete, default)));
        await using (var db = sql.Open())
            Assert.True(await new DeletionProcessor(db, s.Config, TimeProvider.System, new CompleteDeletion()).Process(default));
        await using (var db = sql.Open())
        {
            var tombstone = await db.FamilyRecords.SingleAsync(x => x.FamilyId == family.FamilyId && x.Id == deletedId);
            Assert.True(tombstone.Deleted);
            Assert.Equal(Guid.Empty, tombstone.LastEditedBy);
        }
    }

    [SqlFact]
    public async Task ClosingPurgesEveryFullRecordAndProfileButPreservesClosureTombstone()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        await using (var db = sql.Open())
        {
            db.FamilyRecords.AddRange(Record(family.Id, "entry", "one", s.Owner.ObjectId, s.Owner.ObjectId),
                Record(family.Id, "care", "two", s.Owner.ObjectId, s.Owner.ObjectId));
            var row = await db.Families.SingleAsync(x => x.Id == family.Id);
            row.BabySex = "female";
            row.BabyBirthDate = "2026-01-01";
            await db.SaveChangesAsync();
        }
        await s.Call(x => x.CloseFamily(s.Owner, family.Id, s.Context(family), default));
        await using (var db = sql.Open())
            Assert.True(await new DeletionProcessor(db, s.Config, TimeProvider.System, new UnconfiguredAccountIdentityDeletion()).Process(default));
        await using (var db = sql.Open())
        {
            Assert.Empty(await db.FamilyRecords.Where(x => x.FamilyId == family.Id).ToArrayAsync());
            var row = await db.Families.SingleAsync(x => x.Id == family.Id);
            Assert.NotNull(row.DeletedAt);
            Assert.Equal("", row.BabyName);
            Assert.Null(row.BabyBirthDate);
            Assert.Equal("unspecified", row.BabySex);
        }
    }

    [SqlFact]
    public async Task DirectoryAccountWithoutMembershipPurgesPendingEmailInvitationsAndTransientEmail()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        // Public account was never present in Pilot:Identities or any membership.
        var user = new PilotIdentity { ObjectId = Guid.NewGuid(), Email = "public." + Guid.NewGuid().ToString("N") + "@example.test", DisplayName = "New parent" };
        var invitation = await s.Call(x => x.CreateInvitation(s.Owner, family.Id, s.Invitation(family, user.Email), default));
        var deletion = await s.Call(x => x.DeleteAccount(user, Request(), default));
        await using (var db = sql.Open())
        {
            Assert.Equal(user.Email, (await db.AccountDeletions.SingleAsync(x => x.OperationId == deletion.DeletionId)).PendingEmail);
            await new DeletionProcessor(db, s.Config, TimeProvider.System, new CompleteDeletion()).Process(default);
        }
        await using (var db = sql.Open())
        {
            Assert.False(await db.Invitations.AnyAsync(x => x.Id == invitation.Invitation.Id));
            var job = await db.AccountDeletions.SingleAsync(x => x.OperationId == deletion.DeletionId);
            Assert.Null(job.PendingEmail);
            Assert.Equal("completed", job.Status);
            Assert.False(await new DurableAccountDeletionAuthorization(db).HasPendingRequestAsync(user.ObjectId, default));
        }
    }

    private static FamilyRecordRow Record(Guid familyId, string collection, string id, Guid author, Guid editor,
        Guid? endedBy = null) => new()
    {
        FamilyId = familyId, Collection = collection, Id = id,
        IdHash = Hash(id),
        RecordJson = "{\"private\":\"content\"}", RecordedBy = author, LastEditedBy = editor,
        TimerEndedBy = endedBy
    };
    private static string Hash(string id) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(id)));
    private static DeleteAccountRequest Request() => new(Guid.NewGuid(), Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N"));
    private sealed class CompleteDeletion : IAccountIdentityDeletion
    {
        public Task DeleteIdentityAsync(Guid objectId, CancellationToken ct) => Task.CompletedTask;
    }
}
