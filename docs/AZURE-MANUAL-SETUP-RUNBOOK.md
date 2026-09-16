# My Little Days: manual Azure and GitHub setup runbook

Last updated: 16 September 2026 (Australia/Sydney).

This is the operator's step-by-step reference for infrastructure, SQL bootstrap, customer authentication, API settings and releases. It records known values without storing secrets. Existing names containing `pilot` are compatibility identifiers: do not rename them or create replacement resources just because the product now supports full family sharing.

## 1. Current status and where to resume

Status below comes from the setup conversation and supplied deployment output, except API liveness, which was checked directly on 16 September 2026. This is not a full audit of Azure/GitHub.

| Area | Recorded status | Next action |
| --- | --- | --- |
| Bicep infrastructure | Successful deployment output supplied | Reuse existing resources |
| SQL identity bootstrap | User confirmed rows created | Do not recreate the database |
| DbUp | A previous migration job succeeded | Future changes use the same workflow/journal |
| API deployment identity and GitHub setup | User reported completed | Its client ID still needs recording in the private operator inventory |
| Customer mobile/API registrations | IDs supplied and recorded below | Verify redirect, scope, consent and token version |
| Customer default domain, OTP flow, Graph credentials | Completion not confirmed | Complete sections 8–9 |
| Directory credential diagnostic | Rechecked App Service: corrected client `538d93ee-1d58-43cb-adcd-68e094200621` is active; token acquisition and reading the signed-in user succeed | Earlier client-ID blocker resolved by operator; no further credential rotation indicated |
| Customer admission compatibility | Strict support for the observed `creationType=null`, `federated`/`mail` OTP account format deployed in `2fec7dcbfff90f72631600cd1c4a5d68ff07102f` | Release 35043608849 passed all CI, migration, deployment and liveness checks. Live Graph lookup returns exactly the same enabled account. Native sign-in still needs the user's device retry; do not recreate the account |
| App Service runtime settings | API starts; exact deployed settings and customer authentication not audited | Verify section 10; do not recreate valid settings |
| API liveness | Direct GET returned `{"status":"ok"}` on 16 September 2026 | Proceed to authenticated/native checks; this does not verify SQL or Graph |
| Latest API/database workflow | Previously reported running; user now reports API live | Check the run's final jobs and firewall-cleanup result separately |
| Native sign-in and two-device acceptance | Not verified | Complete sections 12–13 |
| Expo preview variables | Read back through EAS CLI: all four public values match, with `EXPO_PUBLIC_FAMILY_UI_DEMO=0` | Verify actual build environment selection and device provisioning before building |
| Expo account/project and devices | CLI confirmed `expo4chao/little-days`, expected project ID and two iPhones on Apple team `A9974KXQ4G`; user confirmed the same phones will be used | Verify both are included in signing; no cloud build started by these checks |
| Local mobile preflight | Type check and 161 tests passed; iOS JS export passed with the recorded live public settings and demo `0` | Signed native build and device acceptance still required |
| Signed iOS preview | EAS CLI verified build `eb360c84-c263-49be-ac63-217ad61dda19` is `FINISHED`, profile `preview`, distribution `INTERNAL`, version `0.2.0` build `18` | Install on the registered phones and test real sign-in; not submitted to TestFlight by this task |

**While a release runs:** avoid pushing a new commit to the trusted branch before its revision recheck, changing deployment variables, rerunning Bicep, or changing App Service settings without coordinating the release. App-setting changes can restart the API. Wait for the run result before deciding on recovery. Do not assume a running or green deployment means customer sign-in works.

### Immediate next steps after API liveness

1. Check the current GitHub run's migration, firewall cleanup and API jobs are successful; a live URL can also be served by an earlier deployment.
2. In the customer tenant verify sections 7–8: mobile redirect, delegated permission/admin consent, API token version and the OTP-only flow associated with the mobile registration. Reuse completed configuration.
3. Verify sections 9–10: directory Graph consent/credential and the actual customer default issuer domain. Liveness does not test Graph access or credential validity.
4. Configure/build the real native app using section 12, not the UI-demo profile.
5. Follow section 13 with two disposable accounts/phones before using real family records. No new infrastructure deployment or SQL initialization is needed merely because the API is now live.

## 2. Resource and identity inventory

### Hosting directory: infrastructure and deployment only

| Item | Known value |
| --- | --- |
| Hosting tenant ID | `7b7e6e31-a778-4334-aee2-e969fa27fd0e` |
| Subscription ID | `4768a858-f23f-4a39-bb64-eabc9c142627` |
| Resource group | `my-little-days-pilot-rg` |
| Existing Linux B1 plan | `ProdRG/reticelASP`, Australia Southeast |
| Web App | `little-days-api-522fpstfbtds2` |
| API origin | `https://little-days-api-522fpstfbtds2.azurewebsites.net` |
| Stable family history ID | `64136b6e-01e2-4c48-890f-bef208eac9e3` (user supplied; App Service value not independently verified) |
| SQL server | `little-days-sql-522fpstfbtds2` |
| SQL hostname | `little-days-sql-522fpstfbtds2.database.windows.net` |
| Database | `little-days-family` |
| Runtime managed identity object ID | `fbb9ee76-3e03-4089-a94c-3548f74ad35a` |
| SQL administrator | `Chao Wang`, type `User` |
| SQL administrator object ID | `a57bbcf8-5aec-4ac5-82e0-c02b450fc5d0` |
| Infrastructure preview app client ID | `23ff75d4-ed66-4929-93cf-c0223c41a1f7` |
| Infrastructure deployment app client ID | `440d17a0-8501-415a-9579-8f8de7d3c2f8` |
| Database migration app client ID | `f122630b-8e09-4aa1-a6c4-1bb122945afb` |
| Database migration service principal object ID | `a7f2dbde-d334-401a-b6df-a24baf0a6f43` |
| API deployment app | `my-little-days-api-deploy`; client ID not supplied in conversation |

### Customer directory: parent accounts and application authentication

| Item | Known value |
| --- | --- |
| Customer tenant ID | `deab2578-7cd3-4152-b5db-f430d6b638f8` |
| Default customer domain | App Service currently configures `mylittledayscustomers.onmicrosoft.com`; compare against customer directory's actual default domain |
| Mobile registration | `my-little-days-mobile` |
| Mobile client ID | `abce8eb9-baf9-4c17-8801-20d0716a0e4d` |
| Mobile app-registration object ID | `705f603b-b07d-484d-bfd9-6d182114941f` |
| API registration | `my-little-days-api` |
| API client ID | `9233837e-60c2-45c6-871b-96bd9cc8e007` |
| API app-registration object ID | `f86866db-e6ee-45ec-aa78-890042e48b4d` |
| Directory access registration | `my-little-days-directory`, client ID `538d93ee-1d58-43cb-adcd-68e094200621`, customer tenant confirmed by user |
| Directory registration object ID | `caf5630f-a587-4442-b7fd-98ed56b18d14` (not the client ID) |
| Directory service principal object ID | `c42091bb-b1e6-4796-bed1-285129ceaddc` (not the client ID) |
| Native redirect | `mylittledays://auth` |
| API delegated scope | `api://9233837e-60c2-45c6-871b-96bd9cc8e007/Family.ReadWrite` |

Use **Application (client) IDs** in app configuration and Azure login. Use the appropriate **service principal/managed identity object ID** when verifying SQL principals or RBAC identities. An app-registration object ID is not interchangeable with its Enterprise application object ID.

GitHub `AZURE_TENANT_ID` remains the **hosting** tenant. API `Entra__TenantId` and mobile `EXPO_PUBLIC_ENTRA_TENANT_ID` use the **customer** tenant. Never substitute one for the other.

## 3. GitHub environments and common variables

