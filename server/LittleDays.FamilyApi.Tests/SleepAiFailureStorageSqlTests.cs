using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using System.Text.Json;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiFailureStorageSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    private sealed class Setup(SqlFixture sql) : IAsyncDisposable
    {
        public Scenario Scenario { get; } = new(sql);
        public SleepAiJobTests.Clock Clock { get; } = new();
        public async Task<T> Store<T>(Func<SleepAiJobStore, Task<T>> action, SleepAiFailureCapture? capture = null)
        {
            await using var db = sql.Open();
            var family = new FamilyService(db, Scenario.Config, Clock);
            return await action(new(db, family, new(new ConfigurationBuilder().Build()), Clock,
                Microsoft.Extensions.Options.Options.Create(SleepAiJobTests.Enabled()), capture));
        }
        public CreateSleepPredictionJobRequest Request(bool consent = true, FamilySummary? family = null)
        {
            var value = SleepAiJobTests.Request(Clock.Now);
            return value with
            {
                DiagnosticsConsentVersion = consent ? SleepAiFailureCapture.ConsentVersion : null,
                Request = value.Request with { FamilyId = family?.Id, MembershipId = family?.MembershipId,
                    HistoryId = family is null ? null : Scenario.Config.Family.HistoryId }
            };
        }
        public Task<SleepPredictionJobResponse> Enqueue(CreateSleepPredictionJobRequest value, PilotIdentity? user = null) =>
            Store(x => x.Enqueue(user ?? Scenario.Owner, value, default));
        public async Task<SleepAiJobClaim> Claim() => Assert.IsType<SleepAiJobClaim>(await Store(x => x.Claim(default)));
        public SleepAiFailureCapture Capture(int count = 1)
        {
            var capture = new SleepAiFailureCapture(Clock); capture.Start(SleepAiFailureCapture.ConsentVersion);
            for (var attempt = 1; attempt <= count; attempt++)
                capture.Record(attempt, "invalid_json", null, $"synthetic failed output {attempt}",
                    TimeSpan.FromMilliseconds(12), "synthetic-2026-10-01");
            return capture;
        }
        public Task<bool> Complete(SleepAiJobClaim claim, SleepAiFailureCapture capture, bool success = true) =>
            Store(x => x.Complete(claim, success ? new(2, claim.Request.InputRevision, "insufficient_data", Clock.Now,
                SleepAiValidation.ValidateRequest(claim.Request, claim.Request.Now).TodayEnd, []) : null,
                success ? null : "ai_invalid_response", default), capture);
        public async Task<SleepAiFailedOutputRow[]> Failures()
        {
            await using var db = sql.Open(); var users = Scenario.Config.Pilot.Identities.Select(x => x.ObjectId).ToArray();
            return await db.SleepAiFailedOutputs.Where(x => users.Contains(x.UserId)).OrderBy(x => x.Attempt).ToArrayAsync();
        }
        public async ValueTask DisposeAsync()
        {
            await using var db = sql.Open(); var users = Scenario.Config.Pilot.Identities.Select(x => x.ObjectId).ToArray();
            await db.SleepAiFailedOutputs.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
            await db.SleepAiJobs.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
            await db.SleepAiRevocations.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
        }
    }

    [SqlFact]
    public async Task ExplicitConsentStoresOnlyBoundedFailedOutputsOnceWithoutExposingThemInPrediction()
    {
        await using var s = new Setup(sql); var request = s.Request(); await s.Enqueue(request);
        var claim = await s.Claim(); Assert.Equal(SleepAiFailureCapture.ConsentVersion, claim.DiagnosticsConsentVersion);
        using var capture = s.Capture(3); Assert.True(await s.Complete(claim, capture));
        Assert.False(await s.Complete(claim, capture));
        var rows = await s.Failures(); Assert.Equal(2, rows.Length);
        Assert.Equal(new[] { 1, 2 }, rows.Select(x => x.Attempt));
        Assert.All(rows, row =>
        {
            Assert.Equal(request.OperationId, row.JobId); Assert.Equal(1, row.Run);
            Assert.Equal(request.ConsentGeneration, row.ConsentGeneration);
            Assert.Equal(s.Scenario.Config.Family.HistoryId, row.HistoryEpoch);
            Assert.Equal("invalid_json", row.Reason); Assert.Null(row.PeriodIndex);
            Assert.StartsWith("synthetic failed output", row.ResponseText);
            Assert.Equal(row.ResponseText!.Length, row.OriginalLength); Assert.False(row.Truncated);
            Assert.Equal(row.OccurredAt.AddDays(7), row.ExpiresAt); Assert.Equal(12, row.DurationMs);
        });
        var response = await s.Store(x => x.Get(s.Scenario.Owner, request.OperationId, default));
        Assert.Equal("completed", response.Status);
        var json = JsonSerializer.Serialize(response, SleepAiJson.Options);
        Assert.DoesNotContain("synthetic failed output", json); Assert.DoesNotContain("invalid_json", json);
        await using var db = sql.Open(); var stored = await db.SleepAiJobs.FindAsync(s.Scenario.Owner.ObjectId, request.OperationId);
        Assert.Null(stored!.RequestJson); Assert.NotNull(stored.ResultJson);
    }

    [SqlFact]
    public async Task LegacyConsentNeverCapturesAndCannotBeRetrofittedOntoAnImmutableOperation()
    {
        await using var s = new Setup(sql); var request = s.Request(consent: false); await s.Enqueue(request);
        Assert.Equal("operation_reused", (await Assert.ThrowsAsync<ApiException>(() => s.Enqueue(request with
            { DiagnosticsConsentVersion = SleepAiFailureCapture.ConsentVersion }))).Code);
        var claim = await s.Claim(); Assert.Null(claim.DiagnosticsConsentVersion);
        using var deliberatelyEnabledCollector = s.Capture();
        Assert.True(await s.Complete(claim, deliberatelyEnabledCollector, success: false));
        Assert.Empty(await s.Failures());
        Assert.Equal("failed", (await s.Store(x => x.Get(s.Scenario.Owner, request.OperationId, default))).Status);
    }

    [SqlFact]
    public async Task ConsentRevocationAfterParentExpiryPurgesOnlyThatUsersDiagnosticGeneration()
    {
        await using var s = new Setup(sql); var request = s.Request(); await s.Enqueue(request);
        using var capture = s.Capture(); Assert.True(await s.Complete(await s.Claim(), capture));
        s.Clock.Now = SleepAiValidation.ValidateRequest(request.Request, request.Request.Now).TodayEnd;
        await s.Store(x => x.Cleanup(default));
        Assert.Single(await s.Failures());
        await using var db = sql.Open(); Assert.False(await db.SleepAiJobs.AnyAsync(x => x.Id == request.OperationId));
        await s.Store(x => x.Cancel(s.Scenario.Other, request.ConsentGeneration, true, default));
        Assert.Single(await s.Failures());
        await s.Store(x => x.Cancel(s.Scenario.Owner, request.ConsentGeneration, true, default));
        Assert.Empty(await s.Failures());
    }

    [SqlFact]
    public async Task CancelledOrSupersededWorkerCannotPersistFailedOutput()
    {
        await using var s = new Setup(sql); var request = s.Request(); await s.Enqueue(request);
        var cancelled = await s.Claim(); using var capture = s.Capture();
        await s.Store(x => x.Cancel(s.Scenario.Owner, request.OperationId, false, default));
        Assert.False(await s.Complete(cancelled, capture)); Assert.Empty(await s.Failures());
        request = s.Request(); await s.Enqueue(request); var superseded = await s.Claim();
        await s.Enqueue(request with { OperationId = Guid.NewGuid(), Request = request.Request with { InputRevision = new('b', 64) } });
        Assert.False(await s.Complete(superseded, capture)); Assert.Empty(await s.Failures());
    }

    [SqlFact]
    public async Task ObsoleteLeaseCannotPersistButCurrentRecoveryRunCan()
    {
        await using var s = new Setup(sql); await s.Enqueue(s.Request()); var first = await s.Claim();
        s.Clock.Now = s.Clock.Now.AddMinutes(2); var second = await s.Claim(); using var capture = s.Capture();
        Assert.False(await s.Complete(first, capture)); Assert.True(await s.Complete(second, capture, success: false));
        Assert.Equal(2, Assert.Single(await s.Failures()).Run);
    }

    [SqlFact]
    public async Task ExactSevenDayBoundaryDeletesDiagnosticsButNeverFamilyRecords()
    {
        await using var s = new Setup(sql); await s.Scenario.Create(); var request = s.Request(); await s.Enqueue(request);
        using var capture = s.Capture(); await s.Complete(await s.Claim(), capture);
        var row = Assert.Single(await s.Failures());
        await using var db = sql.Open(); var before = await db.Families.CountAsync();
        s.Clock.Now = row.ExpiresAt.AddTicks(-1); await s.Store(x => x.Cleanup(default));
        Assert.Single(await s.Failures());
        s.Clock.Now = row.ExpiresAt; await s.Store(x => x.Cleanup(default)); Assert.Empty(await s.Failures());
        Assert.Equal(before, await db.Families.CountAsync());
    }

    [SqlFact]
    public async Task HistoryEpochRotationPurgesBothPersonalAndFamilyDiagnosticsAndRejectsLateOldCapture()
    {
        await using var s = new Setup(sql); var family = await s.Scenario.Create();
        using var capture = s.Capture();
        await s.Enqueue(s.Request()); await s.Complete(await s.Claim(), capture);
        await s.Enqueue(s.Request(family: family)); await s.Complete(await s.Claim(), capture);
        await s.Enqueue(s.Request()); var latePersonal = await s.Claim();
        Assert.Equal(2, (await s.Failures()).Length);
        s.Scenario.Config.Family.HistoryId = Guid.NewGuid();
        Assert.True(await s.Complete(latePersonal, capture)); // Personal AI availability is unchanged.
        Assert.Equal(2, (await s.Failures()).Length);
        await s.Store(x => x.Cleanup(default)); Assert.Empty(await s.Failures());
        await s.Enqueue(s.Request()); await s.Complete(await s.Claim(), capture);
        Assert.Equal(s.Scenario.Config.Family.HistoryId, Assert.Single(await s.Failures()).HistoryEpoch);
    }

    [SqlFact]
    public async Task AccountDeletionPurgesAffectedFamilyOutputAndBlocksLateCaptureWithoutCancellingOtherMembersPrediction()
    {
        await using var s = new Setup(sql); var ownerFamily = await s.Scenario.Create();
        var caregiverFamily = await s.Scenario.Accept(await s.Scenario.Invite(ownerFamily.Id));
        using var capture = s.Capture();
        await s.Enqueue(s.Request(family: caregiverFamily), s.Scenario.Caregiver); await s.Complete(await s.Claim(), capture);
        await s.Enqueue(s.Request(family: ownerFamily)); await s.Complete(await s.Claim(), capture);
        var next = s.Request(family: ownerFamily); await s.Enqueue(next); var ownerInFlight = await s.Claim();
        Assert.Equal(2, (await s.Failures()).Length);
        await s.Scenario.Call(x => x.DeleteAccount(s.Scenario.Caregiver, new(Guid.NewGuid(), new string('c', 64)), default));
        Assert.Empty(await s.Failures());
        await using var db = sql.Open(); var row = await db.SleepAiJobs.FindAsync(s.Scenario.Owner.ObjectId, next.OperationId);
        Assert.Equal("running", row!.State); Assert.Null(row.DiagnosticsConsentVersion); Assert.Null(row.DiagnosticsHistoryEpoch);
        Assert.True(await s.Complete(ownerInFlight, capture)); Assert.Empty(await s.Failures());
        Assert.Equal("completed", (await s.Store(x => x.Get(s.Scenario.Owner, next.OperationId, default))).Status);
    }

    [SqlFact]
    public async Task RemovalPurgesMembershipDiagnosticsAndFamilyClosurePurgesRemainingFamilyDiagnostics()
    {
        await using var s = new Setup(sql); var family = await s.Scenario.Create();
        var member = await s.Scenario.Accept(await s.Scenario.Invite(family.Id)); using var capture = s.Capture();
        await s.Enqueue(s.Request(family: member), s.Scenario.Caregiver); await s.Complete(await s.Claim(), capture);
        await s.Enqueue(s.Request(family: family)); await s.Complete(await s.Claim(), capture);
        await s.Scenario.Remove(family, s.Scenario.Caregiver.ObjectId);
        Assert.Equal(s.Scenario.Owner.ObjectId, Assert.Single(await s.Failures()).UserId);
        await s.Scenario.Call(x => x.CloseFamily(s.Scenario.Owner, family.Id, s.Scenario.Context(family), default));
        Assert.Empty(await s.Failures());
    }

    [SqlFact]
    public async Task DiagnosticInsertFailureDoesNotUndoCompletionOrRequeueProviderWork()
    {
        await using var s = new Setup(sql); var request = s.Request(); await s.Enqueue(request);
        var claim = await s.Claim(); using var capture = s.Capture(); await using var db = sql.Open();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE dbo.SleepAiFailedOutputs WITH NOCHECK ADD CONSTRAINT CK_TestRejectFailureCapture CHECK (Attempt=0)");
        try
        {
            Assert.True(await s.Complete(claim, capture));
            Assert.Equal("completed", (await s.Store(x => x.Get(s.Scenario.Owner, request.OperationId, default))).Status);
            Assert.Empty(await s.Failures()); Assert.Null(await s.Store(x => x.Claim(default)));
            Assert.False(await s.Complete(claim, capture));
        }
        finally { await db.Database.ExecuteSqlRawAsync("ALTER TABLE dbo.SleepAiFailedOutputs DROP CONSTRAINT CK_TestRejectFailureCapture"); }
    }
}
