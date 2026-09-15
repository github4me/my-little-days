# Azure family sharing: setup and release

Updated 15 September 2026. This is the current activation guide for the full family service, replacing the former synthetic-data setup guide. It documents implementation and remaining operator work; it does **not** establish that Azure deployment, customer sign-in or device acceptance has succeeded.

The native app and `/v2` API share the baby profile, feeding, nappies, sleep, growth, milestones and daily care, including temperature. The first owner reviews and uploads existing history; invitees explicitly accept that family without merging personal history. Later invitations use the existing family. Invitations appear in the recipient's in-app inbox: **no email or invitation notification is sent**, and no delivery service is required. Photos, personal reminders and learning selections/check-ins are outside the shared model; review the app's replacement warning before activation.

Deploy compatible API and native builds together. `/v1` remains for identity and membership lifecycle routes; the old bottle-feed-only contract cannot activate a full family. Authenticated `/v2/capabilities` must advertise schema `2`, all six record kinds and the 10 MiB seed limit. Browser previews and JavaScript exports do not prove native authentication, SQLite or device behavior.

## 1. Separate hosting and customer identities

The **hosting tenant** owns the subscription, App Service, SQL administrator, managed identity and GitHub deployment identities. The **customer External ID tenant** owns family accounts and mobile/API/Graph registrations. These tenant IDs may differ.

| Value | Destination |
| --- | --- |
| Hosting subscription and tenant IDs | GitHub `AZURE_SUBSCRIPTION_ID`, `AZURE_TENANT_ID`; infrastructure |
| Customer tenant UUID | API `Entra__TenantId`; mobile `EXPO_PUBLIC_ENTRA_TENANT_ID` |
| Mobile client UUID | API `Entra__MobileClientId`; mobile `EXPO_PUBLIC_ENTRA_CLIENT_ID` |
| API client UUID | API `Entra__Audience`; `api://<api-client-id>/Family.ReadWrite` |
| Customer default `<tenant>.onmicrosoft.com` domain | `Admission__LocalAccountIssuer` |
| Actual App Service HTTPS origin | `Family__PublicBaseUrl`, mobile API URL and GitHub health URL |
| App Service managed identity object ID/name | SQL contained user and runtime grants; never a mobile client ID |
| SQL server FQDN and database | Managed identity connection string |
| Stable history UUID | `Family__HistoryId`; rotate after database restore |

Keep existing resource names, managed-resource tags, SQL roles, workflow filenames and GitHub environments containing `pilot`. They are compatibility identifiers, not a request to create another environment. Retain `deploy-family-pilot.yml`, `family-pilot-ci.yml`, environment `family-pilot`, SQL role `family_pilot_runtime` and `FAMILY_PILOT_DEPLOY_ENABLED`.

## 2. Configure public customer sign-in

1. Select the **customer External ID tenant** in Entra admin center. Use local customer accounts, not workforce B2B invitations or Entra groups.
2. Enable **External Identities → All Identity Providers → Email One-time-passcode**. Create a user flow under **External Identities → User flows** with **Email Accounts → Email one-time passcode** as its only identity provider. Collect only needed attributes. Associate the mobile registration through the flow's **Applications → Add application**. The API registration is the token resource, not the interactive application. [Microsoft user-flow setup](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-user-flow-sign-up-sign-in-customers), [associate an application](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-user-flow-add-application).
3. Create separate single-tenant **mobile** and **API** registrations with administrator owners. Expose `api://<api-client-id>/Family.ReadWrite` as an enabled delegated scope with administrator consent; set the API manifest's `api.requestedAccessTokenVersion` to `2`. Authorize the mobile client for that scope. On the mobile registration, add the API's delegated permission and grant customer-tenant administrator consent. The mobile client needs no secret or Graph application permissions. [Expose an API](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-expose-web-apis).
4. On the mobile registration, add a **Mobile and desktop applications** redirect exactly `mylittledays://auth`. The app uses a browser-hosted authorization-code flow with PKCE, not an MSAL-generated `msauth` redirect or Entra's separate native-authentication API. Leave implicit, password and device-code flows disabled.
5. Verify discovery at `https://<customer-tenant-id>.ciamlogin.com/<customer-tenant-id>/v2.0/.well-known/openid-configuration`. Investigate issuer mismatches without weakening validation. The API requires an access token for its own audience and validates signature, lifetime, tenant, object ID, token version, delegated scope and the mobile `azp` client ID. Public client IDs are not device attestation.

