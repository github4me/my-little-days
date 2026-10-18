using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace LittleDays.FamilyApi.Tests;

public sealed class SleepAiExchangeStorageSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task DisabledJobsAreNeverStampedOrRetroactivelyCaptured()
    {
        await using var s = new Setup(sql); s.Options.FullRequestCaptureEnabled = false;
        var request = SleepAiJobTests.Request(s.Clock.Now);
        await s.Store(x => x.Enqueue(s.Scenario.Owner, request, default));
        s.Options.FullRequestCaptureEnabled = true;
        var claim = (await s.Store(x => x.Claim(default)))!;
        Assert.Null(claim.ExchangeCaptureHistoryEpoch);
        Assert.False(await s.Store(x => x.StoreExchange(claim, s.Exchange(), default)));
        Assert.Empty(await s.Rows());
    }

    [SqlFact]
    public async Task DispatchAndResponseAreUpsertedBeforeCompletionAndRemainExactlySevenDays()
    {
        await using var s = new Setup(sql); var claim = await s.Claim(); var exchange = s.Exchange();
        Assert.True(await s.Store(x => x.StoreExchange(claim, exchange, default)));
        var before = Assert.Single(await s.Rows()); Assert.Equal("dispatching", before.Outcome); Assert.Null(before.ResponseBody);
        var completed = exchange with { FinishedAt = s.Clock.Now, ResponseBody = "synthetic response", ResponseBytes = 18, Outcome = "response_received", HttpStatus = 200 };
        Assert.True(await s.Store(x => x.StoreExchange(claim, completed, default)));
        Assert.True(await s.Store(x => x.Complete(claim, new(2, claim.Request.InputRevision, "insufficient_data", s.Clock.Now,
            SleepAiValidation.ValidateRequest(claim.Request, claim.Request.Now).TodayEnd, []), null, default)));
        var saved = Assert.Single(await s.Rows()); Assert.Equal("synthetic request", saved.RequestBody);
        Assert.Equal("synthetic response", saved.ResponseBody); Assert.Equal(200, saved.HttpStatus);
        await using (var db = sql.Open()) Assert.Null((await db.SleepAiJobs.FindAsync(s.Scenario.Owner.ObjectId, claim.JobId))!.RequestJson);
        s.Clock.Now = exchange.ExpiresAt.AddTicks(-1); await s.Store(x => x.Cleanup(default));
        Assert.Single(await s.Rows());
        s.Clock.Now = exchange.ExpiresAt; await s.Store(x => x.Cleanup(default));
        Assert.Empty(await s.Rows());
    }

    [SqlFact]
    public async Task RevocationPurgesExchangeAfterJobExpiryAndBlocksLateWrites()
    {
        await using var s = new Setup(sql); var claim = await s.Claim();
        Assert.True(await s.Store(x => x.StoreExchange(claim, s.Exchange(), default)));
        await s.Store(x => x.Cancel(s.Scenario.Owner, claim.JobId, false, default));
        Assert.Empty(await s.Rows()); Assert.False(await s.Store(x => x.StoreExchange(claim, s.Exchange(), default)));
        var next = await s.Claim(); Assert.True(await s.Store(x => x.StoreExchange(next, s.Exchange(), default)));
        s.Clock.Now = SleepAiValidation.ValidateRequest(next.Request, next.Request.Now).TodayEnd;
        await s.Store(x => x.Cleanup(default)); Assert.Single(await s.Rows());
        await s.Store(x => x.Cancel(s.Scenario.Owner, s.Generation, true, default));
        Assert.Empty(await s.Rows());
    }

    [SqlFact]
    public async Task WrongLeaseEpochAndAccountCannotCaptureAndAccountPurgeSuppressesLateReceipt()
    {
        await using var s = new Setup(sql); var claim = await s.Claim();
        Assert.False(await s.Store(x => x.StoreExchange(claim with { LeaseId = Guid.NewGuid() }, s.Exchange(), default)));
        Assert.False(await s.Store(x => x.StoreExchange(claim with { UserId = s.Scenario.Other.ObjectId }, s.Exchange(), default)));
        Assert.False(await s.Store(x => x.StoreExchange(claim with { ExchangeCaptureHistoryEpoch = Guid.NewGuid() }, s.Exchange(), default)));
        Assert.Empty(await s.Rows());
        Assert.True(await s.Store(x => x.StoreExchange(claim, s.Exchange(), default)));
        await using var db = sql.Open(); var family = new FamilyService(db, s.Scenario.Config, s.Clock);
        await family.Transaction(async () => { await family.PurgeSleepAiFailuresForAccount(s.Scenario.Owner.ObjectId, default); return true; }, default);
        Assert.Empty(await s.Rows()); Assert.False(await s.Store(x => x.StoreExchange(claim, s.Exchange(), default)));
    }

    private sealed class Setup(SqlFixture sql) : IAsyncDisposable
    {
        public Scenario Scenario { get; } = new(sql);
        public SleepAiJobTests.Clock Clock { get; } = new();
        public SleepAiOptions Options { get; } = Enabled();
        public Guid Generation { get; private set; }
        private static SleepAiOptions Enabled() { var options = SleepAiJobTests.Enabled(); options.FullRequestCaptureEnabled = true; return options; }
        public async Task<T> Store<T>(Func<SleepAiJobStore, Task<T>> action)
        {
            await using var db = sql.Open(); var family = new FamilyService(db, Scenario.Config, Clock);
            return await action(new(db, family, new(new ConfigurationBuilder().Build()), Clock,
                Microsoft.Extensions.Options.Options.Create(Options)));
        }
        public async Task<SleepAiJobClaim> Claim()
        {
            var value = SleepAiJobTests.Request(Clock.Now); Generation = value.ConsentGeneration;
            await Store(x => x.Enqueue(Scenario.Owner, value, default));
            return (await Store(x => x.Claim(default)))!;
        }
        public SleepAiExchange Exchange() => new(1, 2, Clock.Now, null, "synthetic request", null, 17, 0, false, false, null, null, "dispatching", 0);
        public async Task<SleepAiExchangeRow[]> Rows()
        { await using var db = sql.Open(); return await db.SleepAiExchanges.Where(x => x.UserId == Scenario.Owner.ObjectId).ToArrayAsync(); }
        public async ValueTask DisposeAsync()
        {
            await using var db = sql.Open(); var id = Scenario.Owner.ObjectId;
            await db.SleepAiExchanges.Where(x => x.UserId == id).ExecuteDeleteAsync();
            await db.SleepAiJobs.Where(x => x.UserId == id).ExecuteDeleteAsync();
            await db.SleepAiRevocations.Where(x => x.UserId == id).ExecuteDeleteAsync();
        }
    }
}
