-- Read-only operator checks. Connect using the hosting Entra SQL administrator
-- directly to little-days-family, not master. Running this wakes paused SQL.
-- Do not publish the output to public logs. No customer payloads are selected.
SET NOCOUNT ON;
IF DB_NAME() <> N'little-days-family'
    THROW 51000, 'Wrong database: stop Basic preflight.', 1;

SELECT DB_NAME() AS DatabaseName,
       DATABASEPROPERTYEX(DB_NAME(), 'Edition') AS Edition,
       DATABASEPROPERTYEX(DB_NAME(), 'ServiceObjective') AS ServiceObjective,
       DATABASEPROPERTYEX(DB_NAME(), 'MaxSizeInBytes') AS MaxSizeInBytes;

-- BOTH used and allocated ROWS files must fit. Never silently shrink files.
SELECT SUM(CONVERT(bigint, size)) * 8192 AS AllocatedDataBytes,
       SUM(CONVERT(bigint, FILEPROPERTY(name, 'SpaceUsed'))) * 8192 AS UsedDataBytes,
       CONVERT(bigint, 2147483648) AS BasicMaxDataBytes
FROM sys.database_files
WHERE type_desc = 'ROWS';

IF EXISTS (SELECT 1 FROM sys.database_files WHERE type_desc = 'ROWS'
           AND FILEPROPERTY(name, 'SpaceUsed') IS NULL)
    THROW 51000, 'Data usage could not be measured; stop Basic preflight.', 1;
IF (SELECT SUM(CONVERT(bigint, size)) * 8192 FROM sys.database_files WHERE type_desc = 'ROWS') > 2147483648
    THROW 51000, 'Allocated data exceeds Basic capacity; no automatic shrink is permitted.', 1;
IF (SELECT SUM(CONVERT(bigint, FILEPROPERTY(name, 'SpaceUsed'))) * 8192 FROM sys.database_files WHERE type_desc = 'ROWS') > 1610612736
    THROW 51000, 'Less than 25 percent Basic storage headroom; review S0 instead.', 1;

-- TDE is supported on Azure SQL Basic and must remain enabled. Other persisted
-- features require review; this DMV also lists SQL Server edition restrictions.
SELECT feature_name FROM sys.dm_db_persisted_sku_features;
SELECT COUNT_BIG(*) AS MemoryOptimizedTableCount FROM sys.tables WHERE is_memory_optimized = 1;
SELECT COUNT_BIG(*) AS ColumnstoreIndexCount FROM sys.indexes WHERE type IN (5, 6);
SELECT is_cdc_enabled AS ChangeDataCaptureEnabled FROM sys.databases WHERE database_id = DB_ID();
IF EXISTS (SELECT 1 FROM sys.dm_db_persisted_sku_features WHERE feature_name <> N'TransparentDatabaseEncryption')
    OR EXISTS (SELECT 1 FROM sys.tables WHERE is_memory_optimized = 1)
    OR EXISTS (SELECT 1 FROM sys.indexes WHERE type IN (5, 6))
    OR EXISTS (SELECT 1 FROM sys.databases WHERE database_id = DB_ID() AND is_cdc_enabled = 1)
    THROW 51000, 'A tier-dependent feature requires review; do not remove it automatically.', 1;

-- Aggregate baselines only; these are not a backup or proof of identical data.
SELECT s.name AS SchemaName, t.name AS TableName, SUM(p.rows) AS ApproximateRows
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.partitions AS p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE t.is_ms_shipped = 0
GROUP BY s.name, t.name
ORDER BY s.name, t.name;

SELECT ScriptName, Sha256 FROM dbo.DatabaseMigrations ORDER BY ScriptName;
SELECT OBJECT_NAME(object_id) AS TableName, name AS IndexName, is_disabled
FROM sys.indexes
WHERE object_id IN (OBJECT_ID(N'dbo.FamilyRecords'), OBJECT_ID(N'dbo.Operations'),
                   OBJECT_ID(N'dbo.Memberships'), OBJECT_ID(N'dbo.Invitations'))
  AND index_id > 0
ORDER BY TableName, IndexName;
SELECT name AS TriggerName, is_disabled FROM sys.triggers WHERE parent_class = 1;

-- Restricted operator inventory: these are database identities, not app users.
SELECT name, type_desc, sid, default_schema_name
FROM sys.database_principals
WHERE type IN ('E', 'X') OR name = N'family_pilot_runtime'
ORDER BY name;
SELECT r.name AS RoleName, m.name AS MemberName
FROM sys.database_role_members AS rm
JOIN sys.database_principals AS r ON r.principal_id = rm.role_principal_id
JOIN sys.database_principals AS m ON m.principal_id = rm.member_principal_id
ORDER BY r.name, m.name;
SELECT p.name AS PrincipalName, g.class_desc, g.major_id, g.minor_id,
       g.permission_name, g.state_desc
FROM sys.database_permissions AS g
JOIN sys.database_principals AS p ON p.principal_id = g.grantee_principal_id
WHERE p.type IN ('E', 'X') OR p.name = N'family_pilot_runtime'
ORDER BY p.name, g.class, g.major_id, g.minor_id, g.permission_name;

SELECT COUNT_BIG(*) AS OperationCounterMismatches
FROM dbo.Families AS f
LEFT JOIN dbo.FamilyOperationCounts AS c ON c.FamilyId = f.Id
OUTER APPLY (SELECT COUNT_BIG(*) AS ActualCount FROM dbo.Operations AS o WHERE o.FamilyId = f.Id) AS actual
WHERE COALESCE(c.ReceiptCount, 0) <> actual.ActualCount;
