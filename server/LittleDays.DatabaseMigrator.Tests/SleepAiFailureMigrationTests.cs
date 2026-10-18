using LittleDays.DatabaseMigrator;
using Microsoft.Data.SqlClient;

namespace LittleDays.DatabaseMigrator.Tests;

public sealed class SleepAiFailureMigrationTests
{
    [Fact]
    public void FailureDiagnosticsMigrationIsAdditiveVersionElevenWithBoundedIndependentRetention()
    {
        var scripts = MigrationRunner.Scripts().Take(11).ToArray();
        Assert.Equal("0011_SleepAiFailedOutputDiagnostics.sql", scripts.Last().Name);
        Assert.Equal(11, SchemaVerifier.Version(scripts.Select(x => x.Name)));
        var script = scripts.Last().Contents;
        Assert.DoesNotContain("ALTER TABLE dbo.FamilyRecords", script);
        Assert.DoesNotContain("DELETE FROM", script);
        Assert.DoesNotContain("FOREIGN KEY", script);
        Assert.Contains("DiagnosticsConsentVersion varchar(40) NULL", script);
        Assert.Contains("DATALENGTH(ResponseText) <= 32768", script);
        Assert.Contains("ExpiresAt = DATEADD(day, 7, OccurredAt)", script);
        Assert.Contains("PRIMARY KEY (UserId, JobId, Run, Attempt)", script);
        Assert.Contains("GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.SleepAiFailedOutputs", script);
    }

    [Theory]
    [InlineData("([OriginalLength]=(datalength([ResponseText])/(2)))", "OriginalLength = DATALENGTH(ResponseText) / 2")]
    [InlineData("([Truncated]=(1) AND [OriginalLength]>(datalength([ResponseText])/(2)))", "Truncated = 1 AND OriginalLength > DATALENGTH(ResponseText) / 2")]
    [InlineData("([ExpiresAt]=dateadd(day,(7),[OccurredAt]))", "ExpiresAt = DATEADD(day, 7, OccurredAt)")]
    [InlineData("[OriginalLength]=([ByteLength]/(2))/(4)", "OriginalLength = ByteLength / 2 / 4")]
    public void DiagnosticConstraintsNormalizeCatalogParenthesesWithoutChangingArithmetic(string catalog, string approved) =>
        Assert.Equal(SchemaVerifier.NormalizeExpression(approved), SchemaVerifier.NormalizeExpression(catalog));

    [Theory]
    [InlineData("OriginalLength = DATALENGTH(ResponseText) / 2", "OriginalLength = DATALENGTH(ResponseText) / 4")]
    [InlineData("OriginalLength = DATALENGTH(ResponseText) / 2", "OriginalLength = 2 / DATALENGTH(ResponseText)")]
    [InlineData("OriginalLength = ByteLength / 2 / 4", "OriginalLength = ByteLength / (2 / 4)")]
    [InlineData("OriginalLength = ByteLength / 2", "(OriginalLength = ByteLength) / 2")]
    [InlineData("ExpiresAt = DATEADD(day, 7, OccurredAt)", "ExpiresAt = DATEADD(day, 8, OccurredAt)")]
    [InlineData("ExpiresAt = DATEADD(day, 7, OccurredAt)", "ExpiresAt = DATEADD(hour, 7, OccurredAt)")]
    public void DiagnosticConstraintNormalizationPreservesDivisorOrderGroupingAndRetentionUnit(string approved, string changed) =>
        Assert.NotEqual(SchemaVerifier.NormalizeExpression(approved), SchemaVerifier.NormalizeExpression(changed));

    [Theory]
    [InlineData("OriginalLength = ByteLength / / 2")]
    [InlineData("OriginalLength = ByteLength / 2 + 1")]
    [InlineData("OriginalLength = ByteLength / 2; SELECT 1")]
    public void DiagnosticConstraintParserRejectsMalformedOrUnapprovedArithmetic(string expression) =>
        Assert.Throws<FormatException>(() => SchemaVerifier.NormalizeExpression(expression));

    private const string LegacyJobInsert = """
        INSERT dbo.SleepAiJobs(UserId,Id,ConsentGeneration,RequestHash,InputRevision,State,RequestNow,
          CreatedAt,UpdatedAt,ExpiresAt,RequestJson,Runs)
        VALUES(NEWID(),NEWID(),NEWID(),REPLICATE('a',64),REPLICATE('b',64),'queued',SYSUTCDATETIME(),
          SYSUTCDATETIME(),SYSUTCDATETIME(),DATEADD(day,1,SYSUTCDATETIME()),'{}',0)
        """;

    private const string DiagnosticInsert = """
        DECLARE @now datetimeoffset=SYSUTCDATETIME();
        INSERT dbo.SleepAiFailedOutputs(UserId,JobId,Run,Attempt,ConsentGeneration,HistoryEpoch,Reason,
          ResponseText,OriginalLength,Truncated,OccurredAt,ExpiresAt,DurationMs,Model)
        VALUES(NEWID(),NEWID(),1,1,NEWID(),NEWID(),'invalid_json',N'synthetic ',10,0,@now,DATEADD(day,7,@now),12,'synthetic-2026-10-01')
        """;