Repository: [github4me/my-little-days](https://github.com/github4me/my-little-days).

1. Open repository **Settings → Environments**.
2. Reuse or create these environments:

   | Environment | Purpose | Protection |
   | --- | --- | --- |
   | `family-infra-preview` | Read-only Bicep what-if | Exact trusted branch restriction |
   | `family-infra` | Apply infrastructure | Required reviewer and exact branch restriction |
   | `family-database` | DbUp migrations | Required reviewer and exact branch restriction |
   | `family-pilot` | API deployment | Required reviewer and exact branch restriction |

3. Under deployment branches/tags choose selected branches and add `feature/family-invitations` exactly. Do not assume an environment name creates protection.
4. Configure reviewers for the three write environments. Disable administrator bypass where available. Prevent self-review when a separate reviewer is available; a solo operator needs a workable review arrangement.
5. If your GitHub plan/repository visibility does not support the required protections, leave privileged deployment disabled pending a reviewed alternative.
6. Open **Settings → Secrets and variables → Actions → Variables** and record these repository variables:

   | Variable | Value |
   | --- | --- |
   | `FAMILY_INFRA_BRANCH` | `feature/family-invitations` |
   | `AZURE_SUBSCRIPTION_ID` | `4768a858-f23f-4a39-bb64-eabc9c142627` |
   | `AZURE_TENANT_ID` | `7b7e6e31-a778-4334-aee2-e969fa27fd0e` |
   | `AZURE_INFRA_PREVIEW_CLIENT_ID` | `23ff75d4-ed66-4929-93cf-c0223c41a1f7` |
   | `AZURE_INFRA_DEPLOY_CLIENT_ID` | `440d17a0-8501-415a-9579-8f8de7d3c2f8` |
   | `SQL_ADMIN_OBJECT_ID` | `a57bbcf8-5aec-4ac5-82e0-c02b450fc5d0` |
   | `SQL_ADMIN_DISPLAY_NAME` | `Chao Wang` |
   | `SQL_ADMIN_PRINCIPAL_TYPE` | `User` (capital U) |
   | `FAMILY_INFRA_ENABLED` | `true` only once preview setup is ready |

7. In **family-infra → Environment variables**, set `FAMILY_INFRA_APPLY_ENABLED=true` only after protection is ready, and `FAMILY_INFRA_CAPACITY_CONFIRMED=true` only after reviewing shared-plan capacity.

These IDs and flags are variables, not credentials. Never put customer Graph secrets, SQL passwords or access tokens in them. Check for conflicting environment overrides if a run shows unexpected values.

See [the infrastructure guide](AZURE-GITHUB-INFRA.md) for the exact workflow behavior and [GitHub environment documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments) for protection availability.

## 4. Hosting identities: federation and Azure role assignment

### 4.1 Create or locate each hosting app

1. In [Azure Portal](https://portal.azure.com), switch to hosting tenant `7b7e6e31-a778-4334-aee2-e969fa27fd0e`.
2. Open **Microsoft Entra ID → App registrations → All applications**.
3. Locate the existing registration before creating anything. The four purposes are infrastructure preview, infrastructure apply, database migration and API deployment.
4. If missing, choose **New registration**, enter its purpose-specific name, select this organization only and leave redirect empty.
5. Record the Application (client) ID. Do not create a client secret for GitHub deployment.

### 4.2 Configure each federated credential

1. Open the registration → **Certificates & secrets → Federated credentials → Add credential**.
2. Use the GitHub scenario only if its generated subject matches the actual workflow claim. Otherwise use **Other issuer** with the exact values below.
3. Issuer: `https://token.actions.githubusercontent.com`.
4. Audience: `api://AzureADTokenExchange`.
5. Use the corresponding subject:

   | Registration | Subject |
   | --- | --- |
   | `my-little-days-infra-preview` | `repo:github4me@4475381/my-little-days@1360277237:environment:family-infra-preview` |
   | `my-little-days-infra-deploy` | `repo:github4me@4475381/my-little-days@1360277237:environment:family-infra` |
   | `my-little-days-db-migrate` | `repo:github4me@4475381/my-little-days@1360277237:environment:family-database` |
   | `my-little-days-api-deploy` | `repo:github4me@4475381/my-little-days@1360277237:environment:family-pilot` |

6. Give the credential a descriptive name and save.
7. Confirm issuer/subject/audience against the current workflow's binding or Azure login log. These subjects follow this repository's observed immutable-ID format; do not replace them with the older `repo:owner/repo:...` form unless the actual claim changes. Never print or copy the raw token.

### 4.3 Assign roles in the correct screen and scope

1. Open the **target Azure resource or subscription**, not the app registration's API permissions page.
2. Select **Access control (IAM) → Add → Add role assignment**. The Role assignments list itself is not the role-selection wizard.
3. Select the reviewed role. Some roles appear under the privileged-administrator role category rather than job-function roles.
4. On **Members**, choose **User, group, or service principal → Select members**.
5. Search for the exact app name and verify its identity. Select the service principal, not your personal account.
6. Choose **Review + assign**, then verify the resulting assignment's scope.
7. If Add role assignment is disabled, ask the hosting role administrator to perform it; application ownership does not itself grant Azure RBAC-assignment permission.

| Principal | Role/scope to verify |
| --- | --- |
| Infrastructure preview | Custom role in [github-infra-preview-role.example.json](../infra/github-infra-preview-role.example.json), assigned at the hosting subscription for subscription metadata/what-if. No write roles. |
| Infrastructure apply | Preserve the reviewed existing assignments. Needs subscription deployment/resource-group operations, target RG resource management and existing-plan join. No Owner, role-assignment management or SQL data-plane rights are required. |
| Database migration | Custom role in [github-database-role.example.json](../infra/github-database-role.example.json), assigned only at `little-days-sql-522fpstfbtds2` SQL server. |
| API deployment | **Website Contributor**, assigned only at `little-days-api-522fpstfbtds2` Web App. No database privileges. |

For a custom role: open **Subscription → IAM → Add → Add custom role**, import/review the linked JSON, create it, then make the separate role assignment at the scope specified above. `AssignableScopes` in a role definition does not itself grant access.

The exact infrastructure-apply role names were not supplied in the setup record, and there is no checked-in apply-role JSON. For disaster recovery, record/export the reviewed assignment names and scopes privately; do not guess a broad replacement grant. The [infrastructure guide](AZURE-GITHUB-INFRA.md) specifies the required operations.

Portal reference: [assign Azure roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-portal).

## 5. Bicep: initial deployment and future changes

Infrastructure is already created. This section is for reference, not an instruction to redeploy now.

1. Review [Bicep parameters](../infra/bicep/pilot.parameters.example.json) and the current infrastructure diff.
2. Confirm the existing plan remains `ProdRG/reticelASP`; review its CPU/memory usage and the impact on the app already hosted there.
3. Confirm SQL free-offer eligibility and cost expectations. Do not accept an automatic paid fallback or shared-plan resize.
4. Complete sections 3–4 before enabling apply.
5. Open **Actions → Family infrastructure → Run workflow** and select the trusted branch, or push a reviewed infrastructure change to it. Documentation-only edits do not trigger infrastructure deployment.
6. Review the preview job, commit and proposed resource changes. This is a what-if, not a guarantee of deployer permissions or capacity.
7. Approve `family-infra` only when the preview and capacity are acceptable.
8. Record the output resource names, API URL, SQL hostname/database and managed identity ID. Preserve existing successful values in section 2.
9. Continue with SQL/customer/API configuration: Bicep does not perform those steps.

Do not run a local infrastructure apply alongside GitHub. Infrastructure apply and API/database releases use the same concurrency group. If a revision or configuration fingerprint becomes stale, start and review a fresh run; do not bypass the checks.

## 6. SQL: one-time bootstrap and migration environment

### 6.1 Bootstrap identities (already reported complete)

1. Open SQL server **little-days-sql-522fpstfbtds2 → Networking**.
2. If needed for an operator connection, temporarily allow only your current public IPv4. Keep **Allow Azure services** off. Preserve reviewed App Service outbound-IP rules.
3. Connect using SSMS or VS Code MSSQL, selecting **Microsoft Entra ID – Universal with MFA support** (or the client's equivalent interactive Entra option).
4. Sign in as the configured administrator **Chao Wang**. Server is `little-days-sql-522fpstfbtds2.database.windows.net`; select database **little-days-family**, not `master`. Keep encryption enabled and certificate validation on.
5. Open [sql-bootstrap.sql](../infra/sql-bootstrap.sql). In a private local copy, replace:

   | Variable | Value |
   | --- | --- |
   | `@ExpectedDatabase` | `little-days-family` |
   | `@RuntimeIdentity` | `little-days-api-522fpstfbtds2` |
   | `@MigrationGroup` | `my-little-days-db-migrate` |

6. Verify the named identities uniquely resolve in the hosting tenant. Runtime object ID: `fbb9ee76-3e03-4089-a94c-3548f74ad35a`. Migration service principal object ID: `a7f2dbde-d334-401a-b6df-a24baf0a6f43` (not registration object ID `5d7fdc0e-9ec7-4e4b-a63a-d0f114c5270e`).
7. Review and execute the bootstrap against the dedicated database. It creates contained users, runtime-role membership and migration privileges; it does not create the application tables.
8. Verify the users and runtime role exist. If directory lookup fails, resolve it with the SQL/Entra administrator rather than switching to SQL passwords or granting Graph privileges to the API managed identity.
9. Remove only your temporary operator firewall rule when finished.

### 6.2 Configure GitHub database environment

In **Settings → Environments → family-database → Environment variables**, set:

| Variable | Value |
| --- | --- |
| `AZURE_SUBSCRIPTION_ID` | `4768a858-f23f-4a39-bb64-eabc9c142627` |
| `AZURE_TENANT_ID` | `7b7e6e31-a778-4334-aee2-e969fa27fd0e` |
| `AZURE_DB_MIGRATION_CLIENT_ID` | `f122630b-8e09-4aa1-a6c4-1bb122945afb` |
| `FAMILY_DB_RESOURCE_GROUP` | `my-little-days-pilot-rg` |
| `FAMILY_DB_SERVER_NAME` | `little-days-sql-522fpstfbtds2` |
| `FAMILY_DB_NAME` | `little-days-family` |
| `FAMILY_DB_MIGRATIONS_ENABLED` | `true` only after bootstrap and environment protection |

DbUp, not the API, initializes and upgrades schema. Do not run the old API `--migrate` command or manually apply table-grant scripts. See [database deployment](AZURE-DATABASE-DEPLOYMENT.md) for transaction, journal and adoption details.

## 7. Customer tenant and mobile/API registrations

### 7.1 Locate the customer tenant

1. Open [Entra admin center](https://entra.microsoft.com) and switch directory to **deab2578-7cd3-4152-b5db-f430d6b638f8**.
2. Confirm this is an External ID customer tenant, not the hosting workforce directory.
3. Open the tenant overview/custom domain names and record its actual default `<domain>.onmicrosoft.com`. The domain is not derivable from its GUID or app name.
4. Do not recreate the tenant or registrations already listed in section 2.

For a future rebuild only: **Entra ID → Overview → Manage tenants → Create → External**, choose name/domain/location, link the subscription/resource group, review and create. Location cannot be changed later. Keep hosting resources in the original directory. [Microsoft tenant setup](https://learn.microsoft.com/en-us/entra/external-id/customers/quickstart-tenant-setup)

### 7.2 Mobile registration

1. In the customer directory open **App registrations → my-little-days-mobile**.
2. Confirm client ID `abce8eb9-baf9-4c17-8801-20d0716a0e4d` and supported accounts in this organization only.
3. Under **Owners**, add the responsible administrator if missing.
4. Open **Authentication → Add a platform → Mobile and desktop applications**.
5. Add the custom redirect exactly `mylittledays://auth` and save.
6. Do not substitute an MSAL-generated `msauth` URI. Do not create a mobile secret or enable implicit/password/device-code flows for this app.

### 7.3 API registration, scope and token version

1. Open **my-little-days-api** in the same customer directory; confirm client ID `9233837e-60c2-45c6-871b-96bd9cc8e007`.
2. Add a responsible administrator under **Owners**. No redirect or secret is needed for this token-resource registration.
3. Open **Expose an API → Application ID URI → Add** and save:

   ```text
   api://9233837e-60c2-45c6-871b-96bd9cc8e007
   ```

4. Select **Add a scope** and enter:

   | Field | Value |
   | --- | --- |
   | Scope name | `Family.ReadWrite` |
   | Who can consent | `Admins only` |
   | Admin consent display name | `Access your family's records` |
   | Admin consent description | `Allow My Little Days to read and update records in families you belong to.` |
   | State | `Enabled` |

5. Save the scope. Under **Authorized client applications → Add a client application**, enter mobile client ID `abce8eb9-baf9-4c17-8801-20d0716a0e4d`, check `Family.ReadWrite` and save.
6. Open **Manifest**, find the existing `api` object and set `requestedAccessTokenVersion` to numeric `2`. Preserve every other property, especially the newly created scope; save.

### 7.4 Mobile delegated permission and consent

1. Return to **my-little-days-mobile → API permissions → Add a permission → My APIs**.
2. Select **my-little-days-api → Delegated permissions → Family.ReadWrite → Add permissions**.
3. Select **Grant admin consent** for the customer tenant and confirm.
4. Verify the permission status is granted. If the API is not listed, check directory selection and owners on both registrations.
5. The mobile requested scope must be exactly `api://9233837e-60c2-45c6-871b-96bd9cc8e007/Family.ReadWrite`.

This is a delegated API scope, not a family administrator role. Family permissions remain in the application's database. References: [expose an API](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-expose-web-apis), [client permissions](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-access-web-apis).

## 8. Customer email-code sign-up/sign-in flow

1. Stay in the customer tenant.
2. Open **External Identities → All Identity Providers → Email One-time-passcode** and ensure it is enabled.
3. Open **External Identities → User flows → New user flow**.
4. Use a descriptive name, for example `MyLittleDaysSignUpSignIn`.
5. Under identity providers select **Email Accounts → Email one-time passcode**.
6. Keep the flow email-OTP-only; do not enable password or social identity providers. Graph represents email OTP itself as `federated` with issuer `mail`; that internal representation is supported and does not mean other federated providers are enabled. Changing providers requires a separate compatibility/security review.
7. Select only needed user attributes, such as display name if required. Do not collect unnecessary family information through registration.
8. Create the flow; open **Applications → Add application** and select **my-little-days-mobile**. Do not attach the token-resource API or directory-service registration as the interactive client.
9. Verify the mobile registration is associated with this flow and test the real email-code experience using a disposable customer account when the native build is ready.

Entra sends sign-in verification codes. Family invitations themselves are still discovered in the app; no invitation-email delivery service is required. Reference: [Microsoft user flows](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-user-flow-sign-up-sign-in-customers).

## 9. Server-only customer directory credentials

For a smaller setup, this runbook uses the already-supported shared credential option: one confidential customer registration handles both account lookup and deletion.

1. In the **customer** tenant open **App registrations → New registration**.
2. Name it `my-little-days-directory`, select this organization only, leave redirect empty and register. If it already exists, inspect/reuse it.
3. Record its Application (client) ID and add a responsible administrator owner.
4. Open **API permissions → Add a permission → Microsoft Graph → Application permissions** (not delegated).
5. Add `User.ReadWrite.All` and `User.DeleteRestore.All`.
6. Grant administrator consent in the customer tenant; verify both permissions show granted.
7. Do not assign privileged directory-administrator roles to this app. It must not be reused as a GitHub deployer or embedded in mobile configuration.
8. Open **Certificates & secrets → Client secrets → New client secret**, choose an appropriate expiry and create it.
9. Copy the secret **Value**, not the secret ID, directly into restricted App Service configuration in section 10. Record its expiry and a rotation reminder in a private operator system.
10. Never put the value in this document, Git, GitHub variables/artifacts, Expo settings, screenshots or chat. If accidentally exposed, rotate it.

`User.ReadWrite.All` covers the required reads and active-user deletion; `User.DeleteRestore.All` covers permanent deleted-user removal. Separate read/deletion registrations remain an alternative documented in [Azure family setup](AZURE-FAMILY-SETUP.md), but do not mix the two configuration modes.

References: [read user permissions](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0), [delete active users](https://learn.microsoft.com/en-us/graph/api/user-delete?view=graph-rest-1.0), [permanent deletion](https://learn.microsoft.com/en-us/graph/api/directory-deleteditems-delete?view=graph-rest-1.0).

## 10. Configure the API in App Service

Coordinate this step with the running release: saving settings can restart the service. No settings are changed by writing this runbook.

1. Switch Azure Portal back to the **hosting** directory.
2. Open **App Services → little-days-api-522fpstfbtds2 → Settings → Environment variables → App settings**.
3. Add/update each setting below. Double underscores are intentional; do not use the Object IDs or hosting tenant where customer values are requested.

   | App setting | Value |
   | --- | --- |
   | `Entra__TenantId` | `deab2578-7cd3-4152-b5db-f430d6b638f8` |
   | `Entra__Audience` | `9233837e-60c2-45c6-871b-96bd9cc8e007` |
   | `Entra__MobileClientId` | `abce8eb9-baf9-4c17-8801-20d0716a0e4d` |
   | `Family__PublicBaseUrl` | `https://little-days-api-522fpstfbtds2.azurewebsites.net` |
   | `Family__HistoryId` | `64136b6e-01e2-4c48-890f-bef208eac9e3` — preserve across ordinary deployments |
   | `Admission__Mode` | `Directory` |
   | `Admission__LocalAccountIssuer` | Actual customer `<domain>.onmicrosoft.com` from section 7 |
   | `Admission__EmailOtpOnly` | `true` after the real OTP-only flow is configured |
   | `Admission__UseAccountDeletionCredentials` | `true` |
   | `AccountDeletion__GraphClientId` | `538d93ee-1d58-43cb-adcd-68e094200621` |
   | `AccountDeletion__GraphClientSecret` | Secret Value from section 9; server-only |
   | `AccountDeletion__WorkerEnabled` | `true` |
   | `AccountDeletion__PollIntervalMinutes` | `120` |

4. The user supplied `64136b6e-01e2-4c48-890f-bef208eac9e3` as the history ID. Verify the App Service setting matches; do not generate a replacement for this deployment. If a different valid value is already in use, reconcile the discrepancy before changing it. Only for a separate first-time setup with no existing history ID, generate one locally in PowerShell:

   ```powershell
   [guid]::NewGuid().ToString()
   ```

   Keep it stable on ordinary releases. Database restore is a different recovery procedure; see section 15.

5. With credential reuse enabled, omit **both** `Admission__GraphClientId` and `Admission__GraphClientSecret`. Check that older settings do not leave nonempty separate credentials configured.
6. Add app setting **ConnectionStrings__FamilyDatabase** with this value:

   ```text
   Server=tcp:little-days-sql-522fpstfbtds2.database.windows.net,1433;Database=little-days-family;Authentication=Active Directory Managed Identity;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
   ```

7. Save/Apply the settings. No SQL password or Key Vault is needed. Restrict who can read/update App Service settings and deploy code.
8. Check **Identity → System assigned** is **On** and its object ID matches section 2. Do not toggle it off/on, which could change the identity used by SQL.
9. Keep **Authentication / Easy Auth** disabled; the ASP.NET API validates bearer tokens itself.
10. Under **Configuration → General settings** (or the portal's stack settings), confirm Linux .NET 10 and startup command `dotnet LittleDays.FamilyApi.dll`. Do not configure a migration startup command. Keep the provisioned HTTPS/TLS and Always On settings.
11. Confirm SQL Networking contains the reviewed Web App outbound-IP rules. Do not enable all-Azure/all-Internet access as a connection workaround.
12. If startup fails, inspect sanitized application logs for missing setting names. Do not dump environment variables, secrets or request tokens.

`Admission__EmailOtpOnly=true` does not create the Entra flow. Directory mode deliberately fails startup when required identity/directory settings are missing; do not switch to a permissive/static fallback just to get a green health check.

## 11. API deployment environment and release steps

### 11.1 GitHub API variables

Open **Settings → Environments → family-pilot → Environment variables**:

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | Hosting `my-little-days-api-deploy` client ID; still to record, not `9233837e-...` |
| `AZURE_TENANT_ID` | `7b7e6e31-a778-4334-aee2-e969fa27fd0e` |
| `AZURE_SUBSCRIPTION_ID` | `4768a858-f23f-4a39-bb64-eabc9c142627` |
| `AZURE_WEBAPP_NAME` | `little-days-api-522fpstfbtds2` |
| `FAMILY_API_PUBLIC_URL` | `https://little-days-api-522fpstfbtds2.azurewebsites.net` |
| `FAMILY_PILOT_DEPLOY_ENABLED` | `true` only after protections and runtime configuration are ready |

The `pilot` environment/flag names remain intentional. OIDC uses the hosting deployer, while the deployed API validates customer access tokens; these are different identities.

### 11.2 Start a new release (not while the current run is still active)

1. Ensure reviewed code is committed/pushed to the trusted branch and no conflicting deployment is in progress.
2. Open **Actions → Deploy family API and database → Run workflow**.
3. Select **feature/family-invitations**, not `master`, in the branch dropdown.
4. Check **database_bootstrapped** because the SQL identities were bootstrapped and you reviewed the release's SQL changes.
5. Leave **adopt_ef=false** for this DbUp-managed database, including subsequent runs. It is only for reviewed legacy EF adoption, not a normal retry option.
6. Run. There is **no release SHA input**; the workflow pins the selected commit automatically.
7. Review validation and CI results. Before approving **family-database**, review the pinned commit and migration diff. A newer branch head makes the approval stale.
8. DbUp opens access only for the runner's exact IPv4, applies pending migrations and removes its firewall rule. Both migration and cleanup must succeed before API deployment.
9. Approve **family-pilot** when ready. The previously built API artifact is deployed and `/health/live` checked.
10. Record the run link, pinned SHA, database outcome, firewall cleanup outcome and API outcome privately, without tokens/customer payloads.

If a run is still active, let it finish; the checklist above is a reference for a later release, not an instruction to start a duplicate.

## 12. Configure the next native mobile build

### 12.1 Add the public connection settings in Expo

Setup checkpoint, 16 September 2026: the user confirmed saving all four variables below plus `EXPO_PUBLIC_FAMILY_UI_DEMO=0`. A subsequent read-only `eas env:list preview` check confirmed those five exact public values. Account/project checks also matched the expected project. This is not a completed build or a verification of customer authentication.

1. Sign in to [Expo](https://expo.dev) and select account **expo4chao**.
2. Open the existing **little-days** project. Confirm its project ID is `a5210f78-8729-46d4-82a4-7d1d40d30ac6`; do not create a second project because the store display name is My Little Days.
3. Open the project's **Environment variables** page (under project settings if grouped there).
4. Create or update each of the four values below as a string with **Plain text** visibility, assigned to the **preview** environment only for this first integration build.
5. Save each variable and verify its preview environment badge. Avoid duplicate names/conflicting account-wide values.
6. Check that `EXPO_PUBLIC_FAMILY_UI_DEMO` is absent or `0` for the real preview environment, not `1`. Never add Graph secrets or SQL credentials here.

These are public identifiers/URLs embedded into the mobile bundle, not passwords:

```dotenv
EXPO_PUBLIC_FAMILY_API_URL=https://little-days-api-522fpstfbtds2.azurewebsites.net
EXPO_PUBLIC_ENTRA_TENANT_ID=deab2578-7cd3-4152-b5db-f430d6b638f8
EXPO_PUBLIC_ENTRA_CLIENT_ID=abce8eb9-baf9-4c17-8801-20d0716a0e4d
EXPO_PUBLIC_ENTRA_API_SCOPE=api://9233837e-60c2-45c6-871b-96bd9cc8e007/Family.ReadWrite
```

The API's `Family__HistoryId` is not an extra mobile environment variable. Reference: [EAS environment variables](https://docs.expo.dev/eas/environment-variables/).

### 12.2 Preflight the real preview build

1. Use the local project directory `C:\Git\little-days-offline-v0.1.0\little-days` and the reviewed `feature/family-invitations` code. Preserve unrelated local changes; do not reset the checkout.
2. Verify EAS login/project with these read-only commands (log in interactively if needed; never share passwords or Apple verification codes in chat):

   ```powershell
   npx eas-cli@latest whoami
   npx eas-cli@latest project:info
   ```

3. Check the resolved build configuration:

   ```powershell
   npx eas-cli@latest config --platform ios --profile preview
   ```

4. Confirm profile **preview**, distribution **internal**, channel **preview**, project ID above and bundle identifier `com.littledays.babylog`. Confirm the resolved EAS environment is **preview**; if not, correct the profile's environment selection before building. The checked-in preview profile does not currently specify an explicit `environment` field.
5. Do not select **ui-preview**: that profile explicitly enables the UI-only demo. Verify no demo flag or unexpected local `.env` values override real connection settings. Do not print unrelated secret variables while checking.
6. Run `npm run verify` and `npm run export:ios` with the intended public configuration available locally. A local export without the EAS settings does not prove the cloud build has them; review cloud environment selection as well.
7. Before uploading, review the EAS upload inputs/exclusions for local/private files (including the existing unrelated `work/` directory). Do not upload private operator files or credentials simply because they are untracked.

Preflight evidence, 16 September 2026: `npm run verify` passed (111 unit, 33 controller, 8 family UI and 9 owner-setup tests, plus TypeScript). `npm run export:ios` passed with the four recorded public values and demo `0` explicitly set for that process; local dotenv loading was disabled for this check. `.easignore` excludes `work/`, `.env*`, dependencies, server files and generated bundles. This is JavaScript/local validation, not proof of native signing, device storage or Entra login. CLI used for the read-only checks: EAS CLI `24.6.0`.

Reference: [using EAS variables in builds](https://docs.expo.dev/eas/environment-variables/usage/).

### 12.3 Register the two test iPhones

1. This route uses an **internal ad hoc preview**, not TestFlight. It requires the intended Apple Developer team and each phone in the provisioning profile.
2. Check existing devices:

   ```powershell
   npx eas-cli@latest device:list --apple-team-id A9974KXQ4G
   ```

   Read-only check on 16 September 2026 found two registered iPhones on **Chao Wang (Individual)**, team `A9974KXQ4G`. Device names were empty. The user subsequently confirmed the same previously used phones will be tested; no new device registration is needed if those records match. Registration alone does not prove inclusion in an existing provisioning profile: verify both during signing. For noninteractive checks, supply `--apple-team-id A9974KXQ4G --non-interactive`; without the team flag, this CLI required a team selection and stopped. Do not store full UDIDs in this document.

3. If either phone is missing, run `npx eas-cli@latest device:create`, choose the website registration method, and open the generated link on that iPhone in Safari. Follow the device-registration prompts. Keep the UDID private.
4. Register both phones before the build. During interactive signing, confirm both are included in the provisioning profile; a saved old profile may omit a newly registered phone.
5. If Apple is still processing a newly registered device, wait for processing rather than treating an install failure as an app-code issue.

### 12.4 Build, install and identify the exact version

Verified build checkpoint (16 September 2026): [preview install/build page](https://expo.dev/accounts/expo4chao/projects/little-days/builds/eb360c84-c263-49be-ac63-217ad61dda19), source commit `0437e70b581962e810e3607826348393716d0a3f`, iOS `0.2.0 (18)`, internal profile `preview`, finished at `2026-09-16T00:45:15.875Z`. EAS reported no build error. This does not independently verify the embedded environment values, provisioning device list, successful installation or customer login. Use this exact build page instead of starting a duplicate build.

1. Once configuration, checks and device registration are complete, start the build deliberately:

   ```powershell
   npx eas-cli@latest build --platform ios --profile preview
   ```

2. Follow interactive signing prompts for the correct Apple team and device list. Do not use a noninteractive build with an outdated provisioning profile.
3. Wait for success. Record the build ID, source revision, app version/build number, profile, channel and environment. Review logs for environment selection without publishing credential material.
4. Open that **specific completed build's** install link/QR on each included iPhone and install. Do not use a generic old saved preview link. Do not submit to TestFlight as part of this ad hoc step.
5. The preview uses the existing app's bundle identifier and may replace its installed copy. Prefer spare phones with disposable data. Before replacement or joining a family, preserve important offline-only data using the existing supported backup process; joined-family backup remains blocked by design. Do not uninstall a data-bearing app to troubleshoot installation.
6. Launch and compare the app footer/version with the intended build. Since EAS Updates is enabled, if old UI appears, check the preview channel's compatible update/runtime and installed build before rebuilding or deleting data; do not publish an unrelated update to fix it blindly.
7. Proceed to section 13: real email-code login first, then family creation/invitation on two phones. If sign-in fails, capture the non-sensitive error and stop before importing real family records.

An old installed build does not gain newly embedded settings merely because Azure changed. Reference: [Expo internal distribution and device provisioning](https://docs.expo.dev/build/internal-distribution/).

The API/database GitHub workflow does not build or distribute the iPhone app. Device provisioning and App Store review remain separate from this Azure setup.

### 12.5 Optional: build on your own Mac instead of Expo cloud

This is an alternative discussed on 16 September 2026, not a confirmed switch or a completed Mac setup.

Local compilation uses your Mac rather than EAS cloud build workers, avoiding cloud build usage for that compilation. It does not cancel an existing Expo subscription or remove Apple membership, Azure hosting, hardware/electricity or other service costs. Expo's free plan currently includes 15 iOS cloud builds per month; check the account's current quota/plan before assuming a cloud build will cost money. [Expo pricing](https://expo.dev/pricing)

1. Use a Mac capable of running the Xcode/iOS SDK required by this project's Expo SDK. Install and open Xcode, complete its first-launch setup, and select its command-line tools. Install a supported Node version (see `package.json`), CocoaPods and fastlane for EAS local iOS builds. Validate the actual Mac/tool versions before beginning; they have not been inspected here.
2. Check out the same reviewed feature revision on the Mac and run `npm ci`. Windows-only uncommitted files do not automatically transfer; review/sync intended changes without copying private drafts or credentials.
3. Sign into the same Expo account and verify `expo4chao/little-days`. Keep the existing Apple team, bundle ID and registered-phone signing setup.
4. Make all four public connection values plus demo `0` from section 12.1 available to the local build. Verify the resolved preview configuration. Do not assume cloud-only secret variables are available locally or put server credentials on the Mac for a mobile build.
5. Run the local checks, then deliberately start compilation from the project directory:

   ```sh
   npx eas-cli@24.6.0 build --platform ios --profile preview --local
   ```

6. Confirm signing includes both registered phones. Preserve the resulting signed IPA outside Git and record its source revision/profile. A local build does not automatically provide the same hosted Expo build/install page as a cloud build; arrange a supported IPA installation route for the registered devices before proceeding to section 13.
7. For quick attached-device development, `npx expo run:ios --device` is another route, but it is a development build workflow, not a replacement command for producing the signed preview artifact above.

Apple Developer Program membership is still needed for this ad hoc distribution route and TestFlight/App Store distribution (currently USD 99/year or local pricing). Free Xcode personal-device testing has limitations and is a separate workflow, not the team's current distribution setup. [Apple membership](https://developer.apple.com/help/account/membership/program-enrollment)

Local EAS builds still authenticate with Expo and can retrieve managed signing credentials. See [Expo local builds](https://docs.expo.dev/build-reference/local-builds/) for tool requirements and limitations. No paid plan changes, cloud builds or Mac installs are performed by adding these instructions.

## 13. Verify service and privacy behavior before real family use

### First installed-phone checkpoint

1. Open the exact completed build link in section 12.4 in Safari on the first registered iPhone and use its install control. Repeat on the second phone. Do not uninstall an existing data-bearing copy if installation fails.
2. Launch **My Little Days / 小日子** and check version `0.2.0`, build `18` where displayed. These numbers can recur across previews; the exact EAS build link is the primary install reference.
3. Open **More / 我的 → Family sharing / 家庭共享 → Manage family sharing / 管理家庭共享 → Sign in / 登录**.
4. For a first-time customer, tap **No account? Create one** on the hosted sign-in page, enter a disposable test email, complete email-code verification and any required profile fields. Use a separate customer test email from the tenant administrator where possible. An Azure/Expo administrator account is not automatically a customer account in this tenant. After initial registration, use normal Sign in on later visits. Never share the OTP, passwords or access tokens in chat/screenshots.
5. Confirm the browser returns to the app and it shows the signed-in account. Stop at this checkpoint before creating/joining a family with existing personal records; review import/replacement warnings first.
6. If the page shows UI-demo wording, sign-in is unavailable, the callback does not return, or an error appears, record the non-sensitive message and installed build identity. A green EAS build is not authentication verification.

First-device observation, 16 September 2026: the user reached the branded Entra customer sign-in page and received **We couldn't find an account with this email address**, with **No account? Create one** available. This shows the hosted login page is reachable, not that token exchange, API admission or SQL access works. Complete self-service customer registration first; do not create a workforce guest invitation or rebuild the app for this message. If the email was already registered, check spelling and customer tenant rather than assuming a new account is needed. If registration requests a password, pause and check the linked OTP-only flow instead of weakening API admission. [Microsoft first-user sign-up instructions](https://learn.microsoft.com/en-us/entra/external-id/customers/quickstart-get-started-guide)

### Full two-device acceptance

#### Diagnostic checkpoint: registration returns to app, but Sign in remains

Observed on 16 September 2026: after reporting account creation, the user returned to the app and saw **The action's result could not be confirmed**, while the Sign in button remained. Public liveness was rechecked and returned HTTP 200. Native sign-in is **not yet verified**.

Code inspection: the app performs browser authorization, code/token exchange and secure storage, then calls authenticated `/v1/me` to identify the account. The screenshot's generic message does not identify which stage failed. In particular, API `identity_unavailable` (Graph credential/permission/connectivity failures) currently falls through to this generic message; unmapped token-exchange errors can also do so. These are candidate causes, not a confirmed diagnosis. Do not delete/recreate the account, reset data, weaken authentication or rebuild solely on this evidence.

The attempted read-only App Service setting check was blocked by Azure CLI `Status_InteractionRequired`; cached `az account show` output alone did not prove usable access. To resume operator-assisted read-only inspection on the host, sign in interactively:

```powershell
az login --tenant 7b7e6e31-a778-4334-aee2-e969fa27fd0e --scope https://management.core.windows.net//.default
```

Select the existing hosting subscription if prompted. Keep credentials/verification codes private. After login, inspect only allow-listed public settings (customer tenant/API/mobile IDs, admission mode/issuer and directory client ID); do not print full App Service settings or secrets. Check directory permission consent and secret validity securely if the evidence points to Graph. This login does not itself fix the customer's session.

Portal alternative: switch Entra to customer tenant `deab2578-7cd3-4152-b5db-f430d6b638f8`, open **Monitoring & health → Sign-in logs**, and locate the mobile app's interactive and noninteractive entries around the failed attempt. Record only status, error code/reason and correlation ID where needed, with private user details redacted. A successful interactive event alone does not prove token exchange or `/v1/me` succeeded. [Microsoft activity-log access](https://learn.microsoft.com/en-us/entra/identity/monitoring-health/howto-access-activity-logs)

#### Follow-up: directory client not found (confirmed configuration failure)

After the operator reauthenticated Azure CLI, read-only checks found:

- `Entra__TenantId`, `Entra__Audience` and `Entra__MobileClientId` match the recorded customer registrations.
- Admission mode is `Directory`, email-OTP flag is `true`, credential reuse is `true`, and the configured issuer is `mylittledayscustomers.onmicrosoft.com`. These flags do not prove the actual Entra flow/domain configuration.
- `AccountDeletion__GraphClientId` is currently `50ecf79c-fd34-40df-b008-fd286ebaa97b`.
- A client-credentials request using the existing App Service credential against the customer tenant returned HTTP 400, `unauthorized_client`, error code `700016`. No secret or token was printed/persisted. User lookup could not proceed because this token request failed.

This is a confirmed API directory-access blocker and can produce the generic banner. It does not prove token exchange on the phone succeeded or exclude additional failures. The secret's validity and Graph grants are not yet established: application lookup failed first. [Microsoft error-code reference](https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes)

Next manual steps:

1. In Entra, switch to customer tenant `deab2578-7cd3-4152-b5db-f430d6b638f8`.
2. Open **App registrations → All applications → my-little-days-directory** (or the actual server directory-access registration's name).
3. On **Overview**, compare its **Application (client) ID** and **Directory (tenant) ID** with the settings above. Do not use an Object ID, Enterprise application Object ID or secret ID as the client ID. Record/share only these public identifiers for diagnosis.
4. If the registration is missing, complete section 9 in the customer tenant. Do not substitute the mobile/API token-resource registration or a hosting deployment app; do not delete existing registrations merely to troubleshoot.
5. Once the correct registration is established, an authorized operator updates App Service `AccountDeletion__GraphClientId` and ensures `AccountDeletion__GraphClientSecret` is that same app's secret Value. Coordinate the restart caused by Apply. Never paste the secret into chat or this document.
6. Verify the customer's Graph Application permissions/admin consent from section 9. Retest the directory token request and read-only identity lookup before retrying the phone login.
7. Retry Sign in with the already-created customer account. No database reset or native rebuild is indicated for a server-only directory credential correction.

No Azure settings, registrations, permissions or accounts were changed by this diagnostic session.

Subsequent confirmation, 16 September 2026: the user supplied the actual directory registration above. A diagnostic request using **correct client ID `538d93ee-1d58-43cb-adcd-68e094200621` with the existing App Service secret** succeeded (HTTP 200). The resulting Graph application permissions included both `User.ReadWrite.All` and `User.DeleteRestore.All`. A read-only customer lookup also returned HTTP 200; it found zero matches for the email from the earlier screenshot. The email actually used during completed registration may differ, so this does not establish that registration failed. No tokens, secrets or customer payloads were logged or saved.

The immediate correction is now specific:

1. In the hosting tenant, open **App Services → little-days-api-522fpstfbtds2 → Settings → Environment variables → App settings**.
2. Edit **AccountDeletion__GraphClientId** to **538d93ee-1d58-43cb-adcd-68e094200621**.
3. Leave the existing secret unchanged; it passed this check. Leave the customer tenant, mobile/API IDs and history ID unchanged.
4. Apply/Save during a suitable restart window, then retry Sign in with the exact email used for customer registration. No native rebuild is needed for this server-only correction.
5. If login still fails, compare the actual registered email/account and directory identity shape rather than recreating the account or assuming all remaining authentication stages are verified.

This correction was subsequently verified as active in App Service. It was applied by the operator, not by the diagnostic requests.

#### Follow-up: actual email-code account format is rejected by current API

After the user reported the same banner again, read-only checks established:

1. The corrected directory client ID is active. Its existing credential can acquire a Graph token and read the exact user object from a successful mobile sign-in event (HTTP 200).
2. Mobile registration has public/native redirect `mylittledays://auth`, with no Web/SPA redirect entries. The API registration exposes enabled `Family.ReadWrite` and requests v2 access tokens; the mobile registration requests that API scope.
3. Available customer-tenant mobile sign-in events included successful interactive events at `2026-09-16T00:50:27Z` and `00:50:54Z`. These do not by themselves prove native token exchange or API admission succeeded.
4. The actual enabled account has `creationType=null`, an identity with `signInType=federated` and `issuer=mail`, plus a directory-generated `userPrincipalName` identity. No user email/object ID or token is recorded here.
5. The pre-fix `GraphPublicIdentityAdmission.ParseLocalAccount` required `creationType=LocalAccount` and accepted only an `emailAddress` identity (apart from the ignored UPN). It therefore rejected the observed email-code account. This also explains why the earlier lookup restricted to `emailAddress` found zero matches; it did not prove the user was missing.

This is a confirmed code/data-format incompatibility, separate from the repaired client-ID setting. It is not yet proof of the exact error shown by the phone: `identity_not_supported` has a specific message in current mobile code, whereas the screenshot shows the generic fallback. Token exchange/storage and the exact deployed/mobile error path still need verification; do not mark login fixed merely after changing admission parsing.

Do not recreate the account, switch to password login, enable arbitrary federation, bypass tenant/issuer checks or reset the database. The diagnostic turn made no changes. The subsequently authorized correction supports exactly `creationType=null`, `federated`/`mail`, with one customer-tenant UPN anchor. Legacy local email support remains. The lookup now uses `mail` for OTP and checks the same object ID, email and method on a single enabled result; unsupported providers, guest creation types, mixed identities and ambiguous results still fail closed. JWT tenant/audience/client/scope checks and family permissions are unchanged.

Correction verification and release steps (16 September 2026):

1. Regression tests reproduced the rejection before the code change. After the correction, all 46 admission tests pass, including actual OTP shape, lookup issuer, duplicates, disabled users, wrong tenant anchors, guest/social accounts and changed lookup results.
2. Local `dotnet test server/LittleDays.slnx --configuration Release --no-restore` passed 89 tests; 47 SQL-dependent tests were skipped locally because no disposable SQL connection was configured. `npm run verify` also passed the TypeScript check and 161 mobile/domain/controller/UI tests. The deployment workflow runs SQL coverage against disposable SQL before release.
3. A read-only check using the existing directory application credential returned the exact enabled customer via the corrected `mail` issuer filter: one result, same object, no pagination. No credentials, emails, customer object IDs or token payloads were saved.
4. Commit and push the correction to `feature/family-invitations`. In GitHub **Actions → Deploy family API and database → Run workflow**, select that branch, set **database_bootstrapped=true**, and leave **adopt_ef=false**. No new SQL scripts or Azure configuration are required for this patch.
5. Let CI complete. If GitHub requests an environment review, the operator should approve the expected commit for `family-database` and then `family-pilot`. Do not bypass environment protection or push another commit while awaiting approval.
6. Confirm migration and API deployment jobs succeed, then check `/health/live`. Liveness alone does not validate sign-in.
7. Reopen the currently installed iPhone preview (0.2.0 / Update 18) and tap **Sign in** using the existing registered email and OTP. No native rebuild or account recreation is required for this API-only patch. Confirm the family account replaces the Sign in panel before continuing with family creation/invitations.
8. If the generic banner persists, capture the retry time/timezone and screenshot. Investigate token exchange, secure storage and the authenticated `/v1/me` response separately; do not interpret successful browser sign-in as proof of those later stages. The current mobile fallback also obscures `identity_unavailable`; no mobile error-handling change is included in this server patch.

Deployment observation: API correction commit `3a9f72991653948a58283815bd31ae59e9ba1a8e` was pushed and [release 35043105949](https://github.com/github4me/my-little-days/actions/runs/35043105949) passed CI, SQL migration and Azure package deployment. Its liveness step failed after about 55 seconds while the new container was still warming up. Azure reported the new site started at `2026-09-16T01:17:34Z`, roughly 2½ minutes after package deployment finished. A subsequent independent check confirmed `/health/live` returned 200/`ok` and unauthenticated `/v1/me` returned 401/`unauthorized`. This establishes server responsiveness and an authentication boundary, not successful iPhone sign-in. The workflow retry window is being extended to five minutes before a follow-up release; do not weaken auth or reset data for transient deployment-startup errors.

Final release verification: [release 35043608849](https://github.com/github4me/my-little-days/actions/runs/35043608849), deploying commit `2fec7dcbfff90f72631600cd1c4a5d68ff07102f`, completed successfully with the five-minute retry window. Validation, TypeScript/browser checks, API/real-SQL integration, DbUp migration and API deployment/liveness all passed. Independent post-release requests again returned 200/`ok` for `/health/live` and 401/`unauthorized` for unauthenticated `/v1/me`. Next manual step: reopen the existing iPhone build and retry **More → Family sharing → Sign in** with the registered email. End-to-end native sign-in is not yet confirmed; no rebuild, registration change, new credentials or data reset is required for this patch.

1. Open [API liveness](https://little-days-api-522fpstfbtds2.azurewebsites.net/health/live). Success proves process responsiveness only, not SQL or sign-in health.
2. Using the installed native build, register/sign in with a disposable email account using an actual OTP. Verify the intended customer tenant and return to the app.
3. Verify authenticated capabilities report schema `2`, the six supported record kinds and 10 MiB seed support. Do not put access tokens in chat/logs.
4. With disposable local data, create the first family and check the reviewed initial import succeeds without duplicate records.
5. Invite a second test email in the app. Verify no invitation email is sent, the intended recipient sees the in-app invitation after signing in, and unrelated accounts cannot access it.
6. Test accept and decline. Acceptance must not upload/merge the invitee's personal history into the family.
7. On two phones, verify shared records, overlapping records, author/admin edit permissions and first-successful-write conflict handling with a refresh.
8. Verify leave/removal revokes server access and detected revocation clears the family cache/drafts. Contributions remain with the family. Do not claim a disconnected device can detect a server removal instantaneously.
9. Verify administrator transfer and account/family deletion rules using disposable accounts. Test durable cleanup and retry behavior; do not delete real customer accounts for verification.
10. Verify local backup/import restrictions for joined families. Record native/offline acceptance separately from browser tests.

The deletion worker retries every 120 minutes by default while the service/database are available. SQL pause or quota exhaustion can delay cleanup; keep the worker enabled and monitor pending deletion outcomes.

## 14. Troubleshooting and safe reruns

| Symptom | Check / next action |
| --- | --- |
| `SQL_ADMIN_PRINCIPAL_TYPE must be User or Group` | Use exactly `User` or `Group`, not lowercase `user`. |
| Existing plan validation fails | Inspect actual Linux/region/SKU/status and use reviewed current scripts. Do not resize the shared plan just to bypass validation. |
| .NET runtime preflight fails | Inspect the actual advertised runtime and checked-in runtime parsing/version. Resolve the mismatch rather than bypassing the check or changing the API target blindly. |
| Apply/capacity flags are false | Review protection/capacity, then set the two flags in `family-infra`; repository enablement alone is insufficient. |
| `AADSTS70025` / missing federated credential | Configure federation on the exact client ID used by that job, in the hosting tenant. |
| No matching federated identity record | Compare issuer, full subject (including immutable IDs) and audience with the run's claims. Do not create a client secret as a workaround. |
| API configuration gate shows blank values | Check variables in **family-pilot**, exact names, and `FAMILY_PILOT_DEPLOY_ENABLED=true` after readiness. |
| Workflow missing / no Run workflow button | Manual discovery requires a workflow on the default branch. The repository has a discovery workflow; refresh Actions and select the feature branch. If still missing, verify remote workflow/default branch without merging unreviewed feature code. |
| `Approval is stale` | Branch head moved after the run was pinned. Start a fresh run at current trusted head and review it; retrying the old run keeps the old commit. |
| Migration succeeds, API fails | Keep the successful database state. Fix runtime/deployment configuration and rerun the compatible release. Do not drop tables or delete journal entries. |
| Need to retry after only Azure/GitHub configuration changed | An unchanged trusted SHA can be rerun after the first run ends. Applied DbUp scripts are skipped. If code changed, use a new run. |
| Migration SQL fails | Inspect the failed script and transactional result. Do not force journal entries or edit already-applied migrations. Review a forward fix. |
| Stale `github-db-*` firewall rule | Confirm the owning run is finished; remove only that exact stale rule under SQL Networking. Preserve runtime/other valid rules. |
| API starts but SQL fails | Check managed identity, contained user/runtime grants, exact database, outbound-IP rules and SQL availability/quota. No `db_owner` grant to runtime. |
| Invalid audience/tenant or sign-in rejection | Check customer IDs, delegated scope, API v2 token setting, mobile redirect/flow and actual default issuer domain. Do not weaken validation. |
| Hosted sign-in says it cannot find the email | For a first-time customer use **No account? Create one**, verify the email code and complete registration. Existing Azure/Expo credentials or an in-app family invitation do not automatically register a customer identity. If previously registered, verify email spelling and tenant. No rebuild is indicated by this message alone. |
| Graph access denied | Check customer directory client ID, secret Value/expiry, Application permissions and admin consent. Keep secret material out of logs. |
| Directory token request returns `AADSTS700016` | Compare the directory registration's Application (client) ID and customer tenant before inspecting secret/consent. Previously reproduced with incorrect `50ecf79c-fd34-40df-b008-fd286ebaa97b`; operator correction to `538d93ee-1d58-43cb-adcd-68e094200621` is now verified. |
| Correct Graph credentials, but email-code account still rejected | Deploy the admission correction supporting the exact tenant-bound `creationType=null`, `federated`/`mail` OTP format, then retry the existing iPhone build. If it still fails, distinguish token exchange/storage from API admission. Do not alter the account or loosen authentication. |
| Package deployed, but liveness step fails during warm-up | Check the deployment step and timestamped container startup logs, then request `/health/live` again. The shared B1 plan has taken about 2½ minutes to warm up. The workflow allows up to five minutes of retries; a continuing failure needs diagnosis, not repeated restarts. A passing liveness check still does not prove database access or customer sign-in. |
| Startup rejects shared directory credentials | With reuse `true`, omit both separate Admission Graph credentials; configure AccountDeletion credentials. |

Do not start another release or change the current run just because this document was added locally. No commit, push, cloud setting update or workflow execution is performed by this documentation task.

## 15. Future releases, secret rotation and recovery

### Database changes

1. Add a new ordered SQL script under `server/LittleDays.DatabaseMigrator/Scripts`; use the next unused number.
2. Never edit, rename or remove an applied script. `dbo.DatabaseMigrations` records names/checksums/timestamps.
3. Keep migrations additive/backward-compatible with the currently deployed API; database changes run first.
4. Review/test, then use the same protected API/database workflow. No manual table initialization is needed on later releases.
5. A successful DB change is not automatically undone if API deployment fails. Review backup/recovery before any destructive migration.

### Directory secret rotation

1. Before expiry, create a new secret on the same customer directory registration.
2. Update only `AccountDeletion__GraphClientSecret` in restricted App Service settings during a coordinated window.
3. Verify customer lookup and disposable-account deletion with the new credential.
4. Remove the old secret after verification. Record the new expiry privately; never commit either secret.

### Restore and access revocation

1. Keep traffic closed during a database restore.
2. Rotate `Family__HistoryId` after restore (not on ordinary releases).
3. Reapply post-backup deletion/revocation information from the restricted recovery record before reopening; a new history GUID cannot reconstruct lost events.
4. Verify deleted identities and revoked memberships cannot regain access.
5. Document SQL-backup/diagnostic retention separately from live application deletion. Do not claim all backup copies vanish immediately.

### Family creation, joining and received invitations (16 September 2026)

This change needs API deployment **before** the updated mobile app. It needs no new Azure resources, settings, permissions or database migrations.

1. Commit/review the API and mobile changes together. Run the existing **Deploy family API and database** workflow on that revision and verify success.
2. Publish the updated iPhone preview using the normal preview release process. Do not publish the new mobile confirmation against an older API: the older API ignores the new consent field.
   - For this JavaScript-only change, the existing preview build `eb360c84-c263-49be-ac63-217ad61dda19` has compatible runtime `0.2.0`; no native rebuild is required. Confirm the preview channel and section 12.1 public variables, including `EXPO_PUBLIC_FAMILY_UI_DEMO=0`, before publishing.
   - From the reviewed release commit, run `eas update --platform ios --channel preview --environment preview --clear-cache --message "Improve family creation and joining" --non-interactive`. Do not use `ui-preview`, the production channel, or a bundle exported without the real preview environment.
   - Record the returned update-group URL and commit. On each phone, open the installed preview online to download the update, then fully close and reopen it. Check **My account**, the collapsed **Create a family group**, and the new confirmation warning. The native footer remains `0.2.0 / Update 18` for this OTA; it is not an OTA identifier. Do not uninstall a data-bearing app.
3. On a disposable account without membership, receive two invitations. Open **Create a family group** (collapsed by default), enter another test email, and review. Verify the pending count, automatic-decline warning and required consent.
4. Cancel. Both invitations must remain available. Reopen, acknowledge and create. The new family and outgoing invitations must be created together; received pending invitations become declined. Refresh the inviting admins' invitation history to see the automatic-decline reason.
5. Verify an existing member sees the one-family reminder and no creation form. An admin sees guidance to transfer administration and leave, or close the group. A member sees guidance to leave first and the warning that family-record access is lost.
6. Verify new received invitations are not actionable while an account has active membership. Existing API membership checks still reject creating or joining a second family.
7. Older clients without automatic-decline consent cannot create a family while live invitations are pending; no invitations are changed. Update the app and review again. Previously successful creation receipts remain replayable without repeating the decline operation.
8. On another disposable account, receive invitations from two families. Tap **Accept invitation** for one, verify the automatic-decline and local-data replacement warnings, then cancel. Both invitations must remain available. Reopen and acknowledge: only the chosen family is joined; the other invitation shows **Automatically declined · recipient joined another family group** to its inviting admin.
9. Reconnect/restart after a lost acceptance response. The same operation must resume; it must not re-decline invitations created after the successful join. If the admin removes the user before snapshot download finishes, refreshing must end the obsolete activation and allow sign-out, without deleting untouched personal data.
10. A schema-1 legacy family's invitation must be rejected by the updated full-history client before membership is created; invites and personal data remain unchanged. If an earlier app already committed such a join, refresh with the updated app and use **My account → Sign out**. Ask the legacy family admin to remove that membership before joining a supported family; signing out alone does not end server membership.

Implementation notes: the server commits creating/joining and automatic declines in one transaction. The API presents automatic declines as `declined` with `declineReason: created_family` or `joined_family` for backward compatibility. Expired invitations and invitations belonging to closed families are not automatically declined. The updated client sends `declineOtherInvitations: true` and `requiredSchemaVersion: 2` when accepting; deploy API first because an older service ignores these fields. See [the API contract](FAMILY-API-CONTRACT.md). The checklist above remains the device acceptance procedure; deployment observations are recorded separately below.

Rollback caution: once automatic declines exist, an older API would expose internal invitation states instead of the public `declined` mapping. Retain the compatible API when rolling back the mobile update; review server rollback compatibility before replacing it. Never reset family data or the migration journal as a rollback shortcut.

Deployment observation, 16 September 2026: application commit `d1ad03b4de5d34ca881d03de3de916cbdfa666c1` was pushed to `feature/family-invitations`. [API/database release 35047833451](https://github.com/github4me/my-little-days/actions/runs/35047833451) completed successfully, including cloud app/browser checks, API/SQL integration, DbUp, firewall cleanup, API deployment and liveness. Independent post-release checks returned 200/`ok` from `/health/live` and 401/`unauthorized` from unauthenticated `/v1/me`. Local pre-release verification passed 171 app tests plus 147 API/database tests with no skips.

After API success, the same commit was published to EAS **preview**, iOS runtime **0.2.0**, with the **preview** environment and UI demo disabled. Update group: `cbbb24e7-6c1c-41fa-a63b-0abef0eded4c`; update ID: `01a0a80e-641a-70e1-b309-eaae2aa0cc10`; published at `2026-09-16T02:31:50.554Z`. EAS readback confirmed the commit/runtime/branch, and the exported iOS bundle contained the four expected public connection values. This is an OTA update, not a new native build or TestFlight submission. Existing compatible [preview build 18](https://expo.dev/accounts/expo4chao/projects/little-days/builds/eb360c84-c263-49be-ac63-217ad61dda19) remains the install reference. Native device update receipt, invitation flows and restart/network-interruption acceptance tests still need confirmation on the phones.

Second-phone login is unchanged by this release: signing into an already joined account does not itself delete that phone's independent offline data. A future per-device replacement/consent policy must be agreed before changing this behavior; do not assume it has been implemented.

### Account session-status correction: device acceptance

This client-side correction requires no new Azure settings, API or database changes. It is not deployed merely by adding these instructions; publish the reviewed mobile change separately using the preview OTA procedure above.

1. On a signed-out test account, start sign-in and cancel it. **My account** must stay **Signed out**; cancellation is a short informational notice, not a permanent error or a successful login. Do not delete real data to prepare this test.
2. If an existing session expires, the account must show **Session expired**, label the displayed name/email as cached details, and offer **Sign in again**. Cached profile information is not evidence of current authentication.
3. Cancel that reauthentication. The account must remain expired; the application must not enable family creation, invitation acceptance or account deletion. Explicit sign-out remains available, subject to the existing unresolved activation safeguards.
4. Complete reauthentication with the same account. After the server verifies it, **My account** must show **Signed in** and obsolete login errors must disappear, including for an account that has not joined a family yet.
5. Open the app offline with cached account details. It must not claim that those details have just been verified or silently sign the user out. Reconnect and refresh to verify the status; keep existing data and pending work intact.
6. Open **Request account deletion** without submitting. No previous login-cancellation error should appear in its confirmation. If authentication expires while the confirmation is open, submission must become unavailable and the explanation must request reauthentication. Cancel the dialog; only test a real deletion on an explicitly disposable account.
7. Verify unrelated unresolved errors (for example, a local-save or sign-out-cleanup failure) and unknown family-operation results are not dismissed by the cancellation-notice timer. Do not confuse a dismissed notice with a cancelled server operation.

### Five invited-person places and activation review

The invitation-capacity change itself requires the updated API and mobile client, but no SQL migration or new Azure settings. The shared photo/reminder/play additions below do require the new migration. Deploy the database/API before the mobile update. An old `Pilot:MaxMembers=20` value is automatically capped at six active people (one administrator plus five invitees); existing excess members or invitation history are not deleted.

1. Create a disposable family with five different invitee emails. Review must show the baby profile, category counts, total records and all five normalized addresses. Six different emails must be rejected without creating a family. Repeating the same address must not consume another place.
2. Close review before confirming and verify nothing is uploaded or created. Reopen it; consent must be unchecked again. Change the original records while reviewing and verify a stale review cannot be submitted.
3. In an existing family, active non-admin members and distinct unexpired pending invitations share the five places. At capacity, adding a new email must be blocked; renewing an existing pending invitation does not consume another place. Decline, revoke, expiry or departure releases that place. Concurrent requests must not exceed capacity.
4. Verify the create/join copy advises that the member holding the most complete baby history should create the family. Joining does not merge the recipient's personal records. Only after verified family records are downloaded and saved does activation clear and replace original local data; no recoverable personal backup is retained.
5. On both languages at narrow phone widths, check that the review's final action, cancellation and failure explanation remain usable without scrolling past all disclosure text.

### Family photos, reminders and play: release and phone acceptance

The shared-extras implementation covers the current baby avatar, reminder rules/settings, all stored play check-ins and play selections. It does not upload the device photo library. The authorized release is recorded below; successful publication does not confirm installation or native two-phone acceptance. See [the data-flow reference](FAMILY-EXTRAS.md).

#### A. Azure and GitHub release

1. Review the intended release commit and `server/LittleDays.DatabaseMigrator/Scripts/0003_FamilySharedExtras.sql`. This expands the existing `FamilyRecords` collection/JSON checks for extras and the bounded avatar. It does not recreate tables, replace records or require a new Azure resource. Leave scripts `0001` and `0002` unchanged.
2. Ensure the reviewed commit has been pushed to the trusted release branch before starting a release. In GitHub, open **Actions → Deploy family API and database → Run workflow** and select **feature/family-invitations**, or the deliberately configured trusted branch. Do not use an old failed run if its branch revision has since changed.
3. Confirm **SQL identities and runtime role are bootstrapped; I reviewed this release's SQL changes** only after reviewing the migration and verifying the existing bootstrap. Keep **Adopt a reviewed existing database with legacy EF history** unchecked for the already DbUp-managed database. No new bootstrap identities or grants are needed for this migration.
4. Start the workflow. Review/approve the `family-database` environment when requested. Check that the migrator applies `0003_FamilySharedExtras.sql`, or reports it already applied. Do not manually execute the SQL file or edit `dbo.DatabaseMigrations` to force a rerun.
5. After migration succeeds, review/approve API deployment through the existing `family-pilot` environment. The workflow orders the database before API packaging/deployment. Do not publish the mobile extras update before both have succeeded.
6. Verify API liveness using the existing `/health/live` check. Liveness alone does not verify SQL, login or extras support. During authenticated app testing, the capability contract must include `extrasSchemaVersion: 1`; new create/join activation refuses an older server before clearing personal data. Do not paste access tokens into documentation or screenshots.
7. If SQL succeeds but API deployment fails, retain the successful migration and fix/retry the compatible API release. DbUp skips already applied scripts. Do not revert or delete shared records to recover the deployment.
8. Publish the reviewed mobile commit to the existing Expo **preview** environment/channel using the previous release procedure, with `EXPO_PUBLIC_FAMILY_UI_DEMO=0`. Record the GitHub run, source commit, Expo update group/runtime and build/install reference. This is not a TestFlight submission unless one is separately requested.

No Bicep update, storage account, Key Vault, Entra registration or new environment variable is required for these extras. Existing API managed identity and database access remain in use. The original history limit is 10 MiB; the complete seed is bounded at 32 MiB and the avatar at 12 MiB decoded. Large avatars increase snapshot traffic, so monitor the existing App Service and SQL usage after release.

#### B. Before creating a family

1. Use disposable test histories and accounts on the two phones; joining intentionally clears/replaces the joiner's original local records. Do not run destructive acceptance against a real baby history without the person's informed approval.
2. On the creator phone, set a recognizable baby avatar. Save play selections and check-ins on more than one date, and create daily/after-feed reminder rules plus a one-time reminder with a known due time. The member with the most complete history should be the creator.
3. Open **More → Manage family sharing → Create a family group**. Review the baby profile, ordinary record counts, photo preview, reminder/check-in/settings counts and invitee emails. Cancel first and confirm nothing was uploaded or erased. Reopen and explicitly confirm the review/consent to create.
4. If the review shows an older-reminder warning, stop and return to personal **More → Reminders**. Old iOS one-time notifications can lack the original absolute deadline; the app will not guess or restart them. Explicitly cancel/recreate the affected reminders with the intended deadline, then prepare a fresh family review. Unknown legacy rule settings require the same review/recreation. Do not clear all app data or bypass the warning.
5. If an avatar or extra cannot be read, correct/reselect it in the personal app and retry review. Source changes between review and first upload must request a new review, not silently upload an unseen replacement. Cancelled or failed preparation must leave original personal data intact.

#### C. Two-phone acceptance after deployment

1. Creator: confirm successful creation retains the reviewed avatar, ordinary history, all check-in dates, selections and reminder rules in the family. Restart the app and check again. No recoverable personal backup should be manufactured during activation.
2. Invitee: sign in, accept the invitation and read the warning that existing local information will be cleared/replaced. After confirmed activation, see the creator's family data; the invitee's unrelated photo/history/play/reminders must not have been uploaded to the family. Cancel a separate disposable acceptance attempt before confirmation and verify its local data remains unchanged.
3. On **Care → Play activities / Play settings**, verify the creator's selections and today's family check-ins appear on both phones. A member can add a check-in and undo their own; they cannot undo another member's check-in or change shared activity selections. The administrator can manage all. Refresh the other phone and test a stale edit/conflict without losing the winning record.
4. Update the family avatar as administrator, then refresh the member phone. Confirm the member cannot change it. Remove it and add another supported photo to check that clearing the avatar does not permanently block later updates. Native photo selection/decoding must be checked on the phones, not just in the browser.
5. On **More → Reminders**, confirm the family rules are visible but neither phone enables notifications merely by joining/downloading. Choose **Enable on this phone** on only one phone; handle the OS permission prompt. Verify the other phone stays opted out. Disabling on one phone must not delete family rules or change the other phone's choice.
6. Verify one-time rules use the original absolute due time and expired ones do not restart. Daily rules use each phone's local time. After-feed rules follow the latest family feed and do not produce duplicate notifications after repeated refreshes. Test silent/non-silent behavior on the actual iPhone; do not infer delivery from a saved record.
7. Add/edit/remove a reminder as its member-author and refresh the other phone. Another member cannot edit/delete it; the administrator can. Confirm the delete dialog can be cancelled without a write. Unsaved reminder edits must remain drafts.
8. With disposable accounts, leave/remove a member or sign out while family reminders are enabled. After the action is verified, family records and notifications must be cleared from that device and must not reappear in personal storage. Retry after interrupted connectivity. A remotely removed offline phone cannot learn its removal until reconnecting; check cleanup when it reconnects rather than promising instantaneous offline erasure.
9. Join a different disposable family and verify no avatar, check-in, selection, reminder rule or pending edit from the previous family appears there. New-family notifications require their own explicit opt-in. Record device/OS, release identifiers and any failure; do not include private baby records or auth tokens in shared logs.

These checks do not change the existing policy for signing an already joined account into a second phone that has independent offline data. Explicit create/join activation is the destructive replacement flow; do not assume a newly implemented automatic second-phone migration.

#### Shared-extras release evidence: 16 September 2026

- Application commit `7cf0dab71ad3ed3a8668d26c573d893e5ec0d73b` was pushed to `feature/family-invitations`. Only reviewed source, tests and documentation were committed; local `work/` and `dist-ios-verification/` were excluded.
- [API/database release 35066678308](https://github.com/github4me/my-little-days/actions/runs/35066678308) completed successfully for that exact commit. Cloud application/browser checks, API/SQL integration, DbUp migration and API deployment/liveness passed. Migration logs identify `0003_FamilySharedExtras.sql`, confirm migration success at `2026-09-16T07:07:17Z`, and confirm the temporary SQL firewall rule was removed.
- Independent post-deployment requests returned HTTP 200 with `{"status":"ok"}` from `/health/live`, and HTTP 401/`unauthorized` from both unauthenticated `/v1/me` and `/v2/capabilities`. These prove responsiveness and an authentication boundary, not authenticated phone flows.
- The same application commit was published to EAS **preview**, **iOS**, runtime **0.2.0**, using the **preview** environment and `EXPO_PUBLIC_FAMILY_UI_DEMO=0`. Update group: [`d540cfe1-70c4-476d-bc85-5e248131cd29`](https://expo.dev/accounts/expo4chao/projects/little-days/updates/d540cfe1-70c4-476d-bc85-5e248131cd29). Update ID: `01a0a90d-0891-75d5-a0f1-903f4bafad45`. Published at `2026-09-16T07:09:58.801Z`. EAS readback confirmed the source commit, iOS platform, preview branch and runtime. The exported bundle contains all four expected public API/Entra connection values.
- No native rebuild, Bicep deployment, TestFlight submission or App Store submission was performed. Existing compatible [preview build 18](https://expo.dev/accounts/expo4chao/projects/little-days/builds/eb360c84-c263-49be-ac63-217ad61dda19) remains the install reference. On each phone, open the app online to download the update, then fully close and reopen it. Do not uninstall a data-bearing app. The static footer remains `0.2.0 / Update 18`; use the update group and new behavior rather than this footer alone to identify the OTA.
- Still required: complete section C on disposable two-phone data, especially photo decoding, SQLite activation/recovery and actual notification delivery. Do not claim device acceptance from successful publication.

Post-release CI diagnosis: the later documentation-only commit `703f9e8` triggered [CI 35067266702](https://github.com/github4me/my-little-days/actions/runs/35067266702), which failed the calendar filter bounding-box assertion. This was not the deployment workflow and did not undo the successful Azure or Expo release above. A local reproduction found a test synchronization race: the closing filter modal and inline toolbar share accessible labels, so the test could locate an old modal button immediately before it detached. The original sequence produced transient null boxes in 27 of 30 resize cycles; waiting for the modal-only **Close filters** button to detach produced none in 30 cycles. The fix changes only test waiting, retaining all size, alignment and filtering assertions. A fresh normal web export and three consecutive full browser-suite runs passed locally. For this test-only correction, push the reviewed change and check the new **Family sharing CI** run; do not rerun DbUp, Bicep, API deployment or Expo publication merely because the older CI entry remains red.

## 16. Remaining operator checklist

- [ ] Record actual customer default `.onmicrosoft.com` domain.
- [ ] Verify the mobile redirect is saved.
- [ ] Verify API scope, v2 token setting, mobile permission and administrator consent.
- [ ] Verify OTP-only user flow and mobile association.
- [ ] Create/verify directory registration, Graph consent and private secret/expiry record.
- [ ] Record hosting API deployment client ID (not the customer API ID).
- [x] Record user-supplied stable history GUID: `64136b6e-01e2-4c48-890f-bef208eac9e3`.
- [ ] Configure/verify App Service settings, including that the deployed history GUID matches the recorded value.
- [x] Verify public API liveness: returned `{"status":"ok"}` on 16 September 2026.
- [ ] Record the latest workflow's final result; do not infer all jobs succeeded from liveness alone.
- [ ] Confirm temporary migration firewall access is cleaned up.
- [x] Read-only EAS check confirmed Expo preview public variables and UI demo flag `0`.
- [x] Verified Expo project/account and enumerated two registered iPhones on the expected Apple team.
- [x] User confirmed the same previously registered test phones will be used.
- [x] Local type check, 161 tests and live-config iOS JavaScript export passed.
- [x] EAS verified the supplied signed preview build completed: `eb360c84-c263-49be-ac63-217ad61dda19`, iOS `0.2.0 (18)`.
- [ ] Verify both phones can install this preview and complete the first real sign-in checkpoint.
- [ ] Configure the real native build and perform two-device acceptance.
- [ ] Record reviewed infrastructure-apply RBAC assignment names/scopes for recovery.
- [ ] Record monitoring, secret rotation and restore/deletion verification responsibilities.

Related references: [full Azure activation](AZURE-FAMILY-SETUP.md), [GitHub infrastructure](AZURE-GITHUB-INFRA.md), [Bicep deployment](AZURE-BICEP-DEPLOYMENT.md), [database/API release](AZURE-DATABASE-DEPLOYMENT.md), [server configuration example](../infra/api-appsettings.example.json), [mobile configuration example](../infra/mobile.env.example).
