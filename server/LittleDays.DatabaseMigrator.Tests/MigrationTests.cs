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

public sealed class SqlTheoryAttribute : TheoryAttribute
{
    public SqlTheoryAttribute()
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
    public async Task SharedExtrasUpgradePreservesRowsAndAllowsOnlyAvatarToExceedOldJsonBound()
    {
        await using var db = await TestDatabase.Create();
        db.Runner(scripts: MigrationRunner.Scripts().Take(2).ToArray()).Apply();
        await db.Execute("""
            INSERT dbo.Families(Id,BabyName,Revision,CreatedAt) VALUES ('11111111-1111-1111-1111-111111111111',N'Existing baby',1,SYSUTCDATETIME());
            INSERT dbo.FamilyRecords(FamilyId,Collection,IdHash,Id,RecordJson,RecordedBy,LastEditedBy,Deleted)
            VALUES ('11111111-1111-1111-1111-111111111111','care','abc','retained','{"kind":"bath"}',
                '22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222',0);
            """);
        var version = await db.Count("SELECT CHECKSUM(Version) FROM dbo.FamilyRecords WHERE Id='retained'");
        db.Runner().Apply();
        Assert.Equal(version, await db.Count("SELECT CHECKSUM(Version) FROM dbo.FamilyRecords WHERE Id='retained'"));
        await db.Execute("""
            INSERT dbo.FamilyRecords(FamilyId,Collection,IdHash,Id,RecordJson,RecordedBy,LastEditedBy,Deleted)
            VALUES ('11111111-1111-1111-1111-111111111111','extra','avatar-hash','avatar',
                N'{"kind":"avatar","dataUrl":"'+REPLICATE(CONVERT(nvarchar(max),'a'),70000)+'"}',
                '22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222',0);
            """);
        await Assert.ThrowsAsync<SqlException>(() => db.Execute("UPDATE dbo.FamilyRecords SET Id='not-avatar' WHERE Id='avatar'"));
        await Assert.ThrowsAsync<SqlException>(() => db.Execute("UPDATE dbo.FamilyRecords SET Collection='care' WHERE Id='avatar'"));
        await Assert.ThrowsAsync<SqlException>(() => db.Execute("UPDATE dbo.FamilyRecords SET RecordJson=REPLACE(RecordJson,'avatar','other') WHERE Id='avatar'"));
        await Assert.ThrowsAsync<SqlException>(() => db.Execute("UPDATE dbo.FamilyRecords SET RecordJson=REPLACE(RecordJson,'kind','missingKind') WHERE Id='avatar'"));
        Assert.Equal(2, await db.Count("SELECT COUNT(*) FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.FamilyRecords') AND is_disabled=0 AND is_not_trusted=0"));
    }

