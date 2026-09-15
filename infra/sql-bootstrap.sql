-- Run manually as the Azure SQL Microsoft Entra administrator, against the
-- dedicated pilot database, BEFORE running the reviewed application migration.
-- Use an interactive Entra-authenticated SQL client; no SQL password is needed.
-- Replace all three values. Principal names must be unique in the hosting tenant.
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @ExpectedDatabase sysname = N'REPLACE_PILOT_DATABASE';
DECLARE @RuntimeIdentity sysname = N'REPLACE_APP_SERVICE_MANAGED_IDENTITY_NAME';
-- Hosting-tenant service principal for the protected family-database workflow.
-- An operator group may be used for an explicitly reviewed manual deployment.
DECLARE @MigrationGroup sysname = N'REPLACE_ENTRA_MIGRATION_IDENTITY_NAME';

IF @ExpectedDatabase LIKE N'REPLACE_%' OR @RuntimeIdentity LIKE N'REPLACE_%'
    OR @MigrationGroup LIKE N'REPLACE_%'
    THROW 50001, 'Replace all bootstrap values before executing.', 1;
IF DB_NAME() <> @ExpectedDatabase OR DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50002, 'Connect to the exact dedicated pilot database.', 1;
IF @RuntimeIdentity = @MigrationGroup
    THROW 50003, 'Runtime identity and migration operator must be separate.', 1;

BEGIN TRANSACTION;
DECLARE @Sql nvarchar(max);
IF DATABASE_PRINCIPAL_ID(@RuntimeIdentity) IS NULL
BEGIN
    SET @Sql = N'CREATE USER ' + QUOTENAME(@RuntimeIdentity) + N' FROM EXTERNAL PROVIDER;';
    EXEC sys.sp_executesql @Sql;
END;
IF DATABASE_PRINCIPAL_ID(@MigrationGroup) IS NULL
BEGIN
    SET @Sql = N'CREATE USER ' + QUOTENAME(@MigrationGroup) + N' FROM EXTERNAL PROVIDER;';
    EXEC sys.sp_executesql @Sql;
END;
IF DATABASE_PRINCIPAL_ID(N'family_pilot_runtime') IS NULL
    CREATE ROLE [family_pilot_runtime] AUTHORIZATION [dbo];

SET @Sql = N'GRANT CONNECT TO ' + QUOTENAME(@RuntimeIdentity) + N';';
EXEC sys.sp_executesql @Sql;
SET @Sql = N'ALTER ROLE [family_pilot_runtime] ADD MEMBER ' + QUOTENAME(@RuntimeIdentity) + N';';
EXEC sys.sp_executesql @Sql;
-- Schema control permits DDL, data migrations and per-table runtime grants.
-- This is a privileged identity: protect its workflow. It is NOT db_owner,
-- a database/security administrator or the API runtime/deployment identity.
SET @Sql = N'ALTER USER ' + QUOTENAME(@MigrationGroup) + N' WITH DEFAULT_SCHEMA=dbo;';
EXEC sys.sp_executesql @Sql;
SET @Sql = N'GRANT CONNECT, CREATE TABLE TO ' + QUOTENAME(@MigrationGroup) + N';';
EXEC sys.sp_executesql @Sql;
SET @Sql = N'GRANT CONTROL ON SCHEMA::dbo TO ' + QUOTENAME(@MigrationGroup) + N';';
EXEC sys.sp_executesql @Sql;
COMMIT;

-- Next: run the protected DbUp release workflow. Its numbered scripts initialize
-- schema and grant runtime access. No separate runtime-grants step is needed.
