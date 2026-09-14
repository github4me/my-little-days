using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace LittleDays.FamilyApi.Tests;

public sealed class SqlFactAttribute : FactAttribute
{
    public SqlFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("FAMILY_TEST_SQL_CONNECTION")))
            Skip = "Set FAMILY_TEST_SQL_CONNECTION to a disposable SQL Server/master login with CREATE DATABASE permission. SQL behavior is not simulated.";
    }
}

public sealed class SqlFixture : IAsyncLifetime
{
    private readonly string databaseName = "LittleDaysPilotTests_" + Guid.NewGuid().ToString("N");
    private string? adminConnection;
    public string ConnectionString { get; private set; } = "";
    private bool created;

    public async Task InitializeAsync()
    {
        var supplied = Environment.GetEnvironmentVariable("FAMILY_TEST_SQL_CONNECTION");
        if (string.IsNullOrWhiteSpace(supplied)) return;
        var builder = new SqlConnectionStringBuilder(supplied);
        if (builder.InitialCatalog is not ("" or "master"))
            throw new InvalidOperationException("Test connection must target master; the fixture creates its own isolated database.");
        builder.InitialCatalog = "master";
        adminConnection = builder.ConnectionString;
        await using var connection = new SqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var create = new SqlCommand($"CREATE DATABASE [{databaseName}]", connection);
        await create.ExecuteNonQueryAsync();
        created = true;
        builder.InitialCatalog = databaseName;
        ConnectionString = builder.ConnectionString;
        await using var db = Open();
        await db.Database.MigrateAsync();
    }

    public PilotDatabase Open() => new(new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(ConnectionString).Options);
    public async Task<T> Call<T>(PilotConfiguration config, Func<FamilyService, Task<T>> action, TimeProvider? clock = null)
    {
        await using var db = Open();
        return await action(new FamilyService(db, config, clock ?? TimeProvider.System));
    }

    public async Task DisposeAsync()
    {
        if (!created || adminConnection is null) return;
        // The only deletion target is this fixture's exact, generated DB. Never use caller input as a name.
        if (!System.Text.RegularExpressions.Regex.IsMatch(databaseName, "^LittleDaysPilotTests_[a-f0-9]{32}$"))
            throw new InvalidOperationException("Refusing invalid test cleanup target.");
        SqlConnection.ClearAllPools();
        await using var connection = new SqlConnection(adminConnection);
        await connection.OpenAsync();
        await using var drop = new SqlCommand($"ALTER DATABASE [{databaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{databaseName}]", connection);
        await drop.ExecuteNonQueryAsync();
    }
}

public sealed class Scenario(SqlFixture sql)
{
    public PilotConfiguration Config { get; } = new(
        new() { TenantId = Guid.NewGuid(), Audience = Guid.NewGuid(), MobileClientId = Guid.NewGuid() },
        new() { PublicBaseUrl = "https://pilot.example.test", HistoryId = Guid.NewGuid() },
        new() { Identities = [Identity("Owner"), Identity("Caregiver"), Identity("Other")] });
    public PilotIdentity Owner => Config.Pilot.Identities[0];
    public PilotIdentity Caregiver => Config.Pilot.Identities[1];
    public PilotIdentity Other => Config.Pilot.Identities[2];
    public Task<T> Call<T>(Func<FamilyService, Task<T>> action) => sql.Call(Config, action);
    public Task<FamilySummary> Create() => Call(x => x.CreateFamily(Owner, new(Guid.NewGuid(), "Test baby"), default));
    public async Task<InvitationResult> Invite(Guid familyId)
    {
        var family = (await Call(x => x.Snapshot(Owner, familyId, default))).Family;
        return await Call(x => x.CreateInvitation(Owner, familyId, Invitation(family, Caregiver.Email), default));
    }
    public CreateInvitationRequest Invitation(FamilySummary family, string email, Guid? operationId = null) =>
        new(operationId ?? Guid.NewGuid(), email, family.MembershipId, Config.Family.HistoryId);
    public OperationRequest Context(FamilySummary family, Guid? operationId = null, Guid? target = null) =>
        new(operationId ?? Guid.NewGuid(), family.MembershipId, Config.Family.HistoryId, target);
    public async Task<OkResult> Remove(FamilySummary family, Guid userId)
    {
        var snapshot = await Call(x => x.Snapshot(Owner, family.Id, default));
        var target = snapshot.Members.SingleOrDefault(x => x.Id == userId && x.Status == "active")?.MembershipId ?? Guid.NewGuid();
        return await Call(x => x.RemoveMember(Owner, family.Id, userId, Context(family, target: target), default));
    }
    public async Task<OkResult> Leave(PilotIdentity user, Guid familyId)
    {
        var family = (await Call(x => x.Snapshot(user, familyId, default))).Family;
        return await Call(x => x.Leave(user, familyId, Context(family), default));
    }
    public Task<FamilySummary> Accept(InvitationResult invite, Guid? operationId = null) => Call(x => x.AcceptInvitation(Caregiver, invite.Invitation.Id, new(operationId ?? Guid.NewGuid()), default));
    public static SharedFeedInput Feed(decimal amount = 100) => new(DateTimeOffset.UtcNow.AddMinutes(-30), DateTimeOffset.UtcNow.AddMinutes(-20), amount, "Synthetic pilot feed");
    public FeedOperation CreateFeed(FamilySummary grant, SharedFeedInput? feed = null) =>
        new(Guid.NewGuid(), Guid.NewGuid(), grant.MembershipId, Config.Family.HistoryId, "create", null, feed ?? Feed());
    private static PilotIdentity Identity(string name) => new() { ObjectId = Guid.NewGuid(), Email = name.ToLowerInvariant() + "." + Guid.NewGuid().ToString("N") + "@example.test", DisplayName = name };
}
