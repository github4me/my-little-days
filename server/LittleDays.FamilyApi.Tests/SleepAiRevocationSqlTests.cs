using System.Data.Common;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiRevocationSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task CommittedConsentFenceMasksCompletedResultsAndRejectsAdmissionAndLateCompletionBeforeCleanup()
    {
        await using var s = new Setup(sql); var generation = Guid.NewGuid();
        s.Settings.FullRequestCaptureEnabled = true;
        var completed = Job(s, generation); var running = Job(s, generation, "running");
        running.ExchangeHistoryEpoch = s.Scenario.Config.Family.HistoryId;
        await Seed(s, [completed, running], generation, 2, 2);
        var boundary = new AfterCommit(1);
        await using var db = s.Open(boundary); var cancel = s.Store(db).Cancel(s.Scenario.Owner, generation, true, default);
        try
        {
            await boundary.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(cancel.IsCompleted);
            await using (var check = sql.Open())
            {
                Assert.True(await check.SleepAiRevocations.AnyAsync(x => x.UserId == s.User && x.Kind == "consent" && x.Id == generation));
                var untouched = await check.SleepAiJobs.FindAsync(s.User, completed.Id);
                Assert.Equal("completed", untouched!.State); Assert.NotNull(untouched.ResultJson);
                Assert.Equal(2, await check.SleepAiFailedOutputs.CountAsync(x => x.UserId == s.User));
            }
            var view = await s.Get(completed.Id).WaitAsync(TimeSpan.FromSeconds(3));
            Assert.Equal("cancelled", view.Status); Assert.Null(view.Prediction); Assert.Null(view.ErrorCode);
            Assert.Equal(completed.Id, view.JobId); Assert.Equal(completed.InputRevision, view.InputRevision);
            Assert.Equal(completed.RequestNow, view.RequestNow); Assert.Equal(completed.ExpiresAt, view.ExpiresAt);
            var request = SleepAiJobTests.Request(s.Clock.Now) with { ConsentGeneration = generation };
            Assert.Equal("ai_consent_revoked", (await Assert.ThrowsAsync<ApiException>(() => s.Enqueue(request))).Code);
            var claim = Claim(running) with { ExchangeCaptureHistoryEpoch = s.Scenario.Config.Family.HistoryId };
            var exchange = new SleepAiExchange(1, 2, s.Clock.Now, null, "synthetic request", null, 17, 0,
                false, false, null, null, "dispatching", 0);
            Assert.Equal("ai_consent_revoked", (await Assert.ThrowsAsync<ApiException>(() =>
                s.Call(store => store.StoreExchange(claim, exchange, default)))).Code);
            await using (var check = sql.Open())
            {
                Assert.Equal(2, await check.SleepAiExchanges.CountAsync(x => x.UserId == s.User));
                Assert.False(await check.SleepAiExchanges.AnyAsync(x => x.UserId == s.User && x.JobId == running.Id));
            }
            Assert.False(await s.Call(store => store.Complete(claim, Result(s, running), null, default)));
            await using (var check = sql.Open())
            {
                var cancelled = await check.SleepAiJobs.FindAsync(s.User, running.Id);
                Assert.Equal("cancelled", cancelled!.State); Assert.Null(cancelled.ResultJson);
                Assert.NotNull((await check.SleepAiJobs.FindAsync(s.User, completed.Id))!.ResultJson);
            }
        }
        finally { boundary.Release.TrySetResult(); await cancel; }
        Assert.True(await cancel); await AssertCleared(s, generation);
    }

    [SqlFact]
    public async Task CommittedJobFenceMasksOnlyItsCompletedResultAndPreservesSiblingGeneration()
    {
        await using var s = new Setup(sql); var generation = Guid.NewGuid();
        var target = Job(s, generation); var sibling = Job(s, generation);
        await Seed(s, [target, sibling], generation, 0, 0);
        var boundary = new AfterCommit(1);
        await using var db = s.Open(boundary); var cancel = s.Store(db).Cancel(s.Scenario.Owner, target.Id, false, default);
        try
        {
            await boundary.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            var view = await s.Get(target.Id).WaitAsync(TimeSpan.FromSeconds(3));
            Assert.Equal("cancelled", view.Status); Assert.Null(view.Prediction);
            Assert.Equal("completed", (await s.Get(sibling.Id)).Status); Assert.NotNull((await s.Get(sibling.Id)).Prediction);
            var request = SleepAiJobTests.Request(s.Clock.Now) with { OperationId = target.Id, ConsentGeneration = generation };
            Assert.Equal("ai_consent_revoked", (await Assert.ThrowsAsync<ApiException>(() => s.Enqueue(request))).Code);
            await using var check = sql.Open();
            Assert.NotNull((await check.SleepAiJobs.FindAsync(s.User, target.Id))!.ResultJson);
            Assert.False(await check.SleepAiRevocations.AnyAsync(x => x.UserId == s.User && x.Kind == "consent"));
        }
        finally { boundary.Release.TrySetResult(); await cancel; }
        Assert.Equal("cancelled", (await s.Get(target.Id)).Status);
        Assert.Equal("completed", (await s.Get(sibling.Id)).Status);
    }

    [SqlFact]
    public async Task JobCancellationDeletesOnlyRequestedJobsOrphanDiagnosticsWithinSharedGeneration()
    {
        await using var s = new Setup(sql); var generation = Guid.NewGuid();
        var target = Job(s, generation); var sibling = Job(s, generation);
        await Seed(s, [target, sibling], generation, 2, 2, payloadJobId: target.Id);
        await Seed(s, [], generation, 2, 2, payloadJobId: sibling.Id);
        Assert.True(await s.Call(store => store.Cancel(s.Scenario.Owner, target.Id, false, default)));
        await using var check = sql.Open();
        var failures = await check.SleepAiFailedOutputs.Where(x => x.UserId == s.User).ToArrayAsync();
        var exchanges = await check.SleepAiExchanges.Where(x => x.UserId == s.User).ToArrayAsync();
        Assert.Equal(2, failures.Length); Assert.All(failures, row => Assert.Equal(sibling.Id, row.JobId));
        Assert.Equal(2, exchanges.Length); Assert.All(exchanges, row => Assert.Equal(sibling.Id, row.JobId));
        Assert.Equal("cancelled", (await s.Get(target.Id)).Status);
        Assert.Equal("completed", (await s.Get(sibling.Id)).Status); Assert.NotNull((await s.Get(sibling.Id)).Prediction);
    }

    [SqlFact]
    public async Task CommittedRunningJobFenceRejectsLateCompletionWithoutCancellingSibling()
    {
        await using var s = new Setup(sql); var generation = Guid.NewGuid();
        var target = Job(s, generation, "running"); var sibling = Job(s, generation);
        await Seed(s, [target, sibling], generation, 0, 0);
        var boundary = new AfterCommit(1);
        await using var db = s.Open(boundary); var cancel = s.Store(db).Cancel(s.Scenario.Owner, target.Id, false, default);
        try
        {
            await boundary.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.False(await s.Call(store => store.Complete(Claim(target), Result(s, target), null, default)));
            Assert.Equal("cancelled", (await s.Get(target.Id)).Status);
            Assert.Equal("completed", (await s.Get(sibling.Id)).Status);
            Assert.NotNull((await s.Get(sibling.Id)).Prediction);
        }
        finally { boundary.Release.TrySetResult(); await cancel; }
    }

    [SqlFact]
    public async Task FencedJobAtMidnightStillReportsExpiredWithoutReturningItsResult()
    {
        await using var s = new Setup(sql); var generation = Guid.NewGuid(); var target = Job(s, generation);
        await Seed(s, [target], generation, 0, 0);
        var boundary = new AfterCommit(1);
        await using var db = s.Open(boundary); var cancel = s.Store(db).Cancel(s.Scenario.Owner, generation, true, default);
        try
        {
            await boundary.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            s.Clock.Now = target.ExpiresAt;
            var view = await s.Get(target.Id);
            Assert.Equal("expired", view.Status); Assert.Null(view.Prediction); Assert.Null(view.ErrorCode);
        }
        finally { boundary.Release.TrySetResult(); await cancel; }
    }

    [SqlFact]
    public Task FailedSecondFailureDeletePreservesFenceAndFirstCommitAndRetryFinishes() => VerifyInterruptedDelete("SleepAiFailedOutputs");

    [SqlFact]
    public Task FailedSecondExchangeDeletePreservesEarlierFailureCleanupAndRetryFinishes() => VerifyInterruptedDelete("SleepAiExchanges");

    private async Task VerifyInterruptedDelete(string table)
    {
        await using var s = new Setup(sql); var generation = Guid.NewGuid(); var jobs = new[] { Job(s, generation), Job(s, generation) };
        await Seed(s, jobs, generation, 3, 3); var mutations = new PayloadMutations(table);
        await using (var db = s.Open(mutations))
            await Assert.ThrowsAsync<InvalidOperationException>(() => s.Store(db).Cancel(s.Scenario.Owner, generation, true, default));
        await using (var check = sql.Open())
        {
            Assert.True(await check.SleepAiRevocations.AnyAsync(x => x.UserId == s.User && x.Kind == "consent" && x.Id == generation));
            Assert.Equal(table == "SleepAiFailedOutputs" ? 2 : 0, await check.SleepAiFailedOutputs.CountAsync(x => x.UserId == s.User));
            Assert.Equal(table == "SleepAiExchanges" ? 2 : 3, await check.SleepAiExchanges.CountAsync(x => x.UserId == s.User));
        }
        Assert.All(mutations.BatchRows, count => Assert.InRange(count, 0, 1));
        Assert.Equal(1, mutations.Rows.GetValueOrDefault(table));
        Assert.True(await s.Cancel(generation)); await AssertCleared(s, generation);
        foreach (var job in jobs)
        {
            var view = await s.Get(job.Id); Assert.Equal("cancelled", view.Status); Assert.Null(view.Prediction);
        }
    }

    [SqlFact]
    public async Task CancellationBetweenPayloadCommitsKeepsProgressAndAllowsRetry()
    {
        await using var s = new Setup(sql); var generation = Guid.NewGuid();
        await Seed(s, [], generation, 3, 3);
        using var stop = new CancellationTokenSource(); var mutations = new PayloadMutations();
        var boundary = new AfterMutation(mutations, "SleepAiFailedOutputs", () => { stop.Cancel(); return Task.CompletedTask; });
        await using (var db = s.Open(mutations, boundary))
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => s.Store(db).Cancel(s.Scenario.Owner, generation, true, stop.Token));
        Assert.Equal(1, mutations.Rows.GetValueOrDefault("SleepAiFailedOutputs"));
        await using (var check = sql.Open())
        {
            Assert.Equal(2, await check.SleepAiFailedOutputs.CountAsync(x => x.UserId == s.User));
            Assert.Equal(3, await check.SleepAiExchanges.CountAsync(x => x.UserId == s.User));
            Assert.True(await check.SleepAiRevocations.AnyAsync(x => x.UserId == s.User && x.Id == generation));
        }
        Assert.True(await CanTakeLock("LittleDays:SleepAi:v1"));
        Assert.True(await CanTakeLock("LittleDays:FamilyPilot:v1"));
        Assert.True(await s.Cancel(generation)); await AssertCleared(s, generation);
    }

    [SqlFact]
    public async Task RecoveryGateBetweenExchangeBatchesStopsFurtherDeletesUntilRetry()
    {
        await using var s = new Setup(sql); var generation = Guid.NewGuid(); await Seed(s, [], generation, 2, 3);
        var mutations = new PayloadMutations();
        var boundary = new AfterMutation(mutations, "SleepAiExchanges", () => { s.Maintenance["Recovery:Blocked"] = "true"; return Task.CompletedTask; });
        await using (var db = s.Open(mutations, boundary))
            Assert.Equal("recovery_blocked", (await Assert.ThrowsAsync<ApiException>(() => s.Store(db).Cancel(s.Scenario.Owner, generation, true, default))).Code);
        await using (var check = sql.Open())
        {
            Assert.False(await check.SleepAiFailedOutputs.AnyAsync(x => x.UserId == s.User));
            Assert.Equal(2, await check.SleepAiExchanges.CountAsync(x => x.UserId == s.User));
            Assert.True(await check.SleepAiRevocations.AnyAsync(x => x.UserId == s.User && x.Id == generation));
        }
        Assert.Equal(1, mutations.Rows.GetValueOrDefault("SleepAiExchanges"));
        s.Maintenance["Recovery:Blocked"] = "false";
        Assert.True(await s.Cancel(generation)); await AssertCleared(s, generation);
    }

    [SqlFact]
    public async Task AccountTombstoneBetweenBatchesStopsRevocationBeforeAnotherPayloadMutation()
    {
        await using var s = new Setup(sql); var generation = Guid.NewGuid(); await Seed(s, [], generation, 3, 3);
        var mutations = new PayloadMutations();
        var boundary = new AfterMutation(mutations, "SleepAiFailedOutputs", async () =>
        {
            await using var check = sql.Open();
            var family = new FamilyService(check, s.Scenario.Config, s.Clock);
            await family.Transaction(() =>
            {
                check.AccountDeletions.Add(new() { UserId = s.User, OperationId = Guid.NewGuid(),
                    RequestedAt = s.Clock.Now, ReceiptHash = new('c', 64) });
                return Task.FromResult(true);
            });
        });
        await using (var db = s.Open(mutations, boundary))
            Assert.Equal("account_deleted", (await Assert.ThrowsAsync<ApiException>(() => s.Store(db).Cancel(s.Scenario.Owner, generation, true, default))).Code);
        Assert.Equal(1, mutations.Rows.GetValueOrDefault("SleepAiFailedOutputs"));
        await using var remaining = sql.Open();
        Assert.Equal(2, await remaining.SleepAiFailedOutputs.CountAsync(x => x.UserId == s.User));
        Assert.Equal(3, await remaining.SleepAiExchanges.CountAsync(x => x.UserId == s.User));
        Assert.True(await remaining.SleepAiRevocations.AnyAsync(x => x.UserId == s.User && x.Id == generation));
        Assert.Equal("account_deleted", (await Assert.ThrowsAsync<ApiException>(() => s.Cancel(generation))).Code);
    }

    [SqlFact]
    public async Task PendingPayloadCleanupDoesNotAcknowledgeEarlyAndReleasesBothLocksBetweenRows()
    {
        await using var s = new Setup(sql); var generation = Guid.NewGuid(); await Seed(s, [], generation, 3, 3);
        var mutations = new PayloadMutations(); var boundary = new AfterMutation(mutations, "SleepAiFailedOutputs");
        await using var db = s.Open(mutations, boundary); var cancel = s.Store(db).Cancel(s.Scenario.Owner, generation, true, default);
        try
        {
            await boundary.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5)); Assert.False(cancel.IsCompleted);
            await using (var check = sql.Open())
            {
                Assert.Equal(2, await check.SleepAiFailedOutputs.CountAsync(x => x.UserId == s.User));
                Assert.Equal(3, await check.SleepAiExchanges.CountAsync(x => x.UserId == s.User));
            }
            Assert.True(await CanTakeLock("LittleDays:SleepAi:v1"));
            Assert.True(await CanTakeLock("LittleDays:FamilyPilot:v1"));
            Assert.NotEqual(Guid.Empty, (await s.Scenario.Create().WaitAsync(TimeSpan.FromSeconds(3))).Id);
        }
        finally { boundary.Release.TrySetResult(); await cancel; }
        Assert.True(await cancel); Assert.Equal(3, mutations.Rows["SleepAiFailedOutputs"]); Assert.Equal(3, mutations.Rows["SleepAiExchanges"]);
        Assert.All(mutations.BatchRows, count => Assert.InRange(count, 0, 1)); await AssertCleared(s, generation);
    }

    [SqlFact]
    public async Task JobPayloadCleanupCommitsOneRowAtATimeWithoutHoldingLocksAcrossRows()
    {
        await using var s = new Setup(sql); var generation = Guid.NewGuid();
        await Seed(s, [Job(s, generation), Job(s, generation), Job(s, generation)], generation, 0, 0);
        var mutations = new PayloadMutations(); var boundary = new AfterMutation(mutations, "SleepAiJobs");
        await using var db = s.Open(mutations, boundary); var cancel = s.Store(db).Cancel(s.Scenario.Owner, generation, true, default);
        try
        {
            await boundary.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5)); Assert.False(cancel.IsCompleted);
            await using (var check = sql.Open())
            {
                Assert.Equal(1, await check.SleepAiJobs.CountAsync(x => x.UserId == s.User && x.State == "cancelled" && x.ResultJson == null));
                Assert.Equal(2, await check.SleepAiJobs.CountAsync(x => x.UserId == s.User && x.ResultJson != null));
            }
            Assert.True(await CanTakeLock("LittleDays:SleepAi:v1"));
            Assert.True(await CanTakeLock("LittleDays:FamilyPilot:v1"));
        }
        finally { boundary.Release.TrySetResult(); await cancel; }
        Assert.Equal(3, mutations.Rows["SleepAiJobs"]);
        Assert.All(mutations.BatchRows, count => Assert.InRange(count, 0, 1)); await AssertCleared(s, generation);
    }

    [SqlFact]
    public async Task ConcurrentRetryFinishesSameFenceWhileNewGenerationAndOtherUserRemainIndependent()
    {
        await using var s = new Setup(sql); var generation = Guid.NewGuid(); var nextGeneration = Guid.NewGuid();
        var otherJob = Job(s, generation, user: s.Scenario.Other.ObjectId); var nextJob = Job(s, nextGeneration);
        var freshJobId = Guid.Empty;
        await Seed(s, [Job(s, generation)], generation, 3, 3);
        await Seed(s, [otherJob], generation, 1, 1, s.Scenario.Other.ObjectId);
        await Seed(s, [nextJob], nextGeneration, 1, 1);
        var boundary = new AfterCommit(1);
        await using var db = s.Open(boundary); var first = s.Store(db).Cancel(s.Scenario.Owner, generation, true, default);
        try
        {
            await boundary.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            var retry = s.Cancel(generation);
            var fresh = s.Enqueue(SleepAiJobTests.Request(s.Clock.Now) with { ConsentGeneration = nextGeneration });
            var other = s.Call(store => store.Enqueue(s.Scenario.Other, SleepAiJobTests.Request(s.Clock.Now) with { ConsentGeneration = generation }, default));
            await Task.WhenAll(retry, fresh, other).WaitAsync(TimeSpan.FromSeconds(5));
            Assert.True(await retry); Assert.Equal("queued", (await fresh).Status); Assert.Equal("queued", (await other).Status);
            freshJobId = (await fresh).JobId;
            Assert.False(first.IsCompleted);
            await AssertCleared(s, generation);
        }
        finally { boundary.Release.TrySetResult(); await first; }
        Assert.True(await first);
        var nextView = await s.Get(nextJob.Id);
        Assert.Equal("completed", nextView.Status); Assert.NotNull(nextView.Prediction);
        Assert.Equal(nextJob.ResultJson, JsonSerializer.Serialize(nextView.Prediction, SleepAiJson.Options));
        Assert.Equal("queued", (await s.Get(freshJobId)).Status);
        var otherView = await s.Call(store => store.Get(s.Scenario.Other, otherJob.Id, default));
        Assert.Equal("completed", otherView.Status); Assert.NotNull(otherView.Prediction);
        Assert.Equal(otherJob.ResultJson, JsonSerializer.Serialize(otherView.Prediction, SleepAiJson.Options));
        await using var check = sql.Open();
        Assert.Single(await check.SleepAiRevocations.Where(x => x.UserId == s.User && x.Kind == "consent" && x.Id == generation).ToArrayAsync());
        Assert.Equal(1, await check.SleepAiFailedOutputs.CountAsync(x => x.UserId == s.User && x.ConsentGeneration == nextGeneration));
        Assert.Equal(1, await check.SleepAiExchanges.CountAsync(x => x.UserId == s.User && x.ConsentGeneration == nextGeneration));
        Assert.Equal(1, await check.SleepAiFailedOutputs.CountAsync(x => x.UserId == s.Scenario.Other.ObjectId));
        Assert.Equal(1, await check.SleepAiExchanges.CountAsync(x => x.UserId == s.Scenario.Other.ObjectId));
        Assert.False(await check.SleepAiRevocations.AnyAsync(x => x.UserId == s.Scenario.Other.ObjectId));
    }

    [SqlFact]
    public async Task RepeatedRevocationSkipsAlreadyClearedJobsAndPreservesFamilyRecords()
    {
        await using var s = new Setup(sql); var generation = Guid.NewGuid();
        var family = await s.Scenario.Call(service => service.CreateFullFamily(s.Scenario.Owner,
            new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed()), default));
        var cleared = Job(s, generation, "cancelled"); cleared.UpdatedAt = s.Clock.Now.AddHours(-1);
        var dirty = Job(s, generation, "cancelled"); dirty.RequestJson = "{}"; dirty.ResultJson = "{}";
        dirty.ErrorCode = "ai_timeout"; dirty.LeaseId = Guid.NewGuid(); dirty.LeaseUntil = s.Clock.Now.AddMinutes(2);
        await Seed(s, [cleared, dirty], generation, 1, 1);
        string records; long revision; int receipts;
        await using (var check = sql.Open())
        {
            records = JsonSerializer.Serialize(await check.FamilyRecords.Where(x => x.FamilyId == family.FamilyId).OrderBy(x => x.Id).ToArrayAsync());
            revision = (await check.Families.SingleAsync(x => x.Id == family.FamilyId)).Revision;
            receipts = await check.Operations.CountAsync(x => x.FamilyId == family.FamilyId);
        }
        Assert.True(await s.Cancel(generation)); await AssertCleared(s, generation);
        s.Clock.Now = s.Clock.Now.AddMinutes(5); var mutations = new PayloadMutations();
        await using (var db = s.Open(mutations)) Assert.True(await s.Store(db).Cancel(s.Scenario.Owner, generation, true, default));
        Assert.Equal(0, mutations.Rows.GetValueOrDefault("SleepAiJobs"));
        await using (var check = sql.Open())
        {
            Assert.Equal(cleared.UpdatedAt, (await check.SleepAiJobs.FindAsync(s.User, cleared.Id))!.UpdatedAt);
            Assert.Equal(dirty.UpdatedAt, (await check.SleepAiJobs.FindAsync(s.User, dirty.Id))!.UpdatedAt);
            Assert.Equal(records, JsonSerializer.Serialize(await check.FamilyRecords.Where(x => x.FamilyId == family.FamilyId).OrderBy(x => x.Id).ToArrayAsync()));
            Assert.Equal(revision, (await check.Families.SingleAsync(x => x.Id == family.FamilyId)).Revision);
            Assert.Equal(receipts, await check.Operations.CountAsync(x => x.FamilyId == family.FamilyId));
        }
    }

    [SqlFact]
    public async Task InvalidRevocationIdCreatesNoFenceAndLeavesAllPayloadsUntouched()
    {
        await using var s = new Setup(sql); var generation = Guid.NewGuid(); var job = Job(s, generation);
        await Seed(s, [job], generation, 1, 1);
        foreach (var consent in new[] { false, true })
            Assert.Equal("invalid_input", (await Assert.ThrowsAsync<ApiException>(() => s.Call(store => store.Cancel(s.Scenario.Owner, Guid.Empty, consent, default)))).Code);
        await using var check = sql.Open();
        Assert.False(await check.SleepAiRevocations.AnyAsync(x => x.UserId == s.User));
        Assert.Equal(job.ResultJson, (await check.SleepAiJobs.FindAsync(s.User, job.Id))!.ResultJson);
        Assert.Equal(1, await check.SleepAiFailedOutputs.CountAsync(x => x.UserId == s.User));
        Assert.Equal(1, await check.SleepAiExchanges.CountAsync(x => x.UserId == s.User));
    }

    private async Task Seed(Setup s, SleepAiJobRow[] jobs, Guid generation, int failures, int exchanges, Guid? owner = null, Guid? payloadJobId = null)
    {
        var user = owner ?? s.User; await using var db = sql.Open(); db.SleepAiJobs.AddRange(jobs);
        db.SleepAiFailedOutputs.AddRange(Enumerable.Range(0, failures).Select(index => new SleepAiFailedOutputRow
        {
            UserId = user, JobId = payloadJobId ?? Guid.NewGuid(), ConsentGeneration = generation, Run = 1, Attempt = payloadJobId.HasValue ? index + 1 : 1,
            HistoryEpoch = s.Scenario.Config.Family.HistoryId, Reason = "invalid_json", ResponseText = "synthetic",
            OriginalLength = 9, OccurredAt = s.Clock.Now, ExpiresAt = s.Clock.Now.AddDays(7), Model = "synthetic"
        }));
        db.SleepAiExchanges.AddRange(Enumerable.Range(0, exchanges).Select(index => new SleepAiExchangeRow
        {
            UserId = user, JobId = payloadJobId ?? Guid.NewGuid(), ConsentGeneration = generation, Run = 1, Attempt = payloadJobId.HasValue ? index + 1 : 1,
            HistoryEpoch = s.Scenario.Config.Family.HistoryId, SchemaVersion = 2, RequestBody = "synthetic", RequestBytes = 9,
            ResponseBody = "synthetic response", ResponseBytes = 18, StartedAt = s.Clock.Now, ExpiresAt = s.Clock.Now.AddDays(7)
        }));
        await db.SaveChangesAsync();
    }

    private async Task AssertCleared(Setup s, Guid generation)
    {
        await using var db = sql.Open();
        Assert.False(await db.SleepAiFailedOutputs.AnyAsync(x => x.UserId == s.User && x.ConsentGeneration == generation));
        Assert.False(await db.SleepAiExchanges.AnyAsync(x => x.UserId == s.User && x.ConsentGeneration == generation));
        var jobs = await db.SleepAiJobs.Where(x => x.UserId == s.User && x.ConsentGeneration == generation).ToArrayAsync();
        Assert.All(jobs, row =>
        {
            Assert.Equal("cancelled", row.State); Assert.Null(row.RequestJson); Assert.Null(row.ResultJson);
            Assert.Null(row.ErrorCode); Assert.Null(row.LeaseId); Assert.Null(row.LeaseUntil);
        });
    }

    private static SleepAiJobRow Job(Setup s, Guid generation, string state = "completed", Guid? user = null)
    {
        var request = SleepAiJobTests.Request(s.Clock.Now) with { ConsentGeneration = generation };
        var row = new SleepAiJobRow
        {
            UserId = user ?? s.User, Id = request.OperationId, ConsentGeneration = generation, State = state,
            InputRevision = request.Request.InputRevision, RequestHash = new('b', 64), RequestNow = s.Clock.Now,
            CreatedAt = s.Clock.Now, UpdatedAt = s.Clock.Now, ExpiresAt = SleepAiValidation.ValidateRequest(request.Request, s.Clock.Now).TodayEnd,
            RequestJson = state == "running" ? JsonSerializer.Serialize(request.Request, SleepAiJson.Options) : null,
            LeaseId = state == "running" ? Guid.NewGuid() : null, LeaseUntil = state == "running" ? s.Clock.Now.AddMinutes(2) : null,
            Runs = state == "running" ? 1 : 0
        };
        row.ResultJson = state == "completed" ? JsonSerializer.Serialize(Result(s, row), SleepAiJson.Options) : null;
        return row;
    }
    private static SleepPredictionResponse Result(Setup s, SleepAiJobRow row) => new(2, row.InputRevision, "insufficient_data", s.Clock.Now, row.ExpiresAt, []);
    private static SleepAiJobClaim Claim(SleepAiJobRow row) => new(row.UserId, row.Id, row.LeaseId!.Value,
        JsonSerializer.Deserialize<SleepPredictionRequest>(row.RequestJson!, SleepAiJson.Options)!) { CreatedAt = row.CreatedAt, Run = row.Runs };

    private async Task<bool> CanTakeLock(string resource)
    {
        await using var db = sql.Open(); await using var transaction = await db.Database.BeginTransactionAsync();
        var values = await db.Database.SqlQuery<int>($"""
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock @Resource={resource}, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=0;
            SELECT @result AS Value;
            """).ToArrayAsync();
        return Assert.Single(values) >= 0;
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
        public SleepAiJobStore Store(PilotDatabase db) => new(db, new(db, Scenario.Config, Clock), new(Maintenance), Clock,
            Options.Create(Settings));
        public async Task<T> Call<T>(Func<SleepAiJobStore, Task<T>> action)
        { await using var db = sql.Open(); return await action(Store(db)); }
        public Task<bool> Cancel(Guid generation) => Call(store => store.Cancel(Scenario.Owner, generation, true, default));
        public Task<SleepPredictionJobResponse> Get(Guid id) => Call(store => store.Get(Scenario.Owner, id, default));
        public Task<SleepPredictionJobResponse> Enqueue(CreateSleepPredictionJobRequest request) => Call(store => store.Enqueue(Scenario.Owner, request, default));
        public async ValueTask DisposeAsync()
        {
            var users = Scenario.Config.Pilot.Identities.Select(x => x.ObjectId).ToArray(); await using var db = sql.Open();
            await db.SleepAiFailedOutputs.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
            await db.SleepAiExchanges.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
            await db.SleepAiJobs.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
            await db.SleepAiRevocations.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
            await db.AccountDeletions.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
        }
    }

    private sealed class PayloadMutations(string? failSecondTable = null) : DbCommandInterceptor
    {
        public Dictionary<string, int> Rows { get; } = [];
        public List<int> BatchRows { get; } = [];
        private int failingTableAttempts;
        private static string? Table(DbCommand command) =>
            command.CommandText.Contains("DELETE", StringComparison.OrdinalIgnoreCase) || command.CommandText.Contains("UPDATE", StringComparison.OrdinalIgnoreCase)
                ? new[] { "SleepAiJobs", "SleepAiFailedOutputs", "SleepAiExchanges" }.SingleOrDefault(table => command.CommandText.Contains("dbo." + table, StringComparison.Ordinal))
                : null;
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (Table(command) is { } table && table == failSecondTable && ++failingTableAttempts == 2)
                throw new InvalidOperationException("Synthetic revocation interruption");
            return ValueTask.FromResult(result);
        }
        public override ValueTask<int> NonQueryExecutedAsync(DbCommand command, CommandExecutedEventData eventData,
            int result, CancellationToken cancellationToken = default)
        {
            if (Table(command) is { } table) { Rows[table] = Rows.GetValueOrDefault(table) + result; BatchRows.Add(result); }
            return ValueTask.FromResult(result);
        }
    }

    private sealed class AfterCommit(int target) : DbTransactionInterceptor
    {
        private int committed;
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData,
            CancellationToken cancellationToken = default)
        {
            if (++committed == target) { Entered.TrySetResult(); await Release.Task; }
        }
    }

    private sealed class AfterMutation(PayloadMutations mutations, string table, Func<Task>? action = null) : DbTransactionInterceptor
    {
        private bool ran;
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async Task TransactionCommittedAsync(DbTransaction transaction, TransactionEndEventData eventData,
            CancellationToken cancellationToken = default)
        {
            if (!ran && mutations.Rows.GetValueOrDefault(table) == 1)
            {
                ran = true; Entered.TrySetResult();
                if (action is not null) await action(); else await Release.Task;
            }
        }
    }
}
