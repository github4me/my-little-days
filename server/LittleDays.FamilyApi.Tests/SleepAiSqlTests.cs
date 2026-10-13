using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi.Tests;

// Uses only the existing isolated disposable SQL fixture; never the app's connection.
public sealed class SleepAiSqlTests(SqlFixture sql) : IClassFixture<SqlFixture>
{
    [SqlFact]
    public async Task PersonalAiAuthorizationDoesNotCreateFamilyAndDeniesDeletedAccount()
    {
        var scenario = new Scenario(sql); var request = Personal();
        await using var db = sql.Open();
        var familiesBefore = await db.Families.CountAsync();
        var membersBefore = await db.Memberships.CountAsync();
        Assert.True(await scenario.Call(service => service.AuthorizeSleepPrediction(scenario.Owner, request, default)));
        Assert.Equal(familiesBefore, await db.Families.CountAsync()); Assert.Equal(membersBefore, await db.Memberships.CountAsync());
        await scenario.Call(service => service.DeleteAccount(scenario.Owner,
            new DeleteAccountRequest(Guid.NewGuid(), new string('a', 64)), default));
        var error = await Assert.ThrowsAsync<ApiException>(() => scenario.Call(service => service.AuthorizeSleepPrediction(scenario.Owner, request, default)));
        Assert.Equal(410, error.Status); Assert.Equal("account_deleted", error.Code);
    }

    [SqlFact]
    public async Task FamilyAiAuthorizationRequiresCurrentGrantAndHistoryAndRechecksRevocation()
    {
        var scenario = new Scenario(sql); var family = await scenario.Create();
        var invite = await scenario.Invite(family.Id); var member = await scenario.Accept(invite);
        var request = Personal() with { FamilyId = family.Id, MembershipId = member.MembershipId, HistoryId = scenario.Config.Family.HistoryId };
        Assert.True(await scenario.Call(service => service.AuthorizeSleepPrediction(scenario.Caregiver, request, default)));
        var history = await Assert.ThrowsAsync<ApiException>(() => scenario.Call(service => service.AuthorizeSleepPrediction(scenario.Caregiver, request with { HistoryId = Guid.NewGuid() }, default)));
        Assert.Equal("history_changed", history.Code);
        var grant = await Assert.ThrowsAsync<ApiException>(() => scenario.Call(service => service.AuthorizeSleepPrediction(scenario.Caregiver, request with { MembershipId = Guid.NewGuid() }, default)));
        Assert.Equal("membership_changed", grant.Code);
        await scenario.Remove(family, scenario.Caregiver.ObjectId);
        var revoked = await Assert.ThrowsAsync<ApiException>(() => scenario.Call(service => service.AuthorizeSleepPrediction(scenario.Caregiver, request, default)));
        Assert.Equal(403, revoked.Status); Assert.Equal("membership_revoked", revoked.Code);
    }

    private static SleepPredictionRequest Personal() => new()
    {
        SchemaVersion = 1, InputRevision = new('a', 64), ConsentVersion = "sleep-ai-v1", FamilyId = null,
        MembershipId = null, HistoryId = null, AgeDays = 100, TimeZone = "UTC", Now = DateTimeOffset.UtcNow, Records = []
    };
}