    [SqlFact]
    public async Task FreshCheckDoesNotWriteAndApplyIsRepeatable()
    {
        await using var db = await TestDatabase.Create();
        Assert.Equal(MigrationRunner.Scripts().Count, db.Runner().Pending().Count);
        Assert.Equal(0, await db.Count("SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0"));
        db.Runner().Apply();
        Assert.Equal(MigrationRunner.Scripts().Count, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
        Assert.Empty(db.Runner().Pending());
        db.Runner().Apply();
        Assert.Equal(MigrationRunner.Scripts().Count, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
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
        var extended = scripts.Append(new SqlScript("0007_AddExample.sql", "CREATE TABLE dbo.Example(Id int NOT NULL);")).ToArray();
        db.Runner(scripts: extended).Apply();
        Assert.Equal(MigrationRunner.Scripts().Count + 1, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
        Assert.Empty(db.Runner(scripts: extended).Pending());
    }

    [SqlFact]
    public async Task FailureRollsBackSchemaDataAndJournalAndCanRetry()
    {
        await using var db = await TestDatabase.Create();
        var fail = new SqlScript("0007_Failure.sql", "CREATE TABLE dbo.Example(Id int); INSERT dbo.Example VALUES (1); THROW 51000, 'Synthetic failure', 1;");
        Assert.ThrowsAny<Exception>(() => db.Runner(scripts: [.. MigrationRunner.Scripts(), fail]).Apply());
        Assert.Equal(0, await db.Count("SELECT COUNT(*) FROM sys.tables WHERE is_ms_shipped=0"));
        db.Runner().Apply();
        Assert.ThrowsAny<Exception>(() => db.Runner(scripts: [.. MigrationRunner.Scripts(), fail]).Apply());
        Assert.Equal(0, await db.Count("SELECT COUNT(*) FROM sys.tables WHERE name='Example'"));
        Assert.Equal(MigrationRunner.Scripts().Count, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
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
            Assert.Equal(MigrationRunner.Scripts().Count, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
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
        Assert.Equal(MigrationRunner.Scripts().Count, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }

    [Theory]
    [InlineData("[Active]=(1)", "active = 1")]
    [InlineData("([Collection]='care' OR [Collection]='entry')", "Collection IN ('entry', 'care')")]
    [InlineData("(([Amount]>=(0)) AND ([Amount]<=(2000)))", "Amount >= 0 AND Amount <= 2000")]
    [InlineData("(PurgedAt IS NULL AND DeletedAt IS NOT NULL)", "DeletedAt IS NOT NULL AND PurgedAt IS NULL")]
    public void CatalogExpressionsNormalizeOnlyEquivalentSyntax(string actual, string expected) =>
        Assert.Equal(SchemaVerifier.NormalizeExpression(expected), SchemaVerifier.NormalizeExpression(actual));

    [Theory]
    [InlineData("A = 1 AND (B = 2 OR C = 3)", "(A = 1 AND B = 2) OR C = 3")]
    [InlineData("Status = N'pending'", "Status = N'PENDING'")]
    [InlineData("Id = 'a b'", "Id = 'ab'")]
    [InlineData("JSON_VALUE(RecordJson, '$.kind') = 'avatar'", "JSON_VALUE(RecordJson, '$.Kind') = 'avatar'")]
    public void CatalogExpressionsPreserveGroupingAndLiteralContents(string first, string second) =>
        Assert.NotEqual(SchemaVerifier.NormalizeExpression(first), SchemaVerifier.NormalizeExpression(second));

    [SqlTheory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    public async Task CatalogChecksAllowEveryApprovedPendingUpgrade(int applied)
    {
        await using var db = await TestDatabase.Create();
        var prior = db.Runner(scripts: MigrationRunner.Scripts().Take(applied).ToArray());
        prior.Apply();
        Assert.Empty(prior.Pending());
        Assert.Equal(MigrationRunner.Scripts().Count - applied, db.Runner().Pending().Count);
        Assert.Equal(applied, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
        db.Runner().Apply();
        Assert.Empty(db.Runner().Pending());
        Assert.Equal(MigrationRunner.Scripts().Count, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }

    [SqlTheory]
    [InlineData("DROP INDEX IX_Operations_FamilyId ON dbo.Operations")]
    [InlineData("DROP INDEX IX_Memberships_FamilyId_UserId_Active ON dbo.Memberships; CREATE INDEX IX_Memberships_FamilyId_UserId_Active ON dbo.Memberships(UserId,FamilyId,Active)")]
    [InlineData("DROP INDEX IX_Families_DeletedBy_DeletedAt ON dbo.Families; CREATE UNIQUE INDEX IX_Families_DeletedBy_DeletedAt ON dbo.Families(DeletedBy,DeletedAt)")]
    [InlineData("ALTER TABLE dbo.FamilyRecords DROP CONSTRAINT PK_FamilyRecords; ALTER TABLE dbo.FamilyRecords ADD CONSTRAINT PK_FamilyRecords PRIMARY KEY NONCLUSTERED(FamilyId,Collection,IdHash)")]
    [InlineData("ALTER TABLE dbo.FamilyRecords DROP CONSTRAINT PK_FamilyRecords; ALTER TABLE dbo.FamilyRecords ADD CONSTRAINT PK_FamilyRecords PRIMARY KEY(Collection,FamilyId,IdHash)")]
    [InlineData("DROP INDEX IX_Invitations_FamilyId_CreatedAt ON dbo.Invitations; CREATE INDEX IX_Invitations_FamilyId_CreatedAt ON dbo.Invitations(FamilyId,CreatedAt)")]
    [InlineData("DROP INDEX IX_Invitations_Email_Status_ExpiresAt ON dbo.Invitations; CREATE INDEX IX_Invitations_Email_Status_ExpiresAt ON dbo.Invitations(Email,Status,ExpiresAt) INCLUDE(FamilyId)")]
    [InlineData("DROP INDEX IX_Memberships_UserId ON dbo.Memberships; CREATE UNIQUE INDEX IX_Memberships_UserId ON dbo.Memberships(UserId) WHERE Active=0")]
    [InlineData("ALTER INDEX IX_Operations_FamilyId ON dbo.Operations DISABLE")]
    [InlineData("ALTER TABLE dbo.Feeds NOCHECK CONSTRAINT FK_Feeds_Families_FamilyId; ALTER TABLE dbo.Feeds CHECK CONSTRAINT FK_Feeds_Families_FamilyId")]
    [InlineData("ALTER TABLE dbo.Operations DROP CONSTRAINT FK_Operations_Families_FamilyId; ALTER TABLE dbo.Operations ADD CONSTRAINT FK_Operations_Families_FamilyId FOREIGN KEY(MembershipId) REFERENCES dbo.Families(Id)")]
    [InlineData("ALTER TABLE dbo.Feeds DROP CONSTRAINT FK_Feeds_Families_FamilyId; ALTER TABLE dbo.Feeds ADD CONSTRAINT FK_Feeds_Families_FamilyId FOREIGN KEY(FamilyId) REFERENCES dbo.Families(Id) ON DELETE CASCADE")]
    [InlineData("ALTER TABLE dbo.Feeds NOCHECK CONSTRAINT CK_Feeds_Amount; ALTER TABLE dbo.Feeds CHECK CONSTRAINT CK_Feeds_Amount")]
    [InlineData("ALTER TABLE dbo.Feeds DROP CONSTRAINT CK_Feeds_Amount; ALTER TABLE dbo.Feeds ADD CONSTRAINT CK_Feeds_Amount CHECK(Amount>=0 AND Amount<=4000)")]
    [InlineData("ALTER TABLE dbo.FamilyRecords DROP CONSTRAINT CK_FamilyRecords_Json; ALTER TABLE dbo.FamilyRecords ADD CONSTRAINT CK_FamilyRecords_Json CHECK(ISJSON(RecordJson)=1 AND DATALENGTH(RecordJson)<=131072 OR (Collection='extra' AND Id='avatar' AND COALESCE(JSON_VALUE(RecordJson,'$.kind'),'')='avatar' AND DATALENGTH(RecordJson)<=35651584))")]
    [InlineData("CREATE INDEX IX_Operations_Unreviewed ON dbo.Operations(CreatedAt)")]
    [InlineData("DROP TRIGGER dbo.TR_Operations_MaintainFamilyOperationCounts")]
    [InlineData("DISABLE TRIGGER dbo.TR_Operations_MaintainFamilyOperationCounts ON dbo.Operations")]
    [InlineData("ALTER TRIGGER dbo.TR_Operations_MaintainFamilyOperationCounts ON dbo.Operations AFTER INSERT,UPDATE,DELETE AS BEGIN SET NOCOUNT ON; END")]
    [InlineData("ALTER TABLE dbo.Families DROP COLUMN ProfileVersion; ALTER TABLE dbo.Families ADD ProfileVersion binary(8) NOT NULL DEFAULT 0x0000000000000000")]
    [InlineData("ALTER TABLE dbo.Feeds DROP COLUMN Version; ALTER TABLE dbo.Feeds ADD Version rowversion NULL")]
    [InlineData("ALTER TABLE dbo.FamilyRecords DROP COLUMN Version; ALTER TABLE dbo.FamilyRecords ADD Version binary(8) NOT NULL DEFAULT 0x0000000000000000")]
    [InlineData("ALTER TABLE dbo.Feeds DROP CONSTRAINT CK_Feeds_Amount; ALTER TABLE dbo.Feeds ALTER COLUMN Amount decimal(8,2) NOT NULL; ALTER TABLE dbo.Feeds ADD CONSTRAINT CK_Feeds_Amount CHECK(Amount>=0 AND Amount<=2000)")]
    [InlineData("ALTER TABLE dbo.Feeds DROP CONSTRAINT CK_Feeds_Amount; ALTER TABLE dbo.Feeds ALTER COLUMN Amount decimal(7,3) NOT NULL; ALTER TABLE dbo.Feeds ADD CONSTRAINT CK_Feeds_Amount CHECK(Amount>=0 AND Amount<=2000)")]
    [InlineData("ALTER TABLE dbo.FamilyOperationCounts ALTER COLUMN ReceiptCount bigint NULL")]
    [InlineData("ALTER TABLE dbo.FamilyOperationCounts DROP CONSTRAINT CK_FamilyOperationCounts_ReceiptCount; ALTER TABLE dbo.FamilyOperationCounts ALTER COLUMN ReceiptCount int NOT NULL; ALTER TABLE dbo.FamilyOperationCounts ADD CONSTRAINT CK_FamilyOperationCounts_ReceiptCount CHECK(ReceiptCount>=0)")]
    [InlineData("ALTER TABLE dbo.FamilyOperationCounts DROP CONSTRAINT FK_FamilyOperationCounts_Families_FamilyId; ALTER TABLE dbo.FamilyOperationCounts DROP CONSTRAINT PK_FamilyOperationCounts; ALTER TABLE dbo.FamilyOperationCounts ALTER COLUMN FamilyId uniqueidentifier NULL")]
    public async Task NoOpCheckAndApplyRejectCatalogDriftWithoutChangingJournal(string drift)
    {
        await using var db = await TestDatabase.Create();
        db.Runner().Apply();
        await db.Execute(drift);
        var checkError = Assert.ThrowsAny<Exception>(() => db.Runner().Pending());
        Assert.Contains("Schema verification failed", checkError.ToString(), StringComparison.Ordinal);
        var applyError = Assert.ThrowsAny<Exception>(() => db.Runner().Apply());
        Assert.Contains("Schema verification failed", applyError.ToString(), StringComparison.Ordinal);
        Assert.Equal(MigrationRunner.Scripts().Count, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }

    [SqlFact]
    public async Task UnknownFutureScriptCannotBypassApprovedInvariantsAndRollsBack()
    {
        await using var db = await TestDatabase.Create();
        db.Runner().Apply();
        var scripts = MigrationRunner.Scripts().Append(new SqlScript("0007_Drift.sql",
            "CREATE TABLE dbo.Example(Id int); DROP INDEX IX_Operations_FamilyId ON dbo.Operations;")).ToArray();
        var error = Assert.ThrowsAny<Exception>(() => db.Runner(scripts: scripts).Apply());
        Assert.Contains("Schema verification failed", error.ToString(), StringComparison.Ordinal);
        Assert.Equal(0, await db.Count("SELECT COUNT(*) FROM sys.tables WHERE name='Example'"));
        Assert.Equal(MigrationRunner.Scripts().Count, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
        Assert.Empty(db.Runner().Pending());
    }

    [SqlFact]
    public async Task PartialLegacyAdoptionRejectsDriftBeforeBaselineCanReplaceIt()
    {
        await using var db = await TestDatabase.Create();
        await db.Legacy("20260913173137_InitialPilot");
        await db.Execute("DROP INDEX IX_Invitations_FamilyId_RecipientUserId ON dbo.Invitations; CREATE UNIQUE INDEX IX_Invitations_FamilyId_RecipientUserId ON dbo.Invitations(RecipientUserId,FamilyId) WHERE Status=N'pending';");
        Assert.ThrowsAny<Exception>(() => db.Runner(adopt: true).Pending());
        Assert.ThrowsAny<Exception>(() => db.Runner(adopt: true).Apply());
        Assert.Equal(1, await db.Count("SELECT COUNT(*) FROM dbo.__EFMigrationsHistory"));
        Assert.Equal(0, await db.Count("SELECT COUNT(*) FROM sys.tables WHERE name='DatabaseMigrations'"));
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
