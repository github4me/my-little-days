using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi.Tests;

public sealed class FullHistoryDeletionSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task LeavingPreservesFullRecordsButAccountDeletionPurgesAuthoredAndLastEditedContent()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var caregiver = await s.Accept(await s.Invite(family.Id));
        await using (var db = sql.Open())
        {
            db.FamilyRecords.AddRange(
                Record(family.Id, "entry", "authored", s.Caregiver.ObjectId, s.Owner.ObjectId),
                Record(family.Id, "care", "edited", s.Owner.ObjectId, s.Caregiver.ObjectId),
                Record(family.Id, "entry", "retained", s.Owner.ObjectId, s.Owner.ObjectId));
            await db.SaveChangesAsync();
        }
        await s.Call(x => x.Leave(s.Caregiver, family.Id, s.Context(caregiver), default));
        await using (var db = sql.Open()) Assert.Equal(3, await db.FamilyRecords.CountAsync(x => x.FamilyId == family.Id));
        var deletion = await s.Call(x => x.DeleteAccount(s.Caregiver, Request(), default));
        await using (var db = sql.Open())
        {
            var authorization = new DurableAccountDeletionAuthorization(db);
            Assert.False(await authorization.HasPendingRequestAsync(s.Caregiver.ObjectId, default));
        }
        var provider = new UnconfiguredAccountIdentityDeletion();
        await using (var db = sql.Open()) Assert.False(await new DeletionProcessor(db, s.Config, TimeProvider.System, provider).Process(default));
        await using (var db = sql.Open())
        {
            Assert.Equal("retained", (await db.FamilyRecords.SingleAsync(x => x.FamilyId == family.Id)).Id);
            var job = await db.AccountDeletions.SingleAsync(x => x.OperationId == deletion.DeletionId);
            Assert.Equal("awaiting_identity_deletion", job.Status);
            Assert.Null(job.PendingEmail);
            var authorization = new DurableAccountDeletionAuthorization(db);
            Assert.True(await authorization.HasPendingRequestAsync(s.Caregiver.ObjectId, default));
            Assert.False(await authorization.HasPendingRequestAsync(s.Owner.ObjectId, default));
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

    private static FamilyRecordRow Record(Guid familyId, string collection, string id, Guid author, Guid editor) => new()
    {
        FamilyId = familyId, Collection = collection, Id = id,
        IdHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(id))),
        RecordJson = "{\"private\":\"content\"}", RecordedBy = author, LastEditedBy = editor
    };
    private static DeleteAccountRequest Request() => new(Guid.NewGuid(), Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N"));
    private sealed class CompleteDeletion : IAccountIdentityDeletion
    {
        public Task DeleteIdentityAsync(Guid objectId, CancellationToken ct) => Task.CompletedTask;
    }
}
