using System.Xml.Linq;
using LittleDays.DatabaseMigrator;
using LittleDays.FamilyApi;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace LittleDays.DatabaseMigrator.Tests;

public sealed class OperationIndexMigrationTests
{
    private static readonly Guid FamilyOne = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid FamilyTwo = Guid.Parse("22222222-2222-2222-2222-222222222222");

    [SqlFact]
    public async Task UpgradeBackfillsLargeReceiptHistoryWithoutChangingReceiptsOrProfileVersions()
    {
        await using var db = await TestDatabase.Create();
        db.Runner(scripts: MigrationRunner.Scripts().Take(4).ToArray()).Apply();
        await AddFamilies(db);
        await db.Execute($"""
            INSERT dbo.Operations(UserId,OperationId,FamilyId,MembershipId,HistoryId,Action,Fingerprint,ResultJson,CreatedAt)
            SELECT TOP (100000) '{FamilyOne}',NEWID(),'{FamilyOne}',NEWID(),NEWID(),'fixture','retained',NCHAR(123)+NCHAR(125),SYSUTCDATETIME()
            FROM sys.all_objects a CROSS JOIN sys.all_objects b;
            INSERT dbo.Operations(UserId,OperationId,FamilyId,MembershipId,HistoryId,Action,Fingerprint,ResultJson,CreatedAt)
            SELECT TOP (3000) '{FamilyTwo}',NEWID(),'{FamilyTwo}',NEWID(),NEWID(),'fixture','retained',NCHAR(123)+NCHAR(125),SYSUTCDATETIME()
            FROM sys.all_objects a CROSS JOIN sys.all_objects b;
            """);
        var beforeVersion = await db.Count("SELECT CHECKSUM_AGG(CHECKSUM(ProfileVersion)) FROM dbo.Families");
        var beforeReceipts = await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.Operations");

        db.Runner().Apply();

        Assert.Equal(103000, await db.Count("SELECT COUNT(*) FROM dbo.Operations"));
        Assert.Equal(beforeReceipts, await db.Count("SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM dbo.Operations"));
        Assert.Equal(beforeVersion, await db.Count("SELECT CHECKSUM_AGG(CHECKSUM(ProfileVersion)) FROM dbo.Families"));
        Assert.Equal(100000, await db.Count($"SELECT ReceiptCount FROM dbo.FamilyOperationCounts WHERE FamilyId='{FamilyOne}'"));
        Assert.Equal(3000, await db.Count($"SELECT ReceiptCount FROM dbo.FamilyOperationCounts WHERE FamilyId='{FamilyTwo}'"));

        using var connection = db.Connection();
        await using var context = new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(connection).Options);
        Assert.Equal(100000, await context.FamilyOperationCounts.Where(x => x.FamilyId == FamilyOne).Select(x => x.ReceiptCount).SingleAsync());
        var plan = await EstimatedPlan(db, $"SELECT ReceiptCount FROM dbo.FamilyOperationCounts WHERE FamilyId='{FamilyOne}'");
        Assert.Contains("[PK_FamilyOperationCounts]", IndexNames(plan));
        Assert.DoesNotContain(plan.Descendants().Where(x => x.Name.LocalName == "Object"),
            x => (string?)x.Attribute("Table") == "[Operations]");
        Assert.Empty(db.Runner().Pending());
    }

    [SqlFact]
    public async Task TriggerHandlesMultirowMovesDeletesRollbacksAndRestrictedRuntime()
    {
        await using var db = await TestDatabase.Create();
        db.Runner().Apply();
        await AddFamilies(db);
        await db.Execute("CREATE USER CounterRuntime WITHOUT LOGIN; ALTER ROLE family_pilot_runtime ADD MEMBER CounterRuntime;");
        Assert.Equal(1, await db.Count("EXECUTE AS USER='CounterRuntime'; SELECT HAS_PERMS_BY_NAME('dbo.FamilyOperationCounts','OBJECT','SELECT'); REVERT;"));
        Assert.Equal(0, await db.Count("EXECUTE AS USER='CounterRuntime'; SELECT HAS_PERMS_BY_NAME('dbo.FamilyOperationCounts','OBJECT','UPDATE'); REVERT;"));
        Assert.Equal(0, await db.Count("EXECUTE AS USER='CounterRuntime'; SELECT HAS_PERMS_BY_NAME('dbo.FamilyOperationCounts','OBJECT','INSERT'); REVERT;"));
        Assert.Equal(0, await db.Count("EXECUTE AS USER='CounterRuntime'; SELECT HAS_PERMS_BY_NAME('dbo.FamilyOperationCounts','OBJECT','DELETE'); REVERT;"));

        await db.Execute($"""
            EXECUTE AS USER='CounterRuntime';
            INSERT dbo.Operations(UserId,OperationId,FamilyId,MembershipId,HistoryId,Action,Fingerprint,ResultJson,CreatedAt)
            SELECT NEWID(),NEWID(),Id,NEWID(),NEWID(),'fixture','retained',NCHAR(123)+NCHAR(125),SYSUTCDATETIME()
            FROM dbo.Families CROSS JOIN (VALUES(1),(2),(3)) AS items(n);
            REVERT;
            """);
        Assert.Equal(3, await db.Count($"SELECT ReceiptCount FROM dbo.FamilyOperationCounts WHERE FamilyId='{FamilyOne}'"));
        Assert.Equal(3, await db.Count($"SELECT ReceiptCount FROM dbo.FamilyOperationCounts WHERE FamilyId='{FamilyTwo}'"));
        await db.Execute($"UPDATE dbo.Operations SET FamilyId='{FamilyTwo}' WHERE FamilyId='{FamilyOne}';");
        Assert.Equal(0, await db.Count($"SELECT ReceiptCount FROM dbo.FamilyOperationCounts WHERE FamilyId='{FamilyOne}'"));
        Assert.Equal(6, await db.Count($"SELECT ReceiptCount FROM dbo.FamilyOperationCounts WHERE FamilyId='{FamilyTwo}'"));
        await db.Execute("UPDATE dbo.Operations SET Action='changed';");
        Assert.Equal(6, await db.Count("SELECT SUM(ReceiptCount) FROM dbo.FamilyOperationCounts"));
        await db.Execute("BEGIN TRANSACTION; DELETE dbo.Operations; IF EXISTS(SELECT 1 FROM dbo.FamilyOperationCounts WHERE ReceiptCount<>0) THROW 51000, 'Counter did not follow transactional delete.', 1; ROLLBACK;");
        Assert.Equal(6, await db.Count("SELECT SUM(ReceiptCount) FROM dbo.FamilyOperationCounts"));

        using var connection = db.Connection();
        await using var context = new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(connection).Options);
        Assert.Equal(6, await context.Operations.Where(x => x.FamilyId == FamilyTwo).ExecuteDeleteAsync());
        Assert.Equal(0, await db.Count("SELECT SUM(ReceiptCount) FROM dbo.FamilyOperationCounts"));
        await Assert.ThrowsAsync<SqlException>(() => db.Execute("UPDATE dbo.FamilyOperationCounts SET ReceiptCount=-1;"));
    }

    [SqlFact]
    public async Task CurrentAndLegacyEfReceiptInsertsRemainCompatibleWithTrigger()
    {
        await using var db = await TestDatabase.Create();
        db.Runner().Apply();
        await AddFamilies(db);
        using (var connection = db.Connection())
        await using (var current = new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(connection).Options))
        {
            current.Operations.AddRange(Enumerable.Range(0, 50).Select(_ => Receipt(FamilyOne)));
            await current.SaveChangesAsync();
        }
        // The previous API model has no trigger/output opt-out. Its receipt keys
        // are client generated, so both single and batched inserts must still work
        // while the schema-first deployment temporarily serves the previous API.
        using (var connection = db.Connection())
        await using (var legacy = new LegacyReceiptDatabase(new DbContextOptionsBuilder<LegacyReceiptDatabase>().UseSqlServer(connection).Options))
        {
            legacy.Add(Receipt(FamilyTwo));
            await legacy.SaveChangesAsync();
            legacy.AddRange(Enumerable.Range(0, 50).Select(_ => Receipt(FamilyTwo)));
            await legacy.SaveChangesAsync();
        }
        Assert.Equal(50, await db.Count($"SELECT ReceiptCount FROM dbo.FamilyOperationCounts WHERE FamilyId='{FamilyOne}'"));
        Assert.Equal(51, await db.Count($"SELECT ReceiptCount FROM dbo.FamilyOperationCounts WHERE FamilyId='{FamilyTwo}'"));
    }

    [SqlFact]
    public async Task ConcurrentFirstReceiptsProduceOneAccurateCounter()
    {
        await using var db = await TestDatabase.Create();
        db.Runner().Apply();
        await AddFamilies(db);
        var tasks = Enumerable.Range(0, 8).Select(async _ =>
        {
            using var connection = db.Connection();
            await using var context = new PilotDatabase(new DbContextOptionsBuilder<PilotDatabase>().UseSqlServer(connection).Options);
            context.Operations.AddRange(Enumerable.Range(0, 10).Select(_ => Receipt(FamilyOne)));
            await context.SaveChangesAsync();
        });
        await Task.WhenAll(tasks);
        Assert.Equal(80, await db.Count($"SELECT ReceiptCount FROM dbo.FamilyOperationCounts WHERE FamilyId='{FamilyOne}'"));
        Assert.Equal(1, await db.Count("SELECT COUNT(*) FROM dbo.FamilyOperationCounts"));
    }

    [SqlFact]
    public async Task RecipientHistoryAndPurgePlansUseTheNewAccessPathsOnManyFamilies()
    {
        await using var db = await TestDatabase.Create();
        db.Runner().Apply();
        await db.Execute("""
            INSERT dbo.Families(Id,BabyName,Revision,CreatedAt,DeletedAt)
            SELECT TOP (1000) NEWID(),N'Fixture',1,SYSUTCDATETIME(),SYSUTCDATETIME() FROM sys.all_objects;
            INSERT dbo.Invitations(Id,FamilyId,RecipientUserId,Email,Status,CreatedAt,ExpiresAt)
            SELECT NEWID(),family.Id,NEWID(),CONCAT('recipient',n.n,'@example.invalid'),
                CASE WHEN n.n=1 THEN N'pending' ELSE N'expired' END,
                DATEADD(day,-n.n,SYSUTCDATETIME()),DATEADD(day,n.n,SYSUTCDATETIME())
            FROM dbo.Families family CROSS JOIN (VALUES(1),(2),(3),(4),(5),(6),(7),(8),(9),(10)) n(n);
            UPDATE STATISTICS dbo.Families WITH FULLSCAN;
            UPDATE STATISTICS dbo.Invitations WITH FULLSCAN;
            """);
        var inbox = await EstimatedPlan(db, "SELECT FamilyId,CreatedAt,ExpiresAt FROM dbo.Invitations WHERE Email=N'recipient1@example.invalid' AND Status=N'pending' AND ExpiresAt>SYSUTCDATETIME() ORDER BY CreatedAt DESC");
        Assert.Contains("[IX_Invitations_Email_Status_ExpiresAt]", IndexNames(inbox));
        var populatedFamily = await ExistingFamily(db);
        Assert.Equal(10, await db.Count($"SELECT COUNT(*) FROM dbo.Invitations WHERE FamilyId='{populatedFamily}'"));
        var history = await EstimatedPlan(db, $"SELECT TOP(100) * FROM dbo.Invitations WHERE FamilyId='{populatedFamily}' ORDER BY CASE WHEN Status=N'pending' THEN 0 ELSE 1 END,CreatedAt DESC");
        Assert.Contains("[IX_Invitations_FamilyId_CreatedAt]", IndexNames(history));
        var purge = await EstimatedPlan(db, "SELECT TOP(10) Id FROM dbo.Families WHERE DeletedAt IS NOT NULL AND PurgedAt IS NULL ORDER BY DeletedAt,Id");
        Assert.Contains("[IX_Families_DeletedAt]", IndexNames(purge));
        Assert.DoesNotContain("[PK_Families]", IndexNames(purge));
    }

    [SqlFact]
    public async Task SelectiveAccountErasureLookupsUseNarrowIndexesAmongManyUnrelatedRecords()
    {
        await using var db = await TestDatabase.Create();
        db.Runner().Apply();
        await db.Execute("""
            INSERT dbo.Families(Id,BabyName,Revision,CreatedAt)
            SELECT TOP (1000) NEWID(),N'Fixture',1,SYSUTCDATETIME() FROM sys.all_objects;
            """);
        var populatedFamily = await ExistingFamily(db);
        var userId = Guid.NewGuid();
        await db.Execute($$"""
            INSERT dbo.FamilyRecords(FamilyId,Collection,IdHash,Id,RecordJson,RecordedBy,LastEditedBy,Deleted)
            SELECT family.Id,'care',CONVERT(varchar(64),HASHBYTES('SHA2_256',CONVERT(varchar(10),n.n)),2),
                CONVERT(nvarchar(128),n.n),N'{"kind":"bath"}',
                CASE WHEN family.Id='{{populatedFamily}}' AND n.n=1 THEN '{{userId}}' ELSE NEWID() END,
                CASE WHEN family.Id='{{populatedFamily}}' AND n.n=2 THEN '{{userId}}' ELSE NEWID() END,0
            FROM dbo.Families family CROSS JOIN (VALUES(1),(2),(3),(4),(5),(6),(7),(8),(9),(10)) n(n);
            INSERT dbo.Invitations(Id,FamilyId,RecipientUserId,Email,Status,CreatedAt,ExpiresAt)
            SELECT NEWID(),family.Id,
                CASE WHEN family.Id='{{populatedFamily}}' AND n.n=1 THEN '{{userId}}' ELSE NEWID() END,
                CASE WHEN family.Id='{{populatedFamily}}' AND n.n=2 THEN N'erasure@example.invalid'
                    ELSE CONCAT('unrelated',n.n,'@example.invalid') END,
                N'expired',SYSUTCDATETIME(),SYSUTCDATETIME()
            FROM dbo.Families family CROSS JOIN (VALUES(1),(2),(3),(4),(5),(6),(7),(8),(9),(10)) n(n);
            UPDATE STATISTICS dbo.FamilyRecords WITH FULLSCAN;
            UPDATE STATISTICS dbo.Invitations WITH FULLSCAN;
            """);
        var authorPredicate = $"RecordedBy='{userId}' OR LastEditedBy='{userId}'";
        var recipientPredicate = $"RecipientUserId='{userId}' OR Email=N'erasure@example.invalid'";
        Assert.Equal(2, await db.Count($"SELECT COUNT(*) FROM dbo.FamilyRecords WHERE {authorPredicate}"));
        Assert.Equal(2, await db.Count($"SELECT COUNT(*) FROM dbo.Invitations WHERE {recipientPredicate}"));

        var author = await EstimatedPlan(db, $"SELECT DISTINCT FamilyId FROM dbo.FamilyRecords WHERE {authorPredicate}");
        var recipient = await EstimatedPlan(db, $"SELECT DISTINCT FamilyId FROM dbo.Invitations WHERE {recipientPredicate}");
        // Permit index union, concatenation, lookup and sort variants; only check
        // that these selective lookups have avoided a global clustered-table scan.
        Assert.Contains(IndexNames(author), name => name is "[IX_FamilyRecords_RecordedBy]" or "[IX_FamilyRecords_LastEditedBy]");
        Assert.Contains(IndexNames(recipient), name => name is "[IX_Invitations_RecipientUserId]" or "[IX_Invitations_Email_Status_ExpiresAt]");
        Assert.DoesNotContain(author.Descendants().Concat(recipient.Descendants()),
            node => node.Name.LocalName == "RelOp" && (string?)node.Attribute("PhysicalOp") == "Clustered Index Scan");
    }

    private static Task AddFamilies(TestDatabase db) => db.Execute($"""
        INSERT dbo.Families(Id,BabyName,Revision,CreatedAt) VALUES
        ('{FamilyOne}',N'First',1,SYSUTCDATETIME()),('{FamilyTwo}',N'Second',1,SYSUTCDATETIME());
        """);

    private static OperationRow Receipt(Guid familyId) => new()
    {
        UserId = Guid.NewGuid(), OperationId = Guid.NewGuid(), FamilyId = familyId,
        MembershipId = Guid.NewGuid(), HistoryId = Guid.NewGuid(), Action = "fixture",
        Fingerprint = "retained", ResultJson = "{}", CreatedAt = DateTimeOffset.UtcNow
    };

    private static IEnumerable<string?> IndexNames(XDocument plan) => plan.Descendants()
        .Where(x => x.Name.LocalName == "Object").Select(x => (string?)x.Attribute("Index"));

    private static async Task<Guid> ExistingFamily(TestDatabase db)
    {
        using var connection = db.Connection();
        await connection.OpenAsync();
        using var command = new SqlCommand("SELECT TOP(1) Id FROM dbo.Families ORDER BY Id", connection);
        return (Guid)(await command.ExecuteScalarAsync())!;
    }

    private static async Task<XDocument> EstimatedPlan(TestDatabase db, string sql)
    {
        using var connection = db.Connection();
        await connection.OpenAsync();
        using var command = new SqlCommand("SET SHOWPLAN_XML ON", connection);
        await command.ExecuteNonQueryAsync();
        command.CommandText = sql;
        return XDocument.Parse((string)(await command.ExecuteScalarAsync())!);
    }

    private sealed class LegacyReceiptDatabase(DbContextOptions<LegacyReceiptDatabase> options) : DbContext(options)
    {
        protected override void OnModelCreating(ModelBuilder model)
        {
            model.Entity<OperationRow>(entity =>
            {
                entity.ToTable("Operations");
                entity.HasKey(x => new { x.UserId, x.OperationId });
                entity.Property(x => x.Fingerprint).HasMaxLength(64).IsUnicode(false);
                entity.Property(x => x.Action).HasMaxLength(40).IsUnicode(false);
                entity.Property(x => x.ResultJson).HasMaxLength(2048);
            });
        }
    }
}
