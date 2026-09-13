-- Run manually as the Azure SQL Microsoft Entra administrator AFTER migration.
-- No schema changes or membership in db_owner/db_ddladmin are granted to the API.
SET NOCOUNT ON;
SET XACT_ABORT ON;
DECLARE @ExpectedDatabase sysname = N'REPLACE_PILOT_DATABASE';
IF @ExpectedDatabase LIKE N'REPLACE_%' OR DB_NAME() <> @ExpectedDatabase
    OR DB_NAME() IN (N'master', N'tempdb', N'model', N'msdb')
    THROW 50004, 'Select the exact dedicated pilot database and replace its name.', 1;
IF DATABASE_PRINCIPAL_ID(N'family_pilot_runtime') IS NULL
    THROW 50005, 'Run the reviewed bootstrap script first.', 1;
IF OBJECT_ID(N'dbo.Families', N'U') IS NULL OR OBJECT_ID(N'dbo.Memberships', N'U') IS NULL
    OR OBJECT_ID(N'dbo.Invitations', N'U') IS NULL OR OBJECT_ID(N'dbo.Feeds', N'U') IS NULL
    OR OBJECT_ID(N'dbo.Operations', N'U') IS NULL
    THROW 50006, 'Apply the application migration before runtime grants.', 1;

BEGIN TRANSACTION;
GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.Families TO [family_pilot_runtime];
GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.Memberships TO [family_pilot_runtime];
GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.Invitations TO [family_pilot_runtime];
GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.Feeds TO [family_pilot_runtime];
GRANT SELECT, INSERT, UPDATE ON OBJECT::dbo.Operations TO [family_pilot_runtime];
COMMIT;

-- sys.sp_getapplock is executable through the database public role by default.
-- Verify the API can take transaction-owned locks during the synthetic pilot.
-- Do not grant runtime write access to __EFMigrationsHistory or schema ownership.
-- Feed deletion uses a tombstone; runtime does not need DELETE permission.
