# Little Days family-sharing API

.NET 10 Minimal API with EF Core SQL Server. The current v2 API shares the full baby profile and feed, diaper, sleep, growth, milestone and care records. Owner setup commits the reviewed local history, owner membership and invitations atomically. Members accept an invitation before downloading the owner's family history. Invitations appear in the recipient's app inbox; this API does not send invitation email.

See the [current API contract](../docs/FAMILY-API-CONTRACT.md) for JSON shapes and concurrency, and the [Azure setup guide](../docs/AZURE-FAMILY-SETUP.md) for tenant, admission, deployment and release configuration. The v1 family lifecycle routes remain in use; legacy bottle-only families remain separate.

## Build and test

Run from the repository root with the .NET 10 SDK:

```powershell
dotnet build server/LittleDays.FamilyApi/LittleDays.FamilyApi.csproj

# Disposable/local SQL Server only; target master with CREATE DATABASE permission.
# The fixture creates and drops only its own LittleDaysPilotTests_<GUID> databases.
$env:FAMILY_TEST_SQL_CONNECTION = 'Server=localhost;Database=master;Integrated Security=true;TrustServerCertificate=true'
dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj
```

Without the SQL environment variable, SQL tests report explicit skips. There is no in-memory/SQLite substitute for rowversion, transaction-lock, filtered-index or migration tests. HTTP tests supply signed JWT metadata within the test assembly; the deployed API has no authentication bypass. Graph tests use scripted HTTP responses, not a live tenant.

Local verification on 2026-09-15: 106 tests passed, zero failed and zero skipped against actual local SQL Server 15.0.2190.7. Coverage includes full-history import and seed commit digests, concurrent retries/writes, rowversion conflicts, HTTP conditional snapshots, legacy isolation and deletion cleanup. Fixtures removed their generated databases afterward.

## Configuration and admission

Use environment variables or a restricted host provider. Colons in setting names become double underscores in environment variables. Credentials must stay outside source control, mobile settings and artifacts.

| Setting | Purpose |
| --- | --- |
| `ConnectionStrings:FamilyDatabase` | Runtime SQL connection. Azure uses Entra managed identity with encrypted transport; `TrustServerCertificate=true` above is local-test only. |
| `Entra:TenantId`, `Entra:Audience`, `Entra:MobileClientId` | Customer tenant, API client ID and native application client ID. |
| `Family:PublicBaseUrl` | HTTPS origin, without a path/query/fragment. |
| `Family:HistoryId` | Environment/history GUID. Rotate after restore and configure every replica consistently before traffic resumes. |
| `Admission:Mode` | `Directory` for real enrollment; `Static` is explicit test/pilot configuration. |
| `Admission:LocalAccountIssuer` | Customer tenant's default `<tenant>.onmicrosoft.com` issuer. |
| `Admission:EmailOtpOnly` | Must be true in Directory mode; the mobile application's linked user flow must actually use email OTP only. This setting does not configure Entra. |
| `Admission:GraphClientId`, `Admission:GraphClientSecret` | Server-only directory lookup credentials. |
| `Admission:UseAccountDeletionCredentials` | Explicitly reuse deletion credentials; when true, leave separate admission credentials unset. |
| `AccountDeletion:GraphClientId`, `AccountDeletion:GraphClientSecret` | Server-only confidential application's permanent directory-deletion credentials. |

Directory admission validates the JWT, reads the exact immutable object ID from Graph, requires an enabled local account with one email-address login identity for the configured issuer, and checks directory uniqueness. Token email, preferred username, mail and alternate email values do not prove invitation ownership. Unsupported/federated accounts are rejected. Directory mode does not use `Pilot:Identities` as an enrollment allowlist. Static mode admits only its 0–20 checked object-ID/email/name bindings; an empty static list admits nobody.

JWT checks require a signed unexpired v2 token with exact issuer/audience, customer tenant, native application client and delegated `Family.ReadWrite` scope. Authority is `https://<tenantId>.ciamlogin.com/<tenantId>/v2.0`. See [PublicIdentityAdmission.cs](LittleDays.FamilyApi/PublicIdentityAdmission.cs) and [Program.cs](LittleDays.FamilyApi/Program.cs). Directory startup fails when admission/deletion credentials are incomplete. Live Graph permissions and the linked email-OTP user flow must be configured using the [setup guide](../docs/AZURE-FAMILY-PILOT-SETUP.md).

## Migrations and running

Run migrations under a separate operator identity:

