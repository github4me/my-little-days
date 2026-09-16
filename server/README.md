# Little Days family-sharing API

.NET 10 Minimal API with EF Core SQL Server. The current v2 API shares the full baby profile and feed, diaper, sleep, growth, milestone and care records, plus the selected baby avatar, reminder rules/settings and play selections/check-ins. Owner setup commits the reviewed history and extras, owner membership and invitations atomically. Members accept an invitation before downloading and durably storing the family data; their personal data is replaced, never uploaded or merged. Device preferences, notification permission and notification delivery remain local. Invitations appear in the recipient's app inbox; this API does not send invitation email.

See the [current API contract](../docs/FAMILY-API-CONTRACT.md) for JSON shapes and concurrency, and the [Azure setup guide](../docs/AZURE-FAMILY-SETUP.md) for tenant, admission, deployment and release configuration. The v1 family lifecycle routes remain in use; legacy bottle-only families remain separate.

## Build and test

Run from the repository root with the .NET 10 SDK:

```powershell
dotnet build server/LittleDays.slnx

# Disposable/local SQL Server only; target master with CREATE DATABASE permission.
# The fixture creates and drops only its own LittleDaysPilotTests_<GUID> databases.
$env:FAMILY_TEST_SQL_CONNECTION = 'Server=localhost;Database=master;Integrated Security=true;TrustServerCertificate=true'
dotnet test server/LittleDays.slnx
```

Without the SQL environment variable, SQL tests report explicit skips. There is no in-memory/SQLite substitute for rowversion, transaction-lock, filtered-index or migration tests. HTTP tests supply signed JWT metadata within the test assembly; the deployed API has no authentication bypass. Graph tests use scripted HTTP responses, not a live tenant.

Local verification on 2026-09-15: 106 tests passed, zero failed and zero skipped against actual local SQL Server 15.0.2190.7. Coverage includes full-history import and seed commit digests, concurrent retries/writes, rowversion conflicts, HTTP conditional snapshots, legacy isolation and deletion cleanup. Fixtures removed their generated databases afterward.

