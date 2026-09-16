# LittleDays.DatabaseMigrator

Standalone .NET 10 / DbUp console application. SQL files are embedded, ordered and journaled with normalized SHA-256 checksums in `dbo.DatabaseMigrations`. The API has no migration execution path.

For Azure/GitHub setup, use [the database deployment guide](../../docs/AZURE-DATABASE-DEPLOYMENT.md). Normal releases run this project before API deployment, using a separate OIDC identity.

## Local operator commands

An explicitly authorized hosting-tenant operator may use the same console with Azure CLI login and temporary exact operator-IP access. The database and SQL permissions must already exist; it never creates a database or logs into Azure itself.

```powershell
az login --tenant 7b7e6e31-a778-4334-aee2-e969fa27fd0e
az account set --subscription 4768a858-f23f-4a39-bb64-eabc9c142627
$env:FAMILY_DB_SERVER = 'little-days-sql-522fpstfbtds2.database.windows.net'
$env:FAMILY_DB_NAME = 'little-days-family'
$env:FAMILY_DB_TENANT_ID = '7b7e6e31-a778-4334-aee2-e969fa27fd0e'
dotnet run --project server/LittleDays.DatabaseMigrator -- --check
# Only after review:
dotnet run --project server/LittleDays.DatabaseMigrator -- --apply
```

`--check` acquires a transaction-owned exclusive lock, validates journal/history and lists pending filenames without schema writes. `--apply` executes all pending scripts and journal writes in one transaction. `--adopt-ef` allows explicit adoption of an existing known EF history prefix; it does not permit arbitrary databases or skip SQL baseline assertions. Authentication uses Azure CLI's identity and a SQL access token; TLS certificate validation is mandatory. The CLI reports generic errors to avoid exposing SQL data, credentials or connection strings in CI.

## New migrations

Add the next uniquely numbered `Scripts/0005_Description.sql`; never modify applied scripts. Use plain transaction-compatible SQL with optional `GO` separators. SQL variable substitution is disabled. Include table-specific runtime grants when adding a table used by the API. The runtime must never receive schema control or journal access. New object types needing additional CREATE permissions require separate bootstrap review.

`0001_LegacySchemaBaseline.sql` freezes the three historical EF migrations. `0002_VerifyBaselineAndRuntimeGrants.sql` checks key schema invariants and grants runtime DML. `0003_FamilySharedExtras.sql` adds shared-photo, reminder and play-record constraint support without replacing existing data. `0004_FamilyAvailabilityBounds.sql` adds completed-purge bookkeeping and indexing for bounded cleanup; deploy it before the security-hardened API. Historical EF source remains excluded from the API build and is compiled only into adoption tests. Future migrations belong here, not in EF's migration folder.

Run both backend test projects with actual disposable SQL Server:

```powershell
$env:FAMILY_TEST_SQL_CONNECTION = 'Server=localhost;Database=master;Integrated Security=true;TrustServerCertificate=true'
dotnet test server/LittleDays.slnx --configuration Release
```

Tests create/drop only generated test databases. SQL tests explicitly skip if no test connection is provided. They cover fresh initialization, reruns, checksum tampering, transactions, locking, legacy adoption, unknown schemas and migration/runtime permission separation. Local SQL tests do not verify live Azure OIDC, firewall propagation or customer authentication.
