using LittleDays.DatabaseMigrator;
using Microsoft.Data.SqlClient;

namespace LittleDays.DatabaseMigrator.Tests;

public sealed class SleepAiJobMigrationTests
{
    [Fact]
    public void DurableJobMigrationIsAdditiveAndApprovedAsVersionTen()
    {
        var scripts = MigrationRunner.Scripts();
        Assert.Equal("0010_DurableSleepAiJobs.sql", scripts.Last().Name);
        Assert.Equal(10, SchemaVerifier.Version(scripts.Select(x => x.Name)));
        var script = scripts.Last().Contents;
        Assert.DoesNotContain("ALTER TABLE dbo.FamilyRecords", script);
        Assert.DoesNotContain("DELETE FROM", script);
        Assert.Contains("GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.SleepAiJobs", script);
    }

    [SqlFact]
    public async Task UpgradeAddsQueueAndRuntimeGrantsWithoutChangingExistingRecordsAndNoOpHasZeroPending()
    {
        await using var db = await TestDatabase.Create();
        db.Runner(scripts: MigrationRunner.Scripts().Take(9).ToArray()).Apply();
        await db.Execute("INSERT dbo.Families(Id,BabyName,Revision,CreatedAt) VALUES(NEWID(),N'Synthetic preserved family',4,SYSUTCDATETIME())");
        var checksum = await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(Id,BabyName,Revision,ProfileVersion)) FROM dbo.Families");
        Assert.Single(db.Runner().Pending()); db.Runner().Apply();
        Assert.Empty(db.Runner().Pending()); db.Runner().Apply(); Assert.Empty(db.Runner().Pending());
        Assert.Equal(checksum, await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(Id,BabyName,Revision,ProfileVersion)) FROM dbo.Families"));
        Assert.Equal(3, await db.Count("SELECT COUNT(*) FROM sys.tables WHERE name IN ('SleepAiJobs','SleepAiAttempts','SleepAiRevocations')"));
        Assert.Equal(12, await db.Count("""
            SELECT COUNT(*) FROM sys.database_permissions p
            WHERE p.grantee_principal_id=DATABASE_PRINCIPAL_ID('family_pilot_runtime') AND p.state='G'
              AND p.major_id IN (OBJECT_ID('dbo.SleepAiJobs'),OBJECT_ID('dbo.SleepAiAttempts'),OBJECT_ID('dbo.SleepAiRevocations'))
              AND p.permission_name IN ('SELECT','INSERT','UPDATE','DELETE')
            """));
        await Assert.ThrowsAsync<SqlException>(() => db.Execute("INSERT dbo.SleepAiRevocations(UserId,Kind,Id,ExpiresAt) VALUES(NEWID(),'unknown',NEWID(),SYSUTCDATETIME())"));
        Assert.Equal(MigrationRunner.Scripts().Count, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }

    [SqlTheory]
    [InlineData("DROP INDEX IX_SleepAiJobs_State_CreatedAt ON dbo.SleepAiJobs")]
    [InlineData("ALTER TABLE dbo.SleepAiJobs DROP CONSTRAINT CK_SleepAiJobs_State")]
    [InlineData("ALTER TABLE dbo.SleepAiJobs NOCHECK CONSTRAINT CK_SleepAiJobs_Request")]
    [InlineData("ALTER TABLE dbo.SleepAiJobs ALTER COLUMN RequestHash varchar(32) NOT NULL")]
    [InlineData("DROP INDEX IX_SleepAiAttempts_LeaseUntil ON dbo.SleepAiAttempts; CREATE INDEX IX_SleepAiAttempts_LeaseUntil ON dbo.SleepAiAttempts(StartedAt)")]
    [InlineData("ALTER TABLE dbo.SleepAiRevocations DROP CONSTRAINT CK_SleepAiRevocations_Kind")]
    public async Task QueueBudgetAndRevocationCatalogDriftFailsClosed(string mutation)
    {
        await using var db = await TestDatabase.Create(); db.Runner().Apply(); await db.Execute(mutation);
        var error = Assert.ThrowsAny<Exception>(() => db.Runner().Pending());
        Assert.Contains("Schema verification failed", error.ToString()); Assert.Contains("SleepAi", error.ToString());
        Assert.Equal(MigrationRunner.Scripts().Count, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }
}
