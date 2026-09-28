using LittleDays.DatabaseMigrator;

namespace LittleDays.DatabaseMigrator.Tests;

public sealed class TimerAttributionMigrationTests
{
    [SqlFact]
    public async Task UpgradePreservesExistingRecordsAndVersionsAndAddsNullableAttributionIndex()
    {
        await using var db = await TestDatabase.Create();
        db.Runner(scripts: MigrationRunner.Scripts().Take(6).ToArray()).Apply();
        await db.Execute("""
            DECLARE @family uniqueidentifier=NEWID(), @actor uniqueidentifier=NEWID();
            INSERT dbo.Families(Id,BabyName,Revision,CreatedAt)
            VALUES(@family,N'Synthetic',1,SYSUTCDATETIME());
            INSERT dbo.FamilyRecords(FamilyId,Collection,IdHash,Id,RecordJson,RecordedBy,LastEditedBy,Deleted)
            VALUES(@family,'entry','sleep','sleep',N'{"type":"sleep","start":"2026-09-19T00:00:00Z"}',@actor,@actor,0),
                  (@family,'entry','feed','feed',N'{"type":"feed","start":"2026-09-19T01:00:00Z","feedRunning":true}',@actor,@actor,0);
            """);
        var beforeVersions = await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(Version)) FROM dbo.FamilyRecords");

        db.Runner().Apply();

        Assert.Equal(2, await db.Count("""
            SELECT COUNT(*) FROM dbo.FamilyRecords
            WHERE RecordedBy=LastEditedBy AND Deleted=0 AND
                (Id='sleep' AND RecordJson=N'{"type":"sleep","start":"2026-09-19T00:00:00Z"}' OR
                 Id='feed' AND RecordJson=N'{"type":"feed","start":"2026-09-19T01:00:00Z","feedRunning":true}')
            """));
        Assert.Equal(beforeVersions, await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(Version)) FROM dbo.FamilyRecords"));
        Assert.Equal(2, await db.Count("SELECT COUNT(*) FROM dbo.FamilyRecords WHERE TimerEndedBy IS NULL"));
        Assert.Equal(1, await db.Count("""
            SELECT COUNT(*) FROM sys.columns
            WHERE object_id=OBJECT_ID(N'dbo.FamilyRecords') AND name=N'TimerEndedBy'
              AND system_type_id=36 AND max_length=16 AND is_nullable=1 AND is_computed=0
            """));
        Assert.Equal(1, await db.Count("""
            SELECT COUNT(*) FROM sys.indexes i
            WHERE i.object_id=OBJECT_ID(N'dbo.FamilyRecords') AND i.name=N'IX_FamilyRecords_TimerEndedBy'
              AND i.type=2 AND i.is_unique=0 AND i.is_primary_key=0 AND i.is_unique_constraint=0
              AND i.is_disabled=0 AND i.is_hypothetical=0 AND i.has_filter=1
              AND (SELECT COUNT(*) FROM sys.index_columns ic
                   WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id)=1
              AND EXISTS (
                  SELECT 1 FROM sys.index_columns ic
                  JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
                  WHERE ic.object_id=i.object_id AND ic.index_id=i.index_id AND ic.key_ordinal=1
                    AND ic.is_descending_key=0 AND ic.is_included_column=0 AND c.name=N'TimerEndedBy')
            """));
        Assert.Empty(db.Runner().Pending());
    }

    [SqlTheory]
    [InlineData("DROP INDEX IX_FamilyRecords_TimerEndedBy ON dbo.FamilyRecords")]
    [InlineData("DROP INDEX IX_FamilyRecords_TimerEndedBy ON dbo.FamilyRecords; CREATE INDEX IX_FamilyRecords_TimerEndedBy ON dbo.FamilyRecords(TimerEndedBy)")]
    [InlineData("DROP INDEX IX_FamilyRecords_TimerEndedBy ON dbo.FamilyRecords; ALTER TABLE dbo.FamilyRecords ALTER COLUMN TimerEndedBy uniqueidentifier NOT NULL")]
    public async Task AttributionColumnAndIndexDriftFailClosed(string mutation)
    {
        await using var db = await TestDatabase.Create();
        db.Runner().Apply();
        await db.Execute(mutation);

        var error = Assert.ThrowsAny<Exception>(() => db.Runner().Pending());

        Assert.Contains("Schema verification failed", error.ToString(), StringComparison.Ordinal);
        Assert.Contains("TimerEndedBy", error.ToString(), StringComparison.Ordinal);
        Assert.Equal(MigrationRunner.Scripts().Count,
            await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }
}
