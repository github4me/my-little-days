using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace LittleDays.FamilyApi.Tests;

public sealed class PushSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.FromUnixTimeMilliseconds(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        public override DateTimeOffset GetUtcNow() => Now;
    }
    private sealed class Gateway : IPushGateway
    {
        public List<PushEnvelope> Sent { get; } = [];
        public PushGatewayResult Result { get; set; } = new("accepted", "synthetic-ticket");
        public Func<Task>? BeforeResult { get; set; }
        public async Task<PushGatewayResult> Send(PushEnvelope value, CancellationToken ct)
        { Sent.Add(value); if (BeforeResult is not null) await BeforeResult(); return Result; }
        public Task<PushGatewayResult> Receipt(string id, CancellationToken ct) => Task.FromResult(new PushGatewayResult("sent"));
    }
    private sealed class Setup(SqlFixture sql)
    {
        public Scenario Scenario { get; } = new(sql);
        public Clock Clock { get; } = new();
        public Gateway Gateway { get; } = new();
        public IConfigurationRoot Maintenance { get; } = new ConfigurationBuilder().AddInMemoryCollection().Build();
        public PilotConfiguration Config { get; private set; } = null!;
        public FamilySummary OwnerGrant { get; private set; } = null!;
        public FamilySummary MemberGrant { get; private set; } = null!;
        public Guid DeviceId { get; } = Guid.NewGuid();
        public string Secret { get; } = PushTests.Secret();
        public RegisterPushRequest Registration { get; private set; } = null!;
        public Task<T> Call<T>(Func<FamilyService, Task<T>> action) => sql.Call(Config, action, Clock);
        public async Task Initialize()
        {
            Config = Scenario.Config with { Push = PushTests.Settings() };
            var result = await Call(x => x.CreateFullFamily(Scenario.Owner, new(Guid.NewGuid(), "family-sharing-v1",
                FullDomainTests.Seed([Scenario.Caregiver.Email], [], [])), default));
            OwnerGrant = result.Snapshot.Family;
            MemberGrant = await Call(x => x.AcceptInvitation(Scenario.Caregiver,
                result.Snapshot.Invitations.Single().Id, new(Guid.NewGuid()), default));
            Registration = PushTests.Registration(Config.Push, MemberGrant, Config.Family.HistoryId, Secret);
            await Call(x => x.RegisterPush(Scenario.Caregiver, DeviceId, Registration, default));
        }
        public FullRecordOperation Record(string category = "diaper", bool old = false, bool running = false)
        {
            var id = Guid.NewGuid().ToString(); var start = old ? Clock.Now.AddHours(-1) : Clock.Now;
            var record = category switch
            {
                "feed" => running ? JsonSerializer.SerializeToElement(new { id, type = "feed", start, feedKind = "formula", amount = 0, feedRunning = true, note = "" })
                    : JsonSerializer.SerializeToElement(new { id, type = "feed", start, feedKind = "formula", amount = 150, note = "" }),
                "sleep" => running ? JsonSerializer.SerializeToElement(new { id, type = "sleep", start, note = "" })
                    : JsonSerializer.SerializeToElement(new { id, type = "sleep", start = start.AddMinutes(-2), end = start, note = "" }),
                _ => JsonSerializer.SerializeToElement(new { id, type = "diaper", start, diaperKind = "wet", note = "" })
            };
            return new(Guid.NewGuid(), id, OwnerGrant.MembershipId, Config.Family.HistoryId, "create", "entry", null, record, null);
        }
        public Task<FeedReceipt> Create(FullRecordOperation operation) => Call(x => x.ApplyFullRecord(Scenario.Owner, OwnerGrant.Id, operation, default));
        public async Task<FullRecordOperation> Update(FullRecordOperation original, JsonElement entry)
        {
            var snapshot = await Call(x => x.FullSnapshot(Scenario.Owner, OwnerGrant.Id, default));
            var version = snapshot.Entries.Single(x => x.Entry.GetProperty("id").GetString() == original.RecordId).Version;
            return original with { OperationId = Guid.NewGuid(), Kind = "update", BaseVersion = version, Entry = entry };
        }
        public async Task<int> Process()
        {
            await using var db = sql.Open();
            return await new PushProcessor(db, Config, Clock, new RecoveryGate(Maintenance), Gateway).Process(default);
        }
    }

    [SqlFact]
    public async Task EditsOfEachSupportedCategoryReplacePendingNoticeAndReplayOnlyOnce()
    {
        foreach (var category in PushPolicy.Categories)
        {
            var s = new Setup(sql); await s.Initialize();
            await s.Call(x => x.RegisterPush(s.Scenario.Owner, Guid.NewGuid(),
                PushTests.Registration(s.Config.Push, s.OwnerGrant, s.Config.Family.HistoryId, PushTests.Secret()), default));
            var original = s.Record(category); await s.Create(original);
            var changed = JsonNode.Parse(original.Entry!.Value.GetRawText())!;
            changed["note"] = "Changed by another family member";
            var update = await s.Update(original, JsonSerializer.SerializeToElement(changed));
            await s.Create(update); await s.Create(update);
            await using var db = sql.Open();
            var events = await db.FamilyNotificationEvents.Where(x => x.FamilyId == s.OwnerGrant.Id).ToArrayAsync();
            Assert.Equal(2, events.Length);
            Assert.Equal(update.OperationId, Assert.Single(events, x => !x.Cancelled).OperationId);
            Assert.All(await db.NotificationSummaryBuckets.Where(x => x.FamilyId == s.OwnerGrant.Id).ToArrayAsync(),
                bucket => Assert.Equal(s.Scenario.Caregiver.ObjectId, bucket.RecipientUserId));
            await s.Process(); Assert.Single(s.Gateway.Sent);
        }
    }

    [SqlFact]
    public async Task ReorderedButUnchangedSaveAndRejectedStaleEditDoNotNotify()
    {
        var s = new Setup(sql); await s.Initialize();
        var original = s.Record(); await s.Create(original);
        var reordered = JsonSerializer.SerializeToElement(original.Entry!.Value.EnumerateObject().Reverse()
            .ToDictionary(x => x.Name, x => x.Value));
        var unchanged = await s.Update(original, reordered);
        await s.Create(unchanged);
        var changed = JsonNode.Parse(reordered.GetRawText())!; changed["diaperKind"] = "mixed";
        var stale = unchanged with { OperationId = Guid.NewGuid(), Entry = JsonSerializer.SerializeToElement(changed) };
        Assert.Equal("record_changed", (await Assert.ThrowsAsync<ApiException>(() => s.Create(stale))).Code);
        await using var db = sql.Open();
        Assert.False(Assert.Single(await db.FamilyNotificationEvents.Where(x => x.FamilyId == s.OwnerGrant.Id).ToArrayAsync()).Cancelled);
    }

    [SqlFact]
    public async Task OwnerEditingMembersRecordNotifiesMemberButNotEditor()
    {
        var s = new Setup(sql); await s.Initialize();
        await s.Call(x => x.RegisterPush(s.Scenario.Owner, Guid.NewGuid(),
            PushTests.Registration(s.Config.Push, s.OwnerGrant, s.Config.Family.HistoryId, PushTests.Secret()), default));
        var original = s.Record() with { MembershipId = s.MemberGrant.MembershipId };
        await s.Call(x => x.ApplyFullRecord(s.Scenario.Caregiver, s.OwnerGrant.Id, original, default));
        var changed = JsonNode.Parse(original.Entry!.Value.GetRawText())!; changed["diaperKind"] = "mixed";
        var update = (await s.Update(original, JsonSerializer.SerializeToElement(changed))) with { MembershipId = s.OwnerGrant.MembershipId };
        await s.Create(update);
        await using var db = sql.Open();
        var current = await db.FamilyNotificationEvents.SingleAsync(x => x.FamilyId == s.OwnerGrant.Id && !x.Cancelled);
        Assert.Equal(s.Scenario.Owner.ObjectId, current.ActorUserId);
        var bucket = await (from delivery in db.PushDeliveries join b in db.NotificationSummaryBuckets on delivery.BucketId equals b.Id
            where delivery.EventId == current.Id select b).SingleAsync();
        Assert.Equal(s.Scenario.Caregiver.ObjectId, bucket.RecipientUserId);
        await s.Process(); Assert.Single(s.Gateway.Sent);
    }

    [SqlFact]
    public async Task CategoryChangeCancelsObsoleteNoticeAndRespectsRecipientPreferences()
    {
        var s = new Setup(sql); await s.Initialize();
        await s.Call(x => x.RegisterPush(s.Scenario.Caregiver, s.DeviceId, s.Registration with
            { OperationId = Guid.NewGuid(), ExpectedGeneration = 1, Categories = ["diaper"] }, default));
        var original = s.Record(); await s.Create(original);
        var feed = JsonSerializer.SerializeToElement(new { id = original.RecordId, type = "feed", start = s.Clock.Now, feedKind = "formula", amount = 150, note = "" });
        await s.Create(await s.Update(original, feed));
        await s.Process(); Assert.Empty(s.Gateway.Sent);
        var growth = JsonSerializer.SerializeToElement(new { id = original.RecordId, type = "growth", start = s.Clock.Now, weight = 4, note = "" });
        await s.Create(await s.Update(original, growth));
        await s.Process(); Assert.Empty(s.Gateway.Sent);
        await using var db = sql.Open();
        Assert.True(Assert.Single(await db.FamilyNotificationEvents.Where(x => x.FamilyId == s.OwnerGrant.Id).ToArrayAsync()).Cancelled);
    }

    [SqlFact]
    public async Task FinishingLongTimersNotifiesWithoutBackfillDelay()
    {
        foreach (var category in new[] { "feed", "sleep" })
        {
            var s = new Setup(sql); await s.Initialize();
            var original = s.Record(category, old: true, running: true); await s.Create(original);
            var completed = JsonNode.Parse(original.Entry!.Value.GetRawText())!.AsObject();
            completed.Remove("feedRunning"); completed["end"] = JsonValue.Create(s.Clock.Now);
            if (category == "feed") completed["amount"] = 150;
            await s.Create(await s.Update(original, JsonSerializer.SerializeToElement(completed)));
            await s.Process(); Assert.Single(s.Gateway.Sent);
            await using var db = sql.Open();
            Assert.False((await db.NotificationSummaryBuckets.SingleAsync(x => x.FamilyId == s.OwnerGrant.Id && x.State == "receipt")).IsSummary);
        }
    }

    [SqlFact]
    public async Task FailedEditRollsBackBothNewNoticeAndCancellationOfPreviousNotice()
    {
        var s = new Setup(sql); await s.Initialize();
        var original = s.Record(); await s.Create(original);
        var changed = JsonNode.Parse(original.Entry!.Value.GetRawText())!; changed["diaperKind"] = "mixed";
        var update = await s.Update(original, JsonSerializer.SerializeToElement(changed));
        await using (var db = sql.Open())
        {
            db.SavedChanges += (_, _) => throw new InvalidOperationException("synthetic update failure after SQL write");
            await Assert.ThrowsAsync<InvalidOperationException>(() => new FamilyService(db, s.Config, s.Clock)
                .ApplyFullRecord(s.Scenario.Owner, s.OwnerGrant.Id, update, default));
        }
        await using (var db = sql.Open())
            Assert.False(Assert.Single(await db.FamilyNotificationEvents.Where(x => x.FamilyId == s.OwnerGrant.Id).ToArrayAsync()).Cancelled);
        await s.Process(); Assert.Single(s.Gateway.Sent);
    }

    [SqlFact]
    public async Task CommitAndReplayProduceOneEventExcludeAllActorDevicesAndNeverPushSeed()
    {
        var s = new Setup(sql); await s.Initialize();
        var ownerRequest = PushTests.Registration(s.Config.Push, s.OwnerGrant, s.Config.Family.HistoryId, PushTests.Secret());
        await s.Call(x => x.RegisterPush(s.Scenario.Owner, Guid.NewGuid(), ownerRequest, default));
        await using (var db = sql.Open()) Assert.Empty(await db.FamilyNotificationEvents.Where(x => x.FamilyId == s.OwnerGrant.Id).ToArrayAsync());
        var operation = s.Record();
        await Task.WhenAll(s.Create(operation), s.Create(operation));
        await using (var db = sql.Open())
        {
            Assert.Single(await db.FamilyNotificationEvents.Where(x => x.FamilyId == s.OwnerGrant.Id).ToArrayAsync());
            var bucket = Assert.Single(await db.NotificationSummaryBuckets.Where(x => x.FamilyId == s.OwnerGrant.Id).ToArrayAsync());
            Assert.Equal(s.Scenario.Caregiver.ObjectId, bucket.RecipientUserId);
        }
        Assert.Equal(1, await s.Process());
        Assert.Single(s.Gateway.Sent);
        Assert.Equal(0, await s.Process());
        s.Clock.Now += TimeSpan.FromMinutes(16);
        Assert.Equal(1, await s.Process());
        await using (var db = sql.Open()) Assert.Equal("sent", (await db.NotificationSummaryBuckets.SingleAsync(x => x.FamilyId == s.OwnerGrant.Id)).State);
    }

    [SqlFact]
    public async Task FailedRecordCommitAlsoRollsBackEventAndDelivery()
    {
        var s = new Setup(sql); await s.Initialize();
        await using (var db = sql.Open())
        {
            db.SavedChanges += (_, _) => throw new InvalidOperationException("synthetic failure after SQL write");
            await Assert.ThrowsAsync<InvalidOperationException>(() => new FamilyService(db, s.Config, s.Clock)
                .ApplyFullRecord(s.Scenario.Owner, s.OwnerGrant.Id, s.Record(), default));
        }
        await using (var db = sql.Open())
        {
            Assert.Empty(await db.FamilyRecords.Where(x => x.FamilyId == s.OwnerGrant.Id).ToArrayAsync());
            Assert.Empty(await db.FamilyNotificationEvents.Where(x => x.FamilyId == s.OwnerGrant.Id).ToArrayAsync());
        }
    }

    [SqlFact]
    public async Task OptOutThenInCancelsOldEventsAndStaleUnregisterCannotDisableNewGeneration()
    {
        var s = new Setup(sql); await s.Initialize(); await s.Create(s.Record());
        var off = new UnregisterPushRequest(Guid.NewGuid(), s.Secret, 1);
        // A new signed-in account with exact device proof can revoke only, resolving offline logout.
        var disabled = await s.Call(x => x.UnregisterPush(s.Scenario.Other, s.DeviceId, off, default));
        Assert.False(disabled.Enabled); Assert.Equal(2, disabled.Generation);
        var on = s.Registration with { OperationId = Guid.NewGuid(), ExpectedGeneration = 2 };
        await s.Call(x => x.RegisterPush(s.Scenario.Caregiver, s.DeviceId, on, default));
        var stale = await Assert.ThrowsAsync<ApiException>(() => s.Call(x => x.UnregisterPush(s.Scenario.Other, s.DeviceId, off, default)));
        Assert.Equal("push_binding_changed", stale.Code);
        await s.Process(); Assert.Empty(s.Gateway.Sent);
        await s.Create(s.Record()); await s.Process(); Assert.Single(s.Gateway.Sent);
    }

    [SqlFact]
    public async Task SecretAndTokenKnowledgeCannotStealAnActiveBindingAndSameOperationIsReplayable()
    {
        var s = new Setup(sql); await s.Initialize();
        var replay = await s.Call(x => x.RegisterPush(s.Scenario.Caregiver, s.DeviceId, s.Registration, default));
        Assert.Equal(1, replay.Generation);
        var forged = s.Registration with { OperationId = Guid.NewGuid(), InstallationSecret = PushTests.Secret(), ExpectedGeneration = 1 };
        Assert.Equal("push_binding_forbidden", (await Assert.ThrowsAsync<ApiException>(() => s.Call(x => x.RegisterPush(s.Scenario.Caregiver, s.DeviceId, forged, default)))).Code);
        var stolen = PushTests.Registration(s.Config.Push, s.OwnerGrant, s.Config.Family.HistoryId, PushTests.Secret(), token: s.Registration.ExpoPushToken);
        Assert.Equal("push_token_bound", (await Assert.ThrowsAsync<ApiException>(() => s.Call(x => x.RegisterPush(s.Scenario.Owner, Guid.NewGuid(), stolen, default)))).Code);
    }

    [SqlFact]
    public async Task SleepGraceSuppressesCancelledTimerAndOldEntriesShareOneSealedSummary()
    {
        var s = new Setup(sql); await s.Initialize();
        var sleep = s.Record("sleep", running: true); await s.Create(sleep);
        Assert.Equal(0, await s.Process());
        var snapshot = await s.Call(x => x.FullSnapshot(s.Scenario.Owner, s.OwnerGrant.Id, default));
        var version = snapshot.Entries.Single().Version;
        await s.Create(sleep with { OperationId = Guid.NewGuid(), Kind = "delete", BaseVersion = version, Entry = null });
        s.Clock.Now += TimeSpan.FromSeconds(61); await s.Process(); Assert.Empty(s.Gateway.Sent);
        await s.Create(s.Record(old: true)); await s.Create(s.Record(old: true));
        await using (var db = sql.Open()) Assert.Single(await db.NotificationSummaryBuckets.Where(x => x.FamilyId == s.OwnerGrant.Id && x.IsSummary).ToArrayAsync());
        s.Clock.Now += TimeSpan.FromMinutes(6); await s.Process(); Assert.Single(s.Gateway.Sent);
        await s.Create(s.Record(old: true)); await s.Process(); Assert.Single(s.Gateway.Sent);
    }

    [SqlFact]
    public async Task RemovalRecoveryAndHistoryChangesBlockQueuedDelivery()
    {
        var s = new Setup(sql); await s.Initialize(); await s.Create(s.Record());
        s.Maintenance["Recovery:Blocked"] = "true";
        Assert.Equal(0, await s.Process()); Assert.Empty(s.Gateway.Sent);
        s.Maintenance["Recovery:Blocked"] = "false";
        await s.Call(x => x.RemoveMember(s.Scenario.Owner, s.OwnerGrant.Id, s.Scenario.Caregiver.ObjectId,
            new(Guid.NewGuid(), s.OwnerGrant.MembershipId, s.Config.Family.HistoryId, s.MemberGrant.MembershipId), default));
        Assert.Equal(0, await s.Process()); Assert.Empty(s.Gateway.Sent);
        await using var db = sql.Open();
        Assert.False((await db.PushInstallations.SingleAsync(x => x.Id == s.DeviceId)).Enabled);
    }

    [SqlFact]
    public async Task StaleProviderErrorDoesNotDisableAChangedTokenAndConcurrentWorkersClaimOnce()
    {
        var s = new Setup(sql); await s.Initialize(); await s.Create(s.Record());
        s.Gateway.BeforeResult = async () =>
        {
            var changed = s.Registration with { OperationId = Guid.NewGuid(), ExpectedGeneration = 1,
                ExpoPushToken = "ExpoPushToken[" + Guid.NewGuid().ToString("N") + "]" };
            await s.Call(x => x.RegisterPush(s.Scenario.Caregiver, s.DeviceId, changed, default));
        };
        s.Gateway.Result = new("unregistered", Error: "device_not_registered");
        await Task.WhenAll(s.Process(), s.Process());
        Assert.Single(s.Gateway.Sent);
        await using var db = sql.Open(); var current = await db.PushInstallations.SingleAsync(x => x.Id == s.DeviceId);
        Assert.True(current.Enabled); Assert.Equal(2, current.Generation);
    }

    [SqlFact]
    public async Task IndexedTimerGuardSerializesSimultaneousStartsAndDoesNotDeleteTheWinner()
    {
        var s = new Setup(sql); await s.Initialize(); s.Config.Family.EnforceSingleActiveTimers = true;
        var results = await Task.WhenAll(Enumerable.Range(0, 2).Select(async _ =>
        { try { await s.Create(s.Record("sleep", running: true)); return "ok"; } catch (ApiException error) { return error.Code; } }));
        Assert.Contains("ok", results); Assert.Contains("active_timer_conflict", results);
        await using var db = sql.Open(); Assert.Single(await db.FamilyRecords.Where(x => x.FamilyId == s.OwnerGrant.Id && !x.Deleted).ToArrayAsync());
    }

    [SqlFact]
    public async Task ProvenRegistrationReplayAfterRemovalOrGateDisableAcknowledgesWithoutRegranting()
    {
        var s = new Setup(sql); await s.Initialize();
        await s.Call(x => x.RemoveMember(s.Scenario.Owner, s.OwnerGrant.Id, s.Scenario.Caregiver.ObjectId,
            new(Guid.NewGuid(), s.OwnerGrant.MembershipId, s.Config.Family.HistoryId, s.MemberGrant.MembershipId), default));
        s.Config.Push.RegistrationEnabled = false;
        var replay = await s.Call(x => x.RegisterPush(s.Scenario.Caregiver, s.DeviceId, s.Registration, default));
        Assert.False(replay.Enabled); Assert.Equal(1, replay.Generation);
        var off = await s.Call(x => x.UnregisterPush(s.Scenario.Caregiver, s.DeviceId, new(Guid.NewGuid(), s.Secret, 1), default));
        Assert.Equal(2, off.Generation); Assert.False(off.Enabled);
        s.Config.Push.RegistrationEnabled = true;
        Assert.Equal("membership_revoked", (await Assert.ThrowsAsync<ApiException>(() => s.Call(x => x.RegisterPush(s.Scenario.Caregiver,
            s.DeviceId, s.Registration with { OperationId = Guid.NewGuid(), ExpectedGeneration = 2 }, default)))).Code);
    }

    [SqlFact]
    public async Task ExpiredOrRestoredHistoryDoesNotSendAndPurgedDeviceIsExplicitlyUnknown()
    {
        var s = new Setup(sql); await s.Initialize(); await s.Create(s.Record());
        s.Config.Family.HistoryId = Guid.NewGuid();
        Assert.Equal(0, await s.Process()); Assert.Empty(s.Gateway.Sent);
        s.Clock.Now += TimeSpan.FromDays(9);
        await using (var db = sql.Open()) await new PushProcessor(db, s.Config, s.Clock, new RecoveryGate(s.Maintenance), s.Gateway).Cleanup(default);
        var request = s.Registration with { OperationId = Guid.NewGuid(), ExpectedGeneration = 1, HistoryId = s.Config.Family.HistoryId };
        Assert.Equal("push_installation_unknown", (await Assert.ThrowsAsync<ApiException>(() =>
            s.Call(x => x.RegisterPush(s.Scenario.Caregiver, s.DeviceId, request, default)))).Code);
    }

    [SqlFact]
    public async Task AccountErasureRevokesDeviceAndRemovesEventAttributionWithoutWaitingForPushWorker()
    {
        var s = new Setup(sql); await s.Initialize();
        var ownerRequest = PushTests.Registration(s.Config.Push, s.OwnerGrant, s.Config.Family.HistoryId, PushTests.Secret());
        await s.Call(x => x.RegisterPush(s.Scenario.Owner, Guid.NewGuid(), ownerRequest, default));
        var operation = s.Record() with { MembershipId = s.MemberGrant.MembershipId };
        await s.Call(x => x.ApplyFullRecord(s.Scenario.Caregiver, s.MemberGrant.Id, operation, default));
        await s.Call(x => x.DeleteAccount(s.Scenario.Caregiver, new(Guid.NewGuid(), PushTests.Secret()), default));
        await s.Process(); Assert.Empty(s.Gateway.Sent);
        await using (var db = sql.Open()) await new DeletionProcessor(db, s.Config, s.Clock, new UnconfiguredAccountIdentityDeletion()).Process(default);
        await using (var db = sql.Open())
        {
            Assert.Empty(await db.PushInstallations.Where(x => x.UserId == s.Scenario.Caregiver.ObjectId).ToArrayAsync());
            Assert.Empty(await db.FamilyNotificationEvents.Where(x => x.ActorUserId == s.Scenario.Caregiver.ObjectId).ToArrayAsync());
        }
    }
}
