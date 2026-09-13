# Azure invitation pilot setup

Status: setup instructions and deployment templates, not a deployed or device-validated service. Reviewed against Microsoft and Expo documentation on 14 September 2026. The operator creates resources after reviewing the regional cost estimate. No Azure resource creation, real-history upload or public release is part of this implementation.

The [pilot contract](FAMILY-PILOT-CONTRACT.md) is authoritative. This is a controlled two-account test: login, one family/baby, invitations and a separate completed bottle-feed ledger. Use synthetic baby names, feeds and notes. Existing local profiles, records, timers, photos and backups stay local. Full synchronization, migration, deletion policy and public enrollment remain follow-up work.

## 1. Record the configuration inventory

Keep deployment infrastructure and customer login identities distinct. The Azure subscription's hosting directory owns App Service, managed identity, SQL administrator and GitHub deployment identity. A **customer external tenant** owns the two customer accounts and the mobile/API registrations. These tenant IDs may differ; never substitute the hosting tenant in the mobile configuration.

| Value                                                | Where it is used                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Hosting subscription + directory GUIDs               | Azure resource setup and GitHub `AZURE_SUBSCRIPTION_ID` / `AZURE_TENANT_ID`          |
| Customer external tenant GUID                        | Mobile `EXPO_PUBLIC_ENTRA_TENANT_ID`; API `Entra__TenantId`                          |
| Mobile application client GUID                       | Mobile `EXPO_PUBLIC_ENTRA_CLIENT_ID`; API `Entra__MobileClientId`                    |
| API application client GUID                          | API `Entra__Audience`; URI `api://<api-client-guid>/Family.ReadWrite`                |
| App Service default HTTPS hostname                   | Mobile API URL, API public base URL and GitHub health URL                            |
| SQL server hostname + database name                  | Managed identity connection string                                                   |
| New history GUID                                     | API `Family__HistoryId`; preserve across ordinary deployments, replace after restore |
| App Service identity object ID + unique display name | SQL runtime contained user; these are not mobile/API client IDs                      |
| Two checked customer object IDs and login emails     | Restricted API admission bindings, outside source control                            |

Choose Australia East for App Service/SQL if available and suitable for the approved budget. Confirm identity service geography and diagnostic retention separately. Create an Azure cost budget/alert before enabling billable resources; this document makes no fixed-price or all-data-in-Australia promise.

## 2. Configure customer sign-in

