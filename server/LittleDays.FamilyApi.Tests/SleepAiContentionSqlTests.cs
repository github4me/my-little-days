using System.Data.Common;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi.Tests;

// Application-lock compatibility must be exercised by SQL Server; an in-memory
// provider cannot prove that unrelated family work is allowed to commit.
public sealed class SleepAiContentionSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task HeldAiJobPollAllowsFamilyIdentitySnapshotAndSleepFeedWritesButExcludesLifecycle()
    {
        var s = new Scenario(sql); var clock = new SleepAiJobTests.Clock();
        var created = await s.Call(x => x.CreateFullFamily(s.Owner,
            new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed()), default));
        var request = SleepAiJobTests.Request(clock.Now);
        request = request with { Request = request.Request with { FamilyId = created.FamilyId,
            MembershipId = created.MembershipId, HistoryId = created.HistoryId } };
        await using (var db = sql.Open()) await Store(db, s, clock).Enqueue(s.Owner, request, default);
        var gate = new PauseReader("[SleepAiJobs]");
        await using var pollingDb = Open(gate);
        var poll = Store(pollingDb, s, clock).Get(s.Owner, request.OperationId, default);
        try
        {
            await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(await CanTakeLifecycleLock(), "The AI transaction must retain the lifecycle barrier until its authorized work commits.");
            Assert.Equal(created.FamilyId, Assert.Single((await s.Call(x => x.Me(s.Owner, default))
                .WaitAsync(TimeSpan.FromSeconds(3))).Families).Id);
            Assert.Equal(created.FamilyId, (await s.Call(x => x.FullSnapshot(s.Owner, created.FamilyId, default))
                .WaitAsync(TimeSpan.FromSeconds(3))).Family.Id);
            var entries = new[]
            {
                FullDomainTests.Json("""{"id":"sleep-during-ai-poll","type":"sleep","start":"2026-10-14T00:00:00Z","end":"2026-10-14T00:30:00Z","note":"Synthetic"}"""),
                FullDomainTests.Json("""{"id":"feed-during-ai-poll","type":"feed","start":"2026-10-14T01:00:00Z","end":"2026-10-14T01:10:00Z","feedKind":"formula","amount":120,"note":"Synthetic"}""")
            };
            foreach (var entry in entries)
            {
                var operation = new FullRecordOperation(Guid.NewGuid(), entry.GetProperty("id").GetString()!, created.MembershipId,
                    created.HistoryId, "create", "entry", null, entry, null);
                await s.Call(x => x.ApplyFullRecord(s.Owner, created.FamilyId, operation, default)).WaitAsync(TimeSpan.FromSeconds(3));
                await using var check = sql.Open();
                Assert.True(await check.FamilyRecords.AnyAsync(x => x.FamilyId == created.FamilyId && x.Id == operation.RecordId && !x.Deleted));
                Assert.True(await check.Operations.AnyAsync(x => x.UserId == s.Owner.ObjectId && x.OperationId == operation.OperationId));
            }
            Assert.False(poll.IsCompleted);
        }
        finally { gate.Release.TrySetResult(); await poll; }
        Assert.Equal("queued", (await poll).Status);
        Assert.True(await CanTakeLifecycleLock());
    }

    [SqlFact]
    public async Task AiTransactionsSerializeTrackedWritesAndCommitBeforeTheNextTransactionObservesThem()
    {
        var s = new Scenario(sql); var clock = new SleepAiJobTests.Clock();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var firstId = Guid.NewGuid(); var secondId = Guid.NewGuid();
        await using var firstDb = sql.Open();
        var first = new FamilyService(firstDb, s.Config, clock).SleepAiTransaction(async () =>
        {
            firstDb.SleepAiAttempts.Add(new() { Id = firstId, UserId = s.Owner.ObjectId, StartedAt = clock.Now });
            entered.TrySetResult(); await release.Task; return true;
        }, default);
        Task<bool>? second = null;
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(await CanTakeLock("LittleDays:SleepAi:v1", "Shared"), "The AI serialization lock must exclude other shared or exclusive AI callers.");
            var probe = new LockStarted("LittleDays:SleepAi:v1");
            await using var secondDb = Open(probe); var secondEntered = false;
            second = new FamilyService(secondDb, s.Config, clock).SleepAiTransaction(async () =>
            {
                secondEntered = true;
                Assert.True(await secondDb.SleepAiAttempts.AnyAsync(x => x.Id == firstId));
                secondDb.SleepAiAttempts.Add(new() { Id = secondId, UserId = s.Owner.ObjectId, StartedAt = clock.Now });
                return true;
            }, default);
            await probe.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(secondEntered); Assert.False(second.IsCompleted);
            release.TrySetResult();
            Assert.True(await first); Assert.True(await second.WaitAsync(TimeSpan.FromSeconds(5)));
        }
        finally { release.TrySetResult(); await first; if (second is not null) await second; }
        await using var check = sql.Open();
        Assert.Equal(2, await check.SleepAiAttempts.CountAsync(x => x.Id == firstId || x.Id == secondId));
    }

    [SqlFact]
    public async Task AiLockWaitDoesNotHoldLifecycleBarrierAndCancellationLeavesBothLocksAvailable()
    {
        var s = new Scenario(sql); var clock = new SleepAiJobTests.Clock();
        await using var holder = sql.Open();
        await using var held = await holder.Database.BeginTransactionAsync();
        await holder.Database.ExecuteSqlRawAsync("""
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock @Resource=N'LittleDays:SleepAi:v1',
                @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=0;
            IF @result < 0 THROW 51000, 'Synthetic AI lock unavailable.', 1;
            """);
        var probe = new LockStarted("LittleDays:SleepAi:v1");
        await using var waitingDb = Open(probe); using var cancelled = new CancellationTokenSource();
        var ran = false;
        var waiting = new FamilyService(waitingDb, s.Config, clock).SleepAiTransaction(() =>
        { ran = true; return Task.FromResult(true); }, cancelled.Token);
        try
        {
            await probe.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.True(await CanTakeLifecycleLock(), "An AI request queued behind another AI request must not hold a shared lifecycle lock.");
            cancelled.Cancel();
            var failure = await Record.ExceptionAsync(() => waiting);
            Assert.NotNull(failure); Assert.True(cancelled.IsCancellationRequested);
            // SqlClient can surface cancellation inside sp_getapplock as error 0
            // instead of OperationCanceledException. No timeout or lock error is accepted.
            if (failure is SqlException sqlError) Assert.Equal(0, sqlError.Number);
            else Assert.IsAssignableFrom<OperationCanceledException>(failure);
            Assert.False(ran);
        }
        finally { cancelled.Cancel(); await held.RollbackAsync(); }
        Assert.True(await sql.Call(s.Config, x => x.SleepAiTransaction(() => Task.FromResult(true), default), clock)
            .WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.True(await CanTakeLifecycleLock());
    }

    [SqlFact]
    public async Task AccountDeletionExcludesQueuedAiAdmissionAndNewRequestSeesCommittedRevocation()
    {
        var s = new Scenario(sql); var clock = new SleepAiJobTests.Clock();
        var gate = new PauseReader("[AccountDeletions]");
        await using var deletingDb = Open(gate);
        var deletion = new FamilyService(deletingDb, s.Config, clock).DeleteAccount(s.Owner,
            new(Guid.NewGuid(), new string('c', 64)), default);
        Task<SleepPredictionJobResponse>? admission = null;
        try
        {
            await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            var probe = new LockStarted("LittleDays:FamilyPilot:v1");
            await using var requestDb = Open(probe);
            admission = Store(requestDb, s, clock).Enqueue(s.Owner, SleepAiJobTests.Request(clock.Now), default);
            await probe.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(admission.IsCompleted);
            gate.Release.TrySetResult(); await deletion;
            Assert.Equal("account_deleted", (await Assert.ThrowsAsync<ApiException>(() => admission)).Code);
            await using var check = sql.Open();
            Assert.False(await check.SleepAiJobs.AnyAsync(x => x.UserId == s.Owner.ObjectId));
            Assert.Equal("pending", (await check.AccountDeletions.SingleAsync(x => x.UserId == s.Owner.ObjectId)).Status);
        }
        finally
        {
            gate.Release.TrySetResult(); await deletion;
            if (admission is not null) { try { await admission; } catch (ApiException) { } }
        }
    }

    private PilotDatabase Open(params IInterceptor[] interceptors) => new(
        new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(sql.ConnectionString).AddInterceptors(interceptors).Options);

    private static SleepAiJobStore Store(PilotDatabase db, Scenario scenario, TimeProvider clock) =>
        new(db, new(db, scenario.Config, clock), new(new ConfigurationBuilder().Build()), clock,
            Options.Create(SleepAiJobTests.Enabled()));

    private Task<bool> CanTakeLifecycleLock() => CanTakeLock("LittleDays:FamilyPilot:v1", "Exclusive");

    private async Task<bool> CanTakeLock(string resource, string mode)
    {
        await using var db = sql.Open(); await using var transaction = await db.Database.BeginTransactionAsync();
        var result = await db.Database.SqlQuery<int>($"""
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock @Resource={resource},
                @LockMode={mode}, @LockOwner='Transaction', @LockTimeout=0;
            SELECT @result AS Value;
            """).ToArrayAsync();
        return Assert.Single(result) >= 0;
    }

    private sealed class PauseReader(string table) : DbCommandInterceptor
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains(table, StringComparison.Ordinal) && Entered.TrySetResult())
                await Release.Task.WaitAsync(cancellationToken);
            return result;
        }
    }

    private sealed class LockStarted(string resource) : DbCommandInterceptor
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains(resource, StringComparison.Ordinal)) Entered.TrySetResult();
            return ValueTask.FromResult(result);
        }
    }
}
