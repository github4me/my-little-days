using DbUp.Engine;
using LittleDays.DatabaseMigrator;
using LittleDays.FamilyApi;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace LittleDays.DatabaseMigrator.Tests;

public sealed class SqlFactAttribute : FactAttribute
{
    public SqlFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("FAMILY_TEST_SQL_CONNECTION")))
            Skip = "Set FAMILY_TEST_SQL_CONNECTION to a disposable SQL Server/master connection.";
    }
}

public sealed class MigrationTests
{
    [Fact]
    public void ValidatesTargetsAndImmutableScriptNames()
    {
        MigrationRunner.ValidateAzureTarget("little-days-sql-522fpstfbtds2.database.windows.net", "little-days-family", Guid.NewGuid().ToString());
        Assert.Throws<InvalidOperationException>(() => MigrationRunner.ValidateAzureTarget("localhost", "little-days-family", Guid.NewGuid().ToString()));
        Assert.Throws<InvalidOperationException>(() => MigrationRunner.ValidateAzureTarget("valid.database.windows.net", "master", Guid.NewGuid().ToString()));
        Assert.Throws<InvalidOperationException>(() => new MigrationRunner(() => new(), "master"));
        Assert.Throws<InvalidOperationException>(() => new MigrationRunner(() => new(), "Test", scripts: [new("bad.sql", "SELECT 1")]));
        Assert.Throws<InvalidOperationException>(() => new MigrationRunner(() => new(), "Test", scripts: [new("0001_A.sql", ""), new("0001_B.sql", "")]));
        Assert.Equal(MigrationRunner.Hash("a\r\nb"), MigrationRunner.Hash("a\nb"));
    }