1. In Microsoft Entra admin center, switch to or create an **External/customer tenant**. Do not implement this with workforce B2B guest invitations. Record its Directory (tenant) ID.
2. In that tenant, enable **External Identities → All Identity Providers → Email One-time-passcode**. Create a user flow under **External Identities → User flows**. Select **Email Accounts → Email one-time passcode** as the only identity provider. Do not select password, social or federation providers for this controlled proof. Collect only the attributes needed for the test. [Microsoft user-flow setup](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-user-flow-sign-up-sign-in-customers).
3. Create single-tenant app registrations named, for example, `little-days-pilot-api` and `little-days-pilot-mobile`, with an administrator owner on each. Record their distinct Application (client) IDs. Customer users cannot grant their own consent in an external tenant, so the administrator must grant the required permission. [Register an application](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app?toc=/entra/external-id/toc.json&bc=/entra/external-id/breadcrumb/toc.json).
4. On the API registration, **Expose an API**: keep `api://<api-client-guid>` as Application ID URI; create enabled delegated scope `Family.ReadWrite`, with **Admins only** consent. A suitable description is “Read and write the signed-in user's admitted pilot family.” In its manifest, set `api.requestedAccessTokenVersion` to `2`. No redirect or client secret is needed on the API registration. Under **Authorized client applications**, add the mobile client ID and select this scope. On the mobile registration, add the API's **delegated** `Family.ReadWrite` permission and grant admin consent. Do not add application/daemon permissions or Graph directory access. [Expose and preauthorize an API](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-expose-web-apis), [API token-version property](https://learn.microsoft.com/en-us/graph/api/resources/apiapplication?view=graph-rest-1.0).
5. On the mobile registration, **Authentication → Add a platform → Mobile and desktop applications**: add custom redirect exactly `mylittledays://auth`. This app uses the system browser with authorization code + PKCE, without MSAL's generated `msauth` redirect. Leave implicit grant and password/device-code flows off. No client secret belongs in this public client. Do not enable Entra's separate native-authentication API: “native build” here describes the iPhone application, whose sign-in page is browser hosted. [Redirect platform settings](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri), [public clients](https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-applications).
6. Associate the mobile application with the email-OTP user flow using the flow's **Applications → Add application**. The API registration is the resource receiving access tokens, not the interactive sign-in application. [Associate a user flow](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-user-flow-add-application).

The implementation discovers endpoints under `https://<customer-tenant-guid>.ciamlogin.com/<customer-tenant-guid>/v2.0`. Check its `/.well-known/openid-configuration` endpoint in the setup tenant. The GUID-based CIAM issuer is documented by Microsoft's authentication library. If the actual tenant's discovery/issuer differs, stop the live-login proof and investigate; do not disable issuer checks or change to a `common` authority. [Microsoft CIAM issuer guidance](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-common/docs/authority.md).

The API must receive an **access token** for its client-ID audience. An ID token for the mobile client and a Microsoft Graph access token are invalid. It checks signature, issuer, expiry, customer `tid`, `oid`, delegated `scp` containing `Family.ReadWrite`, and `azp` equal to the mobile client ID. This `azp` restriction narrows permitted clients but is not device attestation: public-client IDs are public.

## 3. Prove the two admitted identities

The empty `Pilot.Identities` in [the API template](../infra/api-appsettings.example.json) intentionally prevents a working service. At least two valid, unique bindings are required. Never fill them using guesses or a display-name match.

1. Have each of the two testers sign in with their intended email using the configured user flow and a native pilot build. The native authentication session can complete before API admission is enabled; the subsequent API call will remain unavailable until configuration is complete. A flow test can help create the customer accounts, but does not replace the native login proof.
2. In the **customer external tenant**, inspect the corresponding sign-in event (application, account, time and authentication details), then the customer's **Users** entry. Confirm the OTP authentication and the actual local email sign-in identity; record the immutable **Object ID**, not application ID, guest email, `mail` profile field or display name. Correlate with the tester's actual sign-in. If you cannot establish which email identity authenticated that object, leave it unadmitted and resolve the discrepancy.
3. Configure the checked `ObjectId`, normalized intended `Email`, and a synthetic `DisplayName` for each account in restricted App Service settings (next section). Keep a private operator record of verification date, tenant and object ID. Do not commit that record or token captures.
4. After deployment, test `/v1/me` through each native session and confirm the correct configured identity and empty family list. Complete the recipient-specific invite proof in section 9. Do not treat successful token decoding or one account's login as completion of this gate.

The API deliberately ignores generic mutable `email`/`preferred_username` claims for identity binding. Unlisted valid identities receive `pilot_not_admitted`; owners can invite only admitted emails. Unknown/wrong-recipient tokens return the same generic unavailable outcome. Recreating a customer account gives it a new object ID and requires a new reviewed binding. Open signup remains gated on a separate trustworthy-recipient-claim design and live proof.

## 4. Create App Service and Azure SQL

Create these manually in the **hosting subscription/directory**, preferably in one dedicated pilot resource group:

1. An Azure SQL logical server and dedicated single database. Select Microsoft Entra-only authentication, configure an Entra administrator group you control, and use an interactive Entra-authenticated SQL client to bootstrap. Do not create an empty/default SQL administrator password. Choose a small provisioned tier for predictable pilot response times; review backup retention and cost before creation. The administrator is an operator in the hosting directory, not a customer account. [Azure SQL Entra configuration](https://learn.microsoft.com/en-us/azure/azure-sql/database/authentication-aad-configure?view=azuresql).
2. A Linux App Service plan and Web App, **Code / .NET 10**, with HTTPS only, TLS 1.2 or newer, FTPS disabled, SCM/FTP basic publishing credentials disabled, and Always On when supported. Keep continuous deployment off. Verify runtime availability with the read-only command `az webapp list-runtimes --os linux`; the configured stack is `DOTNETCORE|10.0`. If the selected region does not offer it, resolve that before deployment. Set startup command `dotnet LittleDays.FamilyApi.dll` if auto-detection does not start the published assembly. [App Service .NET configuration](https://learn.microsoft.com/en-us/azure/app-service/configure-language-dotnetcore).
3. In the Web App's **Identity**, enable **System assigned** and record its object ID and unique name. It is the SQL runtime identity. No SQL credential is bundled with the API. [App Service managed identity and SQL](https://learn.microsoft.com/en-us/azure/app-service/tutorial-connect-msi-sql-database).
4. For a simple controlled pilot, set SQL public networking to **Selected networks**, keep **Allow Azure services and resources to access this server OFF**, and allow only individual IP addresses listed in the App Service's **Properties → Outbound IP addresses**. Include its listed additional/possible outbound addresses if the approved plan can use them. Add the operator's current individual IP temporarily for migration and remove that rule afterwards. Never add `0.0.0.0`, an all-Internet range or GitHub runner IP ranges. Recheck the outbound set when changing App Service plan/region. [SQL firewall behavior](https://learn.microsoft.com/en-us/azure/azure-sql/database/firewall-configure?view=azuresql), [App Service outbound IPs](https://learn.microsoft.com/en-us/azure/app-service/overview-inbound-outbound-ips).

For stronger network isolation, select App Service VNet integration + a SQL private endpoint with private DNS and disable SQL public access. This needs compatible tiers and an operator/migration host on that network; it is a separate cost/networking choice. [SQL private connectivity](https://learn.microsoft.com/en-us/azure/azure-sql/database/private-endpoint-overview?view=azuresql).

Use the exact default HTTPS hostname shown by Azure, including any generated suffix. A paid custom domain is **optional**. Set `Family__PublicBaseUrl` and the mobile API URL to this same origin, without `/v1` or `/join`. Azure's default certificate suffices for `https://<app-host>/join#token=...`. Keep App Service Authentication/Easy Auth off for this API; ASP.NET validates its own bearer tokens, and `/join` and `/health/live` must remain publicly reachable. Do not enable request-body/header capture, token logging or third-party tracking on the landing page.

## 5. Bootstrap SQL and apply migrations separately

The application does **not** apply migrations at ordinary startup. ARM “Contributor” roles do not create SQL data-plane access. Use three separate identities: an interactive SQL administrator for bootstrap, an Entra operator group for migrations, and the App Service managed identity for runtime. GitHub's deployment identity receives neither SQL access nor migration privileges.

1. Create a small migration-operator group in the hosting directory. Add only the person who will run reviewed migrations; use time-limited group membership where available.
2. Connect to the **named pilot database**, using SSMS or another SQL client with Microsoft Entra MFA/interactive authentication as the server's Entra administrator. Copy [sql-bootstrap.sql](../infra/sql-bootstrap.sql) to an untracked local file, replace its database, managed-identity name and operator-group placeholders, inspect the exact values, and execute. The script rejects an unchanged template or system database. If `FROM EXTERNAL PROVIDER` cannot resolve a principal, have the hosting Entra/SQL administrator verify uniqueness and required directory lookup permissions; never solve this by granting Graph directory access to the API runtime. [Microsoft Entra SQL principals](https://learn.microsoft.com/en-us/azure/azure-sql/database/authentication-aad-service-principal?view=azuresql).
3. Review the migration source under `server/LittleDays.FamilyApi/Migrations` at the exact release commit. Sign in as a migration-group member. With .NET 10 installed, run from the repository root (PowerShell):

   ```powershell
   $env:ConnectionStrings__FamilyDatabase = 'Server=tcp:REPLACE_SERVER.database.windows.net,1433;Database=REPLACE_DATABASE;Authentication=Active Directory Interactive;User Id=REPLACE_OPERATOR_UPN;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;'
   dotnet run --project server/LittleDays.FamilyApi --configuration Release -- --migrate
   Remove-Item Env:ConnectionStrings__FamilyDatabase
   ```

   This opens an interactive operator login; there is no password in the command. Confirm the selected account belongs to the hosting directory's migration group. The explicit migration mode requires the database connection, not customer identity bindings. Do not use the managed identity connection string from a laptop, and never configure `--migrate` as the Web App startup command.

4. Reconnect as the SQL administrator and execute a reviewed copy of [sql-runtime-grants.sql](../infra/sql-runtime-grants.sql) after replacing the database placeholder. It grants runtime `SELECT`, `INSERT` and `UPDATE` only on `Families`, `Memberships`, `Invitations`, `Feeds` and `Operations`; no `DELETE`, `db_owner`, `db_ddladmin`, schema ownership or writes to `__EFMigrationsHistory`. Feed deletion uses a tombstone. Verify runtime is not independently in a broader role. The API uses transaction-owned `sys.sp_getapplock`, normally available to the public database role, to serialize this small pilot across instances.
5. Remove the operator's temporary SQL firewall rule. Restrict migration-group membership after the task. Save migration ID, release SHA and successful result in the private change record.

## 6. Set server and mobile configuration

In App Service **Environment variables → App settings**, add the following. ASP.NET maps double underscores to configuration nesting. Use [api-appsettings.example.json](../infra/api-appsettings.example.json) as a reference, not as a file to publish with actual identities.

| App setting                                                    | Value                                                                                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ASPNETCORE_ENVIRONMENT`                                       | `Production`                                                                                                                                                                    |
| `ConnectionStrings__FamilyDatabase`                            | `Server=tcp:<server>.database.windows.net,1433;Database=<db>;Authentication=Active Directory Managed Identity;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;` |
| `Entra__TenantId`                                              | Customer external tenant GUID                                                                                                                                                   |
| `Entra__Audience`                                              | API Application (client) GUID, not `api://...` and not mobile GUID                                                                                                              |
| `Entra__MobileClientId`                                        | Mobile Application (client) GUID                                                                                                                                                |
| `Family__PublicBaseUrl`                                        | Exact HTTPS API origin                                                                                                                                                          |
| `Family__HistoryId`                                            | A fresh GUID for this database history, generated once with `[guid]::NewGuid()`                                                                                                 |
| `Pilot__Identities__0__ObjectId` / `__Email` / `__DisplayName` | Checked first account object GUID / verified login email / synthetic name                                                                                                       |
| `Pilot__Identities__1__ObjectId` / `__Email` / `__DisplayName` | Checked second account object GUID / verified login email / synthetic name                                                                                                      |

For the last two rows, each suffix is a separate complete key, for example `Pilot__Identities__0__Email`. Both object IDs and emails must be unique. Treat the identity settings as personal information even though they are not authentication secrets. Do not publish settings exports, tokens, SQL payloads or raw error dumps in issues.

Explicit pilot limits matching the implementation defaults:

| Setting                             | Value    |
| ----------------------------------- | -------- |
| `Pilot__MaxMembers`                 | `4`      |
| `Pilot__MaxFeeds`                   | `1000`   |
| `Pilot__MaxOperationsPerFamily`     | `100000` |
| `Pilot__InvitationHours`            | `48`     |
| `Pilot__MaxNoteLength`              | `500`    |
| `Pilot__MaxBabyNameLength`          | `60`     |
| `Pilot__RequestsPerMinute`          | `120`    |
| `Pilot__SensitiveRequestsPerMinute` | `10`     |

Do not delete durable operation receipts to escape the operation cap; retention needs a designed cleanup policy. This API serializes pilot transactions through SQL and is intended for a small admitted group. An in-process rate limiter does not constitute a distributed abuse-protection service.

For the mobile build, copy the four values from [mobile.env.example](../infra/mobile.env.example) into the selected EAS environment or an ignored local `.env.local`. `EXPO_PUBLIC_` values are public and are embedded in the JavaScript bundle; EAS “secret” visibility cannot turn a mobile client secret into a safe design. [Expo environment variables](https://docs.expo.dev/guides/environment-variables/).

## 7. Configure GitHub CI and optional manual deployment

The checked-in `Family pilot CI` workflow runs TypeScript/unit/browser checks, .NET tests and a disposable real SQL Server 2022 test harness. Its randomly generated SQL password is used only in that isolated GitHub runner. `FAMILY_TEST_SQL_CONNECTION` targets its local `master`; tests create and drop only a fresh `LittleDaysPilotTests_<GUID>` database. Never point this variable at the pilot or production database. Unit-only runs without that variable do not prove SQL concurrency. The workflow publishes an API artifact; it does not deploy.

To enable the separate manual deployment workflow:

1. Create the GitHub environment named **`family-pilot`**. Configure required reviewers, prevent self-review where available, and restrict deployment branches/tags to the reviewed workflow branch. Confirm your GitHub plan supports these controls; if it does not, leave deployment disabled. Protect the branch and require review of `.github/workflows/`. Keep the workflow on the default branch so GitHub exposes its **Run workflow** control; merging there never triggers deployment.
2. In the **hosting directory**, create a dedicated deployment application/service principal without a secret. Add federation for GitHub using [github-oidc.example.json](../infra/github-oidc.example.json): issuer `https://token.actions.githubusercontent.com`, subject `repo:<owner>/<repo>:environment:family-pilot`, audience `api://AzureADTokenExchange`. Check exact case and spelling. Grant **Website Contributor** only on this pilot Web App's resource ID. Do not grant subscription Contributor, SQL administrator or Graph permissions. [App Service GitHub OIDC setup](https://learn.microsoft.com/en-us/azure/app-service/deploy-github-actions).
3. Add GitHub **environment variables** `AZURE_CLIENT_ID` (deployment identity), `AZURE_TENANT_ID` (hosting directory), `AZURE_SUBSCRIPTION_ID`, `AZURE_WEBAPP_NAME`, `FAMILY_API_PUBLIC_URL`, and finally `FAMILY_PILOT_DEPLOY_ENABLED=true`. None is a client secret. Do not upload a publish profile. The deployment job alone can request a short-lived OIDC token. [Azure Login OIDC configuration](https://github.com/Azure/login#login-with-openid-connect-oidc-recommended).
4. Complete SQL bootstrap/migrations and App Service settings first. Dispatch **Deploy family pilot manually** with the full reviewed 40-character commit SHA and the explicit database-readiness checkbox. It reruns CI for that SHA, downloads that run's published artifact, waits at the protected environment, then deploys it. It does not run migrations or provision resources. The reviewer should compare SHA, CI, migration record and target Web App before approving.
5. The final `/health/live` check proves only process liveness. Complete authenticated SQL and two-device checks below before admitting the pilot as usable. Retain the previous API artifact/release SHA for rollback; a code rollback is safe only when the database remains compatible. Do not automatically downgrade migrations.

There are no deployment triggers for `push`, `master`, `main`, PR merge, release or schedule. These templates have not been exercised against your Azure subscription. Leave `FAMILY_PILOT_DEPLOY_ENABLED` unset until the environment protections and exact resource scope have been checked.

## 8. Make a new native pilot build

Authentication libraries, secure credential storage and the `mylittledays` URL scheme require a new native binary. Expo Go and the browser preview cannot validate this flow; production browser login is disabled. [Expo authentication requirements](https://docs.expo.dev/guides/authentication/).

Review `app.json` and `eas.json` before building. With an `appVersion` runtime policy, increment `expo.version` when adding the new native dependencies/scheme so the pilot cannot publish an incompatible OTA update to older `0.1.1` binaries. Check any iOS-specific `runtimeVersion`, which overrides the top-level value. Install the new build on both test phones, and use its pilot/preview channel and matching EAS environment for subsequent compatible updates. Never send this pilot bundle to an old native runtime. [Expo runtime compatibility](https://docs.expo.dev/eas-update/runtime-versions/).

From a shell configured with the reviewed public settings, a preview build is `eas build --platform ios --profile preview`. This is an operator action after native configuration and registered test devices are ready, not a command run by this implementation. Keep TestFlight public/external release gated on privacy, deletion, reviewer access, retention and device validation.

The share link is `https://<actual-api-host>/join#token=<opaque-token>`. The fragment stays out of the HTTP request URL. The landing page requires an explicit button to open `mylittledays://family-invite#token=...` and includes a paste-link fallback. GET does not consume an invite. A custom domain or Universal Links entitlement is not required for this pilot. Test installed-app handling and paste after installation; do not assume a token survives App Store installation automatically.

## 9. Complete the synthetic two-iPhone gate

Record the exact build/runtime, API SHA, migration version and history GUID. Keep captures sanitized and do not paste bearer or invite tokens into external token-decoder websites or issue trackers.

- Both email-OTP accounts complete sign-in, refresh/reauthentication and logout through the native browser callback. API token issuer/audience/tenant/scope/authorized-client checks succeed only for the configured values. A valid unlisted account cannot enter the pilot.
- Account A creates a synthetic family and invites B. B's explicit acceptance grants one caregiver membership. A third unadmitted/wrong recipient, expired or revoked token, repeated acceptance and simultaneous acceptance cannot grant extra access or revive a removed grant. Inspect the HTTPS landing page headers and confirm requests contain no invite token.
- B saves one completed feed offline, closes/reopens the app, reconnects, and sees one accepted record on both phones. Independent overlapping records remain independent. Concurrent edits and edit-versus-delete have one server commit winner; the rejected payload remains a private draft with current state refreshed.
- Remove B with a queued offline operation; the server rejects access and the client clears accepted cache/quarantines old work on reconnection. Reinvite/rejoin gives a new membership ID and cannot replay the old grant's queue. Test account switching, late responses and explicit discard on logout with pending work.
- Check SQL-backed tests and the restore drill below. A passed local unit suite, public liveness response or rendered browser mock is not a substitute for native Entra + managed identity SQL + two-device evidence.

Until these checks pass, keep the pilot labeled unverified and use synthetic data only. Public enrollment, real-history upload and external TestFlight distribution also require account/family deletion, privacy/store disclosures, reviewer access and retention decisions.

## 10. Database restore and history epoch

Every queued feed mutation is bound to `Family__HistoryId` and its membership grant ID. A restored SQL database can contain older revisions, older receipts and formerly valid grants. Treat restore, database replacement and copying an environment as a **new history**, even if the hostname stays the same.

1. Stop the pilot App Service and all instances/slots using that database. Suspend manual deployments. Preserve the old settings/history ID and record the backup point.
2. Restore to a **new named database** using Azure SQL point-in-time restore. Validate the result and runtime contained-user permissions before switching the connection. Review previously removed memberships and invitations that may have reappeared in the older backup; revoke them before reopening. [Azure SQL restore](https://learn.microsoft.com/en-us/azure/azure-sql/database/recovery-using-backups?view=azuresql).
3. Generate a fresh GUID using `[guid]::NewGuid()` and update `Family__HistoryId` on **every** API instance/slot together with the restored database connection. Never reuse the old GUID or let old/new settings serve the same database concurrently. Keep history ID environment-specific; a normal code rollback without a data restore keeps the existing ID.
4. Start the service. Test a device with an old cache and queued operation: it must receive `history_changed`, refresh a consistent new cache and quarantine the old operation. A lower restored revision is accepted only under the new history; it must not be rejected forever as an “older snapshot.” No old queue is resubmitted automatically.
5. Confirm current memberships and two-account behavior, then resume the admitted test. Preserve the old database until the operator's recovery/retention decision; the workflow never deletes it. Record the new history ID and restore outcome.

If the SQL connection, issuer or two-account proof fails, keep admission/deployment closed and fix that specific setup issue. Do not add test authentication headers, trust forwarded identity claims, broaden a firewall to all Azure/Internet traffic, or weaken JWT checks as a workaround.
