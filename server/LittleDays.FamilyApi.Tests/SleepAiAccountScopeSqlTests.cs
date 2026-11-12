using System.Data.Common;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi.Tests;

// These assertions require SQL Server's actual transaction/application locks.
// SqlFixture creates and drops only its own generated, disposable test database.
public sealed class SleepAiAccountScopeSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    private const string GlobalResource = "LittleDays:SleepAi:v1";
    private const string LifecycleResource = "LittleDays:FamilyPilot:v1";
    private static string AccountResource(Guid user) => $"LittleDays:SleepAiAccount:{user:D}";

    [SqlFact]
    public async Task DifferentAccountMutationsCommitConcurrentlyWhileLegacyAndLifecycleBarriersRemain()
    {
        await using var s = new Setup(sql); var entered = Signal(); var release = Signal();
        var firstId = Guid.NewGuid(); var secondId = Guid.NewGuid();
        await using var firstDb = s.Open();
        var first = s.Family(firstDb).SleepAiAccountTransaction(s.User, async () =>
        {
            firstDb.SleepAiAttempts.Add(new() { Id = firstId, UserId = s.User, StartedAt = s.Clock.Now });
            entered.TrySetResult(); await release.Task; return true;
        }, default);
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.True(await CanTakeLock(GlobalResource, "Shared"));
            Assert.False(await CanTakeLock(GlobalResource, "Exclusive"));
            Assert.False(await CanTakeLock(LifecycleResource, "Exclusive"));
            Assert.False(await CanTakeLock(AccountResource(s.User), "Shared"));
            await using var secondDb = s.Open();
            Assert.True(await s.Family(secondDb).SleepAiAccountTransaction(s.Scenario.Other.ObjectId, () =>
            {
                secondDb.SleepAiAttempts.Add(new() { Id = secondId, UserId = s.Scenario.Other.ObjectId, StartedAt = s.Clock.Now });
                return Task.FromResult(true);
            }, default).WaitAsync(TimeSpan.FromSeconds(3)));
            await using var check = s.Open();
            Assert.True(await check.SleepAiAttempts.AnyAsync(x => x.Id == secondId));
            Assert.False(await check.SleepAiAttempts.AnyAsync(x => x.Id == firstId));
            Assert.False(first.IsCompleted);
        }
        finally { release.TrySetResult(); await first; }
        await using var committed = s.Open();
        Assert.Equal(2, await committed.SleepAiAttempts.CountAsync(x => x.Id == firstId || x.Id == secondId));
        Assert.True(await CanTakeLock(GlobalResource, "Exclusive"));
        Assert.True(await CanTakeLock(LifecycleResource, "Exclusive"));
    }

    [SqlFact]
    public async Task SameAccountMutationsSerializeAndObserveThePrecedingCommittedWrite()
    {
        await using var s = new Setup(sql); var entered = Signal(); var release = Signal();
        var firstId = Guid.NewGuid(); var secondId = Guid.NewGuid();
        await using var firstDb = s.Open();
        var first = s.Family(firstDb).SleepAiAccountTransaction(s.User, async () =>
        {
            firstDb.SleepAiAttempts.Add(new() { Id = firstId, UserId = s.User, StartedAt = s.Clock.Now });
            entered.TrySetResult(); await release.Task; return true;
        }, default);
        var probe = new LockStarted(AccountResource(s.User));
        await using var secondDb = s.Open(probe); Task<bool>? second = null; var secondEntered = false;
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            second = s.Family(secondDb).SleepAiAccountTransaction(s.User, async () =>
            {
                secondEntered = true;
                Assert.True(await secondDb.SleepAiAttempts.AnyAsync(x => x.Id == firstId));
                secondDb.SleepAiAttempts.Add(new() { Id = secondId, UserId = s.User, StartedAt = s.Clock.Now });
                return true;
            }, default);
            await probe.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(secondEntered); Assert.False(second.IsCompleted);
            Assert.False(await CanTakeLock(AccountResource(s.User), "Shared"));
            release.TrySetResult();
            Assert.True(await first); Assert.True(await second.WaitAsync(TimeSpan.FromSeconds(5)));
        }
        finally { release.TrySetResult(); await first; if (second is not null) await second; }
        await using var check = s.Open();
        Assert.Equal(2, await check.SleepAiAttempts.CountAsync(x => x.Id == firstId || x.Id == secondId));
    }

    [SqlFact]
    public async Task SameAccountReadsCoexistButMutationWaitsForTheLastReaderToCommit()
    {
        await using var s = new Setup(sql); var entered = Signal(); var release = Signal();
        await using var firstDb = s.Open();
        var read = s.Family(firstDb).SleepAiAccountTransaction(s.User, async () =>
        { entered.TrySetResult(); await release.Task; return true; }, default, readOnly: true);
        var probe = new LockStarted(AccountResource(s.User));
        await using var writingDb = s.Open(probe); Task<bool>? mutation = null; var mutationEntered = false;
        try
        {
            await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.True(await CanTakeLock(AccountResource(s.User), "Shared"));
            Assert.False(await CanTakeLock(AccountResource(s.User), "Exclusive"));
            await using var secondDb = s.Open();
            Assert.True(await s.Family(secondDb).SleepAiAccountTransaction(s.User, () => Task.FromResult(true),
                default, readOnly: true).WaitAsync(TimeSpan.FromSeconds(3)));
            mutation = s.Family(writingDb).SleepAiAccountTransaction(s.User, () =>
            { mutationEntered = true; return Task.FromResult(true); }, default);
            await probe.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(mutationEntered); Assert.False(mutation.IsCompleted);
            release.TrySetResult(); Assert.True(await read);
            Assert.True(await mutation.WaitAsync(TimeSpan.FromSeconds(5))); Assert.True(mutationEntered);
        }
        finally { release.TrySetResult(); await read; if (mutation is not null) await mutation; }
    }

    [SqlFact]
    public async Task LegacyExclusiveLockBlocksAccountReadsAndWritesWithoutTakingLifecycleWhileWaiting()
    {
        await using var s = new Setup(sql);
        foreach (var readOnly in new[] { false, true })
        {
            await using var holder = s.Open(); await using var held = await holder.Database.BeginTransactionAsync();
            await HoldLock(holder, GlobalResource, "Exclusive");
            var probe = new LockStarted(GlobalResource); await using var waitingDb = s.Open(probe);
            using var cancellation = new CancellationTokenSource(); var ran = false;
            var waiting = s.Family(waitingDb).SleepAiAccountTransaction(s.User, () =>
            { ran = true; return Task.FromResult(true); }, cancellation.Token, readOnly);
            try
            {
                await probe.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
                Assert.True(await CanTakeLock(LifecycleResource, "Exclusive"));
                Assert.False(await CanTakeLock(AccountResource(s.User), "Exclusive"));
                Assert.False(ran); Assert.False(waiting.IsCompleted);
                cancellation.Cancel(); await AssertCancelled(waiting); Assert.False(ran);
            }
            finally { cancellation.Cancel(); await held.RollbackAsync(); }
            await using var check = s.Open();
            Assert.True(await s.Family(check).SleepAiAccountTransaction(s.User, () => Task.FromResult(true), default, readOnly)
                .WaitAsync(TimeSpan.FromSeconds(5)));
        }
        Assert.True(await CanTakeLock(GlobalResource, "Exclusive"));
        Assert.True(await CanTakeLock(LifecycleResource, "Exclusive"));
    }

    [SqlFact]
    public async Task WaitingForTheSameAccountDoesNotHoldTheLifecycleBarrier()
    {
        await using var s = new Setup(sql); await using var holder = s.Open();
        await using var held = await holder.Database.BeginTransactionAsync();
        await HoldLock(holder, AccountResource(s.User), "Exclusive");
        var probe = new LockStarted(AccountResource(s.User)); await using var waitingDb = s.Open(probe);
        using var cancellation = new CancellationTokenSource(); var ran = false;
        var waiting = s.Family(waitingDb).SleepAiAccountTransaction(s.User, () =>
        { ran = true; return Task.FromResult(true); }, cancellation.Token);
        try
        {
            await probe.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.True(await CanTakeLock(LifecycleResource, "Exclusive"));
            Assert.False(ran); Assert.False(waiting.IsCompleted);
            cancellation.Cancel(); await AssertCancelled(waiting);
        }
        finally { cancellation.Cancel(); await held.RollbackAsync(); }
        Assert.False(ran); Assert.True(await CanTakeLock(AccountResource(s.User), "Exclusive"));
        Assert.True(await CanTakeLock(GlobalResource, "Exclusive"));
    }

    [SqlFact]
    public async Task WaitingForAccountDoesNotBlockGlobalAdmissionTransaction()
    {
        await using var s = new Setup(sql); await using var holder = s.Open();
        await using var held = await holder.Database.BeginTransactionAsync();
        await HoldLock(holder, AccountResource(s.User), "Exclusive");
        var probe = new LockStarted(AccountResource(s.User)); await using var waitingDb = s.Open(probe);
        using var cancellation = new CancellationTokenSource(); var ran = false;
        var waiting = s.Family(waitingDb).SleepAiAccountTransaction(s.User, () =>
        { ran = true; return Task.FromResult(true); }, cancellation.Token);
        var attemptId = Guid.NewGuid();
        try
        {
            await probe.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.True(await CanTakeLock(GlobalResource, "Exclusive"));
            await using var globalDb = s.Open();
            Assert.True(await s.Family(globalDb).SleepAiTransaction(() =>
            {
                globalDb.SleepAiAttempts.Add(new() { Id = attemptId, UserId = s.Scenario.Other.ObjectId, StartedAt = s.Clock.Now });
                return Task.FromResult(true);
            }, default).WaitAsync(TimeSpan.FromSeconds(3)));
            await using var check = s.Open();
            Assert.True(await check.SleepAiAttempts.AnyAsync(x => x.Id == attemptId));
            Assert.False(ran); Assert.False(waiting.IsCompleted);
            cancellation.Cancel(); await AssertCancelled(waiting);
        }
        finally { cancellation.Cancel(); await held.RollbackAsync(); }
        Assert.False(ran); Assert.True(await CanTakeLock(GlobalResource, "Exclusive"));
    }

    [SqlFact]
    public async Task AccountTransactionRollsBackFailureAndReadOnlyDoesNotFlushTrackedChanges()
    {
        await using var s = new Setup(sql); var failedId = Guid.NewGuid(); var readId = Guid.NewGuid();
        await using (var db = s.Open())
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() => s.Family(db).SleepAiAccountTransaction<bool>(s.User, async () =>
            {
                db.SleepAiAttempts.Add(new() { Id = failedId, UserId = s.User, StartedAt = s.Clock.Now });
                await db.SaveChangesAsync();
                throw new InvalidOperationException("Synthetic rollback probe");
            }, default));
        }
        await using (var db = s.Open())
        {
            db.SleepAiAttempts.Add(new() { Id = readId, UserId = s.User, StartedAt = s.Clock.Now });
            Assert.True(await s.Family(db).SleepAiAccountTransaction(s.User, () => Task.FromResult(true), default, readOnly: true));
        }
        await using var check = s.Open();
        Assert.False(await check.SleepAiAttempts.AnyAsync(x => x.Id == failedId || x.Id == readId));
        Assert.True(await CanTakeLock(AccountResource(s.User), "Exclusive"));
        Assert.True(await CanTakeLock(GlobalResource, "Exclusive"));
    }

    [SqlFact]
    public async Task HeldPollAllowsOtherReadsCompletionAndCancellationButExcludesOwnCancellation()
    {
        await using var s = new Setup(sql); var own = SleepAiJobTests.Request(s.Clock.Now);
        var other = SleepAiJobTests.Request(s.Clock.Now);
        await s.Call(x => x.Enqueue(s.Scenario.Other, other, default));
        var otherClaim = Assert.IsType<SleepAiJobClaim>(await s.Call(x => x.Claim(default)));
        await s.Call(x => x.Enqueue(s.Scenario.Owner, own, default));
        var gate = new PauseJobRead(); await using var pollingDb = s.Open(gate);
        var poll = s.Store(pollingDb).Get(s.Scenario.Owner, own.OperationId, default);
        var probe = new LockStarted(AccountResource(s.User)); await using var cancellingDb = s.Open(probe);
        Task<bool>? cancellation = null;
        try
        {
            await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(await CanTakeLock(LifecycleResource, "Exclusive"));
            Assert.Equal("queued", (await s.Call(x => x.Get(s.Scenario.Owner, own.OperationId, default))
                .WaitAsync(TimeSpan.FromSeconds(3))).Status);
            Assert.True(await s.Call(x => x.Complete(otherClaim, s.Result(otherClaim), null, default))
                .WaitAsync(TimeSpan.FromSeconds(3)));
            Assert.Equal("completed", (await s.Call(x => x.Get(s.Scenario.Other, other.OperationId, default))).Status);
            Assert.True(await s.Call(x => x.Cancel(s.Scenario.Other, other.ConsentGeneration, true, default))
                .WaitAsync(TimeSpan.FromSeconds(3)));
            Assert.Equal("cancelled", (await s.Call(x => x.Get(s.Scenario.Other, other.OperationId, default))).Status);
            cancellation = s.Store(cancellingDb).Cancel(s.Scenario.Owner, own.ConsentGeneration, true, default);
            await probe.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(cancellation.IsCompleted); Assert.False(poll.IsCompleted);
            gate.Release.TrySetResult(); Assert.Equal("queued", (await poll).Status);
            Assert.True(await cancellation.WaitAsync(TimeSpan.FromSeconds(5)));
        }
        finally { gate.Release.TrySetResult(); await poll; if (cancellation is not null) await cancellation; }
        Assert.Equal("cancelled", (await s.Call(x => x.Get(s.Scenario.Owner, own.OperationId, default))).Status);
    }

    [SqlFact]
    public async Task QueuedPollProjectsNoRequestPayloadAndPerformsNoDatabaseMutation()
    {
        await using var s = new Setup(sql); var request = SleepAiJobTests.Request(s.Clock.Now);
        var enqueued = await s.Call(x => x.Enqueue(s.Scenario.Owner, request, default));
        var probe = new QueryProbe(); await using var db = s.Open(probe);
        var response = await s.Store(db).Get(s.Scenario.Owner, request.OperationId, default);
        Assert.Equal(enqueued, response); Assert.Null(response.Prediction);
        AssertReadOnlyJobProjection(probe, excludeResult: false);
        Assert.Empty(db.ChangeTracker.Entries<SleepAiJobRow>());
        await using var check = s.Open();
        var row = await check.SleepAiJobs.SingleAsync(x => x.UserId == s.User && x.Id == request.OperationId);
        Assert.Equal("queued", row.State); Assert.NotNull(row.RequestJson); Assert.Equal(enqueued.UpdatedAt, row.UpdatedAt);
    }

    [SqlFact]
    public async Task CompletedAndExactMidnightPollsPreserveDurableStateAndNeverReturnExpiredPrediction()
    {
        await using var s = new Setup(sql); var request = SleepAiJobTests.Request(s.Clock.Now);
        await s.Call(x => x.Enqueue(s.Scenario.Owner, request, default));
        var claim = Assert.IsType<SleepAiJobClaim>(await s.Call(x => x.Claim(default)));
        var prediction = s.Result(claim); Assert.True(await s.Call(x => x.Complete(claim, prediction, null, default)));
        string? resultJson; DateTimeOffset updated;
        await using (var before = s.Open())
        {
            var row = await before.SleepAiJobs.SingleAsync(x => x.UserId == s.User && x.Id == request.OperationId);
            resultJson = row.ResultJson; updated = row.UpdatedAt;
        }
        var probe = new QueryProbe(); await using var pollingDb = s.Open(probe);
        var store = s.Store(pollingDb);
        var completed = await store.Get(s.Scenario.Owner, request.OperationId, default);
        Assert.Equal("completed", completed.Status);
        Assert.Equal(JsonSerializer.Serialize(prediction, SleepAiJson.Options), JsonSerializer.Serialize(completed.Prediction, SleepAiJson.Options));
        s.Clock.Now = completed.ExpiresAt.AddTicks(-1);
        Assert.NotNull((await store.Get(s.Scenario.Owner, request.OperationId, default)).Prediction);
        s.Clock.Now = completed.ExpiresAt;
        var expired = await store.Get(s.Scenario.Owner, request.OperationId, default);
        Assert.Equal("expired", expired.Status); Assert.Null(expired.Prediction); Assert.Null(expired.ErrorCode);
        AssertReadOnlyJobProjection(probe, excludeResult: false);
        await using var check = s.Open();
        var unchanged = await check.SleepAiJobs.SingleAsync(x => x.UserId == s.User && x.Id == request.OperationId);
        Assert.Equal("completed", unchanged.State); Assert.Equal(resultJson, unchanged.ResultJson); Assert.Equal(updated, unchanged.UpdatedAt);
    }

    [SqlFact]
    public async Task RevokedPollSuppressesInvalidStoredResultBeforeDeserializationWithoutChangingTheRow()
    {
        await using var s = new Setup(sql);
        // Pass SQL's ISJSON constraint while ensuring that loading this as a
        // prediction would throw. Revocation must suppress it before parsing.
        const string invalidResult = """{"schemaVersion":"not-a-number"}""";
        foreach (var kind in new[] { "job", "consent" })
        {
            var request = SleepAiJobTests.Request(s.Clock.Now);
            await s.Call(x => x.Enqueue(s.Scenario.Owner, request, default));
            await using (var seed = s.Open())
            {
                var row = await seed.SleepAiJobs.SingleAsync(x => x.UserId == s.User && x.Id == request.OperationId);
                row.State = "completed"; row.ResultJson = invalidResult; row.ErrorCode = "ai_provider_unavailable";
                seed.SleepAiRevocations.Add(new() { UserId = s.User, Kind = kind,
                    Id = kind == "job" ? request.OperationId : request.ConsentGeneration, ExpiresAt = s.Clock.Now.AddDays(2) });
                await seed.SaveChangesAsync();
            }
            var probe = new QueryProbe(); await using var pollingDb = s.Open(probe);
            var result = await s.Store(pollingDb).Get(s.Scenario.Owner, request.OperationId, default);
            Assert.Equal("cancelled", result.Status); Assert.Null(result.Prediction); Assert.Null(result.ErrorCode);
            AssertReadOnlyJobProjection(probe, excludeResult: false);
            await using var check = s.Open();
            var unchanged = await check.SleepAiJobs.SingleAsync(x => x.UserId == s.User && x.Id == request.OperationId);
            Assert.Equal("completed", unchanged.State); Assert.Equal(invalidResult, unchanged.ResultJson);
        }
    }

    [SqlFact]
    public async Task EnsureCurrentUsesReadOnlyMetadataAndRejectsExactLeaseAndDayEndBoundaries()
    {
        await using var s = new Setup(sql); var request = SleepAiJobTests.Request(s.Clock.Now);
        await s.Call(x => x.Enqueue(s.Scenario.Owner, request, default));
        var claim = Assert.IsType<SleepAiJobClaim>(await s.Call(x => x.Claim(default)));
        var probe = new QueryProbe(); await using var db = s.Open(probe); var store = s.Store(db);
        Assert.True(await store.EnsureCurrent(claim, default));
        Assert.Equal("ai_job_cancelled", (await Assert.ThrowsAsync<ApiException>(() =>
            store.EnsureCurrent(claim with { LeaseId = Guid.NewGuid() }, default))).Code);
        s.Clock.Now = request.Request.Now.AddMinutes(2).AddTicks(-1);
        Assert.True(await store.EnsureCurrent(claim, default));
        s.Clock.Now = request.Request.Now.AddMinutes(2);
        Assert.Equal("ai_job_cancelled", (await Assert.ThrowsAsync<ApiException>(() => store.EnsureCurrent(claim, default))).Code);
        var end = SleepAiValidation.ValidateRequest(request.Request, request.Request.Now).TodayEnd;
        await using (var change = s.Open())
            await change.SleepAiJobs.Where(x => x.UserId == s.User && x.Id == request.OperationId)
                .ExecuteUpdateAsync(update => update.SetProperty(x => x.LeaseUntil, end.AddMinutes(2)));
        s.Clock.Now = end.AddTicks(-1); Assert.True(await store.EnsureCurrent(claim, default));
        s.Clock.Now = end;
        Assert.Equal("ai_job_cancelled", (await Assert.ThrowsAsync<ApiException>(() => store.EnsureCurrent(claim, default))).Code);
        AssertReadOnlyJobProjection(probe, excludeResult: true); Assert.Empty(db.ChangeTracker.Entries<SleepAiJobRow>());
        await using var check = s.Open();
        Assert.Equal("running", (await check.SleepAiJobs.SingleAsync(x => x.UserId == s.User && x.Id == request.OperationId)).State);
    }

    [SqlFact]
    public async Task EnsureCurrentRechecksConsentAccountAndRecoveryInTheSameDbContext()
    {
        foreach (var authority in new[] { "consent", "account", "recovery" })
        {
            await using var s = new Setup(sql); var request = SleepAiJobTests.Request(s.Clock.Now);
            await s.Call(x => x.Enqueue(s.Scenario.Owner, request, default));
            var claim = Assert.IsType<SleepAiJobClaim>(await s.Call(x => x.Claim(default)));
            var probe = new QueryProbe(); await using var db = s.Open(probe); var store = s.Store(db);
            Assert.True(await store.EnsureCurrent(claim, default));
            await using (var change = s.Open())
            {
                if (authority == "consent")
                    change.SleepAiRevocations.Add(new() { UserId = s.User, Kind = "consent", Id = request.ConsentGeneration,
                        ExpiresAt = s.Clock.Now.AddDays(2) });
                else if (authority == "account")
                    change.AccountDeletions.Add(new() { UserId = s.User, OperationId = Guid.NewGuid(),
                        RequestedAt = s.Clock.Now, ReceiptHash = new string('c', 64) });
                else s.Maintenance["Recovery:Blocked"] = "true";
                await change.SaveChangesAsync();
            }
            var expected = authority switch { "consent" => "ai_consent_revoked", "account" => "account_deleted", _ => "recovery_blocked" };
            Assert.Equal(expected, (await Assert.ThrowsAsync<ApiException>(() => store.EnsureCurrent(claim, default))).Code);
            AssertReadOnlyJobProjection(probe, excludeResult: true);
            await using var check = s.Open();
            var unchanged = await check.SleepAiJobs.SingleAsync(x => x.UserId == s.User && x.Id == request.OperationId);
            Assert.Equal("running", unchanged.State); Assert.Equal(claim.LeaseId, unchanged.LeaseId);
        }
    }

    [SqlFact]
    public async Task EnsureCurrentRechecksFamilyGrantAndHistoryInTheSameDbContext()
    {
        foreach (var authority in new[] { "membership", "history" })
        {
            await using var s = new Setup(sql); var family = await s.Scenario.Create();
            var request = SleepAiJobTests.Request(s.Clock.Now);
            request = request with { Request = request.Request with { FamilyId = family.Id,
                MembershipId = family.MembershipId, HistoryId = s.Scenario.Config.Family.HistoryId } };
            await s.Call(x => x.Enqueue(s.Scenario.Owner, request, default));
            var claim = Assert.IsType<SleepAiJobClaim>(await s.Call(x => x.Claim(default)));
            SleepAiJobRow original;
            await using (var before = s.Open())
                original = await before.SleepAiJobs.AsNoTracking().SingleAsync(x => x.UserId == s.User && x.Id == request.OperationId);
            Assert.Equal("running", original.State); Assert.Equal(claim.LeaseId, original.LeaseId);
            var leaseUntil = Assert.IsType<DateTimeOffset>(original.LeaseUntil); Assert.NotNull(original.RequestJson);
            // Keep the same still-valid lease throughout: rejection must come
            // from current authority, not an elapsed lease or lifecycle cleanup.
            s.Clock.Now = leaseUntil.AddTicks(-1);
            var probe = new QueryProbe(); await using var db = s.Open(probe); var store = s.Store(db);
            Assert.True(await store.EnsureCurrent(claim, default));
            AssertReadOnlyJobProjection(probe, excludeResult: true);
            probe.Reads.Clear(); probe.Commands.Clear();
            if (authority == "membership")
            {
                await using var change = s.Open();
                Assert.Equal(1, await change.Memberships.Where(x => x.Id == family.MembershipId)
                    .ExecuteUpdateAsync(update => update.SetProperty(x => x.Active, false).SetProperty(x => x.Status, "removed")));
            }
            else s.Scenario.Config.Family.HistoryId = Guid.NewGuid();

            var error = await Assert.ThrowsAsync<ApiException>(() => store.EnsureCurrent(claim, default));
            Assert.Equal(authority == "membership" ? "membership_revoked" : "history_changed", error.Code);
            Assert.Equal(authority == "membership" ? 403 : 409, error.Status);
            AssertReadOnlyJobProjection(probe, excludeResult: true);
            Assert.Empty(db.ChangeTracker.Entries<SleepAiJobRow>());
            Assert.Equal(leaseUntil.AddTicks(-1), s.Clock.Now);
            await using var check = s.Open();
            var unchanged = await check.SleepAiJobs.AsNoTracking().SingleAsync(x => x.UserId == s.User && x.Id == request.OperationId);
            Assert.Equal(JsonSerializer.Serialize(original, SleepAiJson.Options), JsonSerializer.Serialize(unchanged, SleepAiJson.Options));
        }
    }

    [SqlFact]
    public async Task EmptyAccountScopeIsRejectedBeforeAnyActionOrDatabaseCommand()
    {
        await using var s = new Setup(sql); var probe = new QueryProbe(); await using var db = s.Open(probe); var ran = false;
        var error = await Assert.ThrowsAsync<ArgumentException>(() => s.Family(db).SleepAiAccountTransaction(Guid.Empty, () =>
        { ran = true; return Task.FromResult(true); }, default));
        Assert.Equal("userId", error.ParamName); Assert.False(ran); Assert.Empty(probe.Commands);
    }

    [SqlFact]
    public async Task EmptyClaimBypassesApplicationLocksButStillChecksRecoveryAndAvailability()
    {
        await using var s = new Setup(sql); await using var holder = s.Open();
        await using var held = await holder.Database.BeginTransactionAsync(); await HoldLock(holder, GlobalResource, "Exclusive");
        var probe = new QueryProbe(); await using var db = s.Open(probe); var store = s.Store(db);
        Assert.Null(await store.Claim(default).WaitAsync(TimeSpan.FromSeconds(3)));
        Assert.NotEmpty(probe.Reads); Assert.Empty(probe.ApplicationLocks); Assert.Empty(probe.Mutations);
        s.Maintenance["Recovery:Blocked"] = "true";
        Assert.Equal("recovery_blocked", (await Assert.ThrowsAsync<ApiException>(() => store.Claim(default))).Code);
        s.Maintenance["Recovery:Blocked"] = "false"; s.Settings.Enabled = false;
        Assert.Null(await store.Claim(default).WaitAsync(TimeSpan.FromSeconds(3)));
        Assert.Empty(probe.ApplicationLocks); Assert.Empty(probe.Mutations);
    }

    [SqlFact]
    public async Task ClaimSkipsApplicationLocksWhenOnlyAnUnexpiredRunningLeaseExists()
    {
        await using var s = new Setup(sql); var request = SleepAiJobTests.Request(s.Clock.Now);
        await s.Call(x => x.Enqueue(s.Scenario.Owner, request, default));
        var original = Assert.IsType<SleepAiJobClaim>(await s.Call(x => x.Claim(default)));
        await using var holder = s.Open(); await using var held = await holder.Database.BeginTransactionAsync();
        await HoldLock(holder, GlobalResource, "Exclusive");
        var probe = new QueryProbe(); await using var db = s.Open(probe);
        Assert.Null(await s.Store(db).Claim(default).WaitAsync(TimeSpan.FromSeconds(3)));
        Assert.Empty(probe.ApplicationLocks); Assert.Empty(probe.Mutations);
        await using var check = s.Open();
        var unchanged = await check.SleepAiJobs.SingleAsync(x => x.UserId == s.User && x.Id == request.OperationId);
        Assert.Equal("running", unchanged.State); Assert.Equal(original.LeaseId, unchanged.LeaseId); Assert.Equal(1, unchanged.Runs);
    }

    [SqlFact]
    public async Task TwoPositiveClaimPreflightsStillProduceExactlyOneLeaseAndOneRun()
    {
        await using var s = new Setup(sql); var request = SleepAiJobTests.Request(s.Clock.Now);
        await s.Call(x => x.Enqueue(s.Scenario.Owner, request, default));
        var barrier = new PauseTwoPreflights(); await using var firstDb = s.Open(barrier); await using var secondDb = s.Open(barrier);
        var first = s.Store(firstDb).Claim(default); var second = s.Store(secondDb).Claim(default);
        try { await barrier.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5)); }
        finally { barrier.Release.TrySetResult(); }
        var results = await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(5));
        var claim = Assert.IsType<SleepAiJobClaim>(Assert.Single(results, result => result is not null));
        Assert.Equal(request.OperationId, claim.JobId); Assert.Equal(1, claim.Run);
        await using var check = s.Open();
        var row = await check.SleepAiJobs.SingleAsync(x => x.UserId == s.User && x.Id == request.OperationId);
        Assert.Equal("running", row.State); Assert.Equal(claim.LeaseId, row.LeaseId); Assert.Equal(1, row.Runs);
    }

    private static TaskCompletionSource Signal() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    private static async Task AssertCancelled(Task waiting)
    {
        var failure = await Record.ExceptionAsync(() => waiting.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.NotNull(failure);
        if (failure is SqlException sqlError) Assert.Equal(0, sqlError.Number);
        else Assert.IsAssignableFrom<OperationCanceledException>(failure);
    }

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

    private static Task<int> HoldLock(PilotDatabase db, string resource, string mode) => db.Database.ExecuteSqlInterpolatedAsync($"""
        DECLARE @result int;
        EXEC @result = sys.sp_getapplock @Resource={resource},
            @LockMode={mode}, @LockOwner='Transaction', @LockTimeout=0;
        IF @result < 0 THROW 51000, 'Synthetic application lock unavailable.', 1;
        """);

    private static void AssertReadOnlyJobProjection(QueryProbe probe, bool excludeResult)
    {
        var queries = probe.Reads.Where(text => text.Contains("[SleepAiJobs]", StringComparison.Ordinal)).ToArray();
        Assert.NotEmpty(queries);
        Assert.All(queries, query =>
        {
            Assert.DoesNotContain("[RequestJson]", query, StringComparison.Ordinal);
            // EF's detached DTO projection may emit a NULL alias; that is not
            // reading the stored response column. Any real reference still fails.
            if (excludeResult) Assert.DoesNotContain("[ResultJson]",
                Regex.Replace(query, @"\bNULL\s+AS\s+\[ResultJson\]", "", RegexOptions.IgnoreCase), StringComparison.Ordinal);
        });
        Assert.Empty(probe.Mutations);
    }

    private sealed class Setup(SqlFixture sql) : IAsyncDisposable
    {
        public Scenario Scenario { get; } = new(sql);
        public Guid User => Scenario.Owner.ObjectId;
        public SleepAiJobTests.Clock Clock { get; } = new();
        public SleepAiOptions Settings { get; } = SleepAiJobTests.Enabled();
        public IConfigurationRoot Maintenance { get; } = new ConfigurationBuilder().AddInMemoryCollection().Build();
        public PilotDatabase Open(params IInterceptor[] interceptors) => new(
            new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(sql.ConnectionString).AddInterceptors(interceptors).Options);
        public FamilyService Family(PilotDatabase db) => new(db, Scenario.Config, Clock);
        public SleepAiJobStore Store(PilotDatabase db) => new(db, Family(db), new(Maintenance), Clock, Options.Create(Settings));
        public async Task<T> Call<T>(Func<SleepAiJobStore, Task<T>> action)
        { await using var db = Open(); return await action(Store(db)); }
        public SleepPredictionResponse Result(SleepAiJobClaim claim) => new(2, claim.Request.InputRevision, "insufficient_data", Clock.Now,
            SleepAiValidation.ValidateRequest(claim.Request, claim.Request.Now).TodayEnd, []);
        public async ValueTask DisposeAsync()
        {
            var users = Scenario.Config.Pilot.Identities.Select(x => x.ObjectId).ToArray(); await using var db = Open();
            await db.SleepAiJobs.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
            await db.SleepAiRevocations.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
            await db.SleepAiAttempts.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
            await db.AccountDeletions.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
        }
    }

    private sealed class QueryProbe : DbCommandInterceptor
    {
        public List<string> Reads { get; } = [];
        public List<string> Commands { get; } = [];
        public IEnumerable<string> ApplicationLocks => Commands.Where(text => text.Contains("sp_getapplock", StringComparison.Ordinal));
        public IEnumerable<string> Mutations => Commands.Where(text => Regex.IsMatch(text, @"\b(INSERT|UPDATE|DELETE|MERGE)\b", RegexOptions.IgnoreCase));
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        { Reads.Add(command.CommandText); Commands.Add(command.CommandText); return ValueTask.FromResult(result); }
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        { Commands.Add(command.CommandText); return ValueTask.FromResult(result); }
    }

    private sealed class LockStarted(string resource) : DbCommandInterceptor
    {
        public TaskCompletionSource Entered { get; } = Signal();
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("sp_getapplock", StringComparison.Ordinal) &&
                (command.CommandText.Contains(resource, StringComparison.Ordinal) ||
                 command.Parameters.Cast<DbParameter>().Any(parameter => Equals(parameter.Value, resource)))) Entered.TrySetResult();
            return ValueTask.FromResult(result);
        }
    }

    private sealed class PauseJobRead : DbCommandInterceptor
    {
        public TaskCompletionSource Entered { get; } = Signal();
        public TaskCompletionSource Release { get; } = Signal();
        public override async ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("[SleepAiJobs]", StringComparison.Ordinal) && Entered.TrySetResult())
                await Release.Task.WaitAsync(cancellationToken);
            return result;
        }
    }

    private sealed class PauseTwoPreflights : DbCommandInterceptor
    {
        private int arrivals;
        public TaskCompletionSource Entered { get; } = Signal();
        public TaskCompletionSource Release { get; } = Signal();
        public override async ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData eventData,
            DbDataReader result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.Contains("[SleepAiJobs]", StringComparison.Ordinal) &&
                command.CommandText.Contains("EXISTS", StringComparison.OrdinalIgnoreCase) && Interlocked.Increment(ref arrivals) <= 2)
            {
                if (Volatile.Read(ref arrivals) == 2) Entered.TrySetResult();
                await Release.Task.WaitAsync(cancellationToken);
            }
            return result;
        }
    }
}