The separate DbUp suite then added 10 passing tests, including real SQL initialization/adoption, rollback, journal integrity and restricted permissions (116 backend tests total, no skips). These are historical results. Later extras verification and completed database/API publication are recorded in [shared extras](../docs/FAMILY-EXTRAS.md) and the [release runbook](../docs/AZURE-MANUAL-SETUP-RUNBOOK.md#shared-extras-release-evidence-16-september-2026); native two-phone acceptance remains separate. Both projects publish independently.

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

Directory admission validates the JWT, reads the exact enabled object ID from Graph, and checks directory uniqueness. It supports the observed customer email-OTP format (`creationType=null`, one `federated`/`mail` identity and one configured-customer-tenant UPN identity), plus legacy `LocalAccount` email-address identities issued by that tenant. It revalidates the exact returned object and email; the UPN is not mailbox proof. Other federation, guests and mixed/duplicate login methods are rejected. Token email, preferred username, Graph mail and alternate emails do not prove invitation ownership. Directory mode does not use `Pilot:Identities` as an enrollment allowlist. Static mode admits only its 0–20 checked object-ID/email/name bindings; an empty static list admits nobody.

JWT checks require a signed unexpired v2 token with exact issuer/audience, customer tenant, native application client and delegated `Family.ReadWrite` scope. Authority is `https://<tenantId>.ciamlogin.com/<tenantId>/v2.0`. See [PublicIdentityAdmission.cs](LittleDays.FamilyApi/PublicIdentityAdmission.cs) and [Program.cs](LittleDays.FamilyApi/Program.cs). Directory startup fails when admission/deletion credentials are incomplete. Live Graph permissions and the linked email-OTP user flow must be configured using the [setup guide](../docs/AZURE-FAMILY-SETUP.md).

## Migrations and running

Schema deployment is now a separate [DbUp console project](LittleDays.DatabaseMigrator/README.md), in the same solution. Follow [Azure database deployment](../docs/AZURE-DATABASE-DEPLOYMENT.md) for initial identity bootstrap and the GitHub build → DbUp → API flow. No new permanently running Azure service is needed.

```powershell
# Set runtime connection plus Entra, Family, Admission and AccountDeletion settings.
dotnet run --project server/LittleDays.FamilyApi/LittleDays.FamilyApi.csproj
```

The API rejects the obsolete `--migrate` command and does not compile historical EF migrations. EF remains its ORM. DbUp's numbered SQL scripts initialize or explicitly adopt the three known EF migration stages, validate baseline invariants, and grant runtime DML. Applied files are immutable; future schema changes are new SQL files under `LittleDays.DatabaseMigrator/Scripts`. Historical EF source is retained only for adoption tests.

The migrator uses a separate hosting identity, an exclusive SQL lock and transactional checksum journal. Runtime has no schema control or journal access. Existing schema-1 families remain schema 1; upgrading SQL does not convert their content. No automatic down migrations are run. Database changes must remain compatible with the currently deployed API until its replacement succeeds.

## Limits and concurrency

V2 preserves original entry/care source IDs, timestamp strings and decimal values. Notes allow 10,000 characters and names 100. The service limits new growth to 10,000 total record IDs across collections (including ordinary tombstones), 64 MiB stored record JSON (SQL UTF-16 bytes) and 32 MiB serialized snapshots. Response accounting reserves envelope/member space and uses actual JSON escaping, not raw character count. Member-grant history is capped at 1,000 for new grants; at most three family closures per account in 24 hours are allowed before new creation is blocked. These safety caps are not advertised storage entitlements. Owner source history is limited to 10 MiB; the complete seed with extras is limited to 32 MiB, with a separate 12 MiB decoded avatar limit. Legacy seeds without extras retain the 10 MiB limit. Seeds reject running feed/sleep timers; regular operations permit overlapping records and independent active timers. Domain validation rejects unknown fields and caller-supplied authors. JSON depth is capped at 16.

HTTP limits are 32 MiB plus 64 KiB envelope space for POST v2 families and v2 record-operations (which can carry the avatar), 128 KiB for other v2 endpoints and 16 KiB for v1. Source, seed and individual-record bounds are independently checked. Legacy bottle precision/note/name limits do not constrain v2 content. Capabilities advertise `extrasSchemaVersion: 1` and `maxSeedBytes: 33554432`; deploy `0003_FamilySharedExtras.sql` before the extras-capable API/mobile update.

| Existing `Pilot` setting | Default | Applies to |
| --- | ---: | --- |
| `MaxMembers` | 6 | Both schemas; accepts 2–20 for compatibility, effective total capped at 6 |
| `MaxOperationsPerFamily` | 100,000 | Both schemas; allowed 10–1,000,000 |
| `RequestsPerMinute` | 120 | Per authenticated account; separate anonymous aggregate, per instance; allowed 1–600 |
| `SensitiveRequestsPerMinute` | 10 | Sensitive operations per account, per instance; allowed 1–60 |
| `MaxFeeds` | 1,000 | Legacy feeds only |
| `MaxNoteLength` | 500 | Legacy feed notes only |
| `MaxBabyNameLength` | 60 | Legacy profiles only |

The old configuration prefix is retained for compatibility. A family has up to five places besides the admin, shared by active non-admin members and distinct unexpired pending invitations. Invitations expire after 30 days; decline, revocation, expiry or departure releases capacity. Replacing an existing live invitation does not consume another place. Existing over-limit families and committed receipts remain intact, but cannot add a new place beyond the effective limit. Ordinary writes consume the operation-ledger cap; access revocation and leaving remain available at the cap.

Ordinary family transactions acquire the shared global lifecycle barrier, then an exclusive lock for that family; unrelated families can progress independently. Cross-family creation/join/account lifecycle transactions retain the exclusive global barrier so authorization/revocation and one-family-per-account changes stay atomic. Lock ordering is always global then family. Lock timeout is 10 seconds and SQL command timeout 20 seconds. Account/deletion-status reads use the shared barrier. Authenticated account budgets do not share an anonymous allowance or hash buckets; limits remain per instance, not distributed quotas or a DDoS perimeter. Untrusted forwarded-IP headers do not select a limiter bucket. Liveness bypasses rate limits.

Deploy additive DbUp `0004_FamilyAvailabilityBounds.sql` before this API. Closed-family cleanup handles bounded batches and marks completed purges so old families are not repeatedly scanned for deletion. Whole-history account cleanup remains a global lifecycle operation; measure its latency before larger-scale use. Review existing family sizes before deploying new limits; no migration silently deletes over-limit content. Restore safety is **not fully implemented**: `Recovery__Blocked=true` blocks all `/v1` and `/v2` routes and pauses new cleanup, but operators must stop/drain existing work and independently reconcile a restored target before reopening. Follow the [security remediation checklist](../docs/SECURITY-REMEDIATION-2026-09-17.md).

Records use SQL rowversions and immutable original authors. Owners can edit/delete any record, caregivers their own. Profile updates and singleton extras (`avatar`, `play-selection`, `reminder-settings`) are owner-only; profile updates require the current profile version. Retrying operations checks request fingerprint, history and applicable membership. Snapshot authorization precedes ETag evaluation. Caregivers do not receive member email addresses or invitation administration.

## Deletion and operating boundaries

An owner must transfer ownership or close the family before account deletion. Ordinary departure retains contributions. Closing immediately revokes family access, then purges full and legacy content. Account deletion purges records created or last edited by that account, membership/invitation/operation data, then permanently deletes its directory identity. Transient job email is cleared after SQL cleanup. Minimal security/status tombstones prevent token/retry resurrection.

Deletion completion uses a device-held secret receipt and does not require a surviving login. Directory deletion authorizes only a durable job awaiting identity deletion. Credential rotation, retention/restore policy and live Graph behavior require operational validation; see [directory cleanup and release gates](../docs/AZURE-FAMILY-SETUP.md#7-record-acceptance-and-operational-evidence).

There is no invitation email sender, token landing page or browser CORS. Logs exclude request bodies, JWT details, SQL parameters and raw exceptions; infrastructure logs must exclude credentials and deletion receipt secrets too. Local tests do not prove Azure deployment, real signup/sign-in, permanent Graph deletion, iPhone storage behavior or restore handling.