    [SqlFact]
    public async Task FreshCheckDoesNotWriteAndApplyIsRepeatable()
    {
        await using var db = await TestDatabase.Create();
        Assert.Equal(2, db.Runner().Pending().Count);
        Assert.Equal(0, await db.Count("SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0"));
        db.Runner().Apply();
        Assert.Equal(2, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
        Assert.Empty(db.Runner().Pending());
        db.Runner().Apply();
        Assert.Equal(2, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
        Assert.Equal(3, await db.Count("SELECT COUNT(*) FROM dbo.__EFMigrationsHistory"));
    }

    [SqlFact]
    public async Task ChangedRemovedOrInsertedHistoricalScriptsAreRejected()
    {
        await using var db = await TestDatabase.Create();
        db.Runner().Apply();
        var scripts = MigrationRunner.Scripts().ToArray();
        Assert.ThrowsAny<Exception>(() => db.Runner(scripts: [new(scripts[0].Name, scripts[0].Contents + "\n-- changed"), scripts[1]]).Pending());
        Assert.ThrowsAny<Exception>(() => db.Runner(scripts: [scripts[1]]).Pending());
        Assert.ThrowsAny<Exception>(() => db.Runner(scripts: [new("0000_Earlier.sql", "SELECT 1"), .. scripts]).Pending());
        db.Runner(scripts: [.. scripts, new("0003_AddExample.sql", "CREATE TABLE dbo.Example(Id int NOT NULL);")]).Apply();
        Assert.Equal(3, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }

    [SqlFact]
    public async Task FailureRollsBackSchemaDataAndJournalAndCanRetry()
    {
        await using var db = await TestDatabase.Create();
        var fail = new SqlScript("0003_Failure.sql", "CREATE TABLE dbo.Example(Id int); INSERT dbo.Example VALUES (1); THROW 51000, 'Synthetic failure', 1;");
        Assert.ThrowsAny<Exception>(() => db.Runner(scripts: [.. MigrationRunner.Scripts(), fail]).Apply());
        Assert.Equal(0, await db.Count("SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0"));
        db.Runner().Apply();
        Assert.ThrowsAny<Exception>(() => db.Runner(scripts: [.. MigrationRunner.Scripts(), fail]).Apply());
        Assert.Equal(0, await db.Count("SELECT COUNT(*) FROM sys.tables WHERE name='Example'"));
        Assert.Equal(2, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }

    [SqlFact]
    public async Task ExclusiveLockPreventsConcurrentMigrationsAndWrongTargetFails()
    {
        await using var db = await TestDatabase.Create();
        using var held = db.Connection();
        await held.OpenAsync();
        await using var transaction = (SqlTransaction)await held.BeginTransactionAsync();
        using var command = new SqlCommand("EXEC sys.sp_getapplock @Resource=N'MyLittleDays.DatabaseMigrator', @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=0", held, transaction);
        await command.ExecuteNonQueryAsync();
        Assert.ThrowsAny<Exception>(() => db.Runner().Apply());
        await transaction.RollbackAsync();
        Assert.ThrowsAny<Exception>(() => new MigrationRunner(db.Connection, "DifferentDatabase").Apply());
        db.Runner().Apply();
    }

    [SqlFact]
    public async Task EachHistoricalEfStageRequiresExplicitAdoptionAndPreservesRecords()
    {
        foreach (var migration in new[] { "20260913173137_InitialPilot", "20260914032522_InvitationLifecycleV2", "20260915091021_FullDomainFamiliesV2" })
        {
            await using var db = await TestDatabase.Create();
            await db.Legacy(migration);
            await db.Execute("INSERT dbo.Families(Id,BabyName,Revision,CreatedAt) VALUES ('11111111-1111-1111-1111-111111111111',N'Synthetic baby',1,SYSUTCDATETIME());");
            await db.Execute("INSERT dbo.Feeds(FamilyId,Id,Start,[End],Amount,Note,RecordedBy,LastEditedBy,Deleted) VALUES ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333',SYSUTCDATETIME(),SYSUTCDATETIME(),36.80,N'Synthetic feed','22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222',0);");
            var version = await db.Count("SELECT CHECKSUM(Version) FROM dbo.Feeds");
            Assert.ThrowsAny<Exception>(() => db.Runner().Apply());
            db.Runner(adopt: true).Apply();
            Assert.Equal(1, await db.Count("SELECT COUNT(*) FROM dbo.Families WHERE BabyName=N'Synthetic baby'"));
            Assert.Equal(1, await db.Count("SELECT COUNT(*) FROM dbo.Feeds WHERE Amount=36.80 AND Note=N'Synthetic feed'"));
            Assert.Equal(version, await db.Count("SELECT CHECKSUM(Version) FROM dbo.Feeds"));
            Assert.Equal(2, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
            Assert.Empty(db.Runner().Pending());
        }
    }

    [SqlFact]
    public async Task UnknownOrDriftedSchemaCannotBeAdopted()
    {
        await using var db = await TestDatabase.Create();
        await db.Legacy("20260915091021_FullDomainFamiliesV2");
        await db.Execute("CREATE TABLE dbo.Unknown(Id int)");
        Assert.ThrowsAny<Exception>(() => db.Runner(adopt: true).Apply());
        await db.Execute("DROP TABLE dbo.Unknown; UPDATE dbo.__EFMigrationsHistory SET MigrationId='Unknown' WHERE MigrationId='20260915091021_FullDomainFamiliesV2';");
        Assert.ThrowsAny<Exception>(() => db.Runner(adopt: true).Apply());
        await db.Execute("UPDATE dbo.__EFMigrationsHistory SET MigrationId='20260915091021_FullDomainFamiliesV2' WHERE MigrationId='Unknown'; DROP TABLE dbo.FamilyRecords;");
        Assert.ThrowsAny<Exception>(() => db.Runner(adopt: true).Apply());
        Assert.Equal(0, await db.Count("SELECT COUNT(*) FROM sys.tables WHERE name='DatabaseMigrations'"));
    }

    [SqlFact]
    public async Task UntrustedForeignKeyFailsBaselineChecksWithoutJournaling()
    {
        await using var db = await TestDatabase.Create();
        await db.Legacy("20260915091021_FullDomainFamiliesV2");
        await db.Execute("ALTER TABLE dbo.Feeds NOCHECK CONSTRAINT FK_Feeds_Families_FamilyId");
        Assert.ThrowsAny<Exception>(() => db.Runner(adopt: true).Apply());
        Assert.Equal(0, await db.Count("SELECT COUNT(*) FROM sys.tables WHERE name='DatabaseMigrations'"));
        Assert.Equal(3, await db.Count("SELECT COUNT(*) FROM dbo.__EFMigrationsHistory"));
    }

    [SqlFact]
    public async Task MissingBootstrapRollsBackAndRuntimeCannotAccessJournalOrDdl()
    {
        await using var db = await TestDatabase.Create();
        await db.Execute("DROP ROLE family_pilot_runtime");
        Assert.ThrowsAny<Exception>(() => db.Runner().Apply());
        Assert.Equal(0, await db.Count("SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0"));
        await db.Execute("CREATE ROLE family_pilot_runtime; CREATE USER RuntimeTest WITHOUT LOGIN; ALTER ROLE family_pilot_runtime ADD MEMBER RuntimeTest;");
        db.Runner().Apply();
        Assert.Equal(1, await db.Count("EXECUTE AS USER='RuntimeTest'; SELECT HAS_PERMS_BY_NAME('dbo.Feeds','OBJECT','INSERT'); REVERT;"));
        Assert.Equal(0, await db.Count("EXECUTE AS USER='RuntimeTest'; SELECT HAS_PERMS_BY_NAME('dbo','SCHEMA','ALTER'); REVERT;"));
        Assert.Equal(0, await db.Count("EXECUTE AS USER='RuntimeTest'; SELECT COALESCE(HAS_PERMS_BY_NAME('dbo.DatabaseMigrations','OBJECT','SELECT'),0); REVERT;"));
    }

    [SqlFact]
    public async Task MigrationRoleCanApplyWithoutDbOwner()
    {
        await using var db = await TestDatabase.Create();
        await db.Execute("CREATE USER MigrationTest WITHOUT LOGIN WITH DEFAULT_SCHEMA=dbo; GRANT CONNECT, CREATE TABLE TO MigrationTest; GRANT CONTROL ON SCHEMA::dbo TO MigrationTest;");
        SqlConnection Limited()
        {
            var connection = db.Connection();
            // DbUp opens this connection; impersonate as soon as it opens.
            connection.StateChange += (_, e) =>
            {
                if (e.CurrentState == System.Data.ConnectionState.Open)
                    using (var command = new SqlCommand("EXECUTE AS USER='MigrationTest'", connection)) command.ExecuteNonQuery();
            };
            return connection;
        }
        new MigrationRunner(Limited, db.Name).Apply();
        Assert.Equal(2, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }
}

internal sealed class TestDatabase : IAsyncDisposable
{
    public string Name { get; } = "LittleDaysMigrationTests_" + Guid.NewGuid().ToString("N");
    private string admin = "";
    private string connectionString = "";
    private bool created;
    public SqlConnection Connection() => new(connectionString);
    public MigrationRunner Runner(bool adopt = false, IReadOnlyList<SqlScript>? scripts = null) => new(Connection, Name, adopt, scripts);
    public static async Task<TestDatabase> Create()
    {
        var db = new TestDatabase();
        var builder = new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("FAMILY_TEST_SQL_CONNECTION"));
        if (builder.InitialCatalog is not ("" or "master")) throw new InvalidOperationException("Test connection must target master.");
        builder.InitialCatalog = "master";
        builder.Pooling = false;
        db.admin = builder.ConnectionString;
        using var connection = new SqlConnection(db.admin);
        await connection.OpenAsync();
        using var command = new SqlCommand($"CREATE DATABASE [{db.Name}]", connection);
        await command.ExecuteNonQueryAsync();
        db.created = true;
        builder.InitialCatalog = db.Name;
        db.connectionString = builder.ConnectionString;
        try { await db.Execute("CREATE ROLE family_pilot_runtime AUTHORIZATION dbo;"); }
        catch { await db.DisposeAsync(); throw; }
        return db;
    }
    public async Task Execute(string sql)
    {
        using var connection = Connection();
        await connection.OpenAsync();
        using var command = new SqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
    public async Task<int> Count(string sql)
    {
        using var connection = Connection();
        await connection.OpenAsync();
        using var command = new SqlCommand(sql, connection);
        return Convert.ToInt32(await command.ExecuteScalarAsync());
    }
    public async Task Legacy(string migration)
    {
        using var context = new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(connectionString,
            options => options.MigrationsAssembly(typeof(MigrationTests).Assembly.FullName)).Options);
        await context.GetService<IMigrator>().MigrateAsync(migration);
    }
    public async ValueTask DisposeAsync()
    {
        if (!created) return;
        if (!System.Text.RegularExpressions.Regex.IsMatch(Name, "^LittleDaysMigrationTests_[a-f0-9]{32}$")) throw new InvalidOperationException("Invalid disposable database name.");
        using var connection = new SqlConnection(admin);
        await connection.OpenAsync();
        using var command = new SqlCommand($"ALTER DATABASE [{Name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{Name}];", connection);
        await command.ExecuteNonQueryAsync();
        created = false;
    }
}