```powershell
$env:ConnectionStrings__FamilyDatabase = '<migration-identity connection string>'
dotnet run --project server/LittleDays.FamilyApi/LittleDays.FamilyApi.csproj -- --migrate
# Set runtime connection plus Entra, Family, Admission and AccountDeletion settings.
dotnet run --project server/LittleDays.FamilyApi/LittleDays.FamilyApi.csproj
```

Migration-only mode requires database configuration, applies EF migrations and exits. Normal startup never migrates. Current migration order:

1. `20260913173137_InitialPilot`
2. `20260914032522_InvitationLifecycleV2`
3. `20260915091021_FullDomainFamiliesV2`

The latest migration adds the full-record table, schema/sex/profile-version fields and transient deletion-job email. Existing families keep schema 1; migration does not convert them. Apply the reviewed [runtime grants](../infra/sql-runtime-grants.sql), including full-record SELECT/INSERT/UPDATE/DELETE for writes and durable cleanup. Runtime has no schema permission or database ownership. A down migration removes full-history data and must not be used on populated full families.

To generate a reviewable SQL script using the existing server tool manifest:

```powershell
Push-Location server
dotnet tool restore
# Set an explicit design/migration connection. This command generates, not executes, SQL.
dotnet ef migrations script --idempotent --project LittleDays.FamilyApi/LittleDays.FamilyApi.csproj
Pop-Location
```

## Limits and concurrency

V2 preserves original source IDs, timestamp strings and decimal values. Notes allow 10,000 characters and names 100. Each collection permits 100,000 records, including ordinary tombstones. Owner seed JSON is limited to 10 MiB and rejects running feed/sleep timers; regular family operations permit overlapping records and independent active timers. Domain validation rejects unknown fields and caller-supplied authors. JSON depth is capped at 16.

HTTP limits are 10 MiB plus 64 KiB envelope space only for POST v2 families, 128 KiB for other v2 endpoints and 16 KiB for v1. The seed's exact 10 MiB bound is independently checked. Legacy bottle precision/note/name limits do not constrain v2 content.

| Existing `Pilot` setting | Default | Applies to |
| --- | ---: | --- |
| `MaxMembers` | 20 | Both schemas; allowed 2–20 |
| `MaxOperationsPerFamily` | 100,000 | Both schemas; allowed 10–1,000,000 |
| `RequestsPerMinute` | 120 | Aggregate per-instance requests; allowed 1–600 |
| `SensitiveRequestsPerMinute` | 10 | Sensitive account bucket per instance; allowed 1–60 |
| `MaxFeeds` | 1,000 | Legacy feeds only |
| `MaxNoteLength` | 500 | Legacy feed notes only |
| `MaxBabyNameLength` | 60 | Legacy profiles only |

The old configuration prefix is retained for compatibility. Each family supports up to 100 pending invitations, expiring after 30 days. Ordinary writes consume the operation-ledger cap; access revocation and leaving remain available at the cap.

All authenticated data reads/writes acquire one transaction-owned SQL application lock across API processes. It serializes creation, acceptance, membership changes and writes. Lock timeout is 10 seconds and SQL command timeout 20 seconds. Measure this throughput limit before increasing traffic. Per-instance rate limits use one aggregate limit and 256 sensitive-account buckets; they are not distributed quotas. Liveness bypasses rate limits.

Records use SQL rowversions and immutable original authors. Owners can edit/delete any record, caregivers their own. Full profile updates are owner-only and require the current profile version. Retrying operations checks request fingerprint, history and applicable membership. Snapshot authorization precedes ETag evaluation. Caregivers do not receive member email addresses or invitation administration.

## Deletion and operating boundaries

An owner must transfer ownership or close the family before account deletion. Ordinary departure retains contributions. Closing immediately revokes family access, then purges full and legacy content. Account deletion purges records created or last edited by that account, membership/invitation/operation data, then permanently deletes its directory identity. Transient job email is cleared after SQL cleanup. Minimal security/status tombstones prevent token/retry resurrection.

Deletion completion uses a device-held secret receipt and does not require a surviving login. Directory deletion authorizes only a durable job awaiting identity deletion. Credential rotation, retention/restore policy and live Graph behavior require operational validation; see [directory cleanup and release gates](../docs/AZURE-FAMILY-PILOT-SETUP.md#6a-enable-account-identity-deletion-server-only).

There is no invitation email sender, token landing page or browser CORS. Logs exclude request bodies, JWT details, SQL parameters and raw exceptions; infrastructure logs must exclude credentials and deletion receipt secrets too. Local tests do not prove Azure deployment, real signup/sign-in, permanent Graph deletion, iPhone storage behavior or restore handling.
