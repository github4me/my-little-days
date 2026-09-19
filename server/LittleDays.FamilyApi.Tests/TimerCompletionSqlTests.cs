using System.Text.Json;
using System.Text.Json.Nodes;

namespace LittleDays.FamilyApi.Tests;

public sealed class TimerCompletionSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task ActiveMemberCanFinishAnotherMembersSleepAndAttributionSurvivesLaterEdits()
    {
        var setup = await Setup();
        Assert.True((await setup.Snapshot()).CrossMemberTimerCompletionEnabled);
        var started = Sleep("shared-sleep", "2026-09-19T10:00:00Z");
        await setup.Apply(setup.Caregiver, Create(setup, setup.CaregiverGrant, started));
        var active = await setup.Entry("shared-sleep");
        var finished = Sleep("shared-sleep", "2026-09-19T10:00:00Z", "2026-09-19T10:42:00Z");

        await setup.Apply(setup.Other, Update(setup, setup.OtherGrant, active, finished));

        var completed = await setup.Entry("shared-sleep");
        Assert.Equal(setup.Caregiver.ObjectId, completed.RecordedBy);
        Assert.Equal(setup.Other.ObjectId, completed.EndedBy);
        Assert.Equal(setup.Other.ObjectId, completed.LastEditedBy);
        Assert.Equal("2026-09-19T10:00:00Z", completed.Entry.GetProperty("start").GetString());
        Assert.Equal("2026-09-19T10:42:00Z", completed.Entry.GetProperty("end").GetString());

        var later = JsonNode.Parse(completed.Entry.GetRawText())!;
        later["note"] = "Checked later";
        await setup.Apply(setup.Owner, Update(setup, setup.OwnerGrant, completed,
            FullDomainTests.Json(later.ToJsonString())));

        var edited = await setup.Entry("shared-sleep");
        Assert.Equal(setup.Caregiver.ObjectId, edited.RecordedBy);
        Assert.Equal(setup.Other.ObjectId, edited.EndedBy);
        Assert.Equal(setup.Owner.ObjectId, edited.LastEditedBy);
    }

    [SqlFact]
    public async Task CrossMemberCompletionIsNarrowAndFeedMayUseFinalMeasuredAmount()
    {
        var setup = await Setup();
        var sleep = Sleep("protected-sleep", "2026-09-19T11:00:00Z", note: "Starter note");
        await setup.Apply(setup.Caregiver, Create(setup, setup.CaregiverGrant, sleep));
        var activeSleep = await setup.Entry("protected-sleep");
        var changed = JsonNode.Parse(Sleep("protected-sleep", "2026-09-19T11:00:00Z",
            "2026-09-19T11:30:00Z", "Changed by finisher").GetRawText())!;
        await Code("record_forbidden", () => setup.Apply(setup.Other,
            Update(setup, setup.OtherGrant, activeSleep, FullDomainTests.Json(changed.ToJsonString()))));

        var feed = Feed("shared-feed", "2026-09-19T12:00:00Z", 0, running: true);
        await setup.Apply(setup.Caregiver, Create(setup, setup.CaregiverGrant, feed));
        var activeFeed = await setup.Entry("shared-feed");
        var completedFeed = Feed("shared-feed", "2026-09-19T12:00:00Z", 145,
            end: "2026-09-19T12:18:00Z");

        await setup.Apply(setup.Other, Update(setup, setup.OtherGrant, activeFeed, completedFeed));

        var stored = await setup.Entry("shared-feed");
        Assert.Equal(145m, stored.Entry.GetProperty("amount").GetDecimal());
        Assert.Equal(setup.Caregiver.ObjectId, stored.RecordedBy);
        Assert.Equal(setup.Other.ObjectId, stored.EndedBy);
    }

    [SqlFact]
    public async Task CompletionReleasesSingleTimerGuardAndConcurrentFinishHasOneWinner()
    {
        var setup = await Setup(enforceSingleActiveTimers: true);
        var first = Sleep("first-sleep", "2026-09-19T13:00:00Z");
        await setup.Apply(setup.Caregiver, Create(setup, setup.CaregiverGrant, first));
        await Code("active_timer_conflict", () => setup.Apply(setup.Owner,
            Create(setup, setup.OwnerGrant, Sleep("blocked-sleep", "2026-09-19T13:01:00Z"))));
        var active = await setup.Entry("first-sleep");
        var completed = Sleep("first-sleep", "2026-09-19T13:00:00Z", "2026-09-19T13:10:00Z");
        var outcomes = await Task.WhenAll(
            Capture(() => setup.Apply(setup.Other, Update(setup, setup.OtherGrant, active, completed))),
            Capture(() => setup.Apply(setup.Owner, Update(setup, setup.OwnerGrant, active, completed))));
        Assert.Single(outcomes, x => x == "ok");
        Assert.Single(outcomes, x => x == "record_changed");

        await setup.Apply(setup.Owner,
            Create(setup, setup.OwnerGrant, Sleep("next-sleep", "2026-09-19T13:11:00Z")));
        Assert.Equal(2, (await setup.Snapshot()).Entries.Length);
    }

    [SqlFact]
    public async Task CrossMemberSubMinuteSleepStopCompletesWithAttributionAndDeleteRemainsForbidden()
    {
        var setup = await Setup();
        var sleep = Sleep("quick-sleep", "2026-09-19T14:00:00Z");
        await setup.Apply(setup.Caregiver, Create(setup, setup.CaregiverGrant, sleep));
        var active = await setup.Entry("quick-sleep");
        var delete = Delete(setup, setup.OtherGrant, active);

        await Code("record_forbidden", () => setup.Apply(setup.Other, delete));
        await setup.Apply(setup.Other, Update(setup, setup.OtherGrant, active,
            Sleep("quick-sleep", "2026-09-19T14:00:00Z", "2026-09-19T14:00:30Z")));

        var completed = await setup.Entry("quick-sleep");
        Assert.Equal("2026-09-19T14:00:30Z", completed.Entry.GetProperty("end").GetString());
        Assert.Equal(setup.Caregiver.ObjectId, completed.RecordedBy);
        Assert.Equal(setup.Other.ObjectId, completed.EndedBy);

        var own = Sleep("own-quick-delete", "2026-09-19T14:01:00Z");
        await setup.Apply(setup.Caregiver, Create(setup, setup.CaregiverGrant, own));
        var ownActive = await setup.Entry("own-quick-delete");
        await setup.Apply(setup.Caregiver, Delete(setup, setup.CaregiverGrant, ownActive));
        Assert.DoesNotContain((await setup.Snapshot()).Entries,
            x => x.Entry.GetProperty("id").GetString() == "own-quick-delete");
    }

    private async Task<TimerSetup> Setup(bool enforceSingleActiveTimers = false)
    {
        var scenario = new Scenario(sql);
        scenario.Config.Family.EnforceSingleActiveTimers = enforceSingleActiveTimers;
        var created = await scenario.Call(x => x.CreateFullFamily(scenario.Owner,
            new(Guid.NewGuid(), "family-sharing-v1",
                FullDomainTests.Seed([scenario.Caregiver.Email, scenario.Other.Email], [], [])), default));
        var caregiver = await scenario.Call(x => x.AcceptInvitation(scenario.Caregiver,
            created.Snapshot.Invitations.Single(x => x.Email == scenario.Caregiver.Email).Id,
            new(Guid.NewGuid(), RequiredSchemaVersion: 2), default));
        var other = await scenario.Call(x => x.AcceptInvitation(scenario.Other,
            created.Snapshot.Invitations.Single(x => x.Email == scenario.Other.Email).Id,
            new(Guid.NewGuid(), RequiredSchemaVersion: 2), default));
        return new(scenario, created.Snapshot.Family, caregiver, other);
    }

    private static FullRecordOperation Create(TimerSetup setup, FamilySummary grant, JsonElement entry) =>
        new(Guid.NewGuid(), entry.GetProperty("id").GetString()!, grant.MembershipId,
            setup.HistoryId, "create", "entry", null, entry, null);

    private static FullRecordOperation Update(TimerSetup setup, FamilySummary grant, SharedEntry current,
        JsonElement entry) => new(Guid.NewGuid(), current.Entry.GetProperty("id").GetString()!,
        grant.MembershipId, setup.HistoryId, "update", "entry", current.Version, entry, null);

    private static FullRecordOperation Delete(TimerSetup setup, FamilySummary grant, SharedEntry current) =>
        new(Guid.NewGuid(), current.Entry.GetProperty("id").GetString()!, grant.MembershipId,
            setup.HistoryId, "delete", "entry", current.Version, null, null);

    private static JsonElement Sleep(string id, string start, string? end = null, string note = "") =>
        end is null
            ? JsonSerializer.SerializeToElement(new { id, type = "sleep", start, note })
            : JsonSerializer.SerializeToElement(new { id, type = "sleep", start, end, note });

    private static JsonElement Feed(string id, string start, decimal amount, bool running = false,
        string? end = null) => running
        ? JsonSerializer.SerializeToElement(new
        {
            id, type = "feed", start, feedKind = "formula", amount, feedRunning = true, note = ""
        })
        : JsonSerializer.SerializeToElement(new
        {
            id, type = "feed", start, end, feedKind = "formula", amount, note = ""
        });

    private static async Task Code(string expected, Func<Task> action)
    {
        var error = await Assert.ThrowsAsync<ApiException>(action);
        Assert.Equal(expected, error.Code);
    }

    private static async Task<string> Capture(Func<Task> action)
    {
        try { await action(); return "ok"; }
        catch (ApiException error) { return error.Code; }
    }

    private sealed class TimerSetup(Scenario scenario, FamilySummary ownerGrant,
        FamilySummary caregiverGrant, FamilySummary otherGrant)
    {
        public PilotIdentity Owner => scenario.Owner;
        public PilotIdentity Caregiver => scenario.Caregiver;
        public PilotIdentity Other => scenario.Other;
        public FamilySummary OwnerGrant => ownerGrant;
        public FamilySummary CaregiverGrant => caregiverGrant;
        public FamilySummary OtherGrant => otherGrant;
        public Guid FamilyId => ownerGrant.Id;
        public Guid HistoryId => scenario.Config.Family.HistoryId;
        public Task<FeedReceipt> Apply(PilotIdentity identity, FullRecordOperation operation) =>
            scenario.Call(x => x.ApplyFullRecord(identity, FamilyId, operation, default));
        public Task<FullFamilySnapshot> Snapshot() =>
            scenario.Call(x => x.FullSnapshot(scenario.Owner, FamilyId, default));
        public async Task<SharedEntry> Entry(string id) =>
            (await Snapshot()).Entries.Single(x => x.Entry.GetProperty("id").GetString() == id);
    }
}