Public admission uses `Admission__Mode=Directory`; there is **no manual customer allowlist**. Each authenticated request resolves the exact customer object through Graph and requires `accountEnabled=true`, `creationType=LocalAccount`, one `emailAddress` sign-in identity with the configured issuer, and an unambiguous matching directory lookup. Federation and unsupported login methods are rejected. Token `email`/`preferred_username`, Graph `mail` and `otherMails` are not recipient proof. Graph ignores issuer in email-address filters, so returned identities are rechecked. [Graph identity semantics](https://learn.microsoft.com/en-us/graph/api/resources/objectidentity?view=graph-rest-1.0).

`Admission__EmailOtpOnly=true` records the actual flow configuration; it does not configure Entra or prove a login used OTP. Verify the linked flow and real sign-in events. A deleted/recreated account has a new object ID and cannot inherit membership solely through the same email. `Admission:Mode=Static` is only for isolated compatibility tests.

## 3. Reuse hosting through the guarded workflow

Follow [GitHub infrastructure setup](AZURE-GITHUB-INFRA.md) for protections and [the Bicep guide](AZURE-BICEP-DEPLOYMENT.md) for local deployment mechanics. This document supersedes older application-scope notes in those guides.

The checked-in infrastructure reuses Linux B1 plan `ProdRG/reticelASP` in Australia Southeast and provisions a separate Web App/free-offer SQL environment. Review plan capacity and current Azure state. Do not rename resources, resize the shared plan, change region or substitute paid SQL as an automatic fallback. Confirm free-offer availability for the subscription/region. Hosting location does not guarantee all identity-service data residency.

The **Family infrastructure** workflow (`deploy-family-infra.yml`) runs credential-free checks for relevant changes. Cloud preview requires the trusted branch and `FAMILY_INFRA_ENABLED=true`, using a separate read-only OIDC identity. Apply requires protected environment `family-infra`, reviewer approval, `FAMILY_INFRA_APPLY_ENABLED=true`, `FAMILY_INFRA_CAPACITY_CONFIRMED=true` and unchanged revision/configuration checks. Create actual protections and hosting-tenant permissions first; environment names do not create protection. Keep apply disabled if required protection is unavailable.

Record actual deployment outputs and continue below. Use the default HTTPS hostname including any generated suffix; a custom domain is optional. Keep HTTPS/TLS enforcement, system-assigned managed identity, reviewed .NET 10 runtime and Always On. Startup is `dotnet LittleDays.FamilyApi.dll`, never migration mode. Keep App Service Authentication/Easy Auth off: ASP.NET validates bearer tokens. Bicep preserves separately managed settings; it does not initialize SQL, configure customer registrations or release API code.

SQL uses Entra-only authentication. With public networking, allow only reviewed App Service outbound IPs and a temporary migration-operator IP. Keep **Allow Azure services** off; do not add all-Internet rules or GitHub runner ranges. Private networking is a separate reviewed choice.

Free SQL can pause when idle or at monthly allowance exhaustion. Cold starts, active-device polling, worker activity and shared B1 capacity affect responsiveness and usage. Deployment success and free-tier selection are not production performance or availability guarantees. Review real usage and retries; there is no paid fallback. [Azure SQL free-offer behavior](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer?view=azuresql).

## 4. Bootstrap SQL identities; release schema through DbUp

Separate interactive SQL administration, migration operators and API runtime. Azure control-plane Contributor access is not SQL data-plane permission. GitHub's API deployer needs neither SQL access nor schema privileges.

Follow [Database migrations and API release](AZURE-DATABASE-DEPLOYMENT.md) for the exact Azure/GitHub steps and deployed resource names. Create the dedicated hosting migration identity, assign SQL-server-scoped firewall permissions, and run [sql-bootstrap.sql](../infra/sql-bootstrap.sql) once as SQL administrator. Remove temporary operator access afterward.

The protected `family-database` job runs the separate **LittleDays.DatabaseMigrator** project using DbUp. It initializes or upgrades schema and grants per-table runtime access in one transaction before API deployment. It temporarily opens only the current runner's exact IPv4 and removes its own rule afterward. No broad GitHub/Azure ranges, SQL passwords or runtime schema privileges are needed.

Do not use the former API `--migrate` command or manually apply runtime grants as a normal release step. Existing EF-initialized databases require explicit reviewed adoption; existing synthetic families are not silently converted to full-history families.

## 5. Enter server secrets and build configuration

In restricted App Service **Environment variables → App settings**, double underscores map to configuration nesting. [The server example](../infra/api-appsettings.example.json) is a reference, not a credential store.

| Setting | Value |
| --- | --- |
| `Entra__TenantId` | Customer external tenant UUID |
| `Entra__Audience` | API client UUID |
| `Entra__MobileClientId` | Mobile client UUID |
| `Family__PublicBaseUrl` | Actual HTTPS API origin without a path |
| `Family__HistoryId` | New UUID initially; preserve across normal releases |
| `Admission__Mode` | `Directory` |
| `Admission__LocalAccountIssuer` | Customer default `<tenant>.onmicrosoft.com` |
| `Admission__EmailOtpOnly` | `true` after configuring/verifying the OTP-only flow |
| `Admission__UseAccountDeletionCredentials` | `false` for separate admission credentials |
| `Admission__GraphClientId`, `Admission__GraphClientSecret` | Customer-tenant confidential admission credentials |
| `AccountDeletion__GraphClientId`, `AccountDeletion__GraphClientSecret` | Customer-tenant confidential deletion credentials |
| `AccountDeletion__WorkerEnabled` | `true` |
| `AccountDeletion__PollIntervalMinutes` | `120` default; validated range `120`–`1440` |
| `ConnectionStrings__FamilyDatabase` | `Server=tcp:<server>.database.windows.net,1433;Database=<database>;Authentication=Active Directory Managed Identity;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;` |

Create confidential Graph applications in the **customer tenant**. Grant administrator consent for admission's application `User.Read.All`; deletion requires `User.ReadWrite.All` for active users and `User.DeleteRestore.All` for permanent deleted-user removal. Do not assign privileged administrator roles to these apps. [Read users](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0), [delete users](https://learn.microsoft.com/en-us/graph/api/user-delete?view=graph-rest-1.0), [permanent deletion](https://learn.microsoft.com/en-us/graph/api/directory-deleteditems-delete?view=graph-rest-1.0).

For explicit credential reuse, set `Admission__UseAccountDeletionCredentials=true` and omit both admission client ID/secret settings. The deletion application's consent must cover reads and deletion. Directory release mode fails startup if required credentials or issuer/OTP settings are missing; static fallback is not automatic.

Enter real secrets directly in restricted server-side App Service settings. **No Key Vault resource or role is required.** Keep secrets out of Git, template/parameter copies, GitHub variables/artifacts, mobile/EAS settings, screenshots and logs; do not dump App Service settings. Restrict configuration/deployment access, record expiry and rotate before expiry, then verify admission/deletion again. Hosting managed identity handles SQL, not cross-tenant Graph.

Build the compatible native app with only four public values from [mobile.env.example](../infra/mobile.env.example):

```text
EXPO_PUBLIC_FAMILY_API_URL=https://<actual-app-hostname>
EXPO_PUBLIC_ENTRA_TENANT_ID=<customer-tenant-id>
EXPO_PUBLIC_ENTRA_CLIENT_ID=<mobile-client-id>
EXPO_PUBLIC_ENTRA_API_SCOPE=api://<api-client-id>/Family.ReadWrite
```

These values are embedded at build time. Use an installed native build with the configured redirect scheme; a web preview is not a sign-in test.

## 6. Release API code manually

Protect existing GitHub environment **`family-pilot`** with required reviewers and the reviewed allowed branch. Its hosting-tenant OIDC deployer receives Web App-scoped deployment rights, without SQL/migration or customer Graph rights. Bind federation to the exact repository/environment issuer, subject and audience; verify actual GitHub claims rather than copying a previous repository's subject.

Set `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_WEBAPP_NAME`, `FAMILY_API_PUBLIC_URL`, and finally `FAMILY_PILOT_DEPLOY_ENABLED=true` once ready. The last name is retained compatibility configuration.

Run **Deploy family API and database** (`.github/workflows/deploy-family-pilot.yml`) and select the trusted release branch. Its commit is pinned automatically—no SHA entry is required. Acknowledge `database_bootstrapped` only after the one-time identity bootstrap and SQL review. Leave `adopt_ef=false` for a new database. It verifies the same revision through `family-pilot-ci.yml`, builds both artifacts, waits for database approval, applies DbUp and cleans up firewall access, then waits for API approval, deploys and checks `/health/live`. SQL or cleanup failure blocks API deployment. It does not deploy on pushes/merges or configure customer applications. Infrastructure apply shares the release concurrency lock. See the [database guide](AZURE-DATABASE-DEPLOYMENT.md) for initial setup and failure recovery.

Liveness proves only that the process responds. Verify authenticated identity, capabilities, full snapshots, SQL permissions, native flows and deletion separately. Keep private request bodies, tokens, SQL parameters and Graph responses out of diagnostics.

## 7. Record acceptance and operational evidence

Before real family use, complete the same full service with disposable records on two installed phones; this is release verification, not a reduced product. Record release/build IDs and outcomes without private payloads or tokens:

- Verify both real OTP sessions resolve the intended immutable accounts. Wrong recipients cannot inspect/accept another inbox item; no static bindings are needed.
- Create with every record kind, original IDs/decimals and stopped initial timers. Interrupt the response/restart; retry the same operation and confirm one family/import, complete snapshot activation and no early personal-data cleanup.
- Explicitly accept/decline invitations. Verify the intended full family installs, personal history is never uploaded/merged and documented cleanup completes. Cover first sign-in on another device, offline behavior and storage failure.
- Exercise overlapping records, same-version concurrent edits, author/admin permissions, ownership races, removal and fresh invitations after departure. Family/history identity and authorship survive transfer; stale grants cannot write.
- Verify shared backup/import blocking and cache/draft purge on detected revocation/logout. Ordinary leave/removal retains accepted contributions.
- Request deletion: access stops immediately, associated full content is purged and Graph permanently deletes the identity. Check the device receipt after sign-out; outages/permission errors remain pending.

The deletion worker recovers at process startup and polls every **120 minutes** by default. Access revocation is synchronous; content/directory cleanup is durable and retried. The interval is a retry target while service and SQL are running, not a completion deadline. SQL pause/monthly exhaustion, stopped App Service or Graph failures can extend it. Keep cleanup enabled, monitor pending work and test recovery; do not disable it to reduce usage.

Completion status covers application SQL and directory cleanup, not disappearance from all backups or historical configuration. Document retention for SQL backups, diagnostics, exported artifacts and legacy configuration copies; restrict access and purge expired copies. Verify native storage/OS-backup behavior and update store/privacy disclosures.

After database restore, keep traffic closed, **rotate `Family__HistoryId`**, replay post-backup deletion/revocation tombstones, and confirm deleted accounts/grants cannot return before reopening. History checks do not reconstruct events missing from an older backup. Preserve the necessary restricted deletion/revocation recovery record outside that restored snapshot and test the runbook.

Operator work remains open until evidence exists: actual infrastructure/API deployment, customer registrations/consent, SQL bootstrap/migrations/grants, native builds/two-device acceptance, secret rotation, retention/restore proof and release disclosures. Local tests do not complete those steps.