    [SqlFact]
    public async Task FailureDiagnosticsUpgradePreservesOldJobsAllowsLegacyInsertsAndHasVerifiedNoOp()
    {
        await using var db = await TestDatabase.Create();
        db.Runner(scripts: MigrationRunner.Scripts().Take(10).ToArray()).Apply();
        await db.Execute(LegacyJobInsert);
        var checksum = await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(UserId,Id,RequestHash,RequestJson,Runs)) FROM dbo.SleepAiJobs");
        Assert.Single(db.Runner(scripts: MigrationRunner.Scripts().Take(11).ToArray()).Pending()); db.Runner(scripts: MigrationRunner.Scripts().Take(11).ToArray()).Apply();
        Assert.Equal(checksum, await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(UserId,Id,RequestHash,RequestJson,Runs)) FROM dbo.SleepAiJobs"));
        await db.Execute(LegacyJobInsert);
        Assert.Equal(2, await db.Count("SELECT COUNT(*) FROM dbo.SleepAiJobs WHERE DiagnosticsConsentVersion IS NULL AND DiagnosticsHistoryEpoch IS NULL"));
        await db.Execute(DiagnosticInsert); // A malformed response is intentionally not subject to ISJSON.
        Assert.Equal(1, await db.Count("SELECT COUNT(*) FROM dbo.SleepAiFailedOutputs"));
        Assert.Equal(4, await db.Count("""
            SELECT COUNT(*) FROM sys.database_permissions WHERE grantee_principal_id=DATABASE_PRINCIPAL_ID('family_pilot_runtime')
              AND major_id=OBJECT_ID('dbo.SleepAiFailedOutputs') AND state='G' AND permission_name IN ('SELECT','INSERT','UPDATE','DELETE')
            """));
        Assert.Empty(db.Runner(scripts: MigrationRunner.Scripts().Take(11).ToArray()).Pending()); db.Runner(scripts: MigrationRunner.Scripts().Take(11).ToArray()).Apply(); Assert.Empty(db.Runner(scripts: MigrationRunner.Scripts().Take(11).ToArray()).Pending());
        Assert.Equal(11, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }

    [SqlTheory]
    [InlineData("UPDATE dbo.SleepAiJobs SET DiagnosticsHistoryEpoch=NEWID()")]
    [InlineData("UPDATE dbo.SleepAiJobs SET DiagnosticsConsentVersion='sleep-ai-failed-output-v1'")]
    [InlineData("UPDATE dbo.SleepAiJobs SET DiagnosticsConsentVersion='unknown', DiagnosticsHistoryEpoch=NEWID()")]
    [InlineData("UPDATE dbo.SleepAiFailedOutputs SET ExpiresAt=DATEADD(day,8,OccurredAt)")]
    [InlineData("UPDATE dbo.SleepAiFailedOutputs SET ResponseText=REPLICATE(CONVERT(nvarchar(max),'x'),16385),OriginalLength=16385")]
    [InlineData("UPDATE dbo.SleepAiFailedOutputs SET ResponseText=NULL")]
    [InlineData("UPDATE dbo.SleepAiFailedOutputs SET Run=3")]
    [InlineData("UPDATE dbo.SleepAiFailedOutputs SET Attempt=3")]
    [InlineData("UPDATE dbo.SleepAiFailedOutputs SET PeriodIndex=-1")]
    [InlineData("UPDATE dbo.SleepAiFailedOutputs SET FamilyId=NEWID()")]
    [InlineData("UPDATE dbo.SleepAiFailedOutputs SET OriginalLength=9")]
    public async Task FailureDiagnosticsDatabaseRejectsInvalidConsentRetentionContextAndPayloadBounds(string mutation)
    {
        await using var db = await TestDatabase.Create(); db.Runner(scripts: MigrationRunner.Scripts().Take(11).ToArray()).Apply();
        await db.Execute(LegacyJobInsert); await db.Execute(DiagnosticInsert);
        await Assert.ThrowsAsync<SqlException>(() => db.Execute(mutation));
        Assert.Equal(1, await db.Count("SELECT COUNT(*) FROM dbo.SleepAiFailedOutputs WHERE OriginalLength=10 AND Truncated=0"));
    }

    [SqlTheory]
    [InlineData("DROP INDEX IX_SleepAiFailedOutputs_ExpiresAt ON dbo.SleepAiFailedOutputs")]
    [InlineData("ALTER TABLE dbo.SleepAiFailedOutputs NOCHECK CONSTRAINT CK_SleepAiFailedOutputs_Retention")]
    [InlineData("ALTER TABLE dbo.SleepAiFailedOutputs DROP CONSTRAINT CK_SleepAiFailedOutputs_Length")]
    [InlineData("ALTER TABLE dbo.SleepAiJobs DROP CONSTRAINT CK_SleepAiJobs_DiagnosticsConsent")]
    [InlineData("ALTER TABLE dbo.SleepAiFailedOutputs ALTER COLUMN Model varchar(99) NOT NULL")]
    public async Task FailureDiagnosticsCatalogDriftFailsClosed(string mutation)
    {
        await using var db = await TestDatabase.Create(); db.Runner(scripts: MigrationRunner.Scripts().Take(11).ToArray()).Apply(); await db.Execute(mutation);
        Assert.Contains("Schema verification failed", Assert.ThrowsAny<Exception>(() => db.Runner(scripts: MigrationRunner.Scripts().Take(11).ToArray()).Pending()).ToString());
        Assert.Equal(11, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }
}
