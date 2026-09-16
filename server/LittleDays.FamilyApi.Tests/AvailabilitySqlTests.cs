using System.Data.Common;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace LittleDays.FamilyApi.Tests;

public sealed class AvailabilitySqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    private static Task<CreateFullFamilyResult> Create(Scenario s) => s.Call(x => x.CreateFullFamily(s.Owner,
        new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed()), default));

    [SqlFact]
    public async Task AuthorizedUnchangedSnapshotDoesNotReadRecordBodiesOrSizeAggregates()
    {
        var s = new Scenario(sql);
        var created = await Create(s);
        var first = await s.Call(x => x.ConditionalFullSnapshot(s.Owner, created.FamilyId, null, default));
        var probe = new NoRecordReads();
        await using var db = new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(sql.ConnectionString).AddInterceptors(probe).Options);
        var result = await new FamilyService(db, s.Config, TimeProvider.System).ConditionalFullSnapshot(s.Owner, created.FamilyId, first.ETag, default);
        Assert.Null(result.Snapshot);
        Assert.Equal(first.ETag, result.ETag);
        Assert.True(probe.Reads > 0);
        var forbidden = await Assert.ThrowsAsync<ApiException>(() => s.Call(x => x.ConditionalFullSnapshot(s.Other, created.FamilyId, first.ETag, default)));
        Assert.Equal("membership_revoked", forbidden.Code);
    }

    [SqlFact]
    public async Task DifferentFamilySnapshotAndIdentityReadProceedWhileLifecycleWaitsForAtomicBarrier()
    {
        var a = new Scenario(sql);
        var b = new Scenario(sql);
        var familyA = await Create(a);
        var familyB = await Create(b);
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var held = a.Call(x => x.FamilyTransaction(familyA.FamilyId, async () => { entered.SetResult(); await release.Task; return true; }));
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            var unrelated = b.Call(x => x.FullSnapshot(b.Owner, familyB.FamilyId, default));
            Assert.Equal(familyB.FamilyId, (await unrelated.WaitAsync(TimeSpan.FromSeconds(3))).Family.Id);
            Assert.Single((await b.Call(x => x.Me(b.Owner, default)).WaitAsync(TimeSpan.FromSeconds(3))).Families);
            var close = a.Call(x => x.CloseFamily(a.Owner, familyA.FamilyId, a.Context(familyA.Snapshot.Family), default));
            await Task.Delay(100);
            Assert.False(close.IsCompleted);
            release.TrySetResult();
            await held;
            await close.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Equal("membership_revoked", (await Assert.ThrowsAsync<ApiException>(() => a.Call(x => x.FullSnapshot(a.Owner, familyA.FamilyId, default)))).Code);
        }
        finally { release.TrySetResult(); await held; }
    }

    [SqlFact]
    public async Task CountCapRejectsNewIdsButLegacyBoundedHistoryCanReadEditAndDeleteAtWriteCapacity()
    {
        var s = new Scenario(sql);
        var created = await Create(s);
        await using (var db = sql.Open())
            await db.Database.ExecuteSqlInterpolatedAsync($$"""
                INSERT dbo.FamilyRecords(FamilyId,Collection,IdHash,Id,RecordJson,RecordedBy,LastEditedBy,Deleted)
                SELECT {{created.FamilyId}}, 'entry', CONVERT(varchar(64), HASHBYTES('SHA2_256',CONCAT('old-',n)),2),
                    CONCAT('old-',n), CONCAT('{"id":"old-',n,'","type":"diaper","start":"2026-09-01T00:00:00Z","diaperKind":"wet","note":""}'),
                    {{s.Owner.ObjectId}}, {{s.Owner.ObjectId}}, 0
                FROM (SELECT TOP (10000) ROW_NUMBER() OVER(ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b) rows
                """);
        var snapshot = await s.Call(x => x.FullSnapshot(s.Owner, created.FamilyId, default));
        Assert.True(snapshot.Entries.Length > FamilyAvailability.MaxRecords);
        var fresh = FullDomainTests.Json("""{"id":"new-over-quota","type":"sleep","start":"2026-09-01T00:00:00Z","note":""}""");
        var operation = new FullRecordOperation(Guid.NewGuid(), "new-over-quota", created.MembershipId, created.HistoryId, "create", "entry", null, fresh, null);
        Assert.Equal("family_record_limit", (await Assert.ThrowsAsync<ApiException>(() => s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId, operation, default)))).Code);
        var original = snapshot.Entries[0];
        var id = original.Entry.GetProperty("id").GetString()!;
        var edit = operation with { OperationId = Guid.NewGuid(), RecordId = id, Kind = "update", BaseVersion = original.Version, Entry = original.Entry };
        await s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId, edit, default));
        var edited = (await s.Call(x => x.FullSnapshot(s.Owner, created.FamilyId, default))).Entries.Single(x => x.Entry.GetProperty("id").GetString() == id);
        s.Config.Pilot.MaxOperationsPerFamily = 1;
        await s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId, edit with { OperationId = Guid.NewGuid(), Kind = "delete", BaseVersion = edited.Version, Entry = null }, default));
        await using var check = sql.Open();
        var tombstone = await check.FamilyRecords.SingleAsync(x => x.FamilyId == created.FamilyId && x.Id == id);
        Assert.True(tombstone.Deleted);
        Assert.Equal("{}", tombstone.RecordJson);
        Assert.False(await check.FamilyRecords.AnyAsync(x => x.FamilyId == created.FamilyId && x.Id == "new-over-quota"));
        await s.Call(x => x.CloseFamily(s.Owner, created.FamilyId, s.Context(created.Snapshot.Family), default));
    }

    [SqlFact]
    public async Task AggregateResponseQuotaRejectsGrowthBeforeCommitWithoutBlockingClosure()
    {
        var s = new Scenario(sql);
        var created = await Create(s);
        await using (var db = sql.Open())
            await db.Database.ExecuteSqlInterpolatedAsync($$"""
                INSERT dbo.FamilyRecords(FamilyId,Collection,IdHash,Id,RecordJson,RecordedBy,LastEditedBy,Deleted)
                SELECT {{created.FamilyId}}, 'entry', CONVERT(varchar(64), HASHBYTES('SHA2_256',CONCAT('bytes-',n)),2),
                    CONCAT('bytes-',n), CONCAT(CONVERT(nvarchar(max),'{"id":"bytes-'),n,'","type":"diaper","start":"2026-09-01T00:00:00Z","diaperKind":"wet","note":"',REPLICATE(CONVERT(nvarchar(max),'x'),10000),'"}'),
                    {{s.Owner.ObjectId}}, {{s.Owner.ObjectId}}, 0
                FROM (SELECT TOP (3300) ROW_NUMBER() OVER(ORDER BY (SELECT NULL)) AS n FROM sys.all_objects a CROSS JOIN sys.all_objects b) rows
                """);
        Assert.Equal("family_snapshot_limit", (await Assert.ThrowsAsync<ApiException>(() => s.Call(x => x.FullSnapshot(s.Owner, created.FamilyId, default)))).Code);
        var entry = FullDomainTests.Json("""{"id":"blocked-growth","type":"sleep","start":"2026-09-01T00:00:00Z","note":""}""");
        var op = new FullRecordOperation(Guid.NewGuid(), "blocked-growth", created.MembershipId, created.HistoryId, "create", "entry", null, entry, null);
        Assert.Equal("family_snapshot_limit", (await Assert.ThrowsAsync<ApiException>(() => s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId, op, default)))).Code);
        await using (var db = sql.Open()) Assert.False(await db.Operations.AnyAsync(x => x.OperationId == op.OperationId));
        await s.Call(x => x.CloseFamily(s.Owner, created.FamilyId, s.Context(created.Snapshot.Family), default));
    }

    [SqlFact]
    public async Task CompletedPurgesAreSkippedAndRemainingFamiliesAreBatched()
    {
        var s = new Scenario(sql);
        // Finish this class's earlier closed fixtures before testing exact batch size.
        await using (var db = sql.Open())
            while (await db.Families.AnyAsync(x => x.DeletedAt != null && x.PurgedAt == null))
                await new DeletionProcessor(db, s.Config, TimeProvider.System, new UnconfiguredAccountIdentityDeletion()).Process(default);
        var ids = Enumerable.Range(0, FamilyAvailability.CleanupBatchSize + 2).Select(_ => Guid.NewGuid()).ToArray();
        await using (var db = sql.Open())
        {
            foreach (var id in ids) db.Families.Add(new FamilyRow { Id = id, BabyName = "Synthetic closed family", CreatedAt = DateTimeOffset.UtcNow, DeletedAt = DateTimeOffset.UtcNow });
            await db.SaveChangesAsync();
            Assert.False(await new DeletionProcessor(db, s.Config, TimeProvider.System, new UnconfiguredAccountIdentityDeletion()).Process(default));
        }
        byte[] version;
        Guid first;
        await using (var db = sql.Open())
        {
            Assert.Equal(FamilyAvailability.CleanupBatchSize, await db.Families.CountAsync(x => ids.Contains(x.Id) && x.PurgedAt != null));
            var done = await db.Families.FirstAsync(x => ids.Contains(x.Id) && x.PurgedAt != null);
            first = done.Id; version = done.ProfileVersion;
            Assert.True(await new DeletionProcessor(db, s.Config, TimeProvider.System, new UnconfiguredAccountIdentityDeletion()).Process(default));
        }
        await using (var db = sql.Open())
        {
            Assert.Equal(ids.Length, await db.Families.CountAsync(x => ids.Contains(x.Id) && x.PurgedAt != null));
            Assert.Equal(version, (await db.Families.SingleAsync(x => x.Id == first)).ProfileVersion);
        }
    }

    [SqlFact]
    public async Task LegacyHighFeedConfigurationCannotCommitBeyondEscapedResponseBudget()
    {
        var s = new Scenario(sql);
        s.Config.Pilot.MaxFeeds = 10000;
        var family = await s.Create();
        var note = new string('\uE000', 500);
        var count = (int)((FamilyAvailability.MaxSnapshotBytes - FamilyAvailability.SnapshotMetadataReserve) /
            (512L + FamilyAvailability.MeasureResponseBytes(note)));
        Assert.True(count < s.Config.Pilot.MaxFeeds);
        await using (var db = sql.Open())
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT dbo.Feeds(FamilyId,Id,Start,[End],Amount,Note,RecordedBy,LastEditedBy,Deleted)
                SELECT TOP ({count}) {family.Id},NEWID(),SYSUTCDATETIME(),SYSUTCDATETIME(),100,{note},{s.Owner.ObjectId},{s.Owner.ObjectId},0
                FROM sys.all_objects a CROSS JOIN sys.all_objects b
                """);
        var op = s.CreateFeed(family, Scenario.Feed() with { Note = note });
        Assert.Equal("family_snapshot_limit", (await Assert.ThrowsAsync<ApiException>(() => s.Call(x => x.ApplyFeed(s.Owner, family.Id, op, default)))).Code);
        await using var check = sql.Open();
        Assert.False(await check.Operations.AnyAsync(x => x.OperationId == op.OperationId));
        Assert.Equal(count, await check.Feeds.CountAsync(x => x.FamilyId == family.Id));
    }

    [SqlFact]
    public async Task CreationClosureBudgetSurvivesPurgingAndDoesNotBlockClosureRetry()
    {
        var s = new Scenario(sql);
        for (var i = 0; i < FamilyAvailability.MaxClosuresPerDay; i++)
        {
            var family = await s.Create();
            var request = s.Context(family);
            await s.Call(x => x.CloseFamily(s.Owner, family.Id, request, default));
            await using (var db = sql.Open()) await new DeletionProcessor(db, s.Config, TimeProvider.System, new UnconfiguredAccountIdentityDeletion()).Process(default);
            await s.Call(x => x.CloseFamily(s.Owner, family.Id, request, default));
        }
        Assert.Equal("family_creation_limit", (await Assert.ThrowsAsync<ApiException>(() => s.Create())).Code);
        Assert.Equal("family_creation_limit", (await Assert.ThrowsAsync<ApiException>(() => Create(s))).Code);
    }

    private sealed class NoRecordReads : DbCommandInterceptor
    {
        public int Reads { get; private set; }
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Reads++;
            Assert.DoesNotContain("FamilyRecords", command.CommandText, StringComparison.Ordinal);
            return ValueTask.FromResult(result);
        }
    }
}
