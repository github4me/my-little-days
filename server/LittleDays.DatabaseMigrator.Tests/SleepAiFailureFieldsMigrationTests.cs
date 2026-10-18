using LittleDays.DatabaseMigrator;
using Microsoft.Data.SqlClient;

namespace LittleDays.DatabaseMigrator.Tests;

public sealed class SleepAiFailureFieldsMigrationTests
{
    private const string LegacyInsert = """
        DECLARE @now datetimeoffset=SYSUTCDATETIME();
        INSERT dbo.SleepAiFailedOutputs(UserId,JobId,Run,Attempt,ConsentGeneration,HistoryEpoch,Reason,
          ResponseText,OriginalLength,Truncated,OccurredAt,ExpiresAt,DurationMs,Model)
        VALUES(NEWID(),NEWID(),1,1,NEWID(),NEWID(),'invalid_json',N'synthetic',9,0,@now,DATEADD(day,7,@now),12,'synthetic-2026-10-01')
        """;

    [Fact]
    public void FailureFieldMigrationAddsOnlyNullableBoundedMetadataWithoutBackfill()
    {
        var scripts = MigrationRunner.Scripts().Take(13).ToArray();
        Assert.Equal("0013_SleepAiFailureFields.sql", scripts.Last().Name);
        Assert.Equal(13, SchemaVerifier.Version(scripts.Select(x => x.Name)));
        var script = scripts.Last().Contents;
        Assert.Contains("ALTER TABLE dbo.SleepAiFailedOutputs ADD FailureFieldsJson nvarchar(1024) NULL", script);
        Assert.DoesNotContain("UPDATE ", script);
        Assert.DoesNotContain("DELETE ", script);
        Assert.DoesNotContain("INSERT ", script);
        Assert.DoesNotContain("FamilyRecords", script);
        Assert.DoesNotContain("SleepAiJobs", script);
        Assert.DoesNotContain("ExpiresAt", script);
    }

    [SqlFact]
    public async Task FieldMetadataUpgradePreservesFailuresAllowsPreviousApiInsertsAndHasVerifiedNoOp()
    {
        await using var db = await TestDatabase.Create();
        db.Runner(scripts: MigrationRunner.Scripts().Take(12).ToArray()).Apply();
        await db.Execute(LegacyInsert);
        var checksum = await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(UserId,JobId,Reason,ResponseText,ExpiresAt)) FROM dbo.SleepAiFailedOutputs");
        var upgrade = db.Runner(scripts: MigrationRunner.Scripts().Take(13).ToArray());
        Assert.Single(upgrade.Pending()); upgrade.Apply();
        Assert.Equal(checksum, await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(UserId,JobId,Reason,ResponseText,ExpiresAt)) FROM dbo.SleepAiFailedOutputs"));
        Assert.Equal(1, await db.Count("SELECT COUNT(*) FROM dbo.SleepAiFailedOutputs WHERE FailureFieldsJson IS NULL"));
        await db.Execute(LegacyInsert);
        Assert.Equal(2, await db.Count("SELECT COUNT(*) FROM dbo.SleepAiFailedOutputs WHERE FailureFieldsJson IS NULL"));
        await db.Execute("UPDATE dbo.SleepAiFailedOutputs SET FailureFieldsJson=N'[\"$.periods[0].sleepStart\",\"$.periods[0].sleepEnd\"]'");
        Assert.Equal(2, await db.Count("SELECT COUNT(*) FROM dbo.SleepAiFailedOutputs WHERE JSON_VALUE(FailureFieldsJson,'$[0]')='$.periods[0].sleepStart' AND ExpiresAt=DATEADD(day,7,OccurredAt)"));
        Assert.Equal(4, await db.Count("""
            SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id=DATABASE_PRINCIPAL_ID('family_pilot_runtime')
              AND major_id=OBJECT_ID('dbo.SleepAiFailedOutputs') AND state='G' AND permission_name IN ('SELECT','INSERT','UPDATE','DELETE')
            """));
        Assert.Empty(upgrade.Pending()); upgrade.Apply(); Assert.Empty(upgrade.Pending());
        Assert.Equal(13, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }

    [SqlFact]
    public async Task FailureFieldsCannotExceedBoundedColumnLength()
    {
        await using var db = await TestDatabase.Create(); db.Runner().Apply(); await db.Execute(LegacyInsert);
        await Assert.ThrowsAsync<SqlException>(() => db.Execute("UPDATE dbo.SleepAiFailedOutputs SET FailureFieldsJson=REPLICATE(CONVERT(nvarchar(max),'x'),1025)"));
        Assert.Equal(1, await db.Count("SELECT COUNT(*) FROM dbo.SleepAiFailedOutputs WHERE FailureFieldsJson IS NULL"));
    }

    [SqlTheory]
    [InlineData("ALTER TABLE dbo.SleepAiFailedOutputs DROP COLUMN FailureFieldsJson")]
    [InlineData("ALTER TABLE dbo.SleepAiFailedOutputs ALTER COLUMN FailureFieldsJson nvarchar(1023) NULL")]
    [InlineData("ALTER TABLE dbo.SleepAiFailedOutputs ALTER COLUMN FailureFieldsJson nvarchar(1024) NOT NULL")]
    [InlineData("ALTER TABLE dbo.SleepAiFailedOutputs ALTER COLUMN FailureFieldsJson varchar(1024) NULL")]
    public async Task FailureFieldCatalogRejectsMissingOrAlteredColumnContract(string mutation)
    {
        await using var db = await TestDatabase.Create(); db.Runner().Apply(); await db.Execute(mutation);
        Assert.Contains("Schema verification failed", Assert.ThrowsAny<Exception>(() => db.Runner().Pending()).ToString());
        Assert.Equal(14, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }
}
