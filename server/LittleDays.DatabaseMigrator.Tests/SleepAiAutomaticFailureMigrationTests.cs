using LittleDays.DatabaseMigrator;
using Microsoft.Data.SqlClient;

namespace LittleDays.DatabaseMigrator.Tests;

public sealed class SleepAiAutomaticFailureMigrationTests
{
    private const string JobInsert = """
        INSERT dbo.SleepAiJobs(UserId,Id,ConsentGeneration,RequestHash,InputRevision,State,RequestNow,
          CreatedAt,UpdatedAt,ExpiresAt,RequestJson,Runs)
        VALUES(NEWID(),NEWID(),NEWID(),REPLICATE('a',64),REPLICATE('b',64),'queued',SYSUTCDATETIME(),
          SYSUTCDATETIME(),SYSUTCDATETIME(),DATEADD(day,1,SYSUTCDATETIME()),'{}',0)
        """;

    [Fact]
    public void AutomaticCaptureMigrationIsAdditiveVersionTwelveWithoutBackfillOrRetentionChanges()
    {
        var scripts = MigrationRunner.Scripts();
        Assert.Equal("0012_SleepAiAutomaticFailedOutputCapture.sql", scripts.Last().Name);
        Assert.Equal(12, SchemaVerifier.Version(scripts.Select(x => x.Name)));
        var script = scripts.Last().Contents;
        Assert.Contains("WITH CHECK ADD CONSTRAINT CK_SleepAiJobs_DiagnosticsConsent", script);
        Assert.Contains("DiagnosticsConsentVersion IS NULL OR", script);
        Assert.Contains("DiagnosticsConsentVersion = 'sleep-ai-failed-output-v1'", script);
        Assert.DoesNotContain("UPDATE ", script); Assert.DoesNotContain("DELETE ", script);
        Assert.DoesNotContain("INSERT ", script); Assert.DoesNotContain("SleepAiFailedOutputs", script);
        Assert.DoesNotContain("FamilyRecords", script);
    }

    [SqlFact]
    public async Task AutomaticCaptureUpgradePreservesPriorJobsAndOutputsAndHasVerifiedNoOp()
    {
        await using var db = await TestDatabase.Create();
        db.Runner(scripts: MigrationRunner.Scripts().Take(11).ToArray()).Apply();
        await db.Execute(JobInsert);
        await db.Execute("""
            DECLARE @now datetimeoffset=SYSUTCDATETIME();
            INSERT dbo.SleepAiFailedOutputs(UserId,JobId,Run,Attempt,ConsentGeneration,HistoryEpoch,Reason,
              ResponseText,OriginalLength,Truncated,OccurredAt,ExpiresAt,DurationMs,Model)
            VALUES(NEWID(),NEWID(),1,1,NEWID(),NEWID(),'invalid_json',N'synthetic',9,0,@now,DATEADD(day,7,@now),12,'synthetic-2026-10-01')
            """);
        var jobs = await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.SleepAiJobs");
        var outputs = await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.SleepAiFailedOutputs");
        Assert.Single(db.Runner().Pending()); db.Runner().Apply();
        Assert.Equal(jobs, await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.SleepAiJobs"));
        Assert.Equal(outputs, await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.SleepAiFailedOutputs"));
        Assert.Equal(1, await db.Count("SELECT COUNT(*) FROM dbo.SleepAiJobs WHERE DiagnosticsConsentVersion IS NULL AND DiagnosticsHistoryEpoch IS NULL"));
        // Both prior API insert forms remain valid during schema-first deployment.
        await db.Execute(JobInsert);
        await db.Execute("UPDATE dbo.SleepAiJobs SET DiagnosticsConsentVersion='sleep-ai-failed-output-v1', DiagnosticsHistoryEpoch=NEWID()");
        await db.Execute(JobInsert);
        // New API may stamp an epoch without inventing client consent.
        await db.Execute("UPDATE dbo.SleepAiJobs SET DiagnosticsHistoryEpoch=NEWID() WHERE DiagnosticsConsentVersion IS NULL");
        Assert.Equal(1, await db.Count("SELECT COUNT(*) FROM dbo.SleepAiJobs WHERE DiagnosticsConsentVersion IS NULL AND DiagnosticsHistoryEpoch IS NOT NULL"));
        Assert.Empty(db.Runner().Pending()); db.Runner().Apply(); Assert.Empty(db.Runner().Pending());
        Assert.Equal(12, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }

    [SqlTheory]
    [InlineData("UPDATE dbo.SleepAiJobs SET DiagnosticsConsentVersion='unknown'")]
    [InlineData("UPDATE dbo.SleepAiJobs SET DiagnosticsConsentVersion='unknown', DiagnosticsHistoryEpoch=NEWID()")]
    [InlineData("UPDATE dbo.SleepAiJobs SET DiagnosticsConsentVersion='sleep-ai-failed-output-v1'")]
    public async Task AutomaticPolicyStillRejectsInvalidLegacyConsentForms(string mutation)
    {
        await using var db = await TestDatabase.Create(); db.Runner().Apply(); await db.Execute(JobInsert);
        await Assert.ThrowsAsync<SqlException>(() => db.Execute(mutation));
        Assert.Equal(1, await db.Count("SELECT COUNT(*) FROM dbo.SleepAiJobs WHERE DiagnosticsConsentVersion IS NULL AND DiagnosticsHistoryEpoch IS NULL"));
    }

    [SqlTheory]
    [InlineData("ALTER TABLE dbo.SleepAiJobs DROP CONSTRAINT CK_SleepAiJobs_DiagnosticsConsent")]
    [InlineData("ALTER TABLE dbo.SleepAiJobs NOCHECK CONSTRAINT CK_SleepAiJobs_DiagnosticsConsent")]
    [InlineData("ALTER TABLE dbo.SleepAiJobs DROP CONSTRAINT CK_SleepAiJobs_DiagnosticsConsent; ALTER TABLE dbo.SleepAiJobs WITH CHECK ADD CONSTRAINT CK_SleepAiJobs_DiagnosticsConsent CHECK (DiagnosticsConsentVersion IS NULL OR DiagnosticsConsentVersion IS NOT NULL)")]
    public async Task AutomaticPolicyCatalogRejectsMissingUntrustedOrBroadenedCheck(string mutation)
    {
        await using var db = await TestDatabase.Create(); db.Runner().Apply(); await db.Execute(mutation);
        Assert.Contains("Schema verification failed", Assert.ThrowsAny<Exception>(() => db.Runner().Pending()).ToString());
        Assert.Equal(12, await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }
}
