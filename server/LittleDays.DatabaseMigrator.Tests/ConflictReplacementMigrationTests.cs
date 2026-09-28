using LittleDays.DatabaseMigrator;
using Microsoft.Data.SqlClient;

namespace LittleDays.DatabaseMigrator.Tests;

public sealed class ConflictReplacementMigrationTests
{
    [SqlFact]
    public async Task UpgradePreservesRecordsAndVersionsAndAddsNullableBoundedAudit()
    {
        await using var db = await TestDatabase.Create();
        db.Runner(scripts: MigrationRunner.Scripts().Take(8).ToArray()).Apply();
        await db.Execute("""
            DECLARE @family uniqueidentifier=NEWID(), @actor uniqueidentifier=NEWID();
            INSERT dbo.Families(Id,BabyName,Revision,CreatedAt)
            VALUES(@family,N'Synthetic',1,SYSUTCDATETIME());
            INSERT dbo.FamilyRecords(FamilyId,Collection,IdHash,Id,RecordJson,RecordedBy,LastEditedBy,Deleted)
            VALUES(@family,'entry','feed','feed',N'{"id":"feed","type":"feed","start":"2026-09-21T09:00:00Z","end":"2026-09-21T09:10:00Z","feedKind":"formula","amount":90,"note":""}',@actor,@actor,0);
            """);
        var beforeVersion = await db.Count("SELECT CHECKSUM(Version) FROM dbo.FamilyRecords WHERE Id='feed'");

        db.Runner().Apply();

        Assert.Equal(beforeVersion,
            await db.Count("SELECT CHECKSUM(Version) FROM dbo.FamilyRecords WHERE Id='feed'"));
        Assert.Equal(1, await db.Count("""
            SELECT COUNT(*) FROM dbo.FamilyRecords
            WHERE Id='feed' AND ConflictReplacedBy IS NULL AND ConflictPreviousEditedBy IS NULL
              AND ConflictReplacedAt IS NULL AND ConflictPreviousJson IS NULL
            """));
        Assert.Equal(4, await db.Count("""
            SELECT COUNT(*) FROM sys.columns
            WHERE object_id=OBJECT_ID(N'dbo.FamilyRecords') AND name IN
              (N'ConflictReplacedBy',N'ConflictPreviousEditedBy',N'ConflictReplacedAt',N'ConflictPreviousJson')
              AND is_nullable=1 AND is_computed=0
            """));
        Assert.Equal(2, await db.Count("""
            SELECT COUNT(*) FROM sys.indexes
            WHERE object_id=OBJECT_ID(N'dbo.FamilyRecords')
              AND name IN (N'IX_FamilyRecords_ConflictReplacedBy',N'IX_FamilyRecords_ConflictPreviousEditedBy')
              AND type=2 AND is_unique=0 AND is_disabled=0 AND is_hypothetical=0 AND has_filter=1
            """));
        Assert.Equal(1, await db.Count("""
            SELECT COUNT(*) FROM sys.check_constraints
            WHERE parent_object_id=OBJECT_ID(N'dbo.FamilyRecords')
              AND name=N'CK_FamilyRecords_ConflictReplacement'
              AND is_disabled=0 AND is_not_trusted=0
            """));
        await Assert.ThrowsAsync<SqlException>(() => db.Execute("""
            UPDATE dbo.FamilyRecords SET ConflictReplacedBy=NEWID() WHERE Id='feed';
            """));
        Assert.Empty(db.Runner().Pending());
    }

    [SqlTheory]
    [InlineData("DROP INDEX IX_FamilyRecords_ConflictReplacedBy ON dbo.FamilyRecords")]
    [InlineData("DROP INDEX IX_FamilyRecords_ConflictPreviousEditedBy ON dbo.FamilyRecords; CREATE INDEX IX_FamilyRecords_ConflictPreviousEditedBy ON dbo.FamilyRecords(ConflictPreviousEditedBy)")]
    [InlineData("ALTER TABLE dbo.FamilyRecords DROP CONSTRAINT CK_FamilyRecords_ConflictReplacement")]
    [InlineData("ALTER TABLE dbo.FamilyRecords ALTER COLUMN ConflictPreviousJson nvarchar(512) NULL")]
    public async Task AuditColumnIndexAndConstraintDriftFailClosed(string mutation)
    {
        await using var db = await TestDatabase.Create();
        db.Runner().Apply();
        await db.Execute(mutation);

        var error = Assert.ThrowsAny<Exception>(() => db.Runner().Pending());

        Assert.Contains("Schema verification failed", error.ToString(), StringComparison.Ordinal);
        Assert.Contains("Conflict", error.ToString(), StringComparison.Ordinal);
        Assert.Equal(MigrationRunner.Scripts().Count,
            await db.Count("SELECT COUNT(*) FROM dbo.DatabaseMigrations"));
    }
}
