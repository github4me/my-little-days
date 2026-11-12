using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using System.Data.Common;
using System.Text.Json;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiFailureStorageSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    private sealed class Setup(SqlFixture sql) : IAsyncDisposable
    {
        public Scenario Scenario { get; } = new(sql);
        public SleepAiJobTests.Clock Clock { get; } = new();
        public async Task<T> Store<T>(Func<SleepAiJobStore, Task<T>> action, SleepAiFailureCapture? capture = null,
            DbCommandInterceptor? interceptor = null)
        {
            await using var db = interceptor is null ? sql.Open() : new PilotDatabase(
                new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(sql.ConnectionString).AddInterceptors(interceptor).Options);
            var family = new FamilyService(db, Scenario.Config, Clock);
            return await action(new(db, family, new(new ConfigurationBuilder().Build()), Clock,
                Microsoft.Extensions.Options.Options.Create(SleepAiJobTests.Enabled()), capture));
        }
        public CreateSleepPredictionJobRequest Request(bool consent = false, FamilySummary? family = null)
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
            var capture = new SleepAiFailureCapture(Clock); capture.StartMetadata();
            for (var attempt = 1; attempt <= count; attempt++)
                capture.Record(attempt, "invalid_json", null, $"synthetic failed output {attempt}",
                    TimeSpan.FromMilliseconds(12), "synthetic-2026-10-01");
            return capture;
        }
        public Task<bool> Complete(SleepAiJobClaim claim, SleepAiFailureCapture capture, bool success = true) =>
            Store(x => x.Complete(claim, success ? new(2, claim.Request.InputRevision, "insufficient_data", Clock.Now,
                SleepAiValidation.ValidateRequest(claim.Request, claim.Request.Now).TodayEnd, []) : null,
                success ? null : "ai_invalid_response", default), capture);
        public async Task SeedLegacyFailure(SleepAiJobClaim claim)
        {
            // Synthetic data from the retired capture policy; new completion must never create this row.
            await using var db = sql.Open(); var job = (await db.SleepAiJobs.FindAsync(claim.UserId, claim.JobId))!;
            db.SleepAiFailedOutputs.Add(new()
            {
                UserId = job.UserId, JobId = job.Id, Run = claim.Run, Attempt = 1,
                ConsentGeneration = job.ConsentGeneration, FamilyId = job.FamilyId, MembershipId = job.MembershipId,
                HistoryEpoch = Scenario.Config.Family.HistoryId, Reason = "invalid_json", FailureFieldsJson = "[\"$\"]",
                ResponseText = "synthetic legacy failed output", OriginalLength = 30,
                OccurredAt = Clock.Now, ExpiresAt = Clock.Now.AddDays(7), DurationMs = 12, Model = SleepAiOptions.SelectedModel
            });
            await db.SaveChangesAsync();
        }
        public async Task StampLegacyDiagnosticEpoch(Guid jobId)
        {
            await using var db = sql.Open();
            await db.SleepAiJobs.Where(x => x.UserId == Scenario.Owner.ObjectId && x.Id == jobId)
                .ExecuteUpdateAsync(x => x.SetProperty(row => row.DiagnosticsHistoryEpoch, (Guid?)Scenario.Config.Family.HistoryId));
        }
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
    public Task MetadataOnlyPolicyDoesNotPersistFailedOutputsForLegacyClientOrExposeThemInPrediction() =>
        VerifyMetadataOnlyPolicy(legacyConsentField: false);

    [SqlFact]
    public Task MetadataOnlyPolicyDoesNotPersistFailedOutputsForOldOptInClientOrExposeThemInPrediction() =>
        VerifyMetadataOnlyPolicy(legacyConsentField: true);

    private async Task VerifyMetadataOnlyPolicy(bool legacyConsentField)
    {
        await using var s = new Setup(sql); var request = s.Request(consent: legacyConsentField); await s.Enqueue(request);
        Assert.Equal(request.OperationId, (await s.Enqueue(request)).JobId);
        if (legacyConsentField)
            Assert.Equal("operation_reused", (await Assert.ThrowsAsync<ApiException>(() =>
                s.Enqueue(request with { DiagnosticsConsentVersion = null }))).Code);
        var claim = await s.Claim(); Assert.Null(claim.FailureCaptureHistoryEpoch); Assert.Null(claim.ExchangeCaptureHistoryEpoch);
        using var capture = s.Capture(3);
        Assert.Equal(new[] { 1, 2 }, capture.Attempts.Select(x => x.Attempt));
        Assert.All(capture.Attempts, attempt =>
        {
            Assert.Equal("invalid_json", attempt.Reason); Assert.Null(attempt.PeriodIndex);
            Assert.Equal(new[] { "$" }, attempt.Fields);
            Assert.Null(attempt.ResponseText); Assert.Equal(0, attempt.OriginalLength); Assert.False(attempt.Truncated);
            Assert.Equal(12, attempt.DurationMs);
        });
        Assert.True(await s.Complete(claim, capture)); Assert.Empty(capture.Attempts);
        Assert.False(await s.Complete(claim, capture)); Assert.Empty(await s.Failures());
        var response = await s.Store(x => x.Get(s.Scenario.Owner, request.OperationId, default));
        Assert.Equal("completed", response.Status);
        var json = JsonSerializer.Serialize(response, SleepAiJson.Options);
        Assert.DoesNotContain("synthetic failed output", json); Assert.DoesNotContain("invalid_json", json);
        Assert.DoesNotContain("failureFields", json, StringComparison.OrdinalIgnoreCase);
        await using var db = sql.Open(); var stored = await db.SleepAiJobs.FindAsync(s.Scenario.Owner.ObjectId, request.OperationId);
        Assert.Null(stored!.RequestJson); Assert.NotNull(stored.ResultJson);
        Assert.Null(stored.DiagnosticsConsentVersion);
        Assert.Null(stored.DiagnosticsHistoryEpoch); Assert.Null(stored.ExchangeHistoryEpoch);
    }

    [SqlFact]
    public async Task SpecificFailureFieldMetadataStaysInMemoryWithoutWritingPayloadRows()
    {
        await using var s = new Setup(sql); var request = s.Request(); await s.Enqueue(request);
        using var capture = new SleepAiFailureCapture(s.Clock);
        capture.StartMetadata();
        capture.Record(1, "predicted_sleep_missing_settling", 3, "synthetic-output", TimeSpan.FromMilliseconds(12),
            SleepAiOptions.SelectedModel, ["$.periods[3].sootheStart", "$.periods[3].sootheEnd"]);
        var attempt = Assert.Single(capture.Attempts);
        Assert.Equal("predicted_sleep_missing_settling", attempt.Reason);
        Assert.Equal(3, attempt.PeriodIndex);
        Assert.Equal(new[] { "$.periods[3].sootheStart", "$.periods[3].sootheEnd" },
            attempt.Fields);
        Assert.Null(attempt.ResponseText); Assert.Equal(0, attempt.OriginalLength); Assert.False(attempt.Truncated);
        Assert.True(await s.Complete(await s.Claim(), capture, success: false));
        Assert.Empty(await s.Failures()); Assert.Empty(capture.Attempts);
        var result = JsonSerializer.Serialize(await s.Store(x => x.Get(s.Scenario.Owner, request.OperationId, default)));
        Assert.DoesNotContain("sootheStart", result);
        Assert.DoesNotContain("synthetic-output", result);
    }

    [SqlFact]
    public async Task MetadataOnlyPolicyDoesNotRetrofitConsentOrChangeImmutableLegacyOperation()
    {
        await using var s = new Setup(sql); var request = s.Request(consent: false); await s.Enqueue(request);
        Assert.Equal("operation_reused", (await Assert.ThrowsAsync<ApiException>(() => s.Enqueue(request with
            { DiagnosticsConsentVersion = SleepAiFailureCapture.ConsentVersion }))).Code);
        Assert.Equal(request.OperationId, (await s.Enqueue(request)).JobId);
        var claim = await s.Claim(); Assert.Null(claim.FailureCaptureHistoryEpoch);
        using var deliberatelyEnabledCollector = s.Capture();
        Assert.True(await s.Complete(claim, deliberatelyEnabledCollector, success: false));
        Assert.Empty(await s.Failures());
        await using var db = sql.Open();
        Assert.Null((await db.SleepAiJobs.FindAsync(s.Scenario.Owner.ObjectId, request.OperationId))!.DiagnosticsConsentVersion);
        Assert.Equal("failed", (await s.Store(x => x.Get(s.Scenario.Owner, request.OperationId, default))).Status);
    }

    [SqlFact]
    public async Task PrePolicyNullEpochJobCompletesWithoutCaptureOrRetroactiveConsent()
    {
        await using var s = new Setup(sql); var request = s.Request(); await s.Enqueue(request);
        await using var db = sql.Open();
        // Represents an immutable no-diagnostics job queued by the previous API.
        await db.SleepAiJobs.Where(x => x.UserId == s.Scenario.Owner.ObjectId && x.Id == request.OperationId)
            .ExecuteUpdateAsync(x => x.SetProperty(row => row.DiagnosticsHistoryEpoch, (Guid?)null));
        Assert.Equal(request.OperationId, (await s.Enqueue(request)).JobId);
        var claim = await s.Claim(); Assert.Null(claim.FailureCaptureHistoryEpoch);
        using var collector = s.Capture();
        Assert.True(await s.Complete(claim, collector, success: false)); Assert.Empty(await s.Failures());
        var stored = await db.SleepAiJobs.AsNoTracking().SingleAsync(x => x.UserId == s.Scenario.Owner.ObjectId && x.Id == request.OperationId);
        Assert.Equal("failed", stored.State); Assert.Null(stored.RequestJson);
        Assert.Null(stored.DiagnosticsConsentVersion); Assert.Null(stored.DiagnosticsHistoryEpoch);
    }

    [SqlFact]
    public async Task ConsentRevocationAfterParentExpiryPurgesOnlyThatUsersDiagnosticGeneration()
    {
        await using var s = new Setup(sql); var request = s.Request(); await s.Enqueue(request);
        using var capture = s.Capture(); var claim = await s.Claim();
        Assert.True(await s.Complete(claim, capture)); await s.SeedLegacyFailure(claim);
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
    public async Task ObsoleteLeaseCannotCompleteButCurrentRecoveryRunCompletesWithoutPayloadStorage()
    {
        await using var s = new Setup(sql); await s.Enqueue(s.Request()); var first = await s.Claim();
        s.Clock.Now = s.Clock.Now.AddMinutes(2); var second = await s.Claim(); using var capture = s.Capture();
        Assert.False(await s.Complete(first, capture)); Assert.True(await s.Complete(second, capture, success: false));
        Assert.Empty(await s.Failures());
        var response = await s.Store(x => x.Get(s.Scenario.Owner, second.JobId, default));
        Assert.Equal("failed", response.Status); Assert.Equal("ai_invalid_response", response.ErrorCode);
        await using var db = sql.Open();
        Assert.Equal(2, (await db.SleepAiJobs.FindAsync(s.Scenario.Owner.ObjectId, second.JobId))!.Runs);
    }

    [SqlFact]
    public async Task ExactSevenDayBoundaryDeletesDiagnosticsButNeverFamilyRecords()
    {
        await using var s = new Setup(sql); var family = await s.Scenario.Create();
        var feed = s.Scenario.CreateFeed(family, Scenario.Feed(135));
        var receipt = await s.Scenario.Call(x => x.ApplyFeed(s.Scenario.Owner, family.Id, feed, default));
        var request = s.Request(); await s.Enqueue(request);
        using var capture = s.Capture(); var claim = await s.Claim(); await s.Complete(claim, capture);
        await s.SeedLegacyFailure(claim);
        var row = Assert.Single(await s.Failures());
        await using var db = sql.Open(); var before = await db.Families.CountAsync();
        s.Clock.Now = row.ExpiresAt.AddTicks(-1); await s.Store(x => x.Cleanup(default));
        Assert.Single(await s.Failures());
        s.Clock.Now = row.ExpiresAt; await s.Store(x => x.Cleanup(default)); Assert.Empty(await s.Failures());
        Assert.Equal(before, await db.Families.CountAsync());
        var retained = Assert.Single(await db.Feeds.AsNoTracking().Where(x => x.FamilyId == family.Id).ToArrayAsync());
        Assert.Equal(feed.RecordId, retained.Id); Assert.Equal(135m, retained.Amount); Assert.False(retained.Deleted);
        Assert.Equal(receipt, await s.Scenario.Call(x => x.ApplyFeed(s.Scenario.Owner, family.Id, feed, default)));
    }

    [SqlFact]
    public async Task HistoryEpochRotationPurgesBothPersonalAndFamilyDiagnosticsAndRejectsLateOldCapture()
    {
        await using var s = new Setup(sql); var family = await s.Scenario.Create();
        using var capture = s.Capture();
        await s.Enqueue(s.Request()); var personal = await s.Claim(); await s.Complete(personal, capture); await s.SeedLegacyFailure(personal);
        await s.Enqueue(s.Request(family: family)); var shared = await s.Claim(); await s.Complete(shared, capture); await s.SeedLegacyFailure(shared);
        var late = s.Request(); await s.Enqueue(late); await s.StampLegacyDiagnosticEpoch(late.OperationId);
        var latePersonal = await s.Claim(); Assert.Equal(s.Scenario.Config.Family.HistoryId, latePersonal.FailureCaptureHistoryEpoch);
        Assert.Equal(2, (await s.Failures()).Length);
        s.Scenario.Config.Family.HistoryId = Guid.NewGuid();
        Assert.True(await s.Complete(latePersonal, capture)); // Personal AI availability is unchanged.
        Assert.Equal(2, (await s.Failures()).Length);
        await s.Store(x => x.Cleanup(default)); Assert.Empty(await s.Failures());
        await s.Enqueue(s.Request()); var current = await s.Claim(); await s.Complete(current, capture);
        Assert.Empty(await s.Failures());
        // During a rolling upgrade a previous instance may still own an unexpired current-epoch row.
        await s.SeedLegacyFailure(current); await s.Store(x => x.Cleanup(default));
        Assert.Equal(s.Scenario.Config.Family.HistoryId, Assert.Single(await s.Failures()).HistoryEpoch);
    }

    [SqlFact]
    public async Task ClaimAfterHistoryRotationDoesNotRecaptureOldPersonalRequestUnderNewEpoch()
    {
        await using var s = new Setup(sql); var request = s.Request(); await s.Enqueue(request);
        await s.StampLegacyDiagnosticEpoch(request.OperationId);
        s.Scenario.Config.Family.HistoryId = Guid.NewGuid();
        var claim = await s.Claim(); Assert.Null(claim.FailureCaptureHistoryEpoch);
        using var capture = s.Capture();
        Assert.True(await s.Complete(claim, capture)); Assert.Empty(await s.Failures());
    }

    [SqlFact]
    public Task AccountDeletionPurgesAffectedFamilyOutputAndBlocksLateCaptureWithoutCancellingOtherMembersPrediction() =>
        VerifyAccountDeletionCaptureSuppression(recoverLease: false);

    [SqlFact]
    public Task AccountDeletionSuppressionSurvivesLeaseRecoveryWithoutCancellingOtherMembersPrediction() =>
        VerifyAccountDeletionCaptureSuppression(recoverLease: true);

    private async Task VerifyAccountDeletionCaptureSuppression(bool recoverLease)
    {
        await using var s = new Setup(sql); var ownerFamily = await s.Scenario.Create();
        var caregiverFamily = await s.Scenario.Accept(await s.Scenario.Invite(ownerFamily.Id));
        using var capture = s.Capture();
        await s.Enqueue(s.Request(family: caregiverFamily), s.Scenario.Caregiver);
        var caregiver = await s.Claim(); await s.Complete(caregiver, capture); await s.SeedLegacyFailure(caregiver);
        await s.Enqueue(s.Request(family: ownerFamily));
        var owner = await s.Claim(); await s.Complete(owner, capture); await s.SeedLegacyFailure(owner);
        var next = s.Request(family: ownerFamily); await s.Enqueue(next); await s.StampLegacyDiagnosticEpoch(next.OperationId);
        var ownerInFlight = await s.Claim(); Assert.Equal(s.Scenario.Config.Family.HistoryId, ownerInFlight.FailureCaptureHistoryEpoch);
        Assert.Equal(2, (await s.Failures()).Length);
        await s.Scenario.Call(x => x.DeleteAccount(s.Scenario.Caregiver, new(Guid.NewGuid(), new string('c', 64)), default));
        Assert.Empty(await s.Failures());
        await using var db = sql.Open(); var row = await db.SleepAiJobs.FindAsync(s.Scenario.Owner.ObjectId, next.OperationId);
        Assert.Equal("running", row!.State); Assert.Null(row.DiagnosticsConsentVersion); Assert.Null(row.DiagnosticsHistoryEpoch);
        if (recoverLease)
        {
            s.Clock.Now = s.Clock.Now.AddMinutes(2);
            var recovered = await s.Claim(); Assert.Null(recovered.FailureCaptureHistoryEpoch);
            Assert.False(await s.Complete(ownerInFlight, capture)); ownerInFlight = recovered;
        }
        Assert.True(await s.Complete(ownerInFlight, capture)); Assert.Empty(await s.Failures());
        Assert.Equal("completed", (await s.Store(x => x.Get(s.Scenario.Owner, next.OperationId, default))).Status);
    }

    [SqlFact]
    public async Task RemovalPurgesMembershipDiagnosticsAndFamilyClosurePurgesRemainingFamilyDiagnostics()
    {
        await using var s = new Setup(sql); var family = await s.Scenario.Create();
        var member = await s.Scenario.Accept(await s.Scenario.Invite(family.Id)); using var capture = s.Capture();
        await s.Enqueue(s.Request(family: member), s.Scenario.Caregiver);
        var caregiver = await s.Claim(); await s.Complete(caregiver, capture); await s.SeedLegacyFailure(caregiver);
        await s.Enqueue(s.Request(family: family));
        var owner = await s.Claim(); await s.Complete(owner, capture); await s.SeedLegacyFailure(owner);
        await s.Scenario.Remove(family, s.Scenario.Caregiver.ObjectId);
        Assert.Equal(s.Scenario.Owner.ObjectId, Assert.Single(await s.Failures()).UserId);
        await s.Scenario.Call(x => x.CloseFamily(s.Scenario.Owner, family.Id, s.Scenario.Context(family), default));
        Assert.Empty(await s.Failures());
    }

    [SqlFact]
    public async Task CompletionDoesNotReadOrWriteRetiredFailurePayloadTableOrRequeueProviderWork()
    {
        await using var s = new Setup(sql); var request = s.Request(); await s.Enqueue(request);
        await s.StampLegacyDiagnosticEpoch(request.OperationId);
        var claim = await s.Claim(); using var capture = s.Capture(); var probe = new RejectLegacyPayloadAccess();
        Assert.Equal(s.Scenario.Config.Family.HistoryId, claim.FailureCaptureHistoryEpoch);
        Assert.True(await s.Store(x => x.Complete(claim, new(2, claim.Request.InputRevision, "insufficient_data", s.Clock.Now,
            SleepAiValidation.ValidateRequest(claim.Request, claim.Request.Now).TodayEnd, []), null, default), capture, probe));
        Assert.Equal(0, probe.Attempts);
        Assert.Equal("completed", (await s.Store(x => x.Get(s.Scenario.Owner, request.OperationId, default))).Status);
        Assert.Empty(await s.Failures()); Assert.Null(await s.Store(x => x.Claim(default)));
        Assert.False(await s.Complete(claim, capture));
    }

    private sealed class RejectLegacyPayloadAccess : DbCommandInterceptor
    {
        public int Attempts { get; private set; }
        private void Check(DbCommand command)
        {
            if (!command.CommandText.Contains("SleepAiFailedOutputs", StringComparison.OrdinalIgnoreCase)) return;
            Attempts++;
            throw new InvalidOperationException("Retired diagnostic payload table must not be touched by completion.");
        }
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        { Check(command); return ValueTask.FromResult(result); }
        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        { Check(command); return ValueTask.FromResult(result); }
        public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<object> result, CancellationToken cancellationToken = default)
        { Check(command); return ValueTask.FromResult(result); }
    }
}
