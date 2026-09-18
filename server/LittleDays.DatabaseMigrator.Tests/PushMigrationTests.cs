using LittleDays.DatabaseMigrator;

namespace LittleDays.DatabaseMigrator.Tests;

public sealed class PushMigrationTests
{
    [SqlFact]
    public async Task UpgradePreservesRecordsVersionsAndLegacyDuplicateTimersWithoutBackfillNotifications()
    {
        await using var db = await TestDatabase.Create();
        db.Runner(scripts: MigrationRunner.Scripts().Take(5).ToArray()).Apply();
        await db.Execute("""
            DECLARE @family uniqueidentifier=NEWID(), @actor uniqueidentifier=NEWID();
            INSERT dbo.Families(Id,BabyName,Revision,CreatedAt) VALUES(@family,'Synthetic',1,SYSUTCDATETIME());
            INSERT dbo.FamilyRecords(FamilyId,Collection,IdHash,Id,RecordJson,RecordedBy,LastEditedBy,Deleted)
            VALUES(@family,'entry','one','one','{"type":"sleep","start":"2026-09-18T00:00:00Z"}',@actor,@actor,0),
                  (@family,'entry','two','two','{"type":"sleep","start":"2026-09-18T00:00:00Z"}',@actor,@actor,0);
            """);
        var before = await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(Version)) FROM dbo.FamilyRecords");
        db.Runner().Apply();
        Assert.Equal(before, await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(Version)) FROM dbo.FamilyRecords"));
        Assert.Equal(2, await db.Count("SELECT COUNT(*) FROM dbo.FamilyRecords WHERE ActiveTimerKind='sleep'"));
        Assert.Equal(0, await db.Count("SELECT COUNT(*) FROM dbo.FamilyNotificationEvents"));
        await db.Execute("UPDATE dbo.FamilyRecords SET Deleted=1,RecordJson='{}' WHERE Id='one';");
        Assert.Equal(1, await db.Count("SELECT COUNT(*) FROM dbo.FamilyRecords WHERE ActiveTimerKind='sleep'"));
        Assert.Empty(db.Runner().Pending());
    }

    [SqlFact]
    public async Task RuntimeCanOperatePushMetadataButCannotChangeSchemaOrJournal()
    {
        await using var db = await TestDatabase.Create(); db.Runner().Apply();
        await db.Execute("CREATE USER PushRuntime WITHOUT LOGIN; ALTER ROLE family_pilot_runtime ADD MEMBER PushRuntime;");
        foreach (var table in new[] { "PushInstallations", "FamilyNotificationEvents", "PushDeliveries", "NotificationSummaryBuckets" })
            foreach (var permission in new[] { "SELECT", "INSERT", "UPDATE", "DELETE" })
                Assert.Equal(1, await db.Count($"EXECUTE AS USER='PushRuntime'; SELECT HAS_PERMS_BY_NAME('dbo.{table}','OBJECT','{permission}'); REVERT;"));
        Assert.Equal(0, await db.Count("EXECUTE AS USER='PushRuntime'; SELECT HAS_PERMS_BY_NAME('dbo','SCHEMA','ALTER'); REVERT;"));
        Assert.Equal(0, await db.Count("EXECUTE AS USER='PushRuntime'; SELECT COALESCE(HAS_PERMS_BY_NAME('dbo.DatabaseMigrations','OBJECT','SELECT'),0); REVERT;"));
    }

    [SqlTheory]
    [InlineData("DROP INDEX IX_NotificationSummaryBuckets_State_DueAt_Id ON dbo.NotificationSummaryBuckets")]
    [InlineData("DROP INDEX IX_FamilyNotificationEvents_HistoryId_ActorUserId_OperationId_Category ON dbo.FamilyNotificationEvents")]
    [InlineData("DROP INDEX IX_PushInstallations_FamilyId ON dbo.PushInstallations")]
    [InlineData("DROP INDEX IX_PushInstallations_MembershipId ON dbo.PushInstallations")]
    [InlineData("DROP INDEX IX_PushInstallations_FamilyId ON dbo.PushInstallations; CREATE INDEX IX_PushInstallations_FamilyId ON dbo.PushInstallations(MembershipId)")]
    [InlineData("ALTER TABLE dbo.PushInstallations NOCHECK CONSTRAINT CK_PushInstallations_CategoryMask")]
    public async Task QueueIndexAndConstraintDriftFailClosed(string mutation)
    {
        await using var db = await TestDatabase.Create(); db.Runner().Apply();
        await db.Execute(mutation);
        Assert.ThrowsAny<Exception>(() => db.Runner().Pending());
    }
}
