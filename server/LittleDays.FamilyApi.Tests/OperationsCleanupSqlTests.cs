using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace LittleDays.FamilyApi.Tests;

public sealed class OperationsCleanupSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    private const int BatchSize = 1000;

    [SqlFact]
    public async Task ClosedFamilyReceiptsArePurgedInBatchesWithoutTouchingLiveFamilyReceipts()
    {
        var closed = new Scenario(sql);
        var live = new Scenario(sql);
        var family = await closed.Create();
        var liveFamily = await live.Create();
        await Seed(closed, family.Id, closed.Owner.ObjectId, BatchSize * 2 + 5);
        var close = closed.Context(family);
        await closed.Call(x => x.CloseFamily(closed.Owner, family.Id, close, default));
        var probe = new ReceiptDeletes();
        await using (var db = Open(probe))
            await new DeletionProcessor(db, closed.Config, TimeProvider.System, new DirectoryStub()).Process(default);
        Assert.Equal(3, probe.DeleteCommands);
        await using var check = sql.Open();
        Assert.False(await check.Operations.AnyAsync(x => x.FamilyId == family.Id));
        Assert.True(await check.Operations.AnyAsync(x => x.FamilyId == liveFamily.Id));
        Assert.NotNull((await check.Families.SingleAsync(x => x.Id == family.Id)).PurgedAt);
        // The separate durable closure receipt must still prevent reopening/replay.
        await closed.Call(x => x.CloseFamily(closed.Owner, family.Id, close, default));
        Assert.Single((await live.Call(x => x.Me(live.Owner, default))).Families);
    }

    [SqlFact]
    public async Task InterruptedAccountReceiptCleanupCommitsOnlyItsBatchAndResumesSafely()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        var member = await s.Accept(await s.Invite(family.Id));
        await Seed(s, family.Id, s.Caregiver.ObjectId, BatchSize * 2 + 5);
        await s.Call(x => x.ApplyFeed(s.Caregiver, family.Id, s.CreateFeed(member), default));
        await s.Call(x => x.ApplyFeed(s.Owner, family.Id, s.CreateFeed(family), default));
        await s.Call(x => x.DeleteAccount(s.Caregiver, DeleteRequest(), default));
        int before;
        await using (var db = sql.Open()) before = await db.Operations.CountAsync(x => x.UserId == s.Caregiver.ObjectId);
        var directory = new DirectoryStub();
        var interrupted = new ReceiptDeletes(failSecond: true);
        await using (var db = Open(interrupted))
            await Assert.ThrowsAsync<OperationCanceledException>(() =>
                new DeletionProcessor(db, s.Config, TimeProvider.System, directory).Process(default));
        await using (var db = sql.Open())
        {
            Assert.Equal(before - BatchSize, await db.Operations.CountAsync(x => x.UserId == s.Caregiver.ObjectId));
            Assert.Equal("pending", (await db.AccountDeletions.SingleAsync(x => x.UserId == s.Caregiver.ObjectId)).Status);
            Assert.True(await db.Feeds.AnyAsync(x => x.RecordedBy == s.Caregiver.ObjectId));
        }
        Assert.Empty(directory.Deleted);
        Assert.Equal("account_deleted", (await Assert.ThrowsAsync<ApiException>(() =>
            s.Call(x => x.Snapshot(s.Caregiver, family.Id, default)))).Code);
        await using (var db = sql.Open())
            await new DeletionProcessor(db, s.Config, TimeProvider.System, directory).Process(default);
        await using (var db = sql.Open())
        {
            Assert.False(await db.Operations.AnyAsync(x => x.UserId == s.Caregiver.ObjectId));
            Assert.True(await db.Operations.AnyAsync(x => x.UserId == s.Owner.ObjectId));
            Assert.False(await db.Feeds.AnyAsync(x => x.RecordedBy == s.Caregiver.ObjectId));
            Assert.True(await db.Feeds.AnyAsync(x => x.RecordedBy == s.Owner.ObjectId));
            Assert.Equal("completed", (await db.AccountDeletions.SingleAsync(x => x.UserId == s.Caregiver.ObjectId)).Status);
        }
        Assert.Contains(s.Caregiver.ObjectId, directory.Deleted);
    }

    [SqlFact]
    public async Task AccountReceiptCleanupReleasesGlobalLockBetweenBatches()
    {
        var s = new Scenario(sql);
        var family = await s.Create();
        await s.Accept(await s.Invite(family.Id));
        await Seed(s, family.Id, s.Caregiver.ObjectId, BatchSize + 10);
        await s.Call(x => x.DeleteAccount(s.Caregiver, DeleteRequest(), default));
        var probe = new ReceiptDeletes();
        var boundary = new PauseAfterReceiptBatch(probe);
        await using var db = Open(probe, boundary);
        var work = new DeletionProcessor(db, s.Config, TimeProvider.System, new DirectoryStub()).Process(default);
        try
        {
            await boundary.Reached.Task.WaitAsync(TimeSpan.FromSeconds(10));
            // Requires the same global exclusive lifecycle barrier as cleanup.
            var independent = new Scenario(sql);
            var created = await independent.Create().WaitAsync(TimeSpan.FromSeconds(5));
            Assert.NotEqual(Guid.Empty, created.Id);
        }
        finally
        {
            boundary.Continue.TrySetResult();
            await work;
        }
        Assert.True(probe.DeleteCommands >= 2);
    }

    [SqlFact]
    public async Task AccountCleanupHandlesLargeCrossFamilyAndEmailHistory()
    {
        const int families = 2201;
        var s = new Scenario(sql);
        var unrelated = await s.Create();
        var marker = "Cleanup-scale-" + Guid.NewGuid().ToString("N");
        await using (var seed = sql.Open())
            await seed.Database.ExecuteSqlInterpolatedAsync($"""
                DECLARE @history TABLE (Id uniqueidentifier NOT NULL, Email nvarchar(254) NOT NULL);
                INSERT @history(Id,Email)
                SELECT TOP ({families}) NEWID(),CONCAT('history-',ROW_NUMBER() OVER(ORDER BY a.object_id,b.object_id),'@example.test')
                FROM sys.all_objects a CROSS JOIN sys.all_objects b;
                INSERT dbo.Families(Id,BabyName,Revision,CreatedAt)
                SELECT Id,{marker},1,SYSUTCDATETIME() FROM @history;
                INSERT dbo.Memberships(Id,FamilyId,UserId,Role,Email,DisplayName,Active,GrantedAt,EndedAt,Status)
                SELECT NEWID(),Id,{s.Caregiver.ObjectId},'caregiver',Email,'Synthetic history',0,SYSUTCDATETIME(),SYSUTCDATETIME(),'left' FROM @history;
                INSERT dbo.Invitations(Id,FamilyId,RecipientUserId,Email,Status,CreatedAt,ExpiresAt)
                SELECT NEWID(),Id,NULL,Email,'pending',SYSUTCDATETIME(),DATEADD(day,30,SYSUTCDATETIME()) FROM @history;
                """);
        await s.Call(x => x.DeleteAccount(s.Caregiver, DeleteRequest(), default));
        var probe = new ParameterProbe();
        var directory = new DirectoryStub();
        await using (var db = Open(probe))
            Assert.True(await new DeletionProcessor(db, s.Config, TimeProvider.System, directory).Process(default));
        Assert.True(probe.MaxParameters < 2100, "Cleanup must stay within SQL parameter limits, including the provider's large-collection fallback.");
        await using var check = sql.Open();
        Assert.Equal(families, await check.Families.CountAsync(x => x.BabyName == marker && x.Revision == 2));
        Assert.False(await check.Memberships.AnyAsync(x => x.UserId == s.Caregiver.ObjectId));
        Assert.False(await (from invitation in check.Invitations join family in check.Families on invitation.FamilyId equals family.Id
            where family.BabyName == marker select invitation.Id).AnyAsync());
        Assert.Equal("completed", (await check.AccountDeletions.SingleAsync(x => x.UserId == s.Caregiver.ObjectId)).Status);
        Assert.Equal(1L, (await check.Families.SingleAsync(x => x.Id == unrelated.Id)).Revision);
        Assert.Contains(s.Caregiver.ObjectId, directory.Deleted);
    }

    private PilotDatabase Open(params IInterceptor[] interceptors) => new(
        new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(sql.ConnectionString).AddInterceptors(interceptors).Options);

    private async Task Seed(Scenario s, Guid familyId, Guid userId, int count)
    {
        await using var db = sql.Open();
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT dbo.Operations(UserId,OperationId,FamilyId,MembershipId,HistoryId,Action,Fingerprint,ResultJson,CreatedAt)
            SELECT TOP ({count}) {userId},NEWID(),{familyId},{Guid.Empty},{s.Config.Family.HistoryId},
                'synthetic',REPLICATE('a',64),{"{}"},SYSUTCDATETIME()
            FROM sys.all_objects a CROSS JOIN sys.all_objects b;
            """);
    }

    private static DeleteAccountRequest DeleteRequest() => new(Guid.NewGuid(), Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N"));

    private sealed class DirectoryStub : IAccountIdentityDeletion
    {
        public HashSet<Guid> Deleted { get; } = [];
        public Task DeleteIdentityAsync(Guid id, CancellationToken ct) { Deleted.Add(id); return Task.CompletedTask; }
    }

    private sealed class ReceiptDeletes(bool failSecond = false) : DbCommandInterceptor
    {
        public int DeleteCommands { get; private set; }
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("DELETE", StringComparison.OrdinalIgnoreCase) &&
                (command.CommandText.Contains("[Operations]", StringComparison.Ordinal) || command.CommandText.Contains("dbo.Operations", StringComparison.Ordinal)))
            {
                DeleteCommands++;
                Assert.Contains("TOP", command.CommandText, StringComparison.OrdinalIgnoreCase);
                Assert.Contains(command.Parameters.Cast<DbParameter>(), p => Equals(p.Value, BatchSize));
                if (failSecond && DeleteCommands == 2) throw new OperationCanceledException("Synthetic stop between committed receipt batches.");
            }
            return ValueTask.FromResult(result);
        }
    }

    private sealed class PauseAfterReceiptBatch(ReceiptDeletes probe) : DbTransactionInterceptor
    {
        public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Continue { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData, CancellationToken cancellationToken = default)
        {
            if (probe.DeleteCommands == 1 && Reached.TrySetResult()) await Continue.Task.WaitAsync(cancellationToken);
        }
    }

    private sealed class ParameterProbe : DbCommandInterceptor
    {
        public int MaxParameters { get; private set; }
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            MaxParameters = Math.Max(MaxParameters, command.Parameters.Count);
            return ValueTask.FromResult(result);
        }
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            MaxParameters = Math.Max(MaxParameters, command.Parameters.Count);
            return ValueTask.FromResult(result);
        }
    }
}
