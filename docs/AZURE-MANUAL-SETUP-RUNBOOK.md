Warning: truncated output (original token count: 38479)
Total output lines: 1058

# My Little Days: manual Azure and GitHub setup runbook

Last updated: 17 September 2026 (Australia/Sydney).

This is the operator's step-by-step reference for infrastructure, SQL bootstrap, customer authentication, API settings and releases. It records known values without storing secrets. Existing names containing `pilot` are compatibility identifiers: do not rename them or create replacement resources just because the product now supports full family sharing.

**Security release prerequisite (17 September):** follow the [security remediation and release checklist](SECURITY-REMEDIATION-2026-09-17.md) before the next database/API deployment. It documents automatic exact-IP firewall checks, additive DbUp migration 0004, the restore maintenance gate and the new native-only preview runtime. A manually maintained GitHub IP list is no longer required. No live firewall/settings changes or production restore were performed by that code remediation. Independent recovery evidence remains required; a maintenance flag is not a recovery ledger.

**Backend update (17 September, 10:40 Sydney):** [release 35167068255](https://github.com/github4me/my-little-days/actions/runs/35167068255) successfully deployed `d41b7a1`, including migration 0004. SQL journal/schema, temporary firewall cleanup, retained operator access, API liveness/readiness and unauthenticated rejection were checked. A signed-in phone refresh/read/sync is still required. Both deployment environments have branch restrictions but no required reviewers; see the [reviewer setup steps](AZURE-DATABASE-DEPLOYMENT.md#4-github-protect-and-configure-the-database-environment). Do not assume a separate approval prompt will appear with the current settings.

## 1. Current status and where to resume

Status below combines the historical setup conversation with the explicitly dated live verification on 16–17 September 2026. The latest SQL migration/schema, deployment result, firewall cleanup and HTTP health/rejection checks were verified directly on 17 September. Unverified or historical rows are marked separately; this is not a full audit of Azure/GitHub.

| Area | Recorded status | Next action |
| --- | --- | --- |
| Bicep infrastructure | Successful deployment output supplied | Reuse existing resources |
| SQL identity bootstrap | User confirmed rows created | Do not recreate the database |
| DbUp | Migrations 0001–0005 applied; all journal hashes, indexes, counter trigger and aggregate counter reconciliation independently verified on 17 September | Future scripts start with 0006 and update the version-specific verifier; see section 22 |
| API deployment identity and GitHub setup | User reported completed | Its client ID still needs recording in the private operator inventory |
| Customer mobile/API registrations | IDs supplied and recorded below | Verify redirect, scope, consent and token version |
| Customer default domain, OTP flow, Graph credentials | Completion not confirmed | Complete sections 8–9 |
| Directory credential diagnostic | Rechecked App Service: corrected client `538d93ee-1d58-43cb-adcd-68e094200621` is active; token acquisition and reading the signed-in user succeed | Earlier client-ID blocker resolved by operator; no further credential rotation indicated |
| Customer admission compatibility | Strict support for the observed `creationType=null`, `federated`/`mail` OTP account format deployed in `2fec7dcbfff90f72631600cd1c4a5d68ff07102f` | Release 35043608849 passed all CI, migration, deployment and liveness checks. Live Graph lookup returns exactly the same enabled account. Native sign-in still needs the user's device retry; do not recreate the account |
| App Service runtime settings | API starts; exact deployed settings and customer authentication not audited | Verify section 10; do not recreate valid settings |
| API liveness | Direct liveness/readiness GETs returned 200 on 17 September; unauthenticated capabilities returned 401 | Proceed to authenticated/native checks; this does not verify SQL or Graph |
| Latest API/database workflow | Release 35172852363 succeeded for `581834c`; migration, receipt counters, temporary firewall cleanup and API health independently verified | Test signed-in refresh/read/sync on the phone; do not rerun Bicep or initialization |
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
| Stable family history ID | `64136b6e-01e2-4c48-890f-bef208eac9e3` (App Service value independently verified unchanged on 17 September 2026) |
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

Do not add a manual IP-list variable. If `FAMILY_DB_APPROVED_FIREWALL_RULES_JSON`
was already added, it is unused by the updated workflow and may be removed.
Existing exact-IP rules, including the retained operator address, stay unchanged.
The helper automatically rejects broad ranges, all-Azure access, malformed or
non-public addresses, duplicate names and stale runner rules, before and after
adding its own temporary runner rule. It does not verify ownership or continued
need for other exact IPs. Review SQL server **Networking → Public access** against
App Service **Properties** when the network changes. No new secret or Azure
resource is needed. See the [step-by-step security checklist](SECURITY-REMEDIATION-2026-09-17.md#required-githubazure-steps-before-deploying-the-api).

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

The setup below uses shared credentials for account lookup and deletion. The user explicitly approved reusing this existing Entra registration for the token-cache update. Keep the existing registration, consent, secret and `Admission__UseAccountDeletionCredentials=true`; no separate registration is required. The cached application token retains the existing delete permissions, so protect API process access, logs and memory dumps as described in section 23. The numbered steps below are the original provisioning instructions, not changes required for this rollout.

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

The table below records the shared-credential configuration retained for the token-cache rollout. No App Service setting change is required to enable caching after the updated API is deployed. Keep the existing directory credentials and tenant/history/database settings unchanged; section 23 describes verification and release. Do not reapply settings merely to enable this cache.

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

4. Confirm profile **preview**, distribution **internal**, channel **preview**, project ID above and bundle identifier `com.littledays.babylog`. The checked-in preview profile explicitly sets `environment: preview`; confirm that the resolved configuration retains it. Before assigning the next iOS build number, inspect recent EAS builds across both preview and production: local version management means a production build can already have consumed the next number. Do not reuse a known existing build number.
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
6. Launch and compare the app footer/version with the intended build. Current builds have `updates.enabled=false`: there is no OTA refresh to wait for, and publishing an EAS Update does not update these installs. If old UI appears, compare the installed version/build with this exact completed native build's install page. Do not uninstall a data-bearing app or publish an unrelated update to troubleshoot it.
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
3. Open **More / 我的 → My account / 我的账户 → Sign in / 登录**. After sign-in, **Family sharing / 家庭共享** appears directly below **Baby profile / 宝宝档案**; tap it once to open the family menu. Signed-out users do not need to enter a family screen to register or sign in.
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
5. Let CI complete. If GitH…8479 tokens truncated…e successful Azure or Expo release above. A local reproduction found a test synchronization race: the closing filter modal and inline toolbar share accessible labels, so the test could locate an old modal button immediately before it detached. The original sequence produced transient null boxes in 27 of 30 resize cycles; waiting for the modal-only **Close filters** button to detach produced none in 30 cycles. The fix changes only test waiting, retaining all size, alignment and filtering assertions. A fresh normal web export and three consecutive full browser-suite runs passed locally. For this test-only correction, push the reviewed change and check the new **Family sharing CI** run; do not rerun DbUp, Bicep, API deployment or Expo publication merely because the older CI entry remains red.

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

## 17. Local account/navigation review — 16 September 2026

The account placement, one-tap family entry, real test-profile removal, keyboard handling and issue-only sync presentation changes are local work, not a new published API or Expo release. No new Azure resources or database migration are required for these UI changes. Do not confuse this status with the successful shared-extras release recorded above.

The follow-up correction addresses the three code/documentation gaps found by independent review:

- **Privacy disclosure:** Chinese and English privacy content and the Settings footer now describe reviewed avatar/reminder/play sharing, join replacement without a retained personal copy, and account deletion separately from uninstalling. Reminder rules/settings are shared; notification permission and delivery remain opt-in on each phone. Remote revocation is detected after reconnection, not by instantaneous offline erasure.
- **Unconfirmed-action sign-out consent:** the warning now discloses loss of local family cache, drafts, unsent changes and retry intent, while explaining that sign-out does not undo an accepted server operation. Account-deletion receipts remain available. Cancellation preserves local work; create/join activation still blocks sign-out.
- **Overview/contract consistency:** the current Chinese/English READMEs, Azure setup and API contract describe shared extras and the five invited-person places excluding the administrator. Active non-admin members and distinct live pending invitations reserve the same five places. Historical evidence is not rewritten as fresh acceptance.

No new Azure settings, Bicep deployment, database migration or API deployment are required for these copy/navigation corrections. A reviewed mobile release is still required before phones receive them. The revised network warning remains request-failure based, not an immediate hardware-connectivity indicator.

Local verification of this follow-up on 16 September 2026: `npm run verify` passed TypeScript and 280 application/helper/controller/UI tests; both normal and family-demo browser suites passed from fresh exports. `dotnet test server/LittleDays.slnx --configuration Release --no-restore` against explicitly selected local disposable SQL passed 166 API and 11 DbUp tests, with no skips. The fixtures create and remove only their own generated test databases; Azure data was not used. A clean iOS JavaScript/Hermes export, formatting check and `git diff --check` passed. Independent final review found no remaining factual or consent discrepancy in the corrected copy. No commit, push, cloud change, signed native build or preview/TestFlight publication was performed for this follow-up.

### Remaining acceptance gates — not yet executed on real devices/cloud recovery

Use the following steps with **disposable** accounts and synthetic baby records. Do not delete an existing user's account or uninstall a data-bearing app to prepare testing. Store results in a restricted operator record, not with real family data or authentication credentials in this repository.

1. **Identify the candidate.** Publish only after the reviewed commit passes checks, using section 15's preview procedure. Record the commit, EAS update group, runtime, installation result and the device/iOS versions for both phones. Open online, close and reopen; do not rely only on the static `Update 18` footer to identify an OTA.
2. **Run the two-phone matrix.** Follow section 15 → **Family photos, reminders and play → C** in order. For each step record expected/observed result and pass/fail. Include creation from the most complete history, cancelled join retaining personal data, successful join replacing it without uploading it, reminder opt-in, offline/conflict recovery, removal, administration transfer and cross-family isolation. Add the keyboard check from section B and session-expiry checks. Native photo decoding, notification delivery and SQLite/SecureStore recovery must be observed on the phones.
3. **Check revised consent and account navigation.** Verify both languages. My account is on More; the signed-in family entry is below Baby profile and opens in one tap. Check that closing a sync warning leaves drafts and pending edits intact and that conflicts remain accessible in the family menu. For an uncertain non-activation family operation, inspect the sign-out warning and cancel first; the local work must remain. Only use disposable work when confirming sign-out. Creation/join recovery must still block sign-out until resolved.
4. **Exercise account deletion end to end.** Use an explicitly disposable member account with synthetic authored records, and separately an administrator with another active member. Verify admin deletion is blocked until the required transfer/removal/closure flow is complete. On the member account, cancel deletion first and verify no state change. Submit after consent; verify server access is disabled, native family content/notifications are cleared, and the retained receipt can query progress after sign-out/restart. A pending or retrying directory deletion is not completion. Record completion only after the API confirms it and the designated operator verifies directory and application cleanup. Never paste the receipt token, access token or client secret into the record.
5. **Inventory recovery evidence before restoring anything.** Record the responsible operator, actual SQL short-term/long-term retention, diagnostic/log destinations and retention, CI artifacts and any previous exported/configuration copies. Template values (currently seven-day SQL short-term retention and fourteen-day release artifacts) are not evidence of deployed settings. Set the intended retention through the normal reviewed operational process; do not claim immediate erasure from all backups.
6. **Do not reopen an old backup without revocation evidence.** The repository does not implement an independent deletion/revocation recovery ledger or automated replay. Before a restore, the operator must establish a restricted, complete record outside the database being restored, including post-backup deletion requests, family closure, membership revocation and administrator transfers. It must identify event order/time and affected account/family/membership IDs without tokens or unnecessary baby content. If that evidence is missing or incomplete, keep restored service traffic closed and escalate; rotating the history ID alone is insufficient. A new ledger/service is a separate implementation decision, not silently provisioned by this UI change.
7. **Run an isolated restore drill first.** With approved non-production resources and synthetic accounts, take a recovery point, then perform deletion/revocation/transfer actions and retain their restricted evidence. Restore to an isolated target with no public traffic, rotate its `Family__HistoryId`, and have the operator apply/reconcile the recorded changes through a reviewed recovery procedure. Verify deleted identities remain disabled, old memberships/admin rights cannot return, old-history queued writes are rejected, and valid members receive only the intended restored family. Do not improvise production SQL edits or reconnect a production client as the test. Record restore point, reconciliation steps and results; failed or unproven revocation keeps the target closed.

Local tests cover deletion state/receipts, version/history checks, migration behavior and mocked directory failures. They do **not** prove real directory deletion, actual SQL point-in-time restore, completeness of a recovery ledger, or native OS-backup behavior. Keep these gates open until their own evidence is recorded; a successful API health check or Expo publication is not sufficient.

## 18. Cache-first startup and phone validation

The startup change separates **local restoration** from **background network verification**. A previously signed-in family's validated profile, avatar and records can render from the existing account-scoped SQLite cache without waiting for token refresh, `/v1/me`, snapshots or queued uploads. This removes the API from the startup loading gate; it does not promise zero native launch, JavaScript, SecureStore or disk-read time. Cached content can be older than the server until refresh completes.

Cache display requires a matching active account/member grant and no unfinished activation or account deletion. Known sign-in expiry and the latest verified snapshot origin are guarded separately from the SQLite payload, so restarting after a known expiry or a failed cache replacement must not revive invalid data. Existing offline local saves remain queued; sending still requires fresh server identity and snapshot checks. Notifications are not enabled merely by displaying a cache. A session with no trusted cached identity/snapshot shows recovery/account UI, not another family's data or an editable personal fallback.

No new Azure resource, environment variable, database migration or native dependency is needed. After local verification and source commit, push the branch and publish only to the existing iOS **preview** channel with the **preview** environment and UI demo disabled; use section 15's release command and record the returned update group. This is not TestFlight or production publication.

Phone checks after installing/downloading that exact update:

1. On the same two existing preview phones, open online once and verify the intended family and baby records; allow one successful refresh to establish a current cache. Record the actual update group and device/iOS versions. Do not uninstall or clear storage.
2. Fully close the app, enable airplane mode and reopen. A valid cached family should open after local loading, without waiting for an API timeout. Navigate Home, Records and More; verify the right baby/avatar and existing records. An offline warning may appear and may be dismissed without discarding data.
3. Reconnect. A new record saved on the other phone should arrive through background refresh without blocking the already displayed interface. Test a same-record conflict separately; don't treat cache display as current server approval.
4. With synthetic data, verify an explicit offline Save persists locally across restart and uploads only after reconnection and fresh membership/history checks. Confirm no family content is written to personal storage or exported as a local family backup.
5. With a disposable account, cause a confirmed authentication expiry, close/reopen and verify old family records remain hidden until successful sign-in. Separately remove a member on the other phone: the removed offline phone can only learn this after reconnecting; after it does, restarting must not restore the revoked cache.
6. Sign out normally, then reopen and verify no old family data appears. On a fresh installation or an account with no valid cache, recovery/sign-in is expected; cache-first behavior does not manufacture records or bypass the initial authenticated download.

Record visible startup results separately from controlled tests. Local deferred-request tests prove that a stalled API does not hold the app's `booting` flag; only the phones establish observed launch speed and native storage behavior.

Local verification on 16 September 2026: formatting, TypeScript and all 325 application/auth/controller/UI tests passed. Deterministic tests cover indefinitely pending identity/snapshot requests, offline saves, missing/corrupt cache, known expiry, account mismatch, revoked membership, changed history, administrator demotion, deletion, failed native persistence and late session results. Fresh normal and isolated-demo web exports passed their browser suites. A live-public-config iOS JavaScript/Hermes export passed; this is not a new signed native build. Independent code review found no remaining blocking finding in the changed startup boundary. No API, SQL or Azure infrastructure change is needed for this mobile update. The real-device checks above remain open.

### Preview publication: 16 September 2026

- Application commit `0daeec8737642ed498c82c322029b3f0bc962114` includes the startup correction and the earlier account/navigation commit `9f816e2`. It was published to **iOS / preview**, runtime **0.2.0**, using EAS's **preview** environment, with UI demo disabled. Update group: [`677f7ae3-5dff-4eff-a85b-c48adf6aa623`](https://expo.dev/accounts/expo4chao/projects/little-days/updates/677f7ae3-5dff-4eff-a85b-c48adf6aa623); update ID `01a0a9a7-37b0-7117-85c6-2f65d1a108a2`; published at `2026-09-16T09:58:23.408Z`.
- Independent `update:view` and `channel:view preview` readback confirmed that exact source SHA, platform, runtime, environment and active channel mapping. Tracked source was clean at publication; EAS's dirty-worktree flag reflects the preserved, unrelated untracked `work/` and `dist-ios-verification/` directories, which were not committed. The exported iOS bundle matched the locally verified live-config bundle.
- Existing [signed preview build 18](https://expo.dev/accounts/expo4chao/projects/little-days/builds/eb360c84-c263-49be-ac63-217ad61dda19) remains compatible. Open online, allow download, fully close and reopen. Do not uninstall a data-bearing app. The static `0.2.0 / Update 18` footer is not an OTA identifier; use the update group and changed behavior. No new native build, Azure/API/database deployment, TestFlight or App Store submission was performed.
- At this observation, local Git push was still waiting on the Git Credential Manager's GitHub login window; remote source delivery and cloud CI were **not** confirmed. After the operator completes GitHub login, confirm push of both application and documentation commits, then check the new **Family sharing CI** run. Do not publish the same Expo update again solely to complete Git authentication.
- The real-iPhone startup/offline/reconnection checks above remain pending. Successful publication does not establish native device acceptance.

### Invitation removal-history labels: release and phone checks

This correction includes API and mobile changes; the mobile-only preview publication is recorded below. An accepted invitation now exposes its existing `acceptedMembershipId` binding to the administrator. The app uses that exact membership, not an email match, to show **Accepted · later removed** or **Accepted · later left** and the access-ended time. A new pending invitation to the same email must remain **Waiting for acceptance**. The database already stores this binding: no SQL migration, Azure resource, app setting, credential or native dependency change is needed.

1. Commit and push the reviewed API/mobile changes using the GitHub plugin to `feature/family-invitations`. Do not publish unrelated local work or verification output.
2. Follow section 11.2: run **Actions → Deploy family API and database** from that branch, review its pinned revision, and approve the configured database/API environments. The existing flow still runs DbUp; this correction adds no migration. Do not reset the migration journal or deploy Bicep for this change.
3. Confirm API deployment and liveness succeed before publishing the mobile update. Older APIs remain compatible, but without the new field the app leaves accepted invitations unannotated rather than guessing removal from an email address.
4. Publish the reviewed iOS update to the existing **preview** channel with the **preview** environment and `EXPO_PUBLIC_FAMILY_UI_DEMO=0`. Record the API workflow run, source revision and Expo update group. This does not require a new signed build or TestFlight submission.
5. On the existing preview phones, open online, allow the update to download, fully close/reopen and refresh family sharing. Do not uninstall a data-bearing app or clear its storage.
6. In a disposable family, accept an invitation, remove that member, then invite the same email again. As administrator, verify the old accepted invitation says **已接受 · 后已移除** and shows its access-ended time, while the new invitation says **待接受**. Current member count must exclude the removed grant; **退出与移除历史** is administrator-only and initially collapsed.
7. Accept the new invitation. Confirm the member total increases, the new invitation stays **已接受**, and the older invitation retains its removal label. The returning member must not receive the administrator's invitation/removal history. Ordinary leaving should produce **已接受 · 后已退出** on that particular accepted invitation.

Record these real-device results separately from automated tests; implementation and local verification do not establish deployment or phone acceptance.

### Preview publication: family notices and member history (16 September 2026)

- Published application commit `e2ca4f5868d93225685b06913d8e554faaf0a1df` to **iOS / preview**, runtime **0.2.0**, using the **preview** environment and `EXPO_PUBLIC_FAMILY_UI_DEMO=0`. Update group: [`e5148ff4-c88b-4db0-88db-683dc6e22a59`](https://expo.dev/accounts/expo4chao/projects/little-days/updates/e5148ff4-c88b-4db0-88db-683dc6e22a59); update ID `01a0a9e3-6630-7eab-99f0-79c72339a937`; published at `2026-09-16T11:04:07.472Z`.
- EAS `update:view` and `channel:view preview` readback confirmed the commit, iOS runtime and current preview-channel update. The exported Hermes bundle contains the four expected public API/Entra values. Tracked source was clean at publication; the unrelated untracked `work/` and `dist-ios-verification/` directories were retained. [Family sharing CI 35088072054](https://github.com/github4me/my-little-days/actions/runs/35088072054) completed successfully for this commit.
- This was an explicitly requested **Expo-only** release. No Azure/API/database deployment, native rebuild, TestFlight or App Store submission was performed. Older APIs remain compatible: without `acceptedMembershipId`, invitations keep the ordinary **Accepted** label. Deploy the committed API through section 11.2 and refresh the app to enable the invitation-specific later-removal/exit annotations; mobile publication alone does not establish that server capability.
- On the existing [signed preview build 18](https://expo.dev/accounts/expo4chao/projects/little-days/builds/eb360c84-c263-49be-ac63-217ad61dda19), open online, allow the update to download, then fully close and reopen. Do not uninstall or clear app data. The static `0.2.0 / Update 18` footer is not an OTA identifier. Check that dismissed notices stay hidden across tabs, member counts exclude former members, creation guidance starts collapsed, joined families no longer see the onboarding box, and the preserved-change notice names the section below. Real-iPhone acceptance remains to be checked by the tester.

## 19. Moving this version to TestFlight

Read-only checkpoint, 16 September 2026: `eas env:list production` did not list any of the five required family connection/demo variables. They are verified in **preview**, not **production**. The existing production build profile uses channel `production`, `autoIncrement=true`, and local version management. Submission is already linked to App Store Connect app `6809826484`, bundle identifier `com.littledays.babylog`. No configuration, build, submission, Azure deployment or tester notification was performed for this checklist.

1. **Complete the API feature, if releasing all current fixes.** Follow section 11.2 to deploy the reviewed API commit and verify success. This particular correction adds no database migration or Bicep change, although the existing release workflow still runs DbUp. Without the new API field, the app remains compatible but accepted invitations cannot display their later-removal/exit annotations. API deployment is separate from uploading a binary to Apple.
2. **Configure Expo production variables.** In Expo dashboard, open **expo4chao → little-days → Environment variables**. Assign the existing, verified section 12.1 values to **production** as well as preview: `EXPO_PUBLIC_FAMILY_API_URL`, `EXPO_PUBLIC_ENTRA_TENANT_ID`, `EXPO_PUBLIC_ENTRA_CLIENT_ID`, `EXPO_PUBLIC_ENTRA_API_SCOPE`, and `EXPO_PUBLIC_FAMILY_UI_DEMO=0`. Reusing those values connects TestFlight to the same Azure service and family data; it does not create an isolated test backend. Do not add Graph credentials or SQL secrets. Check for duplicate account/project definitions, then verify the five values with `npx --yes eas-cli@24.6.0 env:list production` without exposing unrelated secrets. See [EAS environment configuration](https://docs.expo.dev/eas/environment-variables/).
3. **Verify the build profile and source.** Make the production profile's `environment` explicitly `production`, retain channel `production`, and confirm distribution resolves to App Store rather than internal/ad hoc. Review/commit any configuration changes through the GitHub plugin. The current signed preview build cannot be submitted as the new TestFlight build. Confirm the next build number against App Store Connect; current local build 18 plus `autoIncrement` does not prove 19 is unused. Keep version `0.2.0` only if compatible with the current App Store version state. Confirm active Apple Developer membership, valid signing credentials and EAS submission credentials; complete Apple authentication privately if requested.
4. **Finish native smoke checks.** On disposable accounts/data, verify email-code registration/sign-in, create/join/remove/reinvite, two-phone sync, offline restart/reconnection, and account deletion. Check privacy/support text reflects server-based family sharing and prepare a reviewer-access route that actually works with email OTP. Reviewers cannot use a developer-owned mailbox's one-time code without an access arrangement. Do not bypass authentication or use the UI-only demo as a substitute for testing the live service.
5. **Build and submit after the checks above.** From the reviewed source, run `npx --yes eas-cli@24.6.0 build --platform ios --profile production --auto-submit`. This creates a new App Store-signed IPA and uploads that build to the existing App Store Connect app. If building and submitting separately, record the successful store build ID and run `npx --yes eas-cli@24.6.0 submit --platform ios --profile production --id <STORE_BUILD_ID>`; do not select an internal preview or an ambiguous latest build. Record source SHA, version/build, build ID and submission result. See [Expo's iOS submission guide](https://docs.expo.dev/submit/ios/).
6. **Finish TestFlight setup in App Store Connect.** Open **Apps → My Little Days → TestFlight**, wait for processing, and address any compliance prompts accurately. Enter the beta description, **What to Test**, feedback email `contact@reticle.com.au`, review contact details and working login/registration instructions. Add the build to the intended internal group and validate it before external distribution. Then select the external testing group, **Add Builds**, and follow **Submit Review** or **Start Testing** according to the build's state. Apple requires a full review for the first external build; later builds of the same version may not require it. See [test information](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information) and [external testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers).
7. **Distribute only to the intended testers.** After any required beta approval, use the existing external group or its approved invitation link. Testers install through Apple's TestFlight app; ad hoc device registration is not this distribution route. Record actual phone acceptance separately from successful upload. Uploading to TestFlight does not publish the app publicly: App Store review/release is a separate action. The production-channel TestFlight build does not receive updates sent only to `preview`; keep future production-channel updates deliberate and reviewed.

## 20. Live-data operation and release-branch cutover

### 20.1 Real accounts and existing resource names

From 16 September 2026, treat the connected service, accounts and family records as **production data**, including when accessed from an Expo preview build or TestFlight. Those names describe app distribution, not disposable accounts or an isolated database. Do not reset the database, change `Family:HistoryId`, recreate identities, uninstall a data-bearing app or clear its storage to remove old "pilot" terminology. Destructive verification still requires separate, explicitly disposable records/accounts; never use a family's real history for deletion tests.

Live account/error/notice copy now uses family/account terminology. Signing out clears this device's family data and sign-in information; it does not delete records already shared with the family. Existing isolated UI-demo fixtures remain explicitly identified as demos and must not be enabled in a live build (`EXPO_PUBLIC_FAMILY_UI_DEMO=0`). The wording correction needs a reviewed mobile update, not a database migration or Azure configuration change. Local verification is not evidence that the update has reached a phone.

Keep these existing technical identifiers unchanged during a branch cutover:

- Resource group `my-little-days-pilot-rg`, its existing SQL database and web app, managed identities and `managedBy=my-little-days-family-pilot` ownership tags. The deployment scripts validate those tags.
- GitHub environments `family-infra-preview`, `family-infra`, `family-database` and `family-pilot`; their secrets/variables, reviewer protections and environment-based Azure trust bindings.
- Existing workflow/script names and flags, including `FAMILY_PILOT_DEPLOY_ENABLED`. Their names do not make real data disposable. Renaming them is a separate coordinated infrastructure change, not necessary for production use.

This decision is a data-handling policy and terminology correction, not a claim that backups, recovery, monitoring, privacy compliance or capacity have received a complete production-readiness audit.

### 20.2 What merging changes

Read-only repository check on 16 September 2026: the default branch is **`master`**, and no `main` branch exists. Keep `master` unless there is a separate decision to rename it. Ordinary family CI accepts pushes/PRs on either branch. The API/database deployment is **manual only**; it rejects a selected branch other than `FAMILY_INFRA_BRANCH` (or the repository default if that variable is unset). Infrastructure deployment also has path-filtered **push** triggers, so an enabled, trusted-branch merge touching infrastructure can start its preview/apply approval flow.

The existing setup instructions record `feature/family-invitations` as the trusted branch. Current live repository/environment variable values, deployment branch policies, required reviewers and Azure federated credentials were **not re-inspected** for this checklist. Merging code does not itself rename or recreate running Azure resources, but do not assume it cannot trigger a deployment.

### 20.3 Safe ordered cutover to `master`

Perform these steps only when intentionally switching the release branch; none were applied for the wording correction.

1. **GitHub → repository → Actions.** Wait for in-progress infrastructure/API/database releases to finish. Pause new manual releases during the cutover. Record the current successful release SHA and configuration values so the release branch can be restored if needed. Do not abandon an active database migration or its firewall cleanup.
2. **GitHub → Settings → Secrets and variables → Actions → Variables.** Record the current `FAMILY_INFRA_ENABLED` and `FAMILY_INFRA_APPLY_ENABLED`, then temporarily set both to `false`. Also open **Settings → Environments → family-infra → Environment variables** and explicitly set its existing `FAMILY_INFRA_APPLY_ENABLED` value to `false`: the earlier setup stores the apply flag there. Align all existing repository/environment copies; do not rely on conflicting scope values or their availability timing. Check both infrastructure environments for any other conflicting copies. This prevents a merge from starting Azure infrastructure preview/apply work while configuration is changing. Do not disable CI or delete approval protections.
3. **GitHub → Settings → Rules → Rulesets** (or **Branches → Branch protection rules**). Protect `master`: use reviewed pull requests, require the relevant successful CI checks, and prevent force-push/deletion. Select check names from actual successful runs rather than inventing them. Create the feature-branch PR into `master`, review it and merge after CI passes. Keep the source branch until cutover verification succeeds.
4. **GitHub → Settings → Secrets and variables → Actions → Variables.** Set `FAMILY_INFRA_BRANCH` to `master` (the branch name only, not `refs/heads/master`). Check **Settings → Environments → each deployment environment → Environment variables** for an old same-name override and align it. Leaving the variable on the feature branch keeps deployment tied to that branch even after merge.
5. **GitHub → Settings → Environments.** For each of `family-infra-preview`, `family-infra`, `family-database` and `family-pilot`, update **Deployment branches and tags** so the intended release branch `master` is allowed. Replace any feature-only selected-branch rule; do not use an unrestricted all-branches rule as a workaround. Retain required reviewers and other protections. If the policy permits protected branches, verify that the target branch actually qualifies.
6. **Azure portal → the infrastructure tenant → App registrations → each GitHub deployment identity → Certificates & secrets → Federated credentials.** Inspect, do not recreate, the preview, infra-deploy, database-migrate and API-deploy credentials. If their subjects bind the unchanged environment names, a branch-only cutover normally needs no Azure credential change. If a custom subject or trust condition includes `refs/heads/feature/family-invitations` or a branch-specific workflow reference, coordinate an exact update to the new branch before release. Preserve issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`, and the repository's actual subject format (including immutable owner/repository IDs if present). Never copy a guessed legacy subject. Do not change the customer sign-in tenant's mobile/API registrations, redirects, scopes or Graph credentials for this branch move. See [GitHub OIDC subjects](https://docs.github.com/en/actions/reference/security/oidc) and [Entra's exact credential matching](https://learn.microsoft.com/en-us/graph/api/resources/federatedidentitycredentials-overview?view=graph-rest-1.0).
7. **Validate before applying.** Confirm CI passed on the merged revision. For infrastructure verification, set `FAMILY_INFRA_ENABLED=true` while keeping `FAMILY_INFRA_APPLY_ENABLED=false` at the effective environment scope, manually run the infrastructure workflow from `master`, and inspect the Azure preview/what-if output. The apply job may wait for environment approval; if started with apply disabled, its `CheckOnly` guard intentionally fails before Azure login. Successful preview plus waiting/blocked apply is expected here, not an all-green deployment run. Do not bypass the guard. Confirm the plan reuses the same web app/database/plan and does not replace or delete live resources. Only restore apply after deliberate review and capacity confirmation, then start a fresh run for an intended infrastructure change. Do not apply merely to rename "pilot" labels.
8. **GitHub → Actions → Deploy family API and database → Run workflow → master.** When ready to release, review the selected revision, confirm the existing database bootstrap, and approve the protected database/API jobs. Do not enable EF adoption or reset the DbUp journal for an already managed database. Check migration/deployment results and `/health/live`, then perform a signed-in, non-destructive family read/sync check; liveness alone does not verify SQL or authorization. A commit arriving while approval is pending may require a fresh run rather than bypassing the stale-revision check.
9. **Record and finish.** Record workflow IDs, deployed source SHA, successful checks and any setting changes here. Keep Expo publication separate: GitHub/Azure deployment does not update the installed iPhone JavaScript or submit to TestFlight. Follow section 19 if building for Apple. Only retire the old feature branch after the new release route is verified. Restoring a branch setting does not undo database migrations; never attempt a data rollback by deleting journals or recreating the database.

Environment branch restrictions and approvals are documented in [GitHub's deployment environments reference](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments). Renaming the default branch to `main`, if desired later, needs the same branch/trust review as a separate change.

## 21. Making the iOS sign-in prompt clearer

This is a proposed branding improvement, **not an applied authentication change**. The browser sign-in confirmation is rendered by iOS through `ASWebAuthenticationSession`; app copy and Entra company branding do not provide an arbitrary replacement for that system dialog. The app's native name and the actual authentication hostname can make it more recognizable. Keep the real hostname visible; do not introduce a redirect/proxy solely to disguise where users authenticate.

### Recommended: use the existing named tenant endpoint

Read-only check on 16 September 2026: `https://mylittledayscustomers.ciamlogin.com/deab2578-7cd3-4152-b5db-f430d6b638f8/v2.0/.well-known/openid-configuration` returned authorization and token endpoints under `mylittledayscustomers.ciamlogin.com`. Its issuer remains `https://deab2578-7cd3-4152-b5db-f430d6b638f8.ciamlogin.com/deab2578-7cd3-4152-b5db-f430d6b638f8/v2.0`. This verifies public metadata availability, not successful iPhone login.

1. In the **customer** Entra tenant, confirm the tenant domain is still `mylittledayscustomers.onmicrosoft.com`. Do not create or rename the tenant or move existing users.
2. Implement a reviewed mobile authority configuration change. The app currently constructs the hostname from the tenant GUID in `src/family/config.ts`; entering a tenant name into `EXPO_PUBLIC_ENTRA_TENANT_ID` will fail validation and is not the fix. Retain the tenant GUID, mobile client ID, API scope, redirect URI and PKCE. Use the named tenant's validated discovery endpoint without loosening issuer/audience checks.
3. Test discovery, authorization, callback, refresh and sign-out with the named endpoint before publishing. The observed issuer is unchanged, so do not alter API token validation or identity mapping merely to change the displayed login host. No new Azure resource or custom-domain DNS configuration is required for this existing named endpoint.
4. If also correcting the app name shown by iOS, inspect the built app's native bundle-name/localization metadata and make the appropriate native configuration change. Native name changes require a new iOS binary; an Expo JavaScript update cannot rewrite an installed app's `Info.plist`. Verify English and Chinese on a phone without uninstalling a data-bearing app.
5. Record the published update/build and confirm the actual system prompt and successful login on iPhone. The metadata check above does not establish device acceptance. Changes to Entra's hosted-page logo/text are separate from this iOS prompt.

### Optional later: a branded domain

A hostname such as `login.reticle.com.au` is an example, not configured or selected. Microsoft's documented custom URL domain setup requires domain verification in the customer tenant, custom URL domain association, Azure Front Door, DNS/TLS configuration, and application endpoint testing. Front Door incurs additional charges. Obtain the domain choice and cost approval before provisioning anything; this is not required for the named-tenant improvement above. Follow [Microsoft's custom URL domain setup](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-custom-url-domain) and [limitations/cost considerations](https://learn.microsoft.com/en-us/entra/external-id/customers/concept-custom-url-domain). See [Expo's browser authentication API](https://docs.expo.dev/versions/latest/sdk/webbrowser/) for the system-session boundary.

## 22. Database indexes and large operation histories

**Deployed on 17 September 2026:** source `581834c4df2f4bb05421c42e6416d29465dbb8e8`, [release 35172852363](https://github.com/github4me/my-little-days/actions/runs/35172852363), all five jobs successful. Migration `0005_QueryIndexesAndOperationCounts.sql` adds the reviewed access paths and transactionally maintained receipt counts. The matching API removes per-write receipt counts and purges deleted-account/closed-family receipts in committed 1,000-row batches. Active-family receipts are not expired, and existing operation limits and idempotency rules remain unchanged.

Follow [the detailed migration and deployment checklist](DATABASE-SCALING-2026-09-17.md#step-by-step-deployment-when-approved). Use the existing **Deploy family API and database** workflow after source review; leave EF adoption disabled. The one-time counter backfill locks receipt writes until its migration transaction commits, so select a quiet window. No new Azure/GitHub variable, identity, secret, infrastructure deployment, Expo update or TestFlight build is required. The last observed environments had no required reviewers; confirm protection before dispatch rather than expecting an approval pause.

Migration 0005 applied at 02:05:34.7639415 UTC / 12:05:34 Sydney. Independent checks verified all five journal hashes, all 31 enabled indexes, the expected trigger and SELECT-only runtime counter access. At the checkpoint all 68 receipts matched their counters; no family count differed. Firewall rules exactly matched preflight, including retained operator access and no leftover runner rule. Azure reports deployment `77d06c49-6e13-4da1-8afa-955e28e12266` active/complete. Independent liveness/readiness checks returned 200, and unauthenticated capabilities returned 401. Full evidence and migration checksum are in the linked guide.

**Remaining manual step:** refresh the existing signed-in iPhone, then verify the next intended record save syncs normally and appears on the other phone if available. No reinstall, Expo release or TestFlight build is needed for these backend changes. Record device acceptance separately; health and SQL checks alone do not establish it. No infrastructure, permanent firewall, identity or approval setting was changed for this release.

## 23. Graph application-token cache and SQL-independent sign-in recognition

**Implementation and rollout are separate.** The update adds token-only `GET /v1/session`, a separate mobile sign-in-recognized state, and an in-memory MSAL cache for directory admission's Graph application token. The user approved reusing the existing Entra registration, including when `Admission__UseAccountDeletionCredentials=true`. No new registration, consent, secret or App Service setting is required. It does not deploy itself or create Redis, a queue, or a database migration. Existing clients retain authoritative `/v1/me` behavior. This documentation update did not change Azure or deploy the API/mobile app.

### 23.1 Customer Entra tenant: retain the existing directory identity

1. Switch to customer tenant **My Little Days Customers**, directory ID `deab2578-7cd3-4152-b5db-f430d6b638f8`. Do not use the hosting tenant or a GitHub deployment identity.
2. Locate the existing **`my-little-days-directory`** registration, Application (client) ID **`538d93ee-1d58-43cb-adcd-68e094200621`**. Do not create a replacement registration for this rollout.
3. Retain its existing consent and secret. `User.ReadWrite.All` covers directory reads and active-user deletion; `User.DeleteRestore.All` covers permanent deleted-user removal. Do not add permissions or rotate a working secret merely to enable caching. Keep the existing expiry/rotation procedure.
4. Review the existing application grants without exposing secrets. The Graph `.default` scope includes granted application permissions, so the cached shared token includes existing deletion authority even though admission only issues read requests. Caching does not attenuate that token's privileges or grant new permissions.
5. Keep secrets and tokens out of chat, Git, GitHub/Expo variables, screenshots and logs. Restrict API deployment/configuration, debugging and memory-dump access. Do not assign privileged directory-administrator roles to this app.
6. Optional future hardening: use a separate admission registration with only application `User.Read.All`, after its own review and consent. A second secret for the same app does not separate permissions. Separate tokens limit a leaked read-token's privileges, but both applications' credentials would still be accessible to a compromise of the API process. This is not a prerequisite for the approved rollout.

Reference: [Microsoft Graph read-user permissions](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0).

### 23.2 Hosting tenant: retain shared-credential settings

1. Switch to hosting tenant `7b7e6e31-a778-4334-aee2-e969fa27fd0e`. Open **App Services → little-days-api-522fpstfbtds2 → Settings → Environment variables → App settings**.
2. Confirm the retained configuration without exporting secret values:

   | Setting | Retained value |
   | --- | --- |
   | `Admission__UseAccountDeletionCredentials` | `true` |
   | `Admission__GraphClientId`, `Admission__GraphClientSecret` | Both omitted, as required by credential reuse |
   | `AccountDeletion__GraphClientId` | `538d93ee-1d58-43cb-adcd-68e094200621` |
   | `AccountDeletion__GraphClientSecret` | Existing server-only secret, unchanged |

3. Keep `Admission__Mode=Directory`, issuer/OTP settings, both `AccountDeletion__Graph*` settings, Entra mobile/API IDs, `Family__HistoryId`, SQL connection string, auto-pause and firewall unchanged. No new GitHub variable/secret, mobile environment value, API scope or redirect URI is needed.
4. No **Apply** or settings restart is needed for this change. The existing configuration works with the previous API; caching begins when the updated API is deployed. If the observed configuration differs, reconcile it before making changes rather than copying credentials into extra settings.
5. There is no separate/shared-client-ID cache gate. Directory admission uses the configured application's MSAL cache in either credential mode; existing credential-resolution and startup validation rules remain in force. Static test admission does not acquire Graph tokens.
6. After an authorized release, verify an existing user's sign-in and family read. A permission/configuration failure remains an error; do not switch to static admission or add permissions as a shortcut. Inspect sanitized failure codes without dumping settings, tokens or customer records.
7. If a code regression requires rollback, follow the reviewed API release procedure to restore the preceding compatible API revision, keeping the existing settings and SQL schema intact. This rollout does not need a credential-mode switch for rollback; any rollback is a separate authorized deployment.

### 23.3 Release and phone validation

1. Review source and automated tests, then use **GitHub Actions → Deploy family API and database → Run workflow** on the reviewed branch. Follow section 11's protections; do not alter branch/OIDC settings or enable EF adoption. DbUp verifies the existing schema; no new migration is introduced.
2. Confirm health and anonymous `GET /v1/session` rejection (`401`). An authenticated session returns only `status=token_valid`, the validated user's own object ID, `accountAccess=pending`, and `familyAccess=pending`, with `Cache-Control: no-store`. Use the app for authenticated acceptance; never put a bearer token in shell history, a shared HTTP client, screenshots or this document.
3. Build the compatible mobile app through the normal Expo preview/review path, then verify on iPhone before production rollout. No native dependency is added, but the current `updates.enabled=false` policy means an EAS OTA publication alone will not reach these installed builds; deliver a new native build without changing that policy. For TestFlight follow section 19, preserving existing public values and `EXPO_PUBLIC_FAMILY_UI_DEMO=0`.
4. New mobile clients fall back to the old authoritative account check if an older API returns `404` for `/v1/session`. They must not fabricate a family list or interpret pending access as revocation.
5. After natural SQL idleness, sign in: token recognition should finish before SQL, family/account access should remain visibly pending, and loading should finish without another Microsoft login. Do not pause production SQL, change free-limit behavior or schedule keep-alives just to run this check.
6. Test both languages, refresh, logout during a delayed request, switching accounts, rejected/expired tokens and offline retries. New family management remains unavailable until authoritative checks finish. A session result must never overwrite deletion/removal results. Use dedicated test families for destructive tests, not real family history.
7. Record API revision/workflow, mobile update/build and actual phone results. Local tests do not establish deployment or native-device acceptance. API and phone publication remain separate steps.

### 23.4 Security and operational limits

- Token validity does not prove an enabled directory account, an undeleted app account or active family membership. Those checks remain fresh on authoritative operations; no positive user-permission cache is added.
- The application-token cache is process-only and expires according to the issuer. Restart loses the cache without extending token validity. Graph rejection stays authoritative; recovery is bounded. Protect memory dumps as well as logs because bearer tokens are sensitive.
- With the approved shared registration, a leaked cached Graph token carries the application's existing delete permissions. Only the admission service token is cached; user identities/authorization and deletion-operation results are not. Restrict API process, deployment, configuration and diagnostic access; never capture bearer tokens or secrets in logs, dumps or support artifacts. A dedicated least-privileged read identity remains optional future hardening.
- The session request avoids SQL and Graph; signing-key discovery may still require an Entra call. The existing deletion worker can independently contact SQL at startup/on its schedule. This endpoint is not a database readiness probe.
- This removes SQL wake-up from the initial recognition step, not database reads/writes. It does not remove free-tier quota exhaustion or guarantee zero latency.
- Cache eviction or secret rotation does not guarantee immediate invalidation of an issued token. Follow the identity incident procedure after a suspected leak; restarting alone is not sufficient.

See [the implementation/security review](AUTHENTICATION-CACHE-REVIEW-2026-09-17.md) and [Microsoft's application-token cache guidance](https://learn.microsoft.com/en-us/entra/msal/dotnet/acquiring-tokens/web-apps-apis/client-credential-flows).

### 23.5 Deployment checkpoint — 17 September 2026

- Released source: `76c045abea41614708639a49c322a879f6af897a`, committed/pushed through the GitHub plugin on `feature/family-invitations`.
- Manually ran [Deploy family API and database #10](https://github.com/github4me/my-little-days/actions/runs/35186622914), with existing SQL bootstrap confirmed and EF adoption disabled. All five jobs succeeded, including mobile/browser verification, 219 API tests, 58 migration-tool tests, DbUp verification and temporary-rule cleanup. No new schema script was added.
- Azure OneDeploy: `9066d8ee-8275-4d09-a082-40a94b91ffc7`. The API artifact recorded the same source SHA. No identity, consent, credential, environment, permanent firewall or App Service setting change was made.
- Public health checks returned `200`. The new `/v1/session` route initially returned `404` immediately after deployment success, then correctly returned anonymous `401` with `Cache-Control: no-store` at 05:45:33 UTC / 15:45:33 Sydney. This propagation interval required neither manual restart nor redeployment. For future releases, verify a release-specific behavior as well as generic liveness before declaring activation.
- Independent post-migration checks confirmed all 33 permanent exact-IP SQL firewall rules unchanged (including the operator rule), with no temporary runner rule left; .NET 10 and AlwaysOn remained unchanged.
- Next manual step: deliver a new native iPhone build and perform section 23.3's signed-in, pending-access, logout/account-switch and two-device checks. No Expo/TestFlight build or publication was started by this API deployment. Authenticated production token-cache behavior has not yet been device-validated.

### 23.6 iOS Expo preview build 23 — 17 September 2026

The requested native preview completed successfully at 05:55:20 UTC / 15:55:20 Sydney. Exact [build/install page](https://expo.dev/accounts/expo4chao/projects/little-days/builds/31f2d2b5-15c7-4b31-b564-1e28eb8b3ccf): `31f2d2b5-15c7-4b31-b564-1e28eb8b3ccf`, source `c19fa44283393031aa6a5f21a3ffbfcf6c3bf6a4`, version `0.2.1 (23)`, bundle `com.littledays.babylog`, profile/environment/channel `preview`, internal distribution (not simulator or TestFlight). Build 22 was already used by the existing store build, so this release advances to 23. The source's runtime code passed release #10's full mobile/browser checks; this packaging change adds no runtime code.

Before upload, EAS readback confirmed the expected account/project and all five public section 12.1 values, including demo `0`. The saved ad hoc profile listed both existing phones. The CLI reused frozen remote credentials; Apple-server profile revalidation was skipped in noninteractive mode, so successful signing is not evidence of installation on either phone. No credentials, consent or devices were added. EAS produced a signed IPA; no OTA publication, TestFlight submission or additional Azure deployment was performed.

Manual installation and acceptance:

1. On each previously registered iPhone, open the exact build/install page above in Safari and choose **Install**. Use this build's link, not an older preview bookmark.
2. Install over the existing app. Do not uninstall or clear storage. First let pending family changes synchronize; use the supported backup for important offline-only records if needed (joined-family local backup remains disabled). This preview connects to the live service and real family records.
3. Launch and confirm footer version `0.2.1` and build/update `23`. OTA is disabled, so reopening an older binary will not fetch these changes: it must be replaced with this native build.
4. Sign in normally. Token recognition may appear before account/family verification completes; pending access must not enable family management or display another account's records. Wait for the authoritative family check without repeating Microsoft sign-in.
5. After a few hours of natural inactivity, reopen the app and check that cached UI appears promptly and verification proceeds quietly. If SQL is still waking, access may remain pending; it must not be reported as a confirmed empty family or remote removal. Do not force-pause production SQL for this check.
6. Verify refresh, offline/reconnection, sign-out during verification, and two-phone synchronization. Use disposable accounts/families for account-switch/deletion/removal tests; never delete real history just to validate this release. Record actual results separately from build success.
7. If installation fails, capture the non-sensitive iOS message and verify the phone is one of the provisioned devices. Do not uninstall a data-bearing app as a workaround. TestFlight delivery remains a separate store build/submission under section 19.

### 23.7 TestFlight build 24 — 17 September 2026

The user requested TestFlight submission after preview 23. An internal/ad hoc IPA cannot be used for this upload, so a new store-signed build was created. Exact [EAS build](https://expo.dev/accounts/expo4chao/projects/little-days/builds/13441500-1013-4a62-adca-c1a59bf629c6): `13441500-1013-4a62-adca-c1a59bf629c6`, version `0.2.1 (24)`, profile/environment/channel `production`, distribution `STORE`, finished at 06:16:10 UTC / 16:16:10 Sydney. EAS recorded source `73d2a6767f5822336ce172b5ccfac1dc4fd808a0` and applied the profile's local auto-increment from 23 to 24 before uploading source. The matching local build-number change must be retained in Git; the runtime code is unchanged from the reviewed preview release.

Production preflight found `EXPO_PUBLIC_FAMILY_API_URL` beginning with `ttps://`. It was corrected in this project's **production** environment to `https://little-days-api-522fpstfbtds2.azurewebsites.net` and all five public variables were read back against section 12.1 before the build. Preview was already correct. Updating the EAS variable does not repair an already-installed binary; use the newly built version. No Azure service, identity, credential, API, database or firewall change was made.

Submission [47dd1fd4-87cb-48a0-be09-37affc530ab6](https://expo.dev/accounts/expo4chao/projects/little-days/submissions/47dd1fd4-87cb-48a0-be09-37affc530ab6) to existing App Store Connect app `6809826484` finished successfully at 06:20:47 UTC / 16:20:47 Sydney. It used the existing EAS-held Apple API key and no automatic tester-group setup. Apple readback confirmed build 24 is `VALID` and `IN_BETA_TESTING` internally, with external state `READY_FOR_BETA_SUBMISSION`; upload and processing are complete, but external beta review has not been submitted for this build. The previous build 22 remains `WAITING_FOR_BETA_REVIEW` externally; this task did not cancel that review or expire any previous build. Native installation and real-user acceptance remain unverified.

Steps for this and future submissions:

1. Read back the **production** public variables and compare their exact values, including `https://` and demo `0`, with the approved live configuration. Do not assume they match preview. Confirm profile distribution `store`, environment `production`, expected bundle/App Store Connect ID and a fresh build number.
2. Build with `npx --yes eas-cli@24.6.0 build --platform ios --profile production --non-interactive --freeze-credentials --no-wait --json`. Existing signing credentials must be usable; stop for private Apple authentication if required. With local `autoIncrement`, inspect and commit the generated build-number change through the GitHub plugin without unrelated local edits. Wait for `FINISHED` and record the exact build ID.
3. Submit that exact ID with `npx --yes eas-cli@24.6.0 submit --platform ios --profile production --id <STORE_BUILD_ID> --non-interactive --no-wait --no-auto-testflight-setup`. Do not use `--latest`, select an ad hoc preview, create new tester groups or publish an App Store release as part of this step.
4. Do not add `--what-to-test` on the current Expo plan. This attempt's initial scheduling request with notes was rejected because EAS changelog submission requires Enterprise; retrying without notes scheduled the single submission above. No upgrade or duplicate submission was created. Add notes directly in Apple instead.
5. Check `eas submit:view <SUBMISSION_ID> --json`, then `eas submit:status --platform ios --profile production --json --non-interactive`. EAS upload success, Apple processing success and tester availability are separate states. Do not repeatedly upload the same binary merely because Apple is processing it.
6. In **App Store Connect → My Little Days → TestFlight → iOS → 0.2.1 → build 24**, wait for processing and add **What to Test** if desired: "Faster sign-in recognition while family access verifies in the background. Test returning after inactivity, refresh, offline reconnection and two-device family sync. Existing family permissions remain enforced."
7. Use the existing intended tester group. Internal availability and external beta-review approval are separate. If external testing requires submission/reviewer information, supply the existing approved review contact and a working email-OTP login route; do not bypass authentication. Do not mark tester availability or device acceptance complete until actually observed. Installing through TestFlight should not require uninstalling the existing data-bearing app.

## 25. Care picker and night appearance preview (18 September 2026)

This is an app-only release. No Azure, SQL, identity, firewall or infrastructure
deployment is required. See [night appearance and recording inputs](NIGHT-APPEARANCE.md).
The local annotated checkpoint `pre-night-theme-2026-09-18` points to `7c9e752`;
it was created before the theme edits. The GitHub connector supports commits and
branch updates but not tag creation, so this checkpoint is currently local.

### Build and install

1. Use the reviewed `feature/family-invitations` revision, version `0.2.1`,
   iOS build `25`. Commit/push through the GitHub plugin. Do not include unrelated
   local SQL migration files, private `work/` outputs or generated screenshots.
2. Create a clean checkout of the pushed SHA. From that checkout run
   `npx --yes eas-cli@24.6.0 config --platform ios --profile preview --non-interactive`.
   Confirm internal distribution, preview environment, the HTTPS API URL, customer
   tenant/mobile client/API scope and `EXPO_PUBLIC_FAMILY_UI_DEMO=0`.
3. Inspect the upload with
   `npx --yes eas-cli@24.6.0 build:inspect --platform ios --profile preview --stage archive --output <new-inspection-directory>`.
   Use a new directory outside the source checkout; confirm no private work or
   credentials enter the archive.
4. Start exactly one build:
   `npx --yes eas-cli@24.6.0 build --platform ios --profile preview --non-interactive --freeze-credentials --no-wait --json`.
   Keep the returned build ID. Do not use `eas update`: OTA is disabled. Do not
   auto-submit to TestFlight or change signing/device enrollment if a check fails.
5. Inspect that exact build with `build:view <BUILD_ID> --json`. Wait for
   `FINISHED`; verify version/build number, commit SHA and internal distribution.
   Open its Expo build page on the already registered iPhone and install over the
   current app. Never uninstall a data-bearing installation to troubleshoot.
6. In Care → Daily care, test the time wheel in all five categories. Cancel must
   retain the old time; Done accepts a valid minute. Confirm today's limit,
   historical-record editing, and date selection. This does not require creating
   synthetic records in the real family.
7. In More → Theme, try Night, Light and Automatic. Check the feed/care keyboard,
   wheel, buttons, raised dialogs and readable text. Also test large text and
   Increase Contrast on the device; browser screenshots do not verify native UI.
8. Verify the editor's save-location text: family-shared records await sync
   confirmation; signed-in personal records are not automatically uploaded.
   No sync, membership or data-retention policy is changed by this release.

Validation before publication: typecheck/unit/controller/native-boundary suites,
full browser regression, dedicated night layout checks at 320/390/768px, contrast
checks and iOS JavaScript export. Physical iPhone/iPad rendering and accessibility
acceptance remain device checks, not claims inferred from those tests.
