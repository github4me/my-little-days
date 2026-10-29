using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiCleanupSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task CleanupBoundsPayloadAndMetadataBatchesAndPreservesRetentionBoundaries()
    {
        await using var s = new Setup(sql); var now = s.Clock.Now; var epoch = s.Scenario.Config.Family.HistoryId;
        var family = await s.Scenario.Create();
        await using (var db = sql.Open())
        {
            db.SleepAiFailedOutputs.AddRange(Failure(s, now, epoch), Failure(s, now.AddDays(1), Guid.NewGuid()), Failure(s, now.AddTicks(1), epoch));
            db.SleepAiExchanges.AddRange(Enumerable.Range(0, 501).Select(_ => Exchange(s, now, epoch)));
            db.SleepAiExchanges.AddRange(Exchange(s, now.AddDays(1), Guid.NewGuid()), Exchange(s, now.AddTicks(1), epoch));
            db.SleepAiJobs.AddRange(Job(s, now.AddTicks(-1)), Job(s, now), Job(s, now.AddTicks(1)));
            db.SleepAiRevocations.AddRange(Enumerable.Range(0, 501).Select(_ => Revocation(s, now)));
            db.SleepAiRevocations.Add(Revocation(s, now.AddTicks(1)));
            db.SleepAiAttempts.AddRange(Enumerable.Range(0, 501).Select(_ => Attempt(s, now.AddDays(-2).AddTicks(-1))));
            db.SleepAiAttempts.AddRange(Attempt(s, now.AddDays(-2)), Attempt(s, now));
            await db.SaveChangesAsync();
        }
        var batches = new DeleteBatches();
        await using (var db = s.Open(batches)) Assert.True(await s.Store(db).Cleanup(default));
        await using (var db = sql.Open())
        {
            var failures = await db.SleepAiFailedOutputs.Where(x => x.UserId == s.User).ToArrayAsync();
            Assert.Equal(now.AddTicks(1), Assert.Single(failures).ExpiresAt); Assert.Equal(epoch, failures[0].HistoryEpoch);
            var exchanges = await db.SleepAiExchanges.Where(x => x.UserId == s.User).ToArrayAsync();
            Assert.Equal(3, exchanges.Length); // 503 eligible/current rows minus the bounded 500 deletions.
            Assert.Single(exchanges, x => x.HistoryEpoch == epoch && x.ExpiresAt > now);
            Assert.Equal(now.AddTicks(1), Assert.Single(await db.SleepAiJobs.Where(x => x.UserId == s.User).ToArrayAsync()).ExpiresAt);
            Assert.Equal(2, await db.SleepAiRevocations.CountAsync(x => x.UserId == s.User));
            Assert.True(await db.SleepAiRevocations.AnyAsync(x => x.UserId == s.User && x.ExpiresAt == now.AddTicks(1)));
            Assert.Equal(3, await db.SleepAiAttempts.CountAsync(x => x.UserId == s.User));
            Assert.True(await db.SleepAiAttempts.AnyAsync(x => x.UserId == s.User && x.StartedAt == now.AddDays(-2)));
            Assert.Equal(1L, (await db.Families.SingleAsync(x => x.Id == family.Id)).Revision);
            Assert.Single(await db.Operations.Where(x => x.FamilyId == family.Id).ToArrayAsync());
        }
        Assert.Equal(500, batches.Rows["SleepAiExchanges"]);
        Assert.Equal(500, batches.Rows["SleepAiRevocations"]);
        Assert.Equal(500, batches.Rows["SleepAiAttempts"]);
        Assert.All(batches.PayloadBatchRows, n => Assert.InRange(n, 0, 1));
        Assert.All(batches.MetadataBatchRows, n => Assert.InRange(n, 0, 25));
        // A later invocation resumes the remainder; current-epoch unexpired data
        // and the exact two-day attempt boundary still remain.
        await using (var db = s.Open()) await s.Store(db).Cleanup(default);
        await using (var db = sql.Open())
        {
            Assert.Single(await db.SleepAiExchanges.Where(x => x.UserId == s.User).ToArrayAsync());
            Assert.Single(await db.SleepAiRevocations.Where(x => x.UserId == s.User).ToArrayAsync());
            Assert.Equal(2, await db.SleepAiAttempts.CountAsync(x => x.UserId == s.User));
        }
    }

    [SqlFact]
    public async Task FailedSecondPayloadBatchLeavesFirstCommitDurableAndRetryFinishesRemainder()
    {
        await using var s = new Setup(sql); await SeedFailures(s, 3);
        var batches = new DeleteBatches(failSecond: true);
        await using (var db = s.Open(batches))
            await Assert.ThrowsAsync<InvalidOperationException>(() => s.Store(db).Cleanup(default));
        await using (var db = sql.Open()) Assert.Equal(2, await db.SleepAiFailedOutputs.CountAsync(x => x.UserId == s.User));
        await using (var db = s.Open()) Assert.True(await s.Store(db).Cleanup(default));
        await using (var db = sql.Open()) Assert.False(await db.SleepAiFailedOutputs.AnyAsync(x => x.UserId == s.User));
    }

    [SqlFact]
    public async Task CancellationAfterCommittedPayloadBatchStopsFurtherDeletesAndReleasesLifecycleBarrier()
    {
        await using var s = new Setup(sql); await SeedFailures(s, 3);
        using var stopping = new CancellationTokenSource(); var batches = new DeleteBatches();
        var boundary = new AfterFirstBatch(batches, () => { stopping.Cancel(); return Task.CompletedTask; });
        await using (var db = s.Open(batches, boundary))
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => s.Store(db).Cleanup(stopping.Token));
        Assert.Equal(1, batches.Rows["SleepAiFailedOutputs"]);
        await using (var db = sql.Open()) Assert.Equal(2, await db.SleepAiFailedOutputs.CountAsync(x => x.UserId == s.User));
        Assert.NotEqual(Guid.Empty, (await new Scenario(sql).Create().WaitAsync(TimeSpan.FromSeconds(3))).Id);
    }

    [SqlFact]
    public async Task RecoveryGateActivatedBetweenBatchesStopsCleanupBeforeAnotherDelete()
    {
        await using var s = new Setup(sql); await SeedFailures(s, 3); var batches = new DeleteBatches();
        var boundary = new AfterFirstBatch(batches, () => { s.Maintenance["Recovery:Blocked"] = "true"; return Task.CompletedTask; });
        await using (var db = s.Open(batches, boundary))
            Assert.Equal("recovery_blocked", (await Assert.ThrowsAsync<ApiException>(() => s.Store(db).Cleanup(default))).Code);
        Assert.Equal(1, batches.Rows["SleepAiFailedOutputs"]);
        await using (var db = sql.Open()) Assert.Equal(2, await db.SleepAiFailedOutputs.CountAsync(x => x.UserId == s.User));
        s.Maintenance["Recovery:Blocked"] = "false";
        await using (var db = s.Open()) Assert.True(await s.Store(db).Cleanup(default));
        await using (var db = sql.Open()) Assert.False(await db.SleepAiFailedOutputs.AnyAsync(x => x.UserId == s.User));
    }

    [SqlFact]
    public async Task PayloadCleanupReleasesBothApplicationLocksBetweenCommittedBatches()
    {
        await using var s = new Setup(sql); await SeedFailures(s, 3); var batches = new DeleteBatches();
        var reached = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var boundary = new AfterFirstBatch(batches, async () => { reached.TrySetResult(); await release.Task; });
        await using var db = s.Open(batches, boundary); var cleanup = s.Store(db).Cleanup(default);
        try
        {
            await reached.Task.WaitAsync(TimeSpan.FromSeconds(5));
            await using (var check = sql.Open()) Assert.Equal(2, await check.SleepAiFailedOutputs.CountAsync(x => x.UserId == s.User));
            Assert.NotEqual(Guid.Empty, (await new Scenario(sql).Create().WaitAsync(TimeSpan.FromSeconds(3))).Id);
            Assert.True(await sql.Call(s.Scenario.Config, x => x.SleepAiTransaction(() => Task.FromResult(true), default))
                .WaitAsync(TimeSpan.FromSeconds(3)));
        }
        finally { release.TrySetResult(); await cleanup; }
        await using var remaining = sql.Open();
        Assert.False(await remaining.SleepAiFailedOutputs.AnyAsync(x => x.UserId == s.User));
    }

    private async Task SeedFailures(Setup s, int count)
    {
        await using var db = sql.Open();
        db.SleepAiFailedOutputs.AddRange(Enumerable.Range(0, count).Select(_ => Failure(s, s.Clock.Now, s.Scenario.Config.Family.HistoryId)));
        await db.SaveChangesAsync();
    }

    private static SleepAiFailedOutputRow Failure(Setup s, DateTimeOffset expires, Guid epoch) => new()
    {
        UserId = s.User, JobId = Guid.NewGuid(), Run = 1, Attempt = 1, ConsentGeneration = Guid.NewGuid(), HistoryEpoch = epoch,
        Reason = "invalid_json", ResponseText = "synthetic", OriginalLength = 9, OccurredAt = expires.AddDays(-7), ExpiresAt = expires,
        Model = "synthetic"
    };
    private static SleepAiExchangeRow Exchange(Setup s, DateTimeOffset expires, Guid epoch) => new()
    {
        UserId = s.User, JobId = Guid.NewGuid(), Run = 1, Attempt = 1, ConsentGeneration = Guid.NewGuid(), HistoryEpoch = epoch,
        SchemaVersion = 3, StartedAt = expires.AddDays(-7), ExpiresAt = expires, RequestBody = "synthetic", RequestBytes = 9
    };
    private static SleepAiJobRow Job(Setup s, DateTimeOffset expires) => new()
    {
        UserId = s.User, Id = Guid.NewGuid(), ConsentGeneration = Guid.NewGuid(), InputRevision = new('a', 64), RequestHash = new('b', 64),
        State = "completed", RequestNow = s.Clock.Now, CreatedAt = s.Clock.Now, UpdatedAt = s.Clock.Now, ExpiresAt = expires, ResultJson = "{}"
    };
    private static SleepAiRevocationRow Revocation(Setup s, DateTimeOffset expires) => new()
    { UserId = s.User, Kind = "consent", Id = Guid.NewGuid(), ExpiresAt = expires };
    private static SleepAiAttemptRow Attempt(Setup s, DateTimeOffset started) => new()
    { Id = Guid.NewGuid(), UserId = s.User, StartedAt = started };

    private sealed class Setup(SqlFixture sql) : IAsyncDisposable
    {
        public Scenario Scenario { get; } = new(sql);
        public Guid User => Scenario.Owner.ObjectId;
        public SleepAiJobTests.Clock Clock { get; } = new();
        public IConfigurationRoot Maintenance { get; } = new ConfigurationBuilder().AddInMemoryCollection().Build();
        public PilotDatabase Open(params IInterceptor[] interceptors) => new(
            new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(sql.ConnectionString).AddInterceptors(interceptors).Options);
        public SleepAiJobStore Store(PilotDatabase db) => new(db, new(db, Scenario.Config, Clock), new(Maintenance), Clock,
            Options.Create(SleepAiJobTests.Enabled()));
        public async ValueTask DisposeAsync()
        {
            await using var db = sql.Open();
            await db.SleepAiFailedOutputs.Where(x => x.UserId == User).ExecuteDeleteAsync();
            await db.SleepAiExchanges.Where(x => x.UserId == User).ExecuteDeleteAsync();
            await db.SleepAiJobs.Where(x => x.UserId == User).ExecuteDeleteAsync();
            await db.SleepAiRevocations.Where(x => x.UserId == User).ExecuteDeleteAsync();
            await db.SleepAiAttempts.Where(x => x.UserId == User).ExecuteDeleteAsync();
        }
    }

    private sealed class DeleteBatches(bool failSecond = false) : DbCommandInterceptor
    {
        private static readonly string[] Tables = ["SleepAiFailedOutputs", "SleepAiExchanges", "SleepAiJobs", "SleepAiRevocations", "SleepAiAttempts"];
        public Dictionary<string, int> Rows { get; } = [];
        public List<int> PayloadBatchRows { get; } = [];
        public List<int> MetadataBatchRows { get; } = [];
        private int attempted;
        private static string? Table(DbCommand command) => command.CommandText.Contains("DELETE", StringComparison.OrdinalIgnoreCase)
            ? Tables.SingleOrDefault(x => command.CommandText.Contains("dbo." + x, StringComparison.Ordinal)) : null;
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (Table(command) is not null && ++attempted == 2 && failSecond)
                throw new InvalidOperationException("Synthetic cleanup interruption");
            return ValueTask.FromResult(result);
        }
        public override ValueTask<int> NonQueryExecutedAsync(DbCommand command, CommandExecutedEventData eventData,
            int result, CancellationToken cancellationToken = default)
        {
            if (Table(command) is { } table)
            {
                Rows[table] = Rows.GetValueOrDefault(table) + result;
                (table is "SleepAiRevocations" or "SleepAiAttempts" ? MetadataBatchRows : PayloadBatchRows).Add(result);
            }
            return ValueTask.FromResult(result);
        }
    }

    private sealed class AfterFirstBatch(DeleteBatches batches, Func<Task> action) : DbTransactionInterceptor
    {
        private bool ran;
        public override async Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData,
            CancellationToken cancellationToken = default)
        {
            if (!ran && batches.Rows.GetValueOrDefault("SleepAiFailedOutputs") == 1)
            { ran = true; await action(); }
        }
    }
}
