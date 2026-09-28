using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace LittleDays.FamilyApi.Tests;

// These tests observe commands issued to disposable, real SQL Server fixtures.
// They verify bounded query shape without relying on production row counts or
// exact optimizer plans, and retain the authorization/consent assertions.
public sealed class QueryEfficiencySqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task ActiveFamilyIdentitySkipsInboxButUnjoinedIdentityStillReceivesInvitations()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var invitation = await s.Invite(family.Id);
        var activeProbe = new QueryProbe();
        var active = await Call(s, activeProbe, service => service.Me(s.Owner, default));
        Assert.Equal(family.Id, Assert.Single(active.Families).Id);
        Assert.Empty(active.PendingInvitations);
        Assert.DoesNotContain(activeProbe.Reads, query => query.Contains("[Invitations]", StringComparison.Ordinal));

        var unjoinedProbe = new QueryProbe();
        var unjoined = await Call(s, unjoinedProbe, service => service.Me(s.Caregiver, default));
        Assert.Empty(unjoined.Families);
        Assert.Equal(invitation.Invitation.Id, Assert.Single(unjoined.PendingInvitations).Id);
        Assert.Contains(unjoinedProbe.Reads, query => query.Contains("[Invitations]", StringComparison.Ordinal));
    }

    [SqlFact]
    public async Task FamilyCreationBatchesIncomingFamilyRevisionsAndRequiresConsentBeforeChangingAny()
    {
        var s = new Scenario(sql);
        var incoming = await IncomingFamilies(s, s.Caregiver, 5);
        var request = new CreateFullFamilyRequest(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed());
        var denied = await Assert.ThrowsAsync<ApiException>(() => s.Call(service => service.CreateFullFamily(s.Caregiver, request, default)));
        Assert.Equal("invitation_decline_consent_required", denied.Code);
        await AssertIncoming(incoming, "pending", 1);

        var probe = new QueryProbe();
        var created = await Call(s, probe, service => service.CreateFullFamily(s.Caregiver, request with { DeclinePendingInvitations = true }, default));
        Assert.Single(probe.LiveFamilyReads);
        await AssertIncoming(incoming, "own_family", 2);
        Assert.Equal(created.FamilyId, Assert.Single((await s.Call(service => service.Me(s.Caregiver, default))).Families).Id);
    }

    [SqlFact]
    public async Task JoiningBatchesOtherFamilyRevisionsAndRequiresConsentBeforeChangingAny()
    {
        var s = new Scenario(sql);
        var incoming = await IncomingFamilies(s, s.Caregiver, 6);
        var chosen = incoming[0];
        var invitationId = Assert.Single(chosen.Snapshot.Invitations).Id;
        var request = new OperationRequest(Guid.NewGuid(), RequiredSchemaVersion: 2);
        var denied = await Assert.ThrowsAsync<ApiException>(() => s.Call(service => service.AcceptInvitation(s.Caregiver, invitationId, request, default)));
        Assert.Equal("invitation_decline_consent_required", denied.Code);
        await AssertIncoming(incoming, "pending", 1);

        var probe = new QueryProbe();
        var joined = await Call(s, probe, service => service.AcceptInvitation(s.Caregiver, invitationId, request with { DeclineOtherInvitations = true }, default));
        // One SELECT for the chosen family, one for every other affected family.
        Assert.Equal(2, probe.LiveFamilyReads.Count());
        Assert.Equal(chosen.FamilyId, joined.Id);
        await AssertIncoming(incoming.Skip(1), "joined_alt", 2);
        await AssertIncoming([chosen], "accepted", 2);
    }

    [SqlFact]
    public async Task BatchedDeclinesAndRevisionsRollBackTogetherWhenSavingFails()
    {
        foreach (var create in new[] { true, false })
        {
            var s = new Scenario(sql);
            var incoming = await IncomingFamilies(s, s.Caregiver, 4);
            await using (var db = sql.Open())
            {
                db.SavedChanges += (_, _) => throw new InvalidOperationException("Synthetic post-save rollback");
                var service = new FamilyService(db, s.Config, TimeProvider.System);
                if (create)
                    await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateFullFamily(s.Caregiver,
                        new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed(), DeclinePendingInvitations: true), default));
                else
                    await Assert.ThrowsAsync<InvalidOperationException>(() => service.AcceptInvitation(s.Caregiver,
                        Assert.Single(incoming[0].Snapshot.Invitations).Id,
                        new(Guid.NewGuid(), DeclineOtherInvitations: true, RequiredSchemaVersion: 2), default));
            }
            await AssertIncoming(incoming, "pending", 1);
            Assert.Empty((await s.Call(service => service.Me(s.Caregiver, default))).Families);
        }
    }

    [SqlFact]
    public async Task LargeIncomingInboxUsesBoundedFamilyQueryBatches()
    {
        var s = new Scenario(sql);
        var ids = Enumerable.Range(0, 257).Select(_ => Guid.NewGuid()).ToArray();
        await using (var seed = sql.Open())
        {
            foreach (var id in ids)
            {
                var owner = Guid.NewGuid();
                seed.Families.Add(new FamilyRow { Id = id, BabyName = "Synthetic family", Revision = 1, CreatedAt = DateTimeOffset.UtcNow, SchemaVersion = 2 });
                seed.Memberships.Add(new MembershipRow { Id = Guid.NewGuid(), FamilyId = id, UserId = owner, Role = "owner", Email = $"{owner:N}@example.test", DisplayName = "Synthetic inviter", GrantedAt = DateTimeOffset.UtcNow });
                seed.Invitations.Add(new InvitationRow { Id = Guid.NewGuid(), FamilyId = id, Email = s.Caregiver.Email, CreatedAt = DateTimeOffset.UtcNow, ExpiresAt = DateTimeOffset.UtcNow.AddDays(30) });
            }
            await seed.SaveChangesAsync();
        }
        var probe = new QueryProbe();
        await Call(s, probe, service => service.CreateFullFamily(s.Caregiver,
            new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed(), DeclinePendingInvitations: true), default));
        Assert.Equal(2, probe.LiveFamilyReads.Count());
        Assert.True(probe.MaxParameters < 2100, "SQL Server parameter limits must not depend on incoming family count");
        await using var check = sql.Open();
        Assert.Equal(ids.Length, await check.Families.CountAsync(row => ids.Contains(row.Id) && row.Revision == 2));
        Assert.Equal(ids.Length, await check.Invitations.CountAsync(row => ids.Contains(row.FamilyId) && row.Status == "own_family"));
    }

    [SqlFact]
    public async Task RecordCapacityUsesScalarCounterAndStillAllowsIdenticalReceiptsAtTheLimit()
    {
        var s = new Scenario(sql);
        var created = await s.Call(service => service.CreateFullFamily(s.Owner,
            new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed()), default));
        s.Config.Pilot.MaxOperationsPerFamily = 2;
        var entry = FullDomainTests.Json("""{"id":"counter-probe","type":"diaper","start":"2026-09-01T10:00:00Z","diaperKind":"wet","note":""}""");
        var operation = new FullRecordOperation(Guid.NewGuid(), "counter-probe", created.MembershipId, created.HistoryId,
            "create", "entry", null, entry, null);
        var probe = new QueryProbe();
        var receipt = await Call(s, probe, service => service.ApplyFullRecord(s.Owner, created.FamilyId, operation, default));
        Assert.Single(probe.Reads, query => query.Contains("[FamilyOperationCounts]", StringComparison.Ordinal));
        Assert.DoesNotContain(probe.Reads, CountsOperations);

        Assert.Equal(receipt, await s.Call(service => service.ApplyFullRecord(s.Owner, created.FamilyId, operation, default)));
        var deniedProbe = new QueryProbe();
        var denied = await Assert.ThrowsAsync<ApiException>(() => Call(s, deniedProbe,
            service => service.ApplyFullRecord(s.Owner, created.FamilyId, operation with { OperationId = Guid.NewGuid() }, default)));
        Assert.Equal("invalid_input", denied.Code);
        Assert.Single(deniedProbe.Reads, query => query.Contains("[FamilyOperationCounts]", StringComparison.Ordinal));
        Assert.DoesNotContain(deniedProbe.Reads, CountsOperations);
        await using var check = sql.Open();
        Assert.Equal(2, await check.Operations.CountAsync(row => row.FamilyId == created.FamilyId));
        Assert.Equal(2L, await check.FamilyOperationCounts.Where(row => row.FamilyId == created.FamilyId).Select(row => row.ReceiptCount).SingleAsync());
    }

    private async Task<T> Call<T>(Scenario scenario, QueryProbe probe, Func<FamilyService, Task<T>> action)
    {
        await using var db = new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>()
            .UseSqlServer(sql.ConnectionString).AddInterceptors(probe).Options);
        return await action(new FamilyService(db, scenario.Config, TimeProvider.System));
    }

    private static bool CountsOperations(string query) =>
        query.Contains("[Operations]", StringComparison.Ordinal) &&
        (query.Contains("COUNT(", StringComparison.OrdinalIgnoreCase) ||
         query.Contains("COUNT_BIG(", StringComparison.OrdinalIgnoreCase));

    private static async Task<CreateFullFamilyResult[]> IncomingFamilies(Scenario scenario, PilotIdentity recipient, int count)
    {
        var results = new List<CreateFullFamilyResult>();
        for (var index = 0; index < count; index++)
        {
            var id = Guid.NewGuid();
            var owner = new PilotIdentity { ObjectId = id, Email = $"sender.{id:N}@example.test", DisplayName = "Synthetic inviter" };
            results.Add(await scenario.Call(service => service.CreateFullFamily(owner,
                new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed([recipient.Email])), default)));
        }
        return results.ToArray();
    }

    private async Task AssertIncoming(IEnumerable<CreateFullFamilyResult> incoming, string status, long revision)
    {
        var ids = incoming.Select(result => result.FamilyId).ToArray();
        await using var db = sql.Open();
        var invitations = await db.Invitations.Where(row => ids.Contains(row.FamilyId)).ToArrayAsync();
        Assert.Equal(ids.Length, invitations.Length);
        Assert.All(invitations, row => Assert.Equal(status, row.Status));
        var families = await db.Families.Where(row => ids.Contains(row.Id)).ToArrayAsync();
        Assert.Equal(ids.Length, families.Length);
        Assert.All(families, row => Assert.Equal(revision, row.Revision));
    }

    private sealed class QueryProbe : DbCommandInterceptor
    {
        public List<string> Reads { get; } = [];
        public int MaxParameters { get; private set; }
        public IEnumerable<string> LiveFamilyReads => Reads.Where(query =>
            query.Contains("FROM [Families] AS", StringComparison.Ordinal) &&
            query.Contains("[DeletedAt] IS NULL", StringComparison.Ordinal) &&
            !query.Contains("EXISTS (", StringComparison.Ordinal));
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Reads.Add(command.CommandText);
            MaxParameters = Math.Max(MaxParameters, command.Parameters.Count);
            return ValueTask.FromResult(result);
        }
    }
}
