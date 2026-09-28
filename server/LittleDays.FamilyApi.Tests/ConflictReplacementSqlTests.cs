using System.Text.Json;

namespace LittleDays.FamilyApi.Tests;

public sealed class ConflictReplacementSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task ReviewedFeedConflictReplacesExactIntentAndRecordsBoundedAudit()
    {
        var setup = await Setup();
        await setup.Apply(setup.Caregiver, Create(setup, setup.CaregiverGrant,
            Feed("shared-feed", 90, "Original")));
        var original = await setup.Entry("shared-feed");

        await setup.Apply(setup.Owner, Update(setup, setup.OwnerGrant, original,
            Feed("shared-feed", 100, "Family version")));
        var stale = Update(setup, setup.CaregiverGrant, original,
            Feed("shared-feed", 140, "My reviewed change"));

        await Error("record_changed", 412, () => setup.Apply(setup.Caregiver, stale));
        await Error("record_changed", 412, () => setup.Apply(setup.Caregiver, stale));
        var current = await setup.Entry("shared-feed");

        var forged = stale with
        {
            OperationId = Guid.NewGuid(),
            BaseVersion = current.Version,
            ReplacesOperationId = stale.OperationId,
            Entry = Feed("shared-feed", 141, "A payload not reviewed in the conflict")
        };
        await Error("conflict_resolution_changed", 409,
            () => setup.Apply(setup.Caregiver, forged));

        var replacement = stale with
        {
            OperationId = Guid.NewGuid(),
            BaseVersion = current.Version,
            ReplacesOperationId = stale.OperationId
        };
        var receipt = await setup.Apply(setup.Caregiver, replacement);
        Assert.Equal(replacement.OperationId, receipt.OperationId);

        var replaced = await setup.Entry("shared-feed");
        Assert.Equal(140m, replaced.Entry.GetProperty("amount").GetDecimal());
        Assert.Equal("My reviewed change", replaced.Entry.GetProperty("note").GetString());
        Assert.Equal(setup.Caregiver.ObjectId, replaced.RecordedBy);
        Assert.Equal(setup.Caregiver.ObjectId, replaced.LastEditedBy);
        Assert.NotNull(replaced.Replacement);
        Assert.Equal(setup.Caregiver.ObjectId, replaced.Replacement!.ReplacedBy);
        Assert.Equal(setup.Owner.ObjectId, replaced.Replacement.PreviousEditedBy);
        Assert.Equal("feed", replaced.Replacement.PreviousEntry.Type);
        Assert.Equal(100m, replaced.Replacement.PreviousEntry.Amount);
        Assert.True(replaced.Replacement.PreviousEntry.NoteChanged);

        var later = Update(setup, setup.OwnerGrant, replaced,
            Feed("shared-feed", 145, "Ordinary later edit"));
        await setup.Apply(setup.Owner, later);
        Assert.Null((await setup.Entry("shared-feed")).Replacement);
    }

    [SqlFact]
    public async Task ASecondRaceRequiresAnotherReviewAndChainsTheDurableConflictReceipt()
    {
        var setup = await Setup();
        await setup.Apply(setup.Caregiver, Create(setup, setup.CaregiverGrant,
            Feed("racing-feed", 90, "Original")));
        var original = await setup.Entry("racing-feed");
        await setup.Apply(setup.Owner, Update(setup, setup.OwnerGrant, original,
            Feed("racing-feed", 100, "First winner")));
        var firstConflict = Update(setup, setup.CaregiverGrant, original,
            Feed("racing-feed", 140, "Reviewed intent"));
        await Error("record_changed", 412,
            () => setup.Apply(setup.Caregiver, firstConflict));
        var firstReviewed = await setup.Entry("racing-feed");

        await setup.Apply(setup.Owner, Update(setup, setup.OwnerGrant, firstReviewed,
            Feed("racing-feed", 110, "Second winner")));
        var firstReplacement = firstConflict with
        {
            OperationId = Guid.NewGuid(),
            BaseVersion = firstReviewed.Version,
            ReplacesOperationId = firstConflict.OperationId
        };
        await Error("record_changed", 412,
            () => setup.Apply(setup.Caregiver, firstReplacement));

        var secondReviewed = await setup.Entry("racing-feed");
        var secondReplacement = firstReplacement with
        {
            OperationId = Guid.NewGuid(),
            BaseVersion = secondReviewed.Version,
            ReplacesOperationId = firstReplacement.OperationId
        };
        await setup.Apply(setup.Caregiver, secondReplacement);

        var final = await setup.Entry("racing-feed");
        Assert.Equal(140m, final.Entry.GetProperty("amount").GetDecimal());
        Assert.Equal(110m, final.Replacement!.PreviousEntry.Amount);
        Assert.Equal(setup.Owner.ObjectId, final.Replacement.PreviousEditedBy);
    }

    [SqlFact]
    public async Task AnyActiveMemberMayResolveOnlyTheirCompetingTimerCompletion()
    {
        var setup = await Setup();
        await setup.Apply(setup.Caregiver, Create(setup, setup.CaregiverGrant,
            Sleep("shared-sleep", "2026-09-21T10:00:00Z")));
        var active = await setup.Entry("shared-sleep");
        await setup.Apply(setup.Owner, Update(setup, setup.OwnerGrant, active,
            Sleep("shared-sleep", "2026-09-21T10:00:00Z", "2026-09-21T10:30:00Z"),
            timerCompletion: "sleep"));

        var unrelated = Update(setup, setup.OtherGrant, active,
            Sleep("shared-sleep", "2026-09-21T10:00:00Z", "2026-09-21T10:40:00Z", "Changed note"),
            timerCompletion: "sleep");
        await Error("record_changed", 412, () => setup.Apply(setup.Other, unrelated));
        var current = await setup.Entry("shared-sleep");
        await Error("conflict_resolution_unavailable", 409, () => setup.Apply(setup.Other,
            unrelated with
            {
                OperationId = Guid.NewGuid(),
                BaseVersion = current.Version,
                ReplacesOperationId = unrelated.OperationId
            }));

        var competing = Update(setup, setup.OtherGrant, active,
            Sleep("shared-sleep", "2026-09-21T10:00:00Z", "2026-09-21T10:40:00Z"),
            timerCompletion: "sleep");
        await Error("record_changed", 412, () => setup.Apply(setup.Other, competing));
        current = await setup.Entry("shared-sleep");
        await setup.Apply(setup.Other, competing with
        {
            OperationId = Guid.NewGuid(),
            BaseVersion = current.Version,
            ReplacesOperationId = competing.OperationId
        });

        var replaced = await setup.Entry("shared-sleep");
        Assert.Equal("2026-09-21T10:40:00Z", replaced.Entry.GetProperty("end").GetString());
        Assert.Equal(setup.Caregiver.ObjectId, replaced.RecordedBy);
        Assert.Equal(setup.Other.ObjectId, replaced.EndedBy);
        Assert.Equal(setup.Other.ObjectId, replaced.Replacement!.ReplacedBy);
        Assert.Equal(setup.Owner.ObjectId, replaced.Replacement.PreviousEditedBy);
        Assert.Equal(DateTimeOffset.Parse("2026-09-21T10:30:00Z"),
            replaced.Replacement.PreviousEntry.End);
    }

    private async Task<ReplacementSetup> Setup()
    {
        var scenario = new Scenario(sql);
        var created = await scenario.Call(x => x.CreateFullFamily(scenario.Owner,
            new(Guid.NewGuid(), "family-sharing-v1",
                FullDomainTests.Seed([scenario.Caregiver.Email, scenario.Other.Email], [], [])), default));
        var caregiver = await scenario.Call(x => x.AcceptInvitation(scenario.Caregiver,
            created.Snapshot.Invitations.Single(x => x.Email == scenario.Caregiver.Email).Id,
            new(Guid.NewGuid(), RequiredSchemaVersion: 2), default));
        var other = await scenario.Call(x => x.AcceptInvitation(scenario.Other,
            created.Snapshot.Invitations.Single(x => x.Email == scenario.Other.Email).Id,
            new(Guid.NewGuid(), RequiredSchemaVersion: 2), default));
        Assert.True(created.Snapshot.ConflictReplacementEnabled);
        return new(scenario, created.Snapshot.Family, caregiver, other);
    }

    private static FullRecordOperation Create(ReplacementSetup setup, FamilySummary grant, JsonElement entry) =>
        new(Guid.NewGuid(), entry.GetProperty("id").GetString()!, grant.MembershipId,
            setup.HistoryId, "create", "entry", null, entry, null);

    private static FullRecordOperation Update(ReplacementSetup setup, FamilySummary grant, SharedEntry current,
        JsonElement entry, string? timerCompletion = null) =>
        new(Guid.NewGuid(), current.Entry.GetProperty("id").GetString()!, grant.MembershipId,
            setup.HistoryId, "update", "entry", current.Version, entry, null,
            TimerCompletion: timerCompletion);

    private static JsonElement Feed(string id, decimal amount, string note) =>
        JsonSerializer.SerializeToElement(new
        {
            id, type = "feed", start = "2026-09-21T09:00:00Z", end = "2026-09-21T09:20:00Z",
            feedKind = "formula", amount, note
        });

    private static JsonElement Sleep(string id, string start, string? end = null, string note = "") =>
        end is null
            ? JsonSerializer.SerializeToElement(new { id, type = "sleep", start, note })
            : JsonSerializer.SerializeToElement(new { id, type = "sleep", start, end, note });

    private static async Task Error(string code, int status, Func<Task> action)
    {
        var error = await Assert.ThrowsAsync<ApiException>(action);
        Assert.Equal(code, error.Code);
        Assert.Equal(status, error.Status);
    }

    private sealed class ReplacementSetup(Scenario scenario, FamilySummary ownerGrant,
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
