using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.AspNetCore.TestHost;
using System.Net;
using System.Net.Http.Json;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiJobSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    private sealed class Setup(SqlFixture sql) : IAsyncDisposable
    {
        public Scenario Scenario { get; } = new(sql);
        public SleepAiJobTests.Clock Clock { get; } = new();
        public SleepAiOptions Options { get; } = SleepAiJobTests.Enabled();
        public IConfigurationRoot Maintenance { get; } = new ConfigurationBuilder().AddInMemoryCollection().Build();
        public async Task<T> Store<T>(Func<SleepAiJobStore, Task<T>> action)
        {
            await using var db = sql.Open();
            var family = new FamilyService(db, Scenario.Config, Clock);
            return await action(new(db, family, new(Maintenance), Clock, Microsoft.Extensions.Options.Options.Create(Options)));
        }
        public Task<SleepPredictionJobResponse> Enqueue(CreateSleepPredictionJobRequest request, CancellationToken ct = default) => Store(x => x.Enqueue(Scenario.Owner, request, ct));
        public Task<SleepPredictionJobResponse> Get(Guid id) => Store(x => x.Get(Scenario.Owner, id, default));
        public Task<SleepAiJobClaim?> Claim() => Store(x => x.Claim(default));
        public SleepPredictionResponse Result(SleepAiJobClaim claim) => new(2, claim.Request.InputRevision, "insufficient_data", Clock.Now,
            SleepAiValidation.ValidateRequest(claim.Request, claim.Request.Now).TodayEnd, []);
        public Task<bool> Complete(SleepAiJobClaim claim) => Store(x => x.Complete(claim, Result(claim), null, default));
        public async Task<IAsyncDisposable> Reserve(PilotDatabase db, Guid? user = null) => await new SleepAiAttemptStore(db,
            new(db, Scenario.Config, Clock), Clock, Microsoft.Extensions.Options.Options.Create(Options)).Reserve(user ?? Scenario.Owner.ObjectId, default);
        public async ValueTask DisposeAsync()
        {
            await using var db = sql.Open();
            var users = Scenario.Config.Pilot.Identities.Select(x => x.ObjectId).ToArray();
            await db.SleepAiJobs.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
            await db.SleepAiRevocations.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
            await db.SleepAiAttempts.Where(x => users.Contains(x.UserId)).ExecuteDeleteAsync();
        }
    }

    [SqlFact]
    public async Task CommittedJobSurvivesCallerCancellationAndContextRestartWithoutDuplicateEnqueue()
    {
        await using var s = new Setup(sql); var request = SleepAiJobTests.Request(s.Clock.Now);
        using var caller = new CancellationTokenSource(); var created = await s.Enqueue(request, caller.Token); caller.Cancel();
        Assert.Equal("queued", created.Status); Assert.Equal(request.OperationId, created.JobId);
        s.Clock.Now = s.Clock.Now.AddMinutes(10);
        var replay = await s.Enqueue(request); Assert.Equal(created.JobId, replay.JobId);
        var claim = Assert.IsType<SleepAiJobClaim>(await s.Claim());
        Assert.Equal(request.Request.Now, claim.Request.Now); Assert.True(await s.Complete(claim));
        var completed = await s.Get(created.JobId); Assert.Equal("completed", completed.Status);
        Assert.Equal("insufficient_data", completed.Prediction!.Status);
        await using var db = sql.Open(); var row = Assert.Single(await db.SleepAiJobs.Where(x => x.UserId == s.Scenario.Owner.ObjectId).ToArrayAsync());
        Assert.Null(row.RequestJson); Assert.NotNull(row.ResultJson); Assert.Equal(1, row.Runs);
        Assert.Equal("operation_reused", (await Assert.ThrowsAsync<ApiException>(() => s.Enqueue(request with
            { Request = request.Request with { AgeDays = 101 } }))).Code);
    }

    [SqlFact]
    public async Task ParallelDuplicatePostsCommitOneJobAndOnlyOneWorkerClaimsIt()
    {
        await using var s = new Setup(sql); var request = SleepAiJobTests.Request(s.Clock.Now);
        var jobs = await Task.WhenAll(s.Enqueue(request), s.Enqueue(request));
        Assert.All(jobs, x => Assert.Equal(request.OperationId, x.JobId));
        var claims = await Task.WhenAll(s.Claim(), s.Claim()); Assert.Single(claims, x => x is not null);
        await using var db = sql.Open(); Assert.Equal(1, await db.SleepAiJobs.CountAsync(x => x.UserId == s.Scenario.Owner.ObjectId));
    }

    [SqlFact]
    public async Task LeaseRecoveryIsBoundedAndOldWorkerCannotPublishAfterReplacement()
    {
        await using var s = new Setup(sql); var request = SleepAiJobTests.Request(s.Clock.Now); await s.Enqueue(request);
        var first = Assert.IsType<SleepAiJobClaim>(await s.Claim()); Assert.Null(await s.Claim());
        s.Clock.Now = s.Clock.Now.AddMinutes(2);
        var second = Assert.IsType<SleepAiJobClaim>(await s.Claim()); Assert.NotEqual(first.LeaseId, second.LeaseId);
        Assert.False(await s.Complete(first));
        s.Clock.Now = s.Clock.Now.AddMinutes(2); Assert.Null(await s.Claim());
        var failed = await s.Get(request.OperationId); Assert.Equal("failed", failed.Status); Assert.Equal("ai_provider_unavailable", failed.ErrorCode);
        Assert.False(await s.Complete(second));
        await using var db = sql.Open(); Assert.Null((await db.SleepAiJobs.FindAsync(s.Scenario.Owner.ObjectId, request.OperationId))!.RequestJson);
    }

    [SqlFact]
    public async Task ConsentAndAbsentOperationTombstonesRejectLatePostsAndCancelLateCompletion()
    {
        await using var s = new Setup(sql); var request = SleepAiJobTests.Request(s.Clock.Now);
        await s.Store(x => x.Cancel(s.Scenario.Owner, request.OperationId, false, default));
        Assert.Equal("ai_consent_revoked", (await Assert.ThrowsAsync<ApiException>(() => s.Enqueue(request))).Code);
        request = request with { OperationId = Guid.NewGuid() }; await s.Enqueue(request);
        var claim = Assert.IsType<SleepAiJobClaim>(await s.Claim());
        await s.Store(x => x.Cancel(s.Scenario.Owner, request.ConsentGeneration, true, default));
        Assert.False(await s.Complete(claim)); Assert.Equal("cancelled", (await s.Get(request.OperationId)).Status);
        Assert.Equal("ai_consent_revoked", (await Assert.ThrowsAsync<ApiException>(() => s.Enqueue(request with { OperationId = Guid.NewGuid() }))).Code);
        await s.Enqueue(request with { OperationId = Guid.NewGuid(), ConsentGeneration = Guid.NewGuid() });
        await using var db = sql.Open(); var old = await db.SleepAiJobs.FindAsync(s.Scenario.Owner.ObjectId, request.OperationId);
        Assert.Null(old!.RequestJson); Assert.Null(old.ResultJson);
    }

    [SqlFact]
    public async Task AccountIsolationAndDeletionPreventReadAndSynchronouslyPurgePrivatePayloads()
    {
        await using var s = new Setup(sql); var request = SleepAiJobTests.Request(s.Clock.Now); await s.Enqueue(request);
        Assert.Equal("job_not_found", (await Assert.ThrowsAsync<ApiException>(() => s.Store(x => x.Get(s.Scenario.Other, request.OperationId, default)))).Code);
        await s.Store(x => x.Cancel(s.Scenario.Other, request.ConsentGeneration, true, default));
        var claim = Assert.IsType<SleepAiJobClaim>(await s.Claim()); Assert.True(await s.Complete(claim));
        await s.Scenario.Call(x => x.DeleteAccount(s.Scenario.Owner, new(Guid.NewGuid(), new string('c', 64)), default));
        Assert.Equal("account_deleted", (await Assert.ThrowsAsync<ApiException>(() => s.Get(request.OperationId))).Code);
        await using var db = sql.Open(); var row = await db.SleepAiJobs.FindAsync(s.Scenario.Owner.ObjectId, request.OperationId);
        Assert.Equal("cancelled", row!.State); Assert.Null(row.RequestJson); Assert.Null(row.ResultJson);
    }

    [SqlFact]
    public async Task RevokedFamilyGrantPreventsPublicationAndPurgesSnapshot()
    {
        await using var s = new Setup(sql); var family = await s.Scenario.Create(); var member = await s.Scenario.Accept(await s.Scenario.Invite(family.Id));
        var request = SleepAiJobTests.Request(s.Clock.Now);
        request = request with { Request = request.Request with { FamilyId = family.Id, MembershipId = member.MembershipId, HistoryId = s.Scenario.Config.Family.HistoryId } };
        await s.Store(x => x.Enqueue(s.Scenario.Caregiver, request, default));
        var claim = Assert.IsType<SleepAiJobClaim>(await s.Claim());
        await s.Scenario.Remove(family, s.Scenario.Caregiver.ObjectId);
        Assert.False(await s.Complete(claim));
        Assert.Equal("membership_revoked", (await Assert.ThrowsAsync<ApiException>(() => s.Store(x => x.Get(s.Scenario.Caregiver, request.OperationId, default)))).Code);
        await using var db = sql.Open(); var row = await db.SleepAiJobs.FindAsync(s.Scenario.Caregiver.ObjectId, request.OperationId);
        Assert.Null(row!.RequestJson); Assert.Null(row.ResultJson);
    }

    [SqlFact]
    public async Task NewRevisionCancelsOnlyUnfinishedOlderWorkAndKeepsCompletedPriorPlan()
    {
        await using var s = new Setup(sql); var first = SleepAiJobTests.Request(s.Clock.Now); await s.Enqueue(first);
        var firstClaim = Assert.IsType<SleepAiJobClaim>(await s.Claim()); await s.Complete(firstClaim);
        s.Clock.Now = s.Clock.Now.AddMinutes(1);
        var second = first with { OperationId = Guid.NewGuid(), Request = first.Request with { Now = s.Clock.Now, InputRevision = new('b', 64) } };
        await s.Enqueue(second); var secondClaim = Assert.IsType<SleepAiJobClaim>(await s.Claim());
        var third = second with { OperationId = Guid.NewGuid(), Request = second.Request with { InputRevision = new('c', 64) } };
        await s.Enqueue(third);
        Assert.False(await s.Complete(secondClaim)); Assert.Equal("cancelled", (await s.Get(second.OperationId)).Status);
        Assert.Equal("completed", (await s.Get(first.OperationId)).Status); Assert.NotNull((await s.Get(first.OperationId)).Prediction);
        var older = first with { OperationId = Guid.NewGuid() }; Assert.Equal("cancelled", (await s.Enqueue(older)).Status);
        Assert.Equal("queued", (await s.Get(third.OperationId)).Status);
    }

    [SqlFact]
    public async Task LocalMidnightExpiryAndCleanupDoNotDeleteFamilyRecordsOrConsumeProviderBudget()
    {
        await using var s = new Setup(sql); var request = SleepAiJobTests.Request(s.Clock.Now); await s.Enqueue(request);
        await s.Scenario.Create(); var claim = Assert.IsType<SleepAiJobClaim>(await s.Claim()); await s.Complete(claim);
        await using var db = sql.Open(); var before = await db.Families.CountAsync();
        for (var i = 0; i < 10; i++) Assert.Equal("completed", (await s.Get(request.OperationId)).Status);
        Assert.Equal(0, await db.SleepAiAttempts.CountAsync(x => x.UserId == s.Scenario.Owner.ObjectId));
        s.Clock.Now = SleepAiValidation.ValidateRequest(request.Request, request.Request.Now).TodayEnd;
        var expired = await s.Get(request.OperationId); Assert.Equal("expired", expired.Status); Assert.Null(expired.Prediction);
        await s.Store(x => x.Cleanup(default));
        Assert.Equal("job_not_found", (await Assert.ThrowsAsync<ApiException>(() => s.Get(request.OperationId))).Code);
        Assert.Equal(before, await db.Families.CountAsync());
    }

    [SqlFact]
    public async Task MaintenancePreventsEnqueueClaimAndPublicationWithoutLosingLease()
    {
        await using var s = new Setup(sql); var request = SleepAiJobTests.Request(s.Clock.Now); await s.Enqueue(request);
        var claim = Assert.IsType<SleepAiJobClaim>(await s.Claim()); s.Maintenance["Recovery:Blocked"] = "true";
        Assert.Equal("recovery_blocked", (await Assert.ThrowsAsync<ApiException>(() => s.Complete(claim))).Code);
        Assert.Equal("recovery_blocked", (await Assert.ThrowsAsync<ApiException>(() => s.Claim())).Code);
        Assert.Equal("recovery_blocked", (await Assert.ThrowsAsync<ApiException>(() => s.Enqueue(request))).Code);
        s.Maintenance["Recovery:Blocked"] = "false"; Assert.Equal("running", (await s.Get(request.OperationId)).Status);
        Assert.True(await s.Complete(claim));
    }

    [SqlFact]
    public async Task DurableThirtiethAttemptAndUtcHourResetSurviveNewDbContexts()
    {
        await using var s = new Setup(sql);
        for (var i = 0; i < 30; i++) { await using var db = sql.Open(); await using var lease = await s.Reserve(db); }
        await using var denied = sql.Open();
        Assert.Equal("ai_hourly_limit", (await Assert.ThrowsAsync<ApiException>(async () => { await using var lease = await s.Reserve(denied); })).Code);
        s.Clock.Now = DateTimeOffset.FromUnixTimeSeconds(s.Clock.Now.ToUnixTimeSeconds() / 3600 * 3600).AddHours(1);
        await using var allowed = sql.Open(); await using var next = await s.Reserve(allowed);
        Assert.Equal(31, await allowed.SleepAiAttempts.CountAsync(x => x.UserId == s.Scenario.Owner.ObjectId));
    }

    [SqlFact]
    public async Task DurableConcurrencyAndDailyLimitsRemainAfterRestartAndStaleLeaseExpires()
    {
        await using var s = new Setup(sql); await using var db1 = sql.Open(); await using var db2 = sql.Open(); await using var db3 = sql.Open();
        await using var first = await s.Reserve(db1); await using var second = await s.Reserve(db2, s.Scenario.Caregiver.ObjectId);
        Assert.Equal("ai_busy", (await Assert.ThrowsAsync<ApiException>(async () => { await using var lease = await s.Reserve(db3); })).Code);
        s.Clock.Now = s.Clock.Now.AddSeconds(75); await using var third = await s.Reserve(db3);
        s.Options.MaxRequestsPerInstancePerDay = await db3.SleepAiAttempts.CountAsync(x => x.StartedAt >= new DateTimeOffset(s.Clock.Now.UtcDateTime.Date, TimeSpan.Zero));
        Assert.Equal("ai_daily_limit", (await Assert.ThrowsAsync<ApiException>(async () => { await using var lease = await s.Reserve(db3, s.Scenario.Other.ObjectId); })).Code);
        s.Clock.Now = new DateTimeOffset(s.Clock.Now.UtcDateTime.Date.AddDays(1), TimeSpan.Zero);
        await using var tomorrow = await s.Reserve(db3);
    }

    private sealed class DeferredProvider : ISleepAiProvider
    {
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Calls { get; private set; }
        public async Task<string?> GenerateAsync(SleepPredictionRequest request, SleepAiTimeBounds bounds, bool retry, CancellationToken ct)
        { Calls++; Started.TrySetResult(); await Release.Task.WaitAsync(ct); return SleepAiJobTests.Output; }
    }

    [SqlFact]
    public async Task TwoHundredthDailyProviderAttemptIsAllowedAndNextAttemptIsDenied()
    {
        await using var s = new Setup(sql); await using var db = sql.Open();
        var earlierToday = new DateTimeOffset(s.Clock.Now.UtcDateTime.Date, TimeSpan.Zero).AddMinutes(1);
        db.SleepAiAttempts.AddRange(Enumerable.Range(0, 199).Select(_ => new SleepAiAttemptRow
            { Id = Guid.NewGuid(), UserId = s.Scenario.Owner.ObjectId, StartedAt = earlierToday }));
        await db.SaveChangesAsync();
        await using var twoHundredth = await s.Reserve(db);
        Assert.Equal(200, await db.SleepAiAttempts.CountAsync(x => x.UserId == s.Scenario.Owner.ObjectId));
        Assert.Equal("ai_daily_limit", (await Assert.ThrowsAsync<ApiException>(async () =>
            { await using var denied = await s.Reserve(db, s.Scenario.Caregiver.ObjectId); })).Code);
        Assert.Equal(200, await db.SleepAiAttempts.CountAsync(x => x.UserId == s.Scenario.Owner.ObjectId));
    }

    [SqlFact]
    public async Task HostedWorkerContinuesAfterAcknowledgedHttpCallerDisposesAndLegacyRouteSharesDurableQuota()
    {
        await using var s = new Setup(sql); s.Options.MaxRequestsPerAccountPerHour = 1;
        var request = SleepAiJobTests.Request(s.Clock.Now); var provider = new DeferredProvider();
        await using var host = new TestHost(s.Scenario.Config, sql.ConnectionString);
        await using var isolated = host.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<IOptions<SleepAiOptions>>(Options.Create(s.Options));
            services.AddSingleton<TimeProvider>(s.Clock);
            services.AddScoped<ISleepAiProvider>(_ => provider);
            services.AddHostedService<SleepAiJobWorker>();
        }));
        using var caller = isolated.CreateClient(); caller.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(s.Scenario.Owner));
        using var submitted = await caller.PostAsJsonAsync("/v2/sleep-prediction-jobs", request);
        Assert.Equal(HttpStatusCode.Accepted, submitted.StatusCode);
        Assert.EndsWith(request.OperationId.ToString("D"), submitted.Headers.Location!.ToString());
        var accepted = await submitted.Content.ReadFromJsonAsync<SleepPredictionJobResponse>(); Assert.Equal(request.OperationId, accepted!.JobId);
        await provider.Started.Task.WaitAsync(TimeSpan.FromSeconds(15)); caller.Dispose();
        using var reopened = isolated.CreateClient(); reopened.DefaultRequestHeaders.Authorization = new("Bearer", host.Token(s.Scenario.Owner));
        var running = await reopened.GetFromJsonAsync<SleepPredictionJobResponse>($"/v2/sleep-prediction-jobs/{request.OperationId}");
        Assert.Equal("running", running!.Status); Assert.Null(running.Prediction);
        provider.Release.TrySetResult();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        SleepPredictionJobResponse? completed;
        do
        {
            completed = await reopened.GetFromJsonAsync<SleepPredictionJobResponse>($"/v2/sleep-prediction-jobs/{request.OperationId}", deadline.Token);
            if (completed!.Status == "running") await Task.Delay(50, deadline.Token);
        } while (completed!.Status == "running");
        Assert.Equal("completed", completed.Status); Assert.Equal("insufficient_data", completed.Prediction!.Status); Assert.Equal(1, provider.Calls);
        using var legacy = await reopened.PostAsJsonAsync("/v2/sleep-predictions", request.Request);
        Assert.Equal(HttpStatusCode.TooManyRequests, legacy.StatusCode);
        Assert.Equal("ai_hourly_limit", (await legacy.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("code").GetString());
        Assert.Equal(1, provider.Calls);
        await using var db = sql.Open(); Assert.Equal(1, await db.SleepAiAttempts.CountAsync(x => x.UserId == s.Scenario.Owner.ObjectId));
        Assert.Null((await db.SleepAiJobs.FindAsync(s.Scenario.Owner.ObjectId, request.OperationId))!.RequestJson);
    }
}
