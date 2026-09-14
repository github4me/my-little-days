# Little Days invitation pilot API

.NET 10 Minimal API with EF Core SQL Server. This is the synthetic completed-bottle-feed pilot described in [the contract](../docs/FAMILY-PILOT-CONTRACT.md), not synchronization of the local app database. Infrastructure setup and release gates are in [the setup guide](../docs/AZURE-FAMILY-PILOT-SETUP.md).

## Build and test

```powershell
# Needed only on Windows machines whose SDK workload initializer is broken.
$env:MSBuildEnableWorkloadResolver = 'false'
dotnet build server/LittleDays.FamilyApi

# Use a local or disposable SQL Server login allowed to CREATE DATABASE.
# Must target master. Tests create and drop only their own GUID-named databases.
$env:FAMILY_TEST_SQL_CONNECTION = 'Server=localhost;Database=master;Integrated Security=true;TrustServerCertificate=true'
dotnet test server/LittleDays.FamilyApi.Tests
```

Without `FAMILY_TEST_SQL_CONNECTION`, non-SQL authentication/configuration/directory-adapter tests run and SQL-specific tests are explicitly skipped. There is no EF in-memory or SQLite substitute for SQL rowversion, transaction-lock, filtered-index and migration tests. HTTP tests supply signed test JWT metadata within the test assembly; the deployed project has no authentication bypass. Directory adapter tests use scripted HTTP, not a live tenant.

## Configuration and running

Use environment variables or the host configuration provider; no secrets belong in source control. Colon-separated configuration keys use double underscores in environment variables. Required settings:

- `ConnectionStrings:FamilyDatabase`: SQL connection string. Production uses Entra managed identity and encrypted transport; local test `TrustServerCertificate=true` is only for local test SQL.
- `Entra:TenantId`, `Entra:Audience`, `Entra:MobileClientId`: external tenant ID, API application client ID, and approved native application client ID.
- `Family:PublicBaseUrl`: HTTPS origin only, without a path/query/fragment.
- `Family:HistoryId`: environment/history GUID. Rotate after a database restore and replace every replica consistently before serving traffic.
- `Pilot:Identities`: 0–20 explicit, operator-checked `{ ObjectId, Email, DisplayName }` bindings. An empty list admits nobody but keeps health and deletion-status receipts available. Account identity comes from validated tenant + `oid`; generic email claims never admit a user or prove invitation ownership. Use synthetic identities and do not reassign an existing object ID to a different person.

Startup fails closed if required settings or identity bindings are invalid. The tenant authority is `https://<tenantId>.ciamlogin.com/<tenantId>/v2.0`. JWT checks require signature, exact issuer/audience, expiry, v2 `ver`, `tid`, native `azp`, and delegated `scp=Family.ReadWrite`.

Run migrations as a separate operator identity before starting the app:

```powershell
$env:ConnectionStrings__FamilyDatabase = '<migration-identity connection string>'
dotnet run --project server/LittleDays.FamilyApi -- --migrate
# Configure runtime identity, Entra/Family settings and checked Pilot identities, then:
dotnet run --project server/LittleDays.FamilyApi
```

`--migrate` requires only database configuration, applies EF migrations, and exits. Normal startup never migrates. For maintenance, run `dotnet tool restore` from `server`, then `dotnet ef` with `--project LittleDays.FamilyApi`; EF tooling requires the connection explicitly. Apply the revised [runtime grants](../infra/sql-runtime-grants.sql), including `OwnershipTransfers`/`AccountDeletions` and content-table DELETE for the cleanup worker. No database ownership or schema changes are granted. The new migration retires legacy pending token invitations; use coordinated API/mobile builds.

## Deliberate pilot limits

| `Pilot` setting | Default | Allowed range |
| --- | ---: | ---: |
| `MaxMembers` | 4 | 2–20 |
| `MaxFeeds` | 1000 | 1–10000 |
| `MaxOperationsPerFamily` | 100000 | 10–1000000 |
| `MaxNoteLength` | 500 | 1–500 |
| `MaxBabyNameLength` | 60 | 1–60 |
| `RequestsPerMinute` | 120 | 1–600 |
| `SensitiveRequestsPerMinute` | 10 | 1–60 |

Feed amounts allow 0–2000 mL with at most two decimal places. Notes allow line breaks/tabs, but no other control characters. Start/end must be completed timestamps from 1970 onwards, end cannot precede start, and end may be at most two minutes ahead of server UTC. Requests are limited to 16 KiB, JSON depth 16, and known fields.

The feed cap counts ordinary deletion tombstones. The operation cap bounds ordinary writes; access-revocation paths remain available. Successful retries cannot repeat membership grants or ownership transitions. Email invitations contain no share token, can precede registration and expire after 30 days. Only the checked matching recipient can accept/decline. New invitation operations replace pending invitations to that email; a family can hold at most 100 pending invitations.

Snapshots include member lifecycle status, nondeleted feeds, name/birth-date profile and any pending ownership transfer. Admins edit any record; caregivers edit their own only. Profile writes are admin-only. Ordinary members do not receive other members' email addresses or the owner's invitation-management list. Inbox discovery is recipient-scoped, with no baby records before acceptance. Conditional snapshots authorize membership before comparing ETags.

Every authenticated data request acquires one SQL transaction-owned application lock for this small pilot. It serializes reads/writes across API processes and prevents cross-family acceptance/removal races. The lock times out after ten seconds; SQL commands time out after twenty seconds. This intentionally trades throughput for simple, consistent pilot behavior. Availability rate limits are per API instance (one aggregate bucket plus one sensitive bucket per admitted identity), not a distributed quota. Liveness bypasses rate limits. Add perimeter rate controls before any larger rollout.

No token invitation landing page is used. The API does not enable browser CORS. Logs exclude EF diagnostics, JWT details, request bodies and raw exceptions; infrastructure logs must also avoid bodies, credentials and deletion receipt secrets.

## Account and family deletion

Owner account deletion is blocked until transfer is accepted or all other members are removed and the family is explicitly closed. Ordinary departure retains contributions. Family closure soft-deletes access, then the durable cleanup worker purges content. Account deletion additionally purges associated records (created or last edited), memberships/invitations and receipt data, then permanently deletes the directory identity. Minimal security/status tombstones prevent token/retry resurrection.

Configure `AccountDeletion:GraphClientId` / `GraphClientSecret` for a dedicated confidential Graph application in the customer tenant, using a server Key Vault reference. Do not add these to mobile/EAS. Without settings, SQL cleanup can run but identity deletion remains pending. Status is checked with a device-only secret receipt; no login must survive for completion polling. Follow the [directory cleanup and release gates](../docs/AZURE-FAMILY-PILOT-SETUP.md#6a-enable-account-identity-deletion-server-only): live Graph permissions, static admission configuration cleanup, backup retention/restore replay and native validation are mandatory before real-user release.

No Azure provisioning, real Entra sign-in, iPhone execution, SQL restore, public enrollment, or production deployment is performed by these tests. Those remain explicit setup/release gates. The SQL locking and JWT validation choices follow [SQL Server application-lock documentation](https://learn.microsoft.com/en-us/sql/relational-databases/system-stored-procedures/sp-getapplock-transact-sql) and [Microsoft identity claim-validation guidance](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation).
