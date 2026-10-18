using LittleDays.DatabaseMigrator;

namespace LittleDays.DatabaseMigrator.Tests;

public sealed class SleepAiExchangeMigrationTests
{
    [Fact]
    public void FullCaptureMigrationIsAdditiveAndVerifiesSevenDayRetentionAndIndexes()
    {
        var scripts = MigrationRunner.Scripts(); var script = scripts.Last();
        Assert.Equal("0014_SleepAiExchangeCapture.sql", script.Name);
        Assert.Equal(14, SchemaVerifier.Version(scripts.Select(x => x.Name)));
        Assert.Contains("ALTER TABLE dbo.SleepAiJobs ADD ExchangeHistoryEpoch uniqueidentifier NULL", script.Contents);
        Assert.Contains("CREATE TABLE dbo.SleepAiExchanges", script.Contents);
        Assert.Contains("ExpiresAt = DATEADD(day,7,StartedAt)", script.Contents);
        Assert.Contains("GRANT SELECT, INSERT, UPDATE, DELETE", script.Contents);
        Assert.DoesNotContain("UPDATE dbo", script.Contents); Assert.DoesNotContain("DELETE FROM", script.Contents);
    }

    [SqlFact]
    public async Task ExchangeUpgradePreservesOldJobsAndVerifiesNoPendingScripts()
    {
        await using var db = await TestDatabase.Create();
        db.Runner(scripts: MigrationRunner.Scripts().Take(13).ToArray()).Apply();
        const string insert = "INSERT dbo.SleepAiJobs(UserId,Id,ConsentGeneration,InputRevision,RequestHash,State,RequestNow,CreatedAt,UpdatedAt,ExpiresAt,Runs) VALUES(NEWID(),NEWID(),NEWID(),REPLICATE('a',64),REPLICATE('b',64),'queued',SYSUTCDATETIME(),SYSUTCDATETIME(),SYSUTCDATETIME(),DATEADD(day,1,SYSUTCDATETIME()),0)";
        await db.Execute(insert);
        Assert.Single(db.Runner().Pending()); db.Runner().Apply();
        await db.Execute(insert);
        Assert.Equal(2, await db.Count("SELECT COUNT(*) FROM dbo.SleepAiJobs WHERE ExchangeHistoryEpoch IS NULL"));
        Assert.Equal(0, await db.Count("SELECT COUNT(*) FROM dbo.SleepAiExchanges"));
        Assert.Equal(4, await db.Count("SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id=DATABASE_PRINCIPAL_ID('family_pilot_runtime') AND major_id=OBJECT_ID('dbo.SleepAiExchanges') AND state='G' AND permission_name IN ('SELECT','INSERT','UPDATE','DELETE')"));
        Assert.Empty(db.Runner().Pending()); db.Runner().Apply(); Assert.Empty(db.Runner().Pending());
        Assert.Equal(14, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }

    [SqlTheory]
    [InlineData("ALTER TABLE dbo.SleepAiJobs DROP COLUMN ExchangeHistoryEpoch")]
    [InlineData("DROP INDEX IX_SleepAiExchanges_ExpiresAt ON dbo.SleepAiExchanges")]
    [InlineData("ALTER TABLE dbo.SleepAiExchanges DROP CONSTRAINT CK_SleepAiExchanges_Retention")]
    [InlineData("ALTER TABLE dbo.SleepAiExchanges NOCHECK CONSTRAINT CK_SleepAiExchanges_Bounds")]
    public async Task ExchangeCatalogRejectsMissingExpiryEpochAndDisabledChecks(string mutation)
    {
        await using var db = await TestDatabase.Create(); db.Runner().Apply(); await db.Execute(mutation);
        Assert.Contains("Schema verification failed", Assert.ThrowsAny<Exception>(() => db.Runner().Pending()).ToString());
    }
}
