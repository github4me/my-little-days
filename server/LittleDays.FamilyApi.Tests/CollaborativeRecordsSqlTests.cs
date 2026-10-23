using System.Text.Json;
using System.Text.Json.Nodes;

namespace LittleDays.FamilyApi.Tests;

// Must run against a disposable SQL Server. In-memory mocks cannot establish
// transaction ordering, rowversions, durable replay, membership or tombstones.
public sealed class CollaborativeRecordsSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    private static JsonElement Note(JsonElement entry, string note)
    {
        var node = JsonNode.Parse(entry.GetRawText())!;
        node["note"] = note;
        return FullDomainTests.Json(node.ToJsonString());
    }
    private static FullRecordOperation Update(CreateFullFamilyResult family, FamilySummary grant,
        SharedEntry entry, string note) => new(Guid.NewGuid(), entry.Entry.GetProperty("id").GetString()!,
        grant.MembershipId, family.HistoryId, "update", "entry", entry.Version, Note(entry.Entry, note), null,
        EditPolicy: RecordEditingPolicy.LastServerSaveWins);
    private static async Task<(CreateFullFamilyResult Family, FamilySummary Grant)> Join(Scenario s)
    {
        var family = await s.Call(x => x.CreateFullFamily(s.Owner,
            new(Guid.NewGuid(), "family-sharing-v1", FullDomainTests.Seed([s.Caregiver.Email])), default));
        var grant = await s.Call(x => x.AcceptInvitation(s.Caregiver, Assert.Single(family.Snapshot.Invitations).Id,
            new(Guid.NewGuid()), default));
        return (family, grant);
    }
    private static async Task Code(string expected, Func<Task> action) =>
        Assert.Equal(expected, (await Assert.ThrowsAsync<ApiException>(action)).Code);

    [SqlFact]
    public async Task LastServerSaveWinsAcrossAuthorsAndReplaysNeverUndoLaterSaves()
    {
        var s = new Scenario(sql);
        var (family, member) = await Join(s);
        var entry = family.Snapshot.Entries[0];
        var ownerSave = Update(family, family.Snapshot.Family, entry, "First accepted");
        await s.Call(x => x.ApplyFullRecord(s.Owner, family.FamilyId, ownerSave, default));
        var lateOfflineSave = Update(family, member, entry, "Later accepted from stale base");
        var receipt = await s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId, lateOfflineSave, default));
        var after = await s.Call(x => x.FullSnapshot(s.Owner, family.FamilyId, default));
        Assert.True(after.CollaborativeEditingEnabled);
        var saved = after.Entries.Single(x => x.Entry.GetProperty("id").GetString() == lateOfflineSave.RecordId);
        Assert.Equal("Later accepted from stale base", saved.Entry.GetProperty("note").GetString());
        Assert.Equal(s.Owner.ObjectId, saved.RecordedBy);
        Assert.Equal(s.Caregiver.ObjectId, saved.LastEditedBy);
        Assert.NotEqual(entry.Version, saved.Version);
        await s.Call(x => x.ApplyFullRecord(s.Owner, family.FamilyId, Update(family, family.Snapshot.Family, entry, "Latest accepted"), default));
        Assert.Equal(receipt, await s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId, lateOfflineSave, default)));
        var final = await s.Call(x => x.FullSnapshot(s.Owner, family.FamilyId, default));
        Assert.Equal("Latest accepted", final.Entries.Single(x => x.Entry.GetProperty("id").GetString() == lateOfflineSave.RecordId).Entry.GetProperty("note").GetString());
        Assert.Equal(after.Revision, receipt.Revision);
        await Code("operation_reused", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId,
            lateOfflineSave with { Entry = Note(entry.Entry, "Changed replay") }, default)));
    }

    [SqlFact]
    public async Task ConcurrentCollaborativeSavesBothSucceedAndHigherReceiptRevisionDeterminesTheWinner()
    {
        var s = new Scenario(sql);
        var (family, member) = await Join(s);
        var entry = family.Snapshot.Entries[0];
        var ownerSave = Update(family, family.Snapshot.Family, entry, "Owner save");
        var memberSave = Update(family, member, entry, "Member save");
        var receipts = await Task.WhenAll(
            s.Call(x => x.ApplyFullRecord(s.Owner, family.FamilyId, ownerSave, default)),
            s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId, memberSave, default)));
        Assert.NotEqual(receipts[0].Revision, receipts[1].Revision);
        var memberWon = long.Parse(receipts[1].Revision, System.Globalization.CultureInfo.InvariantCulture) >
            long.Parse(receipts[0].Revision, System.Globalization.CultureInfo.InvariantCulture);
        var snapshot = await s.Call(x => x.FullSnapshot(s.Owner, family.FamilyId, default));
        var current = snapshot.Entries.Single(x => x.Entry.GetProperty("id").GetString() == ownerSave.RecordId);
        Assert.Equal(memberWon ? "Member save" : "Owner save", current.Entry.GetProperty("note").GetString());
        Assert.Equal(memberWon ? s.Caregiver.ObjectId : s.Owner.ObjectId, current.LastEditedBy);
        Assert.Equal(s.Owner.ObjectId, current.RecordedBy);
        Assert.Equal(memberWon ? receipts[1].Revision : receipts[0].Revision, snapshot.Revision);
    }

    [SqlFact]
    public async Task CollaboratorsDeleteOtherAuthorsRecordsButStaleDeleteCannotEraseNewerEdit()
    {
        var s = new Scenario(sql);
        var (family, member) = await Join(s);
        var entry = family.Snapshot.Entries[0];
        var staleDelete = new FullRecordOperation(Guid.NewGuid(), entry.Entry.GetProperty("id").GetString()!, member.MembershipId,
            family.HistoryId, "delete", "entry", entry.Version, null, null);
        await s.Call(x => x.ApplyFullRecord(s.Owner, family.FamilyId, Update(family, family.Snapshot.Family, entry, "Newer version"), default));
        await Code("record_changed", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId, staleDelete, default)));
        var current = (await s.Call(x => x.FullSnapshot(s.Caregiver, family.FamilyId, default))).Entries.Single(x => x.Entry.GetProperty("id").GetString() == staleDelete.RecordId);
        Assert.Equal("Newer version", current.Entry.GetProperty("note").GetString());
        var delete = staleDelete with { OperationId = Guid.NewGuid(), BaseVersion = current.Version };
        var receipt = await s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId, delete, default));
        Assert.Equal(receipt, await s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId, delete, default)));
        var after = await s.Call(x => x.FullSnapshot(s.Owner, family.FamilyId, default));
        Assert.DoesNotContain(after.Entries, x => x.Entry.GetProperty("id").GetString() == delete.RecordId);
        await Code("record_changed", () => s.Call(x => x.ApplyFullRecord(s.Owner, family.FamilyId, Update(family, family.Snapshot.Family, entry, "Cannot resurrect"), default)));
        await Code("record_changed", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId,
            new(Guid.NewGuid(), delete.RecordId, member.MembershipId, family.HistoryId, "create", "entry", null, entry.Entry, null), default)));
    }

    [SqlFact]
    public async Task SharedCareAndExtrasCanBeEditedAndDeletedByAnotherMember()
    {
        var s = new Scenario(sql);
        var (family, member) = await Join(s);
        var care = Assert.Single(family.Snapshot.CareRecords);
        var extra = FullDomainTests.Json("""{"id":"checkin","kind":"play-checkin","day":"2026-10-24","activityId":"face"}""");
        await s.Call(x => x.ApplyFullRecord(s.Owner, family.FamilyId,
            new(Guid.NewGuid(), "checkin", family.MembershipId, family.HistoryId, "create", "extra", null, null, null, extra), default));
        var snapshot = await s.Call(x => x.FullSnapshot(s.Owner, family.FamilyId, default));
        var checkin = Assert.Single(snapshot.ExtraRecords!);
        var changedExtra = FullDomainTests.Json("""{"id":"checkin","kind":"play-checkin","day":"2026-10-24","activityId":"smile"}""");
        var operations = new[] {
            new FullRecordOperation(Guid.NewGuid(), "care-id", member.MembershipId, family.HistoryId, "update", "care", care.Version, null, Note(care.Record, "Shared edit"), EditPolicy: RecordEditingPolicy.LastServerSaveWins),
            new FullRecordOperation(Guid.NewGuid(), "checkin", member.MembershipId, family.HistoryId, "update", "extra", checkin.Version, null, null, changedExtra, EditPolicy: RecordEditingPolicy.LastServerSaveWins)
        };
        foreach (var operation in operations) await s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId, operation, default));
        snapshot = await s.Call(x => x.FullSnapshot(s.Owner, family.FamilyId, default));
        Assert.Equal("Shared edit", Assert.Single(snapshot.CareRecords).Record.GetProperty("note").GetString());
        Assert.Equal(s.Owner.ObjectId, Assert.Single(snapshot.CareRecords).RecordedBy);
        Assert.Equal(s.Caregiver.ObjectId, Assert.Single(snapshot.CareRecords).LastEditedBy);
        Assert.Equal("smile", Assert.Single(snapshot.ExtraRecords!).Record.GetProperty("activityId").GetString());
        foreach (var operation in operations)
        {
            var version = operation.Collection == "care" ? Assert.Single(snapshot.CareRecords).Version : Assert.Single(snapshot.ExtraRecords!).Version;
            await s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId, operation with {
                OperationId = Guid.NewGuid(), Kind = "delete", BaseVersion = version, CareRecord = null, ExtraRecord = null, EditPolicy = null
            }, default));
        }
        snapshot = await s.Call(x => x.FullSnapshot(s.Owner, family.FamilyId, default));
        Assert.Empty(snapshot.CareRecords);
        Assert.Empty(snapshot.ExtraRecords!);
    }

    [SqlFact]
    public async Task CollaborationPreservesMembershipHistoryAdminAndLegacyUpdateGuards()
    {
        var s = new Scenario(sql);
        var (family, member) = await Join(s);
        var operation = Update(family, member, family.Snapshot.Entries[0], "Shared edit");
        await Code("record_forbidden", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId, operation with { EditPolicy = null }, default)));
        await Code("history_changed", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId, operation with { HistoryId = Guid.NewGuid() }, default)));
        await Code("forbidden", () => s.Call(x => x.UpdateFullProfile(s.Caregiver, family.FamilyId,
            new(Guid.NewGuid(), member.MembershipId, family.HistoryId, member.ProfileVersion, FullDomainTests.Profile()), default)));
        await s.Remove(family.Snapshot.Family, s.Caregiver.ObjectId);
        await Code("membership_revoked", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId, operation, default)));
        var rejoined = await s.Accept(await s.Invite(family.FamilyId));
        Assert.NotEqual(member.MembershipId, rejoined.MembershipId);
        await Code("membership_changed", () => s.Call(x => x.ApplyFullRecord(s.Caregiver, family.FamilyId, operation, default)));
    }
}
