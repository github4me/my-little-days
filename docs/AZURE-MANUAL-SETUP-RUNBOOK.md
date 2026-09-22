# My Little Days: manual Azure and GitHub setup runbook

For recurring failure patterns, product decisions and future working rules, see [project lessons and working memory](PROJECT-LESSONS.md). This runbook remains the source for exact setup and dated deployment evidence.

Last updated: 20 September 2026 (Australia/Sydney).

This is the operator's step-by-step reference for infrastructure, SQL bootstrap, customer authentication, API settings and releases. It records known values without storing secrets. Existing names containing `pilot` are compatibility identifiers: do not rename them or create replacement resources just because the product now supports full family sharing.

**Security release prerequisite (17 September):** follow the [security remediation and release checklist](SECURITY-REMEDIATION-2026-09-17.md) before the next database/API deployment. It documents automatic exact-IP firewall checks, additive DbUp migration 0004, the restore maintenance gate and the new native-only preview runtime. A manually maintained GitHub IP list is no longer required. No live firewall/settings changes or production restore were performed by that code remediation. Independent recovery evidence remains required; a maintenance flag is not a recovery ledger.

**Backend update (17 September, 10:40 Sydney):** [release 35167068255](https://github.com/github4me/my-little-days/actions/runs/35167068255) successfully deployed `d41b7a1`, including migration 0004. SQL journal/schema, temporary firewall cleanup, retained operator access, API liveness/readiness and unauthenticated rejection were checked. A signed-in phone refresh/read/sync is still required. Both deployment environments have branch restrictions but no required reviewers; see the [reviewer setup steps](AZURE-DATABASE-DEPLOYMENT.md#4-github-protect-and-configure-the-database-environment). Do not assume a separate approval prompt will appear with the current settings.

## 1. Current status and where to resume

Status below combines the historical setup conversation with the explicitly dated live verification on 16–17 September 2026. The latest SQL migration/schema, deployment result, firewall cleanup and HTTP health/rejection checks were verified directly on 17 September. Unverified or historical rows are marked separately; this is not a full audit of Azure/GitHub.

| Area                                                 | Recorded status                                                                                                                                        | Next action                                                                                                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bicep infrastructure                                 | Successful deployment output supplied                                                                                                                  | Reuse existing resources                                                                                                                                                                                                  |
| SQL identity bootstrap                               | User confirmed rows created                                                                                                                            | Do not recreate the database                                                                                                                                                                                              |
| DbUp                                                 | Migrations 0001–0005 applied; all journal hashes, indexes, counter trigger and aggregate counter reconciliation independently verified on 17 September | Future scripts start with 0006 and update the version-specific verifier; see section 22                                                                                                                                   |
| API deployment identity and GitHub setup             | User reported completed                                                                                                                                | Its client ID still needs recording in the private operator inventory                                                                                                                                                     |
| Customer mobile/API registrations                    | IDs supplied and recorded below                                                                                                                        | Verify redirect, scope, consent and token version                                                                                                                                                                         |
| Customer default domain, OTP flow, Graph credentials | Completion not confirmed                                                                                                                               | Complete sections 8–9                                                                                                                                                                                                     |
| Directory credential diagnostic                      | Rechecked App Service: corrected client `538d93ee-1d58-43cb-adcd-68e094200621` is active; token acquisition and reading the signed-in user succeed     | Earlier client-ID blocker resolved by operator; no further credential rotation indicated                                                                                                                                  |
| Customer admission compatibility                     | Strict support for the observed `creationType=null`, `federated`/`mail` OTP account format deployed in `2fec7dcbfff90f72631600cd1c4a5d68ff07102f`      | Release 35043608849 passed all CI, migration, deployment and liveness checks. Live Graph lookup returns exactly the same enabled account. Native sign-in still needs the user's device retry; do not recreate the account |
| App Service runtime settings                         | API starts; exact deployed settings and customer authentication not audited                                                                            | Verify section 10; do not recreate valid settings                                                                                                                                                                         |
| API liveness                                         | Direct liveness/readiness GETs returned 200 on 17 September; unauthenticated capabilities returned 401                                                 | Proceed to authenticated/native checks; this does not verify SQL or Graph                                                                                                                                                 |
| Latest API/database workflow                         | Release 35172852363 succeeded for `581834c`; migration, receipt counters, temporary firewall cleanup and API health independently verified             | Test signed-in refresh/read/sync on the phone; do not rerun Bicep or initialization                                                                                                                                       |
| Native sign-in and two-device acceptance             | Not verified                                                                                                                                           | Complete sections 12–13                                                                                                                                                                                                   |
| Expo preview variables                               | Read back through EAS CLI: all four public values match, with `EXPO_PUBLIC_FAMILY_UI_DEMO=0`                                                           | Verify actual build environment selection and device provisioning before building                                                                                                                                         |
| Expo account/project and devices                     | CLI confirmed `expo4chao/little-days`, expected project ID and two iPhones on Apple team `A9974KXQ4G`; user confirmed the same phones will be used     | Verify both are included in signing; no cloud build started by these checks                                                                                                                                               |
| Local mobile preflight                               | Type check and 161 tests passed; iOS JS export passed with the recorded live public settings and demo `0`                                              | Signed native build and device acceptance still required                                                                                                                                                                  |
| Signed iOS preview                                   | EAS CLI verified build `eb360c84-c263-49be-ac63-217ad61dda19` is `FINISHED`, profile `preview`, distribution `INTERNAL`, version `0.2.0` build `18`    | Install on the registered phones and test real sign-in; not submitted to TestFlight by this task                                                                                                                          |

**While a release runs:** avoid pushing a new commit to the trusted branch before its revision recheck, changing deployment variables, rerunning Bicep, or changing App Service settings without coordinating the release. App-setting changes can restart the API. Wait for the run result before deciding on recovery. Do not assume a running or green deployment means customer sign-in works.

### Immediate next steps after API liveness

1. Check the current GitHub run's migration, firewall cleanup and API jobs are successful; a live URL can also be served by an earlier deployment.
2. In the customer tenant verify sections 7–8: mobile redirect, delegated permission/admin consent, API token version and the OTP-only flow associated with the mobile registration. Reuse completed configuration.
3. Verify sections 9–10: directory Graph consent/credential and the actual customer default issuer domain. Liveness does not test Graph access or credential validity.
4. Configure/build the real native app using section 12, not the UI-demo profile.
5. Follow section 13 with two disposable accounts/phones before using real family records. No new infrastructure deployment or SQL initialization is needed merely because the API is now live.

## 2. Resource and identity inventory

### Hosting directory: infrastructure and deployment only

| Item                                           | Known value                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Hosting tenant ID                              | `7b7e6e31-a778-4334-aee2-e969fa27fd0e`                                                                           |
| Subscription ID                                | `4768a858-f23f-4a39-bb64-eabc9c142627`                                                                           |
| Resource group                                 | `my-little-days-pilot-rg`                                                                                        |
| Existing Linux B1 plan                         | `ProdRG/reticelASP`, Australia Southeast                                                                         |
| Web App                                        | `little-days-api-522fpstfbtds2`                                                                                  |
| API origin                                     | `https://little-days-api-522fpstfbtds2.azurewebsites.net`                                                        |
| Stable family history ID                       | `64136b6e-01e2-4c48-890f-bef208eac9e3` (App Service value independently verified unchanged on 17 September 2026) |
| SQL server                                     | `little-days-sql-522fpstfbtds2`                                                                                  |
| SQL hostname                                   | `little-days-sql-522fpstfbtds2.database.windows.net`                                                             |
| Database                                       | `little-days-family`                                                                                             |
| Runtime managed identity object ID             | `fbb9ee76-3e03-4089-a94c-3548f74ad35a`                                                                           |
| SQL administrator                              | `Chao Wang`, type `User`                                                                                         |
| SQL administrator object ID                    | `a57bbcf8-5aec-4ac5-82e0-c02b450fc5d0`                                                                           |
| Infrastructure preview app client ID           | `23ff75d4-ed66-4929-93cf-c0223c41a1f7`                                                                           |
| Infrastructure deployment app client ID        | `440d17a0-8501-415a-9579-8f8de7d3c2f8`                                                                           |
| Database migration app client ID               | `f122630b-8e09-4aa1-a6c4-1bb122945afb`                                                                           |
| Database migration service principal object ID | `a7f2dbde-d334-401a-b6df-a24baf0a6f43`                                                                           |
| API deployment app                             | `my-little-days-api-deploy`; client ID not supplied in conversation                                              |

### Customer directory: parent accounts and application authentication

| Item                                  | Known value                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Customer tenant ID                    | `deab2578-7cd3-4152-b5db-f430d6b638f8`                                                                                               |
| Default customer domain               | App Service currently configures `mylittledayscustomers.onmicrosoft.com`; compare against customer directory's actual default domain |
| Mobile registration                   | `my-little-days-mobile`                                                                                                              |
| Mobile client ID                      | `abce8eb9-baf9-4c17-8801-20d0716a0e4d`                                                                                               |
| Mobile app-registration object ID     | `705f603b-b07d-484d-bfd9-6d182114941f`                                                                                               |
| API registration                      | `my-little-days-api`                                                                                                                 |
| API client ID                         | `9233837e-60c2-45c6-871b-96bd9cc8e007`                                                                                               |
| API app-registration object ID        | `f86866db-e6ee-45ec-aa78-890042e48b4d`                                                                                               |
| Directory access registration         | `my-little-days-directory`, client ID `538d93ee-1d58-43cb-adcd-68e094200621`, customer tenant confirmed by user                      |
| Directory registration object ID      | `caf5630f-a587-4442-b7fd-98ed56b18d14` (not the client ID)                                                                           |
| Directory service principal object ID | `c42091bb-b1e6-4796-bed1-285129ceaddc` (not the client ID)                                                                           |
| Native redirect                       | `mylittledays://auth`                                                                                                                |
| API delegated scope                   | `api://9233837e-60c2-45c6-871b-96bd9cc8e007/Family.ReadWrite`                                                                        |

Use **Application (client) IDs** in app configuration and Azure login. Use the appropriate **service principal/managed identity object ID** when verifying SQL principals or RBAC identities. An app-registration object ID is not interchangeable with its Enterprise application object ID.

GitHub `AZURE_TENANT_ID` remains the **hosting** tenant. API `Entra__TenantId` and mobile `EXPO_PUBLIC_ENTRA_TENANT_ID` use the **customer** tenant. Never substitute one for the other.

## 3. GitHub environments and common variables

Repository: [github4me/my-little-days](https://github.com/github4me/my-little-days).

1. Open repository **Settings → Environments**.
2. Reuse or create these environments:

   | Environment            | Purpose                 | Protection                                     |
   | ---------------------- | ----------------------- | ---------------------------------------------- |
   | `family-infra-preview` | Read-only Bicep what-if | Exact trusted branch restriction               |
   | `family-infra`         | Apply infrastructure    | Required reviewer and exact branch restriction |
   | `family-database`      | DbUp migrations         | Required reviewer and exact branch restriction |
   | `family-pilot`         | API deployment          | Required reviewer and exact branch restriction |

3. Under deployment branches/tags choose selected branches and add `feature/family-invitations` exactly. Do not assume an environment name creates protection.
4. Configure reviewers for the three write environments. Disable administrator bypass where available. Prevent self-review when a separate reviewer is available; a solo operator needs a workable review arrangement.
5. If your GitHub plan/repository visibility does not support the required protections, leave privileged deployment disabled pending a reviewed alternative.
6. Open **Settings → Secrets and variables → Actions → Variables** and record these repository variables:

   | Variable                        | Value                                   |
   | ------------------------------- | --------------------------------------- |
   | `FAMILY_INFRA_BRANCH`           | `feature/family-invitations`            |
   | `AZURE_SUBSCRIPTION_ID`         | `4768a858-f23f-4a39-bb64-eabc9c142627`  |
   | `AZURE_TENANT_ID`               | `7b7e6e31-a778-4334-aee2-e969fa27fd0e`  |
   | `AZURE_INFRA_PREVIEW_CLIENT_ID` | `23ff75d4-ed66-4929-93cf-c0223c41a1f7`  |
   | `AZURE_INFRA_DEPLOY_CLIENT_ID`  | `440d17a0-8501-415a-9579-8f8de7d3c2f8`  |
   | `SQL_ADMIN_OBJECT_ID`           | `a57bbcf8-5aec-4ac5-82e0-c02b450fc5d0`  |
   | `SQL_ADMIN_DISPLAY_NAME`        | `Chao Wang`                             |
   | `SQL_ADMIN_PRINCIPAL_TYPE`      | `User` (capital U)                      |
   | `FAMILY_INFRA_ENABLED`          | `true` only once preview setup is ready |

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

   | Registration                   | Subject                                                                             |
   | ------------------------------ | ----------------------------------------------------------------------------------- |
   | `my-little-days-infra-preview` | `repo:github4me@4475381/my-little-days@1360277237:environment:family-infra-preview` |
   | `my-little-days-infra-deploy`  | `repo:github4me@4475381/my-little-days@1360277237:environment:family-infra`         |
   | `my-little-days-db-migrate`    | `repo:github4me@4475381/my-little-days@1360277237:environment:family-database`      |
   | `my-little-days-api-deploy`    | `repo:github4me@4475381/my-little-days@1360277237:environment:family-pilot`         |

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

| Principal              | Role/scope to verify                                                                                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infrastructure preview | Custom role in [github-infra-preview-role.example.json](../infra/github-infra-preview-role.example.json), assigned at the hosting subscription for subscription metadata/what-if. No write roles.                                      |
| Infrastructure apply   | Preserve the reviewed existing assignments. Needs subscription deployment/resource-group operations, target RG resource management and existing-plan join. No Owner, role-assignment management or SQL data-plane rights are required. |
| Database migration     | Custom role in [github-database-role.example.json](../infra/github-database-role.example.json), assigned only at `little-days-sql-522fpstfbtds2` SQL server.                                                                           |
| API deployment         | **Website Contributor**, assigned only at `little-days-api-522fpstfbtds2` Web App. No database privileges.                                                                                                                             |

For a custom role: open **Subscription → IAM → Add → Add custom role**, import/review the linked JSON, create it, then make the separate role assignment at the scope specified above. `AssignableScopes` in a role definition does not itself grant access.

The exact infrastructure-apply role names were not supplied in the setup record, and there is no checked-in apply-role JSON. For disaster recovery, record/export the reviewed assignment names and scopes privately; do not guess a broad replacement grant. The [infrastructure guide](AZURE-GITHUB-INFRA.md) specifies the required operations.

Portal reference: [assign Azure roles](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-portal).

## 5. Bicep: initial deployment and future changes

**SQL Basic migration applied on 17 September 2026:** see the [dedicated Basic migration record and procedure](AZURE-SQL-BASIC-MIGRATION.md). The ordinary workflow remains free-only and its cloud gates are disabled. See section 24 for verification and the required steady-state integration before re-enabling infrastructure.

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

   | Variable            | Value                           |
   | ------------------- | ------------------------------- |
   | `@ExpectedDatabase` | `little-days-family`            |
   | `@RuntimeIdentity`  | `little-days-api-522fpstfbtds2` |
   | `@MigrationGroup`   | `my-little-days-db-migrate`     |

6. Verify the named identities uniquely resolve in the hosting tenant. Runtime object ID: `fbb9ee76-3e03-4089-a94c-3548f74ad35a`. Migration service principal object ID: `a7f2dbde-d334-401a-b6df-a24baf0a6f43` (not registration object ID `5d7fdc0e-9ec7-4e4b-a63a-d0f114c5270e`).
7. Review and execute the bootstrap against the dedicated database. It creates contained users, runtime-role membership and migration privileges; it does not create the application tables.
8. Verify the users and runtime role exist. If directory lookup fails, resolve it with the SQL/Entra administrator rather than switching to SQL passwords or granting Graph privileges to the API managed identity.
9. Remove only your temporary operator firewall rule when finished.

### 6.2 Configure GitHub database environment

In **Settings → Environments → family-database → Environment variables**, set:

| Variable                       | Value                                                  |
| ------------------------------ | ------------------------------------------------------ |
| `AZURE_SUBSCRIPTION_ID`        | `4768a858-f23f-4a39-bb64-eabc9c142627`                 |
| `AZURE_TENANT_ID`              | `7b7e6e31-a778-4334-aee2-e969fa27fd0e`                 |
| `AZURE_DB_MIGRATION_CLIENT_ID` | `f122630b-8e09-4aa1-a6c4-1bb122945afb`                 |
| `FAMILY_DB_RESOURCE_GROUP`     | `my-little-days-pilot-rg`                              |
| `FAMILY_DB_SERVER_NAME`        | `little-days-sql-522fpstfbtds2`                        |
| `FAMILY_DB_NAME`               | `little-days-family`                                   |
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

   | Field                      | Value                                                                        |
   | -------------------------- | ---------------------------------------------------------------------------- |
   | Scope name                 | `Family.ReadWrite`                                                           |
   | Who can consent            | `Admins only`                                                                |
   | Admin consent display name | `Access your family's records`                                               |
   | Admin consent description  | `Allow My Little Days to read and update records in families you belong to.` |
   | State                      | `Enabled`                                                                    |

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

   | App setting                                | Value                                                                         |
   | ------------------------------------------ | ----------------------------------------------------------------------------- |
   | `Entra__TenantId`                          | `deab2578-7cd3-4152-b5db-f430d6b638f8`                                        |
   | `Entra__Audience`                          | `9233837e-60c2-45c6-871b-96bd9cc8e007`                                        |
   | `Entra__MobileClientId`                    | `abce8eb9-baf9-4c17-8801-20d0716a0e4d`                                        |
   | `Family__PublicBaseUrl`                    | `https://little-days-api-522fpstfbtds2.azurewebsites.net`                     |
   | `Family__HistoryId`                        | `64136b6e-01e2-4c48-890f-bef208eac9e3` — preserve across ordinary deployments |
   | `Admission__Mode`                          | `Directory`                                                                   |
   | `Admission__LocalAccountIssuer`            | Actual customer `<domain>.onmicrosoft.com` from section 7                     |
   | `Admission__EmailOtpOnly`                  | `true` after the real OTP-only flow is configured                             |
   | `Admission__UseAccountDeletionCredentials` | `true`                                                                        |
   | `AccountDeletion__GraphClientId`           | `538d93ee-1d58-43cb-adcd-68e094200621`                                        |
   | `AccountDeletion__GraphClientSecret`       | Secret Value from section 9; server-only                                      |
   | `AccountDeletion__WorkerEnabled`           | `true`                                                                        |
   | `AccountDeletion__PollIntervalMinutes`     | `120`                                                                         |

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

| Variable                      | Value                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `AZURE_CLIENT_ID`             | Hosting `my-little-days-api-deploy` client ID; still to record, not `9233837e-...` |
| `AZURE_TENANT_ID`             | `7b7e6e31-a778-4334-aee2-e969fa27fd0e`                                             |
| `AZURE_SUBSCRIPTION_ID`       | `4768a858-f23f-4a39-bb64-eabc9c142627`                                             |
| `AZURE_WEBAPP_NAME`           | `little-days-api-522fpstfbtds2`                                                    |
| `FAMILY_API_PUBLIC_URL`       | `https://little-days-api-522fpstfbtds2.azurewebsites.net`                          |
| `FAMILY_PILOT_DEPLOY_ENABLED` | `true` only after protections and runtime configuration are ready                  |

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

| Symptom                                                          | Check / next action                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SQL_ADMIN_PRINCIPAL_TYPE must be User or Group`                 | Use exactly `User` or `Group`, not lowercase `user`.                                                                                                                                                                                                                                                                                                              |
| Existing plan validation fails                                   | Inspect actual Linux/region/SKU/status and use reviewed current scripts. Do not resize the shared plan just to bypass validation.                                                                                                                                                                                                                                 |
| .NET runtime preflight fails                                     | Inspect the actual advertised runtime and checked-in runtime parsing/version. Resolve the mismatch rather than bypassing the check or changing the API target blindly.                                                                                                                                                                                            |
| Apply/capacity flags are false                                   | Review protection/capacity, then set the two flags in `family-infra`; repository enablement alone is insufficient.                                                                                                                                                                                                                                                |
| `AADSTS70025` / missing federated credential                     | Configure federation on the exact client ID used by that job, in the hosting tenant.                                                                                                                                                                                                                                                                              |
| No matching federated identity record                            | Compare issuer, full subject (including immutable IDs) and audience with the run's claims. Do not create a client secret as a workaround.                                                                                                                                                                                                                         |
| API configuration gate shows blank values                        | Check variables in **family-pilot**, exact names, and `FAMILY_PILOT_DEPLOY_ENABLED=true` after readiness.                                                                                                                                                                                                                                                         |
| Workflow missing / no Run workflow button                        | Manual discovery requires a workflow on the default branch. The repository has a discovery workflow; refresh Actions and select the feature branch. If still missing, verify remote workflow/default branch without merging unreviewed feature code.                                                                                                              |
| `Approval is stale`                                              | Branch head moved after the run was pinned. Start a fresh run at current trusted head and review it; retrying the old run keeps the old commit.                                                                                                                                                                                                                   |
| Migration succeeds, API fails                                    | Keep the successful database state. Fix runtime/deployment configuration and rerun the compatible release. Do not drop tables or delete journal entries.                                                                                                                                                                                                          |
| Need to retry after only Azure/GitHub configuration changed      | An unchanged trusted SHA can be rerun after the first run ends. Applied DbUp scripts are skipped. If code changed, use a new run.                                                                                                                                                                                                                                 |
| Migration SQL fails                                              | Inspect the failed script and transactional result. Do not force journal entries or edit already-applied migrations. Review a forward fix.                                                                                                                                                                                                                        |
| Stale `github-db-*` firewall rule                                | Confirm the owning run is finished; remove only that exact stale rule under SQL Networking. Preserve runtime/other valid rules.                                                                                                                                                                                                                                   |
| API starts but SQL fails                                         | Check managed identity, contained user/runtime grants, exact database, outbound-IP rules and SQL availability/quota. No `db_owner` grant to runtime.                                                                                                                                                                                                              |
| Invalid audience/tenant or sign-in rejection                     | Check customer IDs, delegated scope, API v2 token setting, mobile redirect/flow and actual default issuer domain. Do not weaken validation.                                                                                                                                                                                                                       |
| Hosted sign-in says it cannot find the email                     | For a first-time customer use **No account? Create one**, verify the email code and complete registration. Existing Azure/Expo credentials or an in-app family invitation do not automatically register a customer identity. If previously registered, verify email spelling and tenant. No rebuild is indicated by this message alone.                           |
| Graph access denied                                              | Check customer directory client ID, secret Value/expiry, Application permissions and admin consent. Keep secret material out of logs.                                                                                                                                                                                                                             |
| Directory token request returns `AADSTS700016`                   | Compare the directory registration's Application (client) ID and customer tenant before inspecting secret/consent. Previously reproduced with incorrect `50ecf79c-fd34-40df-b008-fd286ebaa97b`; operator correction to `538d93ee-1d58-43cb-adcd-68e094200621` is now verified.                                                                                    |
| Correct Graph credentials, but email-code account still rejected | Deploy the admission correction supporting the exact tenant-bound `creationType=null`, `federated`/`mail` OTP format, then retry the existing iPhone build. If it still fails, distinguish token exchange/storage from API admission. Do not alter the account or loosen authentication.                                                                          |
| Package deployed, but liveness step fails during warm-up         | Check the deployment step and timestamped container startup logs, then request `/health/live` again. The shared B1 plan has taken about 2½ minutes to warm up. The workflow allows up to five minutes of retries; a continuing failure needs diagnosis, not repeated restarts. A passing liveness check still does not prove database access or customer sign-in. |
| Startup rejects shared directory credentials                     | With reuse `true`, omit both separate Admission Graph credentials; configure AccountDeletion credentials.                                                                                                                                                                                                                                                         |

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
3. Sign in through **More → My account**, then open **More → Family sharing → Create a family group**. Review the baby profile, ordinary record counts, photo preview, reminder/check-in/settings counts and invitee emails. Cancel first and confirm nothing was uploaded or erased. Reopen and explicitly confirm the review/consent to create.
   - **iPhone keyboard check:** enter one email, then several emails on separate lines with the software keyboard open (test Chinese and English keyboards, including a smaller iPhone). Scroll to **Review setup / 查看并确认** and confirm it can be reached above the keyboard and tapped once. The keyboard should dismiss before preparation; invalid emails should remain editable without losing text. With valid emails, cancel the review and refocus the field; repeat after rotating the phone. Keyboard spacing and drag-to-dismiss require a native-device check; the reduced-height browser regression alone does not verify iOS keyboard geometry. Reviewing or dismissing the keyboard must not create a family or send invitations.
4. If the review shows an older-reminder warning, stop and return to personal **More → Reminders**. Old iOS one-time notifications can lack the original absolute deadline; the app will not guess or restart them. Explicitly cancel/recreate the affected reminders with the intended deadline, then prepare a fresh family review. Unknown legacy rule settings require the same review/recreation. Do not clear all app data or bypass the warning.
5. If an avatar or extra cannot be read, correct/reselect it in the personal app and retry review. Source changes between review and first upload must request a new review, not silently upload an unseen replacement. Cancelled or failed preparation must leave original personal data intact.

#### C. Two-phone acceptance after deployment

Before the data-flow checks, validate the revised navigation on the installed update: **My account** appears above **Baby profile**, and the signed-in **Family sharing** row is directly below the profile and opens the menu in one tap. Real family management no longer has a separate **Test baby profile** editor; use **More → Baby profile** instead. Sign out and confirm the family entry disappears; after session expiry, verify sign-in recovery remains reachable. Offline/sync-error banners can be closed without deleting queued records or conflict drafts; review unresolved conflicts in the family menu. A different error/new conflict, or an error after recovery, should appear again. Normal pending/sync-success status must not stay at the top of every page. Network warnings currently depend on request failures, not an instant device-connectivity listener.

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

**Current cost policy (confirmed 21 September 2026): local builds only.** The
cloud-build commands retained below are historical and must not be run without a
new, explicit user-approved cost exception. Build the Phone, Watch and Widget on
this Mac using the verified local path, inspect the signed IPA, and upload directly
to Apple through Xcode Organizer. Expo may be used for read-only configuration and
existing managed-credential retrieval; do not schedule an EAS cloud build or paid
Workflow.

Checklist refreshed 17 September 2026: local app configuration is version `0.2.1`, build `21`, with remote updates disabled (`updates.enabled=false`). The production build profile uses channel `production`, `autoIncrement=true`, and local version management. Submission is already linked to App Store Connect app `6809826484`, bundle identifier `com.littledays.babylog`. At the earlier read-only checkpoint on 16 September, `eas env:list production` did not list any of the five required family connection/demo variables; preview was verified. That historical check does not establish today's production environment: verify it again before building. This checklist update did not change Expo/Apple configuration, build, submit, deploy Azure resources or notify testers.

1. **Confirm the backend release.** The security API/database release from source `d41b7a132700bd8e96ca377fdbb918e3e52edbfe` completed successfully in [run 35167068255](https://github.com/github4me/my-little-days/actions/runs/35167068255), including migration `0004_FamilyAvailabilityBounds.sql`. Subsequent checks verified public liveness/readiness and unauthenticated rejection. TestFlight packaging itself does not require another API, database or Bicep deployment, or merging the feature branch. Before wider testing, complete the outstanding signed-in, two-device and security acceptance checks recorded in `SECURITY-REMEDIATION-2026-09-17.md`; successful deployment alone does not close them.
2. **Configure Expo production variables.** In Expo dashboard, open **expo4chao → little-days → Environment variables**. Assign the existing, verified section 12.1 values to **production** as well as preview: `EXPO_PUBLIC_FAMILY_API_URL`, `EXPO_PUBLIC_ENTRA_TENANT_ID`, `EXPO_PUBLIC_ENTRA_CLIENT_ID`, `EXPO_PUBLIC_ENTRA_API_SCOPE`, and `EXPO_PUBLIC_FAMILY_UI_DEMO=0`. Reusing those values connects TestFlight to the same Azure service and family data; it does not create an isolated test backend. Do not add Graph credentials or SQL secrets. Check for duplicate account/project definitions, then verify the five values with `npx --yes eas-cli@24.6.0 env:list production` without exposing unrelated secrets. See [EAS environment configuration](https://docs.expo.dev/eas/environment-variables/).
3. **Verify the build profile and source.** Use the reviewed `feature/family-invitations` source and the `production` profile, not `preview` or `ui-preview`. Run `npx --yes eas-cli@24.6.0 config --platform ios --profile production` and confirm the resolved environment is `production` and distribution is App Store (`store`), not internal/ad hoc. These are the expected defaults for the current profile; optionally make `environment: production` and `distribution: store` explicit before release. Review/commit any configuration changes through the GitHub plugin. The current signed ad hoc preview cannot be submitted as the TestFlight build. Confirm the next build number against App Store Connect; local build 21 plus `autoIncrement` does not prove 22 is unused. Keep version `0.2.1` only if compatible with the current App Store version state. Preserve the bundle identifier. Confirm active Apple Developer membership, valid signing credentials and EAS submission credentials; complete Apple authentication privately if requested. Because version management is local, review and commit the resulting build-number change through the GitHub plugin after building so the next release does not reuse it.
4. **Finish native smoke checks.** On disposable accounts/data, verify email-code registration/sign-in, create/join/remove/reinvite, two-phone sync, offline restart/reconnection, and account deletion. Check privacy/support text reflects server-based family sharing and prepare a reviewer-access route that actually works with email OTP. Reviewers cannot use a developer-owned mailbox's one-time code without an access arrangement. Do not bypass authentication or use the UI-only demo as a substitute for testing the live service.
5. **Build locally and upload directly to Apple after the checks above.** From an isolated archive of the reviewed source, run the verified `eas build --platform ios --profile production --local --non-interactive --freeze-credentials --output <LOCAL_IPA>` path, or archive the generated workspace in Xcode. Inspect the resulting IPA and retain its SHA-256. Then use Xcode **Window → Organizer → Archives → Distribute App → App Store Connect → Upload**. Do not add `--auto-submit`, start an EAS cloud build, select an internal preview or upload an ambiguous artifact. Record source SHA, version/build, IPA hash, archive path and Apple's upload/processing result separately.
6. **Finish TestFlight setup in App Store Connect.** Open **Apps → My Little Days → TestFlight**, wait for processing, and address any compliance prompts accurately. Enter the beta description, **What to Test**, feedback email `contact@reticle.com.au`, review contact details and working login/registration instructions. Add the build to the intended internal group and validate it before external distribution. Then select the external testing group, **Add Builds**, and follow **Submit Review** or **Start Testing** according to the build's state. Apple requires a full review for the first external build; later builds of the same version may not require it. See [test information](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information) and [external testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers).
7. **Distribute only to the intended testers.** Internal testers must be eligible App Store Connect users; family/friends who are not team users belong in an external group, not an administrative role added just for testing. After any required beta approval, use the intended external group or its approved invitation link. Testers install through Apple's TestFlight app; ad hoc device registration is not this distribution route. Do not uninstall a data-bearing preview app as a routine preparation step; verify its pending family changes have synced and validate the installation transition on a disposable device/account first. Record actual phone acceptance separately from successful upload. Uploading to TestFlight does not publish the app publicly: App Store review/release is a separate action. With `updates.enabled=false`, this version receives no EAS OTA updates from either channel; future mobile changes require a new native build and submission unless that policy is deliberately changed and reviewed.

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

   | Setting                                                    | Retained value                                |
   | ---------------------------------------------------------- | --------------------------------------------- |
   | `Admission__UseAccountDeletionCredentials`                 | `true`                                        |
   | `Admission__GraphClientId`, `Admission__GraphClientSecret` | Both omitted, as required by credential reuse |
   | `AccountDeletion__GraphClientId`                           | `538d93ee-1d58-43cb-adcd-68e094200621`        |
   | `AccountDeletion__GraphClientSecret`                       | Existing server-only secret, unchanged        |

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

## 24. SQL Basic tier migration — deployed 17 September 2026

The user requested a Bicep and migration plan on 17 September 2026. Follow [Azure SQL Basic migration](AZURE-SQL-BASIC-MIGRATION.md) for all manual Azure/GitHub steps, commands, approval gates, validation and rollback. The standalone target is `infra/bicep/sql-basic.bicep`; `infra/sql-basic-preflight.sql` contains read-only operator checks. Neither is wired into automatic apply.

Before publishing/executing this migration, record then disable `FAMILY_INFRA_ENABLED` and `FAMILY_INFRA_APPLY_ENABLED` in GitHub, including any environment overrides. The current main template/wrappers remain free-only and must stay disabled after conversion until the plan's explicit Basic-profile integration is completed. Preserve the operator's exact-IP rule; do not remove it to pass the older infrastructure wrapper.

Target: same server and `little-days-family` database; Basic/5 DTU, 2 GiB maximum, local seven-day backups, estimated A$7.49/month before tax. Existing family data, operation receipts, history ID, schema, SQL users, Entra registrations, API URL and mobile settings stay unchanged. No DbUp migration or iOS rebuild is needed solely for the tier change.

The initial preflight requirements were paid-conversion approval, fresh size/feature checks, backup/recovery review, Azure provider validation/what-if and a maintenance window; the execution record below documents results. Production performance remains a supervised trial rather than an isolated benchmark. Paid scale-up requires separate approval; a data restore is a different, privacy-sensitive operation requiring independent reconciliation.

### 24.1 Live execution checkpoint — 17 September 2026

The user authorized the in-place Basic change. Read-only SQL verification at 09:19 UTC passed: 32 MiB allocated, 9.56 MiB used, 11 tables, five applied migrations with matching hashes, zero pending migrations, zero operation-counter mismatches and no other active user transactions. No memory-optimized tables, columnstore indexes or CDC were present. The persisted-feature DMV reported only transparent database encryption, which is supported and must remain enabled. Preserve the existing seven-day retention and 12-hour differential backup interval explicitly.

Azure provider validation passed. No database conversion or API maintenance has started at this checkpoint. GitHub requires account re-verification before saving the infrastructure freeze:

1. In Chrome, complete GitHub's **Confirm access** dialog using GitHub Mobile or the existing password; never paste credentials/codes into chat.
2. Save repository variable `FAMILY_INFRA_ENABLED=false` (previous value `true`) and confirm it on the variables list.
3. Open environment **family-infra**, set `FAMILY_INFRA_APPLY_ENABLED=false` (previous value `true`) and confirm the saved value. Leave API/database deployment variables unchanged.
4. Confirm no active infrastructure/API/database release is underway; then repeat the final preview and quiet-window baseline before applying the migration plan.

The local Azure CLI is 2.61.0 and does not accept `--validation-level`. For this authorized operator, omit that option and use the CLI's normal provider validation; do not replace provider validation with template-only validation. The newer GitHub runner CLI can use the documented explicit option.

### 24.2 In-place conversion and verification

- GitHub confirmation completed. Repository `FAMILY_INFRA_ENABLED=false` and environment **family-infra** `FAMILY_INFRA_APPLY_ENABLED=false` were saved/read back; both were previously `true`. No active, queued or waiting Actions runs were present. Other deployment variables were unchanged. Keep these two cloud guards disabled until the free-only steady-state workflow supports Basic.
- Provider validation and what-if succeeded with only the existing database modified and its backup policy unchanged. No resource creation/deletion, server, firewall, identity, API or customer-tenant change appeared in the preview.
- Added temporary App Service setting `Recovery__Blocked=true` (previously absent), restarted the API, verified `503/recovery_blocked` on readiness and `/v1/session`, then stopped only `little-days-api-522fpstfbtds2`. The shared B1 plan and other app were untouched. SQL had paused during the approval gap; a read-only connection initially returned 40613, then succeeded after SQL resumed. This was before conversion, not a Basic failure.
- Final writer-free SQL baseline at **09:42:32 UTC**: 11 tables / 241 total rows, five matching migrations, zero pending scripts/counter mismatches/other active user transactions. Applied frozen Bicep with explicit paid consent using incremental deployment **`little-days-sql-basic-20260917`**, which succeeded at **09:44:17 UTC**.
- At **09:44:39 UTC**, the database was **Online, Basic, 5 DTU, maximum 2147483648 bytes**, with `useFreeLimit=null` (not free). Database GUID `873e470c-47a0-4337-822e-61134a8a7926` unchanged. Storage remained 32 MiB allocated / 9.56 MiB used. All table counts, migration hashes, index/trigger metadata, contained principals, role memberships and permissions matched the stopped baseline exactly; counters remained consistent. These metadata/count checks are not a full payload checksum or a restore drill.
- Separate management comparison passed: all firewall rules including the operator IP, SQL administrator, seven-day/12-hour backup policy, TDE and API managed identity unchanged. No schema migration, SQL initialization, data restore, new database, mobile configuration change or iOS build was performed.
- Frozen template SHA-256: `5E7010918F7E70EAC8E224EFAAD0127E8E4755F614AA6ACFBBB984B892867F0C`; parameter SHA-256: `525082B5DC97A88164F073FB5E43D52B164C1F53E3CA0ECBC7370EDABCBF567D`. Private baseline metadata remains under local `work/`, not committed or published.
- Native two-phone refresh/write propagation, sustained Basic performance and disaster-recovery drill remain unverified. No synthetic baby records were inserted. Basic is a supervised small-workload choice, not evidence that 5 DTU handles arbitrary future scale; a different paid tier requires separate approval.
- API reopened at approximately **09:50 UTC / 19:50 Sydney**. Started with the gate intact and verified liveness `200`, readiness/data-route `503/recovery_blocked`; removed only the temporary `Recovery__Blocked` setting and read back its absence, restoring the original configuration. An explicit API restart was required while the old process still served maintenance responses. Final checks returned `/health/live=200`, `/health/ready=200`, and anonymous `/v1/session=401/unauthorized`, confirming maintenance is off and authentication remains enforced. App Service restart propagation took several minutes; these generic checks do not establish signed-in SQL-backed phone acceptance.

Phone acceptance after the API is reopened:

1. Keep the existing installation and account; no build or reinstall is required for this SQL tier change.
2. Open Family sharing on both phones and refresh. Confirm the same family, baby profile and recent records are present.
3. Add or edit one real record you intended to record. Refresh the other phone and confirm it appears once. Let any pre-maintenance pending change reconcile; do not recreate it with a new operation ID just because the earlier response was uncertain.
4. Check a normal return to the app after inactivity. SQL Basic no longer auto-pauses, but authentication/network/API startup can still cause latency.
5. Report repeated errors or unusually slow reads/writes. Review Azure SQL DTU/data-I/O/log-I/O/storage metrics before approving a higher paid tier; do not run the old free-serverless infrastructure workflow as a repair.

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
   Confirm internal distribution, preview environment and iOS build number. Then
   use `npx --yes eas-cli@24.6.0 env:list preview --scope project --format short`
   to compare the five public values with the approved HTTPS API URL, customer
   tenant/mobile client/API scope and `EXPO_PUBLIC_FAMILY_UI_DEMO=0`. Also check
   `--scope account` for conflicting definitions. `config` lists environment names,
   not their actual values; do not treat that list as a value comparison. Do not
   copy any unrelated sensitive environment values into a report or commit.
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

### Preview 25 release record

- Source: `bf51b428bf0a38832366b796c1e98a181903e1d2` on
  `feature/family-invitations`; app changes are in `d7e33a1`.
- Expo build: `7c35ee3b-02a0-402e-93ef-527dadb2b0e3`, version `0.2.1`, build `25`,
  internal distribution / preview environment; submitted on 18 September 2026.
  [Build and installation page](https://expo.dev/accounts/expo4chao/projects/little-days/builds/7c35ee3b-02a0-402e-93ef-527dadb2b0e3).
- Build status: **FINISHED** at `2026-09-18T00:31:44Z` (10:31 Sydney).
  EAS returned the internal IPA artifact for the exact source SHA/version above;
  installation and native acceptance on a physical phone remain user checks.
- All five project preview values matched; no same-name account-level overrides.
  The clean upload excludes private work, source-server files and credentials.
  EAS's expected shallow Git metadata and empty directory placeholders are not
  evidence of excluded file contents being uploaded.
- GitHub Family sharing CI passed for `d7e33a1`; local verification and browser
  checks passed. Actual iOS wheel/keyboard/appearance checks remain pending on the
  registered phones. Install over the current app, without deleting local data.
- This build does not deploy Azure resources, API code or database migrations and
  does not submit to TestFlight. OTA remains disabled.

## 26. App-wide Apple-guided UI preview (18 September 2026)

This extends the Night-only pass to shared controls, navigation, forms, records,
calendar and accessibility preferences. See the [implementation and native
acceptance checklist](APPLE-UI-IMPLEMENTATION.md). It does not change account,
family, storage or synchronization rules, or require Azure/SQL configuration.

### Publish the exact preview

1. Use version **0.2.1**, iOS build **26**, profile/environment **preview** and
   internal distribution. Commit through the GitHub plugin on
   `feature/family-invitations`, excluding unrelated SQL work and private outputs.
2. Freeze the pushed source SHA in a clean checkout. Repeat section 25's resolved
   EAS configuration, five public environment-value comparisons and account-level
   override check. Keep `EXPO_PUBLIC_FAMILY_UI_DEMO=0`; preview connects to the real
   service, not a disposable family. Do not change credentials or enroll devices.
3. Inspect a fresh upload archive, confirming its source SHA and absence of
   private files. Run exactly one native build using
   `npx --yes eas-cli@24.6.0 build --platform ios --profile preview --non-interactive --freeze-credentials --no-wait --json`.
   Record the build ID, then check that ID with `build:view <BUILD_ID> --json`.
   Do not run `eas update`: OTA remains disabled. Do not submit to TestFlight.
4. Once that exact build reports **FINISHED**, open its Expo installation page on
   an already registered iPhone and install over the existing app. Keep local
   records; never uninstall or clear storage as part of this UI check.

### Phone acceptance

Follow the linked checklist in both appearances and Chinese/English. In iPhone
Settings, test Larger Text, Bold Text, Increase Contrast, Reduce Motion and
VoiceOver. Confirm all five tabs remain reachable; form actions stay visible
with the keyboard; time wheels keep draft changes until Done; Cancel/VoiceOver
Escape closes a picker before its underlying editor. Check the same shared
records and truthful save/sync messages without creating test family data.

Browser layout tests and native-boundary mocks do not establish actual UIKit
rendering, VoiceOver focus, font scaling, Large Content Viewer or iPad acceptance.
Those physical-device checks remain explicit release follow-ups.

### Automated validation

- Full `npm run verify` passed, including authentication, family lifecycle,
  synchronization, native security and new UI-boundary coverage. Final focused
  checks include real installed React Native Web semantics for busy controls and
  readonly inputs, not only mocked native props.
- Full browser regression and all nine isolated family demo scenarios passed.
  Apple-specific browser checks passed at 320/390/768px across Chinese/English,
  Light/Night and increased contrast, with 12 reviewed captures and no external
  traffic. This browser check is also part of the existing CI workflow.
- iOS JavaScript export passed. Independent review found and fixed picker-first
  cancellation and legacy family draft time-input consistency before release.
- No schema, API, authentication grant or family data operation is part of this
  release. Native build and installation status are recorded separately below.

### Preview 26 release record

- Source: `1ffac7adbbef6431fcba79097f3bc0dd3960ea5e` on
  `feature/family-invitations`, committed/pushed through the GitHub plugin.
- Expo build: `c004f0be-9969-4f37-bda4-a3360c75c020`, version **0.2.1**, iOS
  build **26**, internal distribution / preview environment, reusing existing
  remote signing credentials and registered devices.
  [Build and installation page](https://expo.dev/accounts/expo4chao/projects/little-days/builds/c004f0be-9969-4f37-bda4-a3360c75c020).
- Build status: **FINISHED** at `2026-09-18T03:31:11Z` (13:31 Sydney), with an
  internal IPA returned for the exact source SHA/version above. Submitted at
  `2026-09-18T03:26:59Z`; physical installation is not yet confirmed.
- All five public preview values matched, with no same-name account overrides.
  The inspected clean archive matched the exact source SHA and excluded private
  working files, server source, local dependency copies and credential files.
- [Family sharing CI for the source commit](https://github.com/github4me/my-little-days/actions/runs/35303127666)
  passed both TypeScript/browser and API/SQL integration jobs. The API/SQL tests
  use CI's disposable SQL instance; they do not deploy or modify production.
- Install over the current app using the page above. Physical-device acceptance remains
  outstanding; no Azure/API/database deployment or TestFlight submission occurred.

## 27. Task-first Care and Play help preview (18 September 2026)

This app-only release places recording controls before general explanations.
Care and Play help/references are below the main content and initially collapsed.
Temperature accuracy/urgent warnings, bath supervision, nail-tool safety and
permission/consent notices remain visible. No record, sync or medical rules change.

### Publish and check

1. Publish the reviewed UI/test/documentation changes through the GitHub plugin
   on `feature/family-invitations`, using version **0.2.1**, iOS build **27**.
   Exclude unrelated SQL/infrastructure work and private verification files.
2. Follow section 26's clean-checkout, resolved preview-environment, five public
   value/account-override and upload-archive checks. Use internal distribution,
   existing signing credentials/devices and demo mode `0`. OTA remains disabled.
3. Start one native preview build for the exact pushed SHA and verify that build
   reaches **FINISHED**. Do not submit to TestFlight or deploy Azure/API/SQL.
4. On an already registered iPhone, use the resulting Expo installation page to
   install over the existing app; never uninstall or clear local data.
5. In **Care → Daily care**, confirm the form follows the care choices. Below the
   history, **Recording help & references / 记录说明与参考** should start collapsed.
   Opening/closing help must preserve an unsaved entry. Do not save synthetic
   records to the real family. Confirm urgent temperature, raw-reading, bath and
   nail safety instructions remain visible without opening help.
6. Check **Play activities / Play settings** for collapsed **Play help & references /
   早教说明与参考** below their content. Repeat in Chinese/English and Light/Dark;
   check larger text, keyboard reachability and VoiceOver's expanded/collapsed state.

Validation: TypeScript and all 517 verification tests passed; full browser and
four Apple layout scenarios passed (16 isolated captures, no external traffic).
Physical iPhone/VoiceOver acceptance remains pending.

### Preview 27 release record

- Source: `5dea17ce45e8e047cfdfffa22ae95671baed2234`, pushed through the GitHub
  plugin on `feature/family-invitations`. Only the 11 reviewed UI, test,
  documentation and build-number files were included; unrelated local SQL work
  remains uncommitted.
- [Family sharing CI](https://github.com/github4me/my-little-days/actions/runs/35304521914)
  passed both TypeScript/browser and API/SQL integration jobs. The latter uses
  disposable CI SQL, not the production database.
- Expo build: `bbe33166-550b-4fd0-926b-82618b98c605`, **0.2.1 / 27**, internal
  distribution, profile/environment **preview**, exact source SHA above.
  [Build and installation page](https://expo.dev/accounts/expo4chao/projects/little-days/builds/bbe33166-550b-4fd0-926b-82618b98c605).
  Submitted at `2026-09-18T03:49:21Z`; **FINISHED** at `2026-09-18T03:54:06Z`
  (13:54 Sydney), with an internal IPA returned for the exact source/version.
  Open the page on an already registered iPhone and install over the current app.
- The five public preview values matched and no same-name account overrides were
  present. The clean upload archive matched the release source and excluded
  private work, server files, dependencies, generated exports and credentials.
  Existing signing credentials/devices were reused; OTA remains disabled.
- No Azure/API/SQL deployment or TestFlight submission is part of this release.
  Physical iPhone installation and accessibility/keyboard acceptance are pending.

## 28. My account invitations and deletion preview (18 September 2026)

This app-only release shows eligible users' received invitations directly below
Signed in, even when My account is collapsed. Invitations follow authoritative
accept/decline results; cancellation, failed requests and unconfirmed lifecycle
work do not mark them handled. Delete account is the final, separated account
item; its confirmation, consent and administrator restrictions are unchanged.

### Publish and phone acceptance

1. Push only the reviewed app/test/docs changes through the GitHub plugin on
   `feature/family-invitations`, version **0.2.1**, iOS build **28**. Preserve
   unrelated SQL/infrastructure work. Follow section 26's clean-source,
   preview-environment, public-value/account-override and upload-archive checks.
2. Build one native internal preview for the exact pushed SHA, reusing existing
   signing credentials and registered devices. Demo mode stays `0` and OTA stays
   disabled. No Azure/API/SQL deployment or TestFlight submission is required.
3. After that build is **FINISHED**, open its Expo page on an already registered
   iPhone and install over the current app without uninstalling or clearing data.
4. With a verified, eligible account that has a genuine pending invitation, open
   **More → My account**. **Received family invitations / 收到的家庭邀请** should
   appear below Signed in even while account details are collapsed. Check inviter,
   expiry and Accept/Decline controls. Opening a review and cancelling must keep
   the invitation; accept or decline only an invitation you actually intend to
   action. Joining still requires the existing local-data replacement consent.
5. Expand My account. **Delete account / 删除账户** should be the separate final
   item below Sign out. You can inspect and cancel its confirmation; do not submit
   a deletion as a test. Existing family administrators remain blocked.
6. Check Chinese/English, Light/Dark, large Dynamic Type and VoiceOver order.
   During unresolved verification, family changes or deletion, the screen must
   not grant new join/delete actions. Phone acceptance is separate from test success.

Validation: TypeScript and 522 verification tests, full browser regression,
Apple layout scenarios and isolated bilingual family flows passed. The focused
family suite includes 55 tests. Native installation and acceptance remain pending.

### Preview 28 release record

- Source: `32d60b7c201e8307b9e659499935cb01dbe5cf95`, pushed via the GitHub plugin
  on `feature/family-invitations`. Exactly nine reviewed app/test/docs files were
  included; unrelated AGENTS, SQL/infrastructure and runbook edits were preserved.
- [Family sharing CI](https://github.com/github4me/my-little-days/actions/runs/35307572959)
  passed both TypeScript/browser and disposable API/SQL integration jobs. No
  production SQL operation is part of this CI or app preview release.
- Expo build: `7bf78b99-0bd0-4021-950b-94ca057ff670`, **0.2.1 / 28**, internal
  distribution and preview profile/environment, matching the exact source above.
  [Build and installation page](https://expo.dev/accounts/expo4chao/projects/little-days/builds/7bf78b99-0bd0-4021-950b-94ca057ff670).
  Submitted at `2026-09-18T04:37:38Z`; **FINISHED** at `2026-09-18T04:42:06Z`
  (14:42 Sydney), with an internal IPA returned for the exact source/version.
- All five public preview settings matched; no account-level overrides were
  present. The inspected clean archive matched the source and excluded private
  work, credentials, dependencies, generated exports and server files. Existing
  signing credentials and registered devices were reused; OTA remains disabled.
- Install from the page above, over the existing app without clearing data.
  Physical-device checks remain pending. No Azure/API/SQL deployment or TestFlight
  submission occurred.

## 29. Standalone Delete account in More (18 September 2026)

Delete account is a separate More item, at the same level as My account, after
ordinary settings and before the footer. It is no longer inside My account.
Pending received invitations still appear directly below Signed in. The existing
deletion explanation, acknowledgement, administrator restriction and server
confirmation remain unchanged; unavailable family access cannot enable deletion.

### Publish and phone acceptance

1. Push the reviewed app/test/docs changes via the GitHub plugin on
   `feature/family-invitations`, version **0.2.1**, iOS build **29**, without
   unrelated SQL/infra changes. Use section 26's exact-source, preview environment,
   five public values, account-override and clean archive checks.
2. Build a native internal **preview** from that pushed SHA with the existing
   signing credentials and registered devices. Demo stays `0`, OTA stays disabled.
   This release does not require Azure/API/SQL deployment or TestFlight submission.
3. After the build finishes, install over the existing app from its Expo page.
   Do not uninstall, clear storage or submit account deletion as a test.
4. Open **More / 我的**. Expand My account: there must be no Delete account action
   inside it. Scroll below the ordinary settings to find the separate
   **Delete account / 删除账户** item before the footer.
5. For an eligible non-administrator, inspect and cancel the confirmation only.
   The full consequences and unchecked consent must be visible; opening or
   cancelling must not submit a deletion. Family administrators remain blocked
   with the ownership explanation. Expired/unverified accounts and unavailable
   family access cannot submit deletion; signed-out users have no deletion item.
6. Check Chinese/English, Light/Dark, large Dynamic Type and VoiceOver focus.
   Verify received invitations are still visible below Signed in and deletion
   progress, if genuinely applicable, appears only in My account.

Validation: TypeScript and all 524 verification tests passed, including 56 family
UI tests and the More sibling-composition check. Full browser regression, four
Apple layout scenarios and isolated bilingual Light/Dark family flows passed.
No real account was deleted and no production service was used by these tests.
The exact native preview release is recorded below; physical-device acceptance
remains separate and pending.

### Preview 29 release record

- Source: `12ea638131ad3aabe1a9c7e6fe0be2c01d579835`, pushed via the GitHub plugin
  on `feature/family-invitations`. Nine scoped app/test/docs files were included;
  unrelated AGENTS, SQL/infrastructure and earlier runbook changes were preserved.
- [Family sharing CI](https://github.com/github4me/my-little-days/actions/runs/35309169779)
  passed both TypeScript/browser and disposable API/SQL integration jobs.
- Expo build: `1adad8c9-4a23-4a6d-9b87-1411f69073be`, **0.2.1 / 29**, internal
  distribution, preview profile/environment and exact source above.
  [Build and installation page](https://expo.dev/accounts/expo4chao/projects/little-days/builds/1adad8c9-4a23-4a6d-9b87-1411f69073be).
  Submitted at `2026-09-18T05:02:52Z`; **FINISHED** at `2026-09-18T05:07:02Z`
  (15:07 Sydney), with an internal IPA returned for the exact source/version.
- All five public preview settings matched; there were no same-name account
  overrides. The clean upload archive matched the reviewed source and excluded
  private work, credentials, dependencies, exports and server files. Existing
  signing credentials and registered devices were reused; OTA remains disabled.
- Install from that Expo page over the existing app, without clearing data.
  Phone installation, VoiceOver and Dynamic Type acceptance remain pending.
  No Azure/API/SQL deployment or TestFlight submission occurred.

## 30. TestFlight 0.2.1 build 30 (18 September 2026)

The user requested TestFlight delivery of the app changes in preview 29. Internal
preview 29 is not a store-signed IPA, so a new production build was required.
No runtime code changed for packaging. This includes the Apple-guided UI updates,
task-first Care/Play help, received invitations below Signed in, and the standalone
Delete account item at the bottom of More.

### Build and submission procedure

1. Use the reviewed release checkout at `550e425fbb42bd13b54fea9aaee0c093a332a636`,
   preserving unrelated local work. Recheck the **production** EAS environment,
   not preview: all five approved public values must match section 12.1, including
   the HTTPS API URL and demo `0`, with no same-name account-level overrides.
2. Confirm store distribution, production environment/channel, bundle
   `com.littledays.babylog`, App Store Connect app `6809826484`, and disabled OTA.
   Inspect the clean archive and use existing frozen remote signing credentials.
   The current profile auto-increments local build number **29 → 30**; retain that
   generated app.json-only change in Git using the GitHub plugin.
3. Wait for the exact store build
   [`d0c59fb1-064a-4796-a39a-d20602deaa53`](https://expo.dev/accounts/expo4chao/projects/little-days/builds/d0c59fb1-064a-4796-a39a-d20602deaa53)
   to finish. Confirm version **0.2.1 (30)**, distribution **STORE** and source
   `550e425`. EAS records the checkout SHA before its local build-number bump.
4. Submit that exact ID with the production profile, noninteractive mode and
   `--no-auto-testflight-setup`, as in section 23.7. Do not submit the internal
   preview or use `--latest`. Do not add the plan-restricted changelog flag.
5. Verify EAS submission completion, then Apple processing and internal/external
   availability separately. Do not upload again just because Apple is processing.
6. In **App Store Connect → My Little Days → TestFlight → iOS → 0.2.1 → build 30**,
   add What to Test if desired: "Refined Light/Dark layouts and care forms.
   Received family invitations now appear below Signed in. Delete account is a
   separate item at the bottom of More; opening it still requires confirmation."
   Use only the intended existing tester group; external beta approval is separate.
7. Install the new build through TestFlight over the existing app. Do not uninstall,
   clear data, or test deletion against a real account. Check both languages and
   appearances, invitations, cancellation, sign-in and normal family recording.
   Device acceptance is not established by upload or Apple processing alone.

Preflight verified the production public values and lack of account overrides.
The clean archive matched the reviewed source and excluded private work, generated
exports, dependencies, credentials and server files. The existing TestFlight
build 24 was VALID and IN_BETA_TESTING internally and externally at preflight.
This release does not deploy Azure/API/SQL, change tester groups or publish to
the public App Store. Build, submission and Apple readback results follow below.

### Build 30 verified release record

- EAS store build `d0c59fb1-064a-4796-a39a-d20602deaa53` finished at
  `2026-09-18T05:53:30Z` (15:53 Sydney), version **0.2.1 (30)**, distribution
  **STORE**, production profile/environment/channel, source `550e425`.
- Packaging commit `fb5985293420b7208142370d60c2d4c272b12805` preserves the generated
  build-number increment and these steps via the GitHub plugin. Its
  [Family sharing CI](https://github.com/github4me/my-little-days/actions/runs/35312336039)
  passed both mobile/browser and disposable API/SQL jobs. The tested runtime code
  is unchanged from preview 29; this commit changes app.json and documentation only.
- Submission [`ffc65bc8-7c7c-4497-a833-c64916cf3759`](https://expo.dev/accounts/expo4chao/projects/little-days/submissions/ffc65bc8-7c7c-4497-a833-c64916cf3759)
  was scheduled at `2026-09-18T05:54:25Z` and verified **FINISHED** at approximately
  `05:57:56Z`, targeting existing App Store Connect app `6809826484` and the exact
  store build above. Existing EAS-held Apple credentials were reused.
- Apple readback at approximately `05:58 UTC` confirmed build **30** is **VALID**
  and **IN_BETA_TESTING** internally. External state is
  **READY_FOR_BETA_SUBMISSION**: upload and processing are complete, but this build
  has not been submitted for external beta review. Earlier builds were not expired
  or cancelled, and no tester groups were created or changed.
- Internal testers can check **TestFlight → My Little Days → 0.2.1 (30)**.
  For external testers, use the existing intended group in App Store Connect,
  select build 30 and complete the beta-review submission with the approved
  reviewer/contact and login information. Do not confuse internal availability
  with external approval or publish an App Store release for this step.
- Installation on a physical iPhone and real-user acceptance remain unverified.
  Install over the existing app without uninstalling or clearing records.
  No Azure/API/SQL deployment, credential change or public App Store release occurred.

## 31. Planned Apple Watch support prerequisites

Status: source implementation added on 18 September 2026; nothing below has been
provisioned or released. See section 32 and the implementation guide for exact
settings and verification. See [Apple Watch implementation plan](APPLE-WATCH-PLAN.md) for scope,
dependencies, acceptance tests and rollback requirements. Existing iPhone build 30
does not acquire Watch support from this document.

1. **Scope and devices:** the user confirmed baby milk feeds, not pumping, and
   notifications for other members' milk-feed, nappy and sleep entries only.
   Record the actual Watch model/watchOS, paired iPhone/iOS and Mac/Xcode versions.
   Choose deployment targets after checking those devices and the supported build
   toolchain; do not assume any particular Watch model is supported yet.
2. **Native build proof:** implement the empty companion Watch target and repeatable
   Expo config plugin first. On the Mac, validate pairing and basic message delivery.
   In EAS, prove clean prebuild, target embedding and signing with the existing
   iPhone bundle `com.littledays.babylog`. A proposed companion identifier is
   `com.littledays.babylog.watchkitapp`; verify it and register the required target
   identifiers/profiles only during approved implementation. Do not rename the
   existing app or create a separate App Store product by default.
3. **Apple push credentials:** in Apple Developer Certificates, Identifiers &
   Profiles, verify the iPhone App ID's Push Notifications capability and the
   appropriate APNs entitlement in the signed app. In Expo/EAS iOS credentials,
   inspect and reuse a valid APNs key where possible; create one only if missing.
   APNs keys are not the same as App Store Connect submission keys. Do not rotate
   existing signing credentials merely to add notifications. Follow
   [Expo push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/).
4. **Expo delivery security:** use existing project
   `a5210f78-8729-46d4-82a4-7d1d40d30ac6`. Verify project-scoped token registration
   and configure push access-token protection for the server sender. Store any
   sender credential only in protected server configuration, never in an
   `EXPO_PUBLIC_*` value, source control, screenshots or mobile bundles. Recheck
   preview/production app identity and notification routing to avoid duplicates.
   See [Expo sending/security setup](https://docs.expo.dev/push-notifications/sending-notifications/).
5. **Azure and GitHub:** add notification configuration with registration, event
   generation and delivery disabled initially. Deploy reviewed additive DbUp
   migrations before the compatible API through the existing database/API flow.
   Check new grants/index verification, recovery gates and queue metrics. Confirm
   the existing App Service can host the background sender reliably. Do not
   re-enable the paused free-only Bicep workflow or change SQL Basic for this work.
   No new Entra registration or extra Azure queue service is planned for the
   companion MVP. Exact new setting names/values must be documented when implemented.
6. **Install and grant consent:** build a new signed iPhone+Watch application;
   JavaScript preview/OTA alone cannot add a native Watch target. Install over the
   current app without deleting records. Enable the new per-device family-entry
   notification preference and grant the iOS notification permission. In the
   iPhone Watch app, check My Watch → Notifications and the app's mirroring/custom
   settings. Label availability varies with installed OS/app configuration.
7. **Test with isolated accounts:** use two consenting disposable family accounts,
   paired devices and real Watch hardware. Enable registration, event generation
   and delivery gates only for that acceptance cohort, keeping general production
   delivery disabled. Confirm another member's committed
   entry alerts the recipient, not the creator; imports, retries and opt-out do not.
   Test locked/unlocked phone routing, Focus, offline commands, app termination,
   account switching and removal. Never test deletion/removal against a real
   family's data. Apple chooses whether a forwarded alert appears on iPhone or
   Watch; do not expect both. See
   [Apple routing rules](https://developer.apple.com/documentation/watchos-apps/taking-advantage-of-notification-forwarding).
8. **TestFlight rollout:** submit the exact new store build, verify Apple processing
   and tester availability separately, then install the Watch companion from the
   paired iPhone's TestFlight app/build details when available. Start with the
   intended internal testers; external testing may require beta review. After
   acceptance, extend notification availability beyond the isolated cohort only
   to intended users who explicitly opt in. Record source,
   migration/API revisions, EAS build/submission IDs and physical-device results.
   Keep a compatible rollback build and documented feature-off/queue-recovery steps.

## 32. Apple Watch implementation: manual release checklist

The step-by-step operator guide is [Apple Watch implementation and rollout](APPLE-WATCH-IMPLEMENTATION.md).
It records exact bundle IDs, Azure settings, Apple/Expo credentials, database/API
ordering, timer-duplicate review, notification cohort, device acceptance and rollback.
Use that guide as the detailed continuation of section 31.

1. Prove native compilation/embedding/signing using EAS cloud builders or a Mac,
   then verify on paired hardware. A personal Mac is not required for EAS Build.
   Windows checks and an iOS JavaScript export are not a watchOS build.
2. Review/publish source and pass CI; run the existing **Deploy family API and database**
   workflow for migration 0006 then compatible API, with feature gates disabled.
3. Preserve SQL Basic and the current production resources. Do not re-enable the
   paused free-only Bicep flow or alter existing Entra registrations for this feature.
4. Configure server-only Expo sender credentials and persistent token-encryption key.
   Add explicit disposable customer IDs with `Push__AllowAllUsers=false` before
   enabling any notification gate. Review old active timers before enabling the
   separately gated single-timer guard required by family Watch recording.
5. Build a new signed iPhone + `LittleDaysWatch` binary, install over the existing app,
   opt in on the phone and verify actual notification routing/sync on paired hardware.
6. Only after acceptance, approve the intended cohort expansion/TestFlight submission.
   Record the exact build, source, schema and API revisions; no release was made in
   this implementation step. Never report a provider receipt as confirmed user delivery.

### 32.1 First EAS Watch build attempt — Apple signing setup needed

On 18 September 2026, the user authorized the EAS cloud build, not Azure deployment
or TestFlight submission. EAS CLI 24.6.0 resolved production/store/channel settings,
the five public production variables matched the approved values, account-level
overrides were absent, and the Watch target was detected.

- EAS registered Apple bundle identifier `com.littledays.babylog.watchkitapp`.
  The existing iPhone credentials were found; the new Watch provisioning profile
  was missing. Noninteractive credential setup stopped **before a cloud build was
  queued**. No build ID or native compilation result exists for this attempt.
- Interactive setup found the Apple session expired and requested a password.
  The prompt was cancelled; do not put Apple passwords or verification codes in
  chat, scripts or build artifacts.
- To complete this one-time step, open a terminal in the repository and run:

  ```powershell
  npx --yes eas-cli@24.6.0 credentials:configure-build --platform ios --profile production
  ```

  Sign in to the existing Apple Developer account privately and complete Apple's
  verification. Reuse the existing distribution certificate; create the missing
  App Store provisioning profile for `LittleDaysWatch` on the same Apple team.
  Do not revoke or replace the working iPhone signing credentials. Once setup
  completes, retry the production EAS build; submission remains separate.

- Source is still uncommitted Watch work on base `44b351d99057ab64bc19bb6f13bba3c4a1ecf05d`,
  not an already-published release SHA. A minimal 167-file app-source package was
  frozen in `work/watch-store-build31` and compared byte-for-byte with the inspected
  clean archive. It excludes server code, local work, credentials and generated
  exports. Version/build remain 0.2.1/30 before EAS's build-number increment.
- When using that isolated directory, set **both** `EAS_NO_VCS=1` and
  `EAS_PROJECT_ROOT` to its absolute path. Without the latter, the no-VCS client can
  still discover the parent Git root. The first archive inspection detected that
  mismatch; the corrected archive was verified. No archive was uploaded or build
  started while credential setup was blocked.

### 32.2 EAS Watch build 31 queued

After the user completed Apple login, EAS confirmed both active App Store profiles:
phone `Z6BA8UVQM6` and Watch `8MHYYTJZ6Q`, using existing distribution certificate
serial `58D2164224C284130E166C60EAEDA733` on team `A9974KXQ4G`. No certificate was revoked.

- Build [`24af9879-54a8-4044-998a-5ce4197536b2`](https://expo.dev/accounts/expo4chao/projects/little-days/builds/24af9879-54a8-4044-998a-5ce4197536b2)
  was accepted at **2026-09-18 10:41:06 UTC** as **0.2.1 (31)**, profile/environment/
  channel `production`, distribution `STORE`, existing bundle `com.littledays.babylog`.
- The frozen source package from section 32.1 was uploaded with the embedded Watch
  target and disabled OTA. EAS incremented the isolated package's build number
  30 → 31; the repository app.json was aligned afterward. Source remains local
  uncommitted implementation, not a published release commit.
- Fingerprint: `3293f79d8aa3d8e254466df60681047c2995e374`.
- Initial status was `NEW`; native build success and physical-device acceptance are
  separate checks. **No TestFlight submission, Azure deployment or feature-gate
  enablement was requested or performed by this build.**

### Build 31 completed — native iPhone and Watch archive verified

EAS reported build `24af9879-54a8-4044-998a-5ce4197536b2` **FINISHED** at
**2026-09-18 10:46:18 UTC** (20:46 Sydney). Cloud logs confirm the Watch executable
linked, `LittleDaysWatch.app` was signed/created, and the native phone Watch bridge
compiled and packaged. This replaces the previous native-compilation uncertainty.

The downloaded final IPA was inspected locally: it contains
`Payload/MyLittleDays.app/Watch/LittleDaysWatch.app/`, its executable, Info.plist
and embedded provisioning profile. This is a combined store-signed build, not
an OTA or simulator artifact. No TestFlight submission has occurred. Installation,
real WatchConnectivity behaviour and APNs notification delivery still require
paired-device acceptance; family Watch recording also requires the separately
deployed/gated compatible API and database migration.

Both compiled Info.plists report version **0.2.1**, build **31**. Phone minimum OS
is 16.4; Watch minimum OS is 9.4 with companion ID `com.littledays.babylog` and
`WKApplication=true`. IPA SHA-256:
`A1A80B1549271B78B65DED93C60CE4289C25AE487A784F75A7FE881D7E200A81`.

## Watch backend release — 18 September 2026

The backend-only release is recorded in [Watch backend deployment](APPLE-WATCH-BACKEND-DEPLOYMENT.md), including exact commit/workflow, migration verification, timer-guard activation and remaining notification setup. Use that record for current rollout status; the earlier build-only entries are historical checkpoints. This deployment does not submit the mobile build to TestFlight or enable push delivery.

## Watch TestFlight build 31 — 18 September 2026

The user subsequently approved the next step: submit the existing combined iPhone/Watch build, not create another build or publish an App Store release.

- Exact EAS build: `24af9879-54a8-4044-998a-5ce4197536b2`, **0.2.1 (31)**, production/STORE, `com.littledays.babylog` with embedded `com.littledays.babylog.watchkitapp`.
- Preflight: build FINISHED; no existing submission for build 31 and no build 31 in Apple's TestFlight list. Existing build 30 was valid and in beta testing internally/externally. No earlier builds were expired or cancelled.
- Submission: [`a55adbe9-5ce7-4656-9eb9-17a0c5bd21d4`](https://expo.dev/accounts/expo4chao/projects/little-days/submissions/a55adbe9-5ce7-4656-9eb9-17a0c5bd21d4), scheduled **11:07:51 UTC** (21:07 Sydney), targeting existing App Store Connect app `6809826484` with the existing EAS-held Apple API key.
- Command: `npx --yes eas-cli@24.6.0 submit --platform ios --profile production --id 24af9879-54a8-4044-998a-5ce4197536b2 --non-interactive --no-auto-testflight-setup --no-wait`. Do not use `--latest`, resubmit while processing, add the plan-restricted changelog flag or create new tester groups.
- Native source remains the frozen, previously verified local snapshot described in section 32.2; the backend was separately committed/deployed as `cd369de`. Do not mislabel the current backend commit as the native build's source revision.

### Install and verify on paired devices

1. Once Apple marks this build available to your tester, open **TestFlight → My Little Days**, select **0.2.1 (31)** and update over the installed iPhone app. Do not uninstall or clear records.
2. In TestFlight's app page, open **Information → App Details**. If the embedded Watch app is compatible, use its install/update button. The generated build requires iOS 16.4+ and watchOS 9.4+. See [Apple's TestFlight Watch installation instructions](https://testflight.apple.com/#installation).
3. Open Little Days on the paired iPhone, sign in if needed and refresh the family. Keep the phone app open for the first Watch connection; confirm the expected family/baby before entering data.
4. Open Little Days on Watch. At the next real care event, verify milk-feed, nappy and sleep recording appears once on the phone and synchronizes. A Watch-local or phone-received status is not yet SQL confirmation. Do not fabricate records in a real family just to test.
5. Verify timer controls respond immediately, reconnect does not duplicate a saved entry, and the family guard prevents competing live timers. The under-one-minute live-sleep cancellation rule remains; manual backfills are separate.
6. Family-entry push delivery is still disabled pending protected Expo credentials and acceptance-account configuration. Missing alerts are expected in this recording-only rollout; do not change Azure flags just to dismiss that state.
7. For external testers, check **App Store Connect → My Little Days → TestFlight → build 31** and the existing intended group. If Apple requires beta review, complete the approved beta-review information there; upload success alone is not external availability. Do not publish a public App Store release.

### Submission blocked — diagnostic handoff

The submission ended **ERRORED at 11:09:01 UTC**. Both EAS CLI 24.6.0 and 24.7.0 returned no error detail and an empty submission `logFiles` array. Apple readback afterward contained no build 31. The cause is therefore **not yet diagnosed**; native-build success must not be described as successful TestFlight upload.

The exact submission page was opened in the in-app browser, but it redirects to Expo sign-in. Next: the account owner signs in there, then inspect the failed submission's error/logs. Do not share passwords or tokens in chat. Do not blindly resubmit, regenerate profiles, modify the Watch target or increment the build number before identifying the failure. If Expo identifies a transient service failure, retry the same submission; if Apple identifies a binary issue, fix and verify that specific issue before a new build.

No tester groups, Apple app metadata, older builds, Azure configuration or production data were changed by this submission attempt. Physical-device installation and Watch behaviour remain unverified.

## Watch icon rejection and replacement build 32 — 18 September 2026

The user supplied the failed submission logs: Apple rejected the embedded Watch icon with **90396** and **90717** because it contained an alpha channel. Upload IDs were `1264d12f-0b69-4c98-9c92-e1e84b43ef3e` (build) and `4a63ef42-355f-47db-9b2e-30cbb15ffa7f` (IPA). The bytes uploaded successfully, but Apple validation failed. This was not a provisioning-profile or API/database failure.

The Watch config plugin had copied `assets/icon.png` unchanged. That source is 1024px RGBA with transparent rounded corners. The fix uses the already locked Jimp encoder, now a declared build dependency, to composite onto the artwork's existing `#C9E6FA` background and encode PNG colour type **2 (RGB)**. Source artwork is unchanged. The regression failed on the previous output (colour type 6) and passes on the new output, checking all pixels opaque, original opaque pixels preserved, dimensions and deterministic regeneration. The real-CNG test also checks the generated icon's PNG colour type.

- `npm run verify` passed; `npm ci --ignore-scripts --dry-run` confirmed package/lockfile agreement. Local Xcode compilation is unavailable on Windows; EAS supplies native compilation/signing.
- A fresh 167-file stage at `work/watch-store-build32` was compared byte-for-byte with the inspected EAS archive. Before EAS's version bump, only the plugin, its two tests and package/lock metadata differ from the frozen build-31 source. No private work, generated exports, credentials, server code or IPA were uploaded.
- Production public API/tenant/client/scope/demo values were read back; no account overrides exist. OTA remains disabled. Both existing signing profiles were reused without capability updates.
- Replacement **0.2.1 (32)**: [EAS build `936725bc-5564-4181-bd42-db5aa490a276`](https://expo.dev/accounts/expo4chao/projects/little-days/builds/936725bc-5564-4181-bd42-db5aa490a276), production/STORE. EAS incremented 31 → 32; root app.json was aligned. Do not retry the rejected build 31.

### Build 32 compiled and submitted

- EAS finished native compilation/signing at **11:24:39 UTC**. The final IPA contains both phone and Watch bundles at **0.2.1 (32)**, with iOS 16.4+ and watchOS 9.4+ respectively. Its SHA-256 is `6A8BCBA36D41EFDF5F288F5A7A7C172ACB3BBA7CEA71C6A3969BF20190D577B3`.
- Xcode compiled the Watch icon into `Assets.car`; there are no standalone Watch PNGs in the IPA. Direct PNG-channel inspection of the compiled asset is therefore unavailable on this Windows host. The generated source PNG passes RGB/no-alpha tests; final Apple validation is the release gate, not an inferred pass from archive success.
- The previously local native implementation and icon fix were committed/pushed through the GitHub plugin as **`502a18f267b98d871ceea7b4ca311096b2c51e8a`**. All published source files matched local Git hashes; runtime/build sources matched the frozen build-32 stage byte-for-byte. Unrelated local infrastructure, screenshots and private work were excluded.
- Submitted the exact replacement build once through the production profile with `--no-auto-testflight-setup`: [submission `17fec122-eea6-47bf-b0c3-44be9648db0a`](https://expo.dev/accounts/expo4chao/projects/little-days/submissions/17fec122-eea6-47bf-b0c3-44be9648db0a). Apple processing/availability must be checked separately.
- [Family sharing CI run `35339667995`](https://github.com/github4me/my-little-days/actions/runs/35339667995) passed for `502a18f`: TypeScript/browser checks and API/real-SQL integration both succeeded. This CI run does not deploy Azure or enable push delivery.
- At the **11:34 UTC** checkpoint, EAS submission remained `IN_PROGRESS`, with no error returned, and Apple's TestFlight build list did not yet include 32. Do not call this accepted, installable or failed, and do not create a duplicate submission while it is processing. Check the submission link above and **App Store Connect → My Little Days → TestFlight → iOS**. When build 32 appears and is valid, follow the paired-device checklist above using 32. External beta review/group availability is separate from upload acceptance.

Release lesson: the Expo image source may legitimately contain transparency, but the Watch asset-catalog icon must be generated with the required opaque encoding. Keep this conversion in the config plugin because clean EAS prebuild regenerates native files. Verify dimensions, RGB encoding and preserved artwork before uploading; do not treat successful native compilation as Apple validation. Reuse existing signing credentials for an artwork-encoding fix.

No additional Azure/SQL deployment, new profiles, tester-group changes or public App Store release is required. Recording-only device acceptance follows the build-31 checklist above using build **32**; notifications remain disabled.

## Watch milk-amount refinement — source verification and next device check

This change is not part of build 32: the unmarked four-button volume grid is replaced
with one Crown-operated wheel, and a bottle timer preserves its selected starting
volume as a Watch-local suggestion for completion. It does not change API/SQL data
contracts or add consumed volume before confirmation.

1. On a Mac/Swift-equipped machine, run `swift test --package-path watch`. Windows
   checks of the config plugin and phone protocol do not replace these Swift tests
   or a SwiftUI/native build. The current editing host has no Swift/Xcode toolchain.
2. When release is requested, freeze the changed source and use the existing
   production EAS build/profile/credential procedure. This Swift change needs a
   **new combined iPhone/Watch native build**, not Expo preview/OTA. Verify actual
   production configuration and use the returned exact build ID for submission;
   do not reuse build 32 or regenerate provisioning profiles for this UI change.
3. Once Apple accepts that new build, update through **TestFlight → My Little Days**
   and install/update its companion through **Information → App Details**. Do not
   uninstall the app or clear real family records.
4. At the next real bottle feed, select the intended starting volume (for example
   150 mL) and start the timer on Watch. Open **Finish milk**: the wheel should
   select 150, not 0. Adjust to what was actually consumed and use **Confirm & finish**.
   Check the correct final volume arrives once on iPhone. Turning the wheel or
   backing out must not finish the feed or save consumed volume.
5. Check the selection survives a Watch app restart and phone snapshot refresh.
   In a separate fixture/test workspace, check zero and maximum input, old timer
   fallback, account/family switching, no-volume breastfeeding and offline replay.
   Old timers created by build 32 did not retain the starting selection, so a
   missing suggestion cannot be reconstructed and falls back to 120 mL.
6. Verify small/large Watch sizes, English/Chinese, larger text and VoiceOver:
   selected value and units are legible, Crown changes the current selection,
   confirmation remains reachable, and incoming updates do not reset an edited value.

## Watch care reminders and family-update activation — 18 September 2026

**Scope confirmed by the user:** family alerts cover other members' **additions and
edits to milk feeds, nappies and sleep only**. No growth, milestone, daily-care or
play-entry alerts. Each phone opts in independently; a user's own actions do not
notify any of that user's devices. Care reminders are a separate existing feature:
configure them on iPhone, receive them on Watch, with no Watch editing controls.

### Current state — do not mistake implementation for activation

The read-only check during this task found `Push__RegistrationEnabled`,
`Push__EventCreationEnabled`, `Push__DeliveryEnabled` and `Push__AllowAllUsers` all
`false` on `little-days-api-522fpstfbtds2`. No `Push__ProjectId`, token-encryption
key, sending access token or allowed customer IDs were configured. No Azure values,
Expo credentials, real family records or device subscriptions were changed here.
The backend update and phone/Watch help are local source changes, not a deployed
release. Migration 0006 already supplies the needed tables; no new migration is
needed for this update. Retain the current Basic database and timer setting.

### A. Enable existing care reminders on the paired Watch

1. On iPhone, open **小日子 → 我的 → 照护提醒** (**Little Days → More → Care reminders**).
   Save the desired reminder. For shared reminders, also select **启用本机通知 /
   Enable on this phone** on each receiving phone. Saving a shared rule alone does
   not grant another phone notification permission.
2. In **iPhone Settings → Notifications → My Little Days**, allow notifications.
   Choose the desired display and sound settings. Keep an intentionally silent
   reminder silent; the app must not bypass it to force a Watch alert.
3. Open the iPhone **Watch app → My Watch → Notifications**. Find My Little Days;
   select **Mirror my iPhone**, or enable its switch under **Mirror iPhone Alerts
   From**, as offered by the installed OS. Do not add a duplicate reminder on Watch.
4. For an alert check, wear/unlock the Watch and lock the paired iPhone. Keep devices
   connected. If testing without Focus, turn it off temporarily and restore it after
   the check. With iPhone unlocked, the notification normally appears on iPhone
   instead; this is [Apple's routing behaviour](https://support.apple.com/en-au/108274),
   not evidence that Watch delivery failed. Muting, Focus and system policy still apply.
5. Test with a harmless short-lived reminder and cancel that specific test reminder
   afterward. Confirm cancellation/rescheduling reaches the phone scheduler. Do not
   uninstall either app, reset pairing or clear family data to test notifications.

### B. Configure the protected server sender before opening rollout gates

1. Use **Expo → expo4chao → little-days → project settings → Push notifications**
   (dashboard wording may vary). Confirm project ID
   `a5210f78-8729-46d4-82a4-7d1d40d30ac6`. Verify existing iOS APNs credentials for
   `com.littledays.babylog` through EAS credentials; reuse valid credentials rather
   than regenerating certificates/profiles for this change.
2. Enable Expo enhanced push security and create/configure an appropriate dedicated
   sending access token, following [Expo's sending documentation](https://docs.expo.dev/push-notifications/sending-notifications/).
   Keep it in the approved secret store. This is the server's access token, **not**
   a device's `ExpoPushToken[...]`. Do not reuse a developer login token implicitly,
   paste secrets into chat, or put them in `EXPO_PUBLIC_*`, source, artifacts or logs.
3. In Azure's infrastructure tenant `7b7e6e31-a778-4334-aee2-e969fa27fd0e`, select
   subscription `4768a858-f23f-4a39-bb64-eabc9c142627` → **App Services →
   little-days-api-522fpstfbtds2 → Settings → Environment variables → App settings**.
   Resource group is `my-little-days-pilot-rg`; the name is legacy, the data is production.
4. While all three operational push gates remain false, configure:

   | App setting                                             | Value                                                                    |
   | ------------------------------------------------------- | ------------------------------------------------------------------------ |
   | `Push__ProjectId`                                       | `a5210f78-8729-46d4-82a4-7d1d40d30ac6`                                   |
   | `Push__Environment`                                     | `production`                                                             |
   | `Push__TokenEncryptionKey`                              | Persistent, securely generated base64 encoding of 32 random bytes        |
   | `Push__AccessToken`                                     | Protected sending access token from step 2                               |
   | `Push__AllowAllUsers`                                   | `false` until broad rollout is explicitly approved                       |
   | `Push__AllowedUserIds__0`, `Push__AllowedUserIds__1`, … | Approved customer-account object IDs for initial sender/recipient cohort |

   Customer IDs are user Object IDs in customer tenant
   `deab2578-7cd3-4152-b5db-f430d6b638f8`, obtainable by the authorized operator in
   **Microsoft Entra ID → Users → chosen customer → Object ID**. Do not use the
   mobile/API app-registration client IDs, service-principal IDs or Azure admin IDs.
   Preserve the encryption key across restarts/replicas; replacement requires a
   deliberate token re-registration/rotation plan.

5. Save/apply, allow the App Service restart to settle, and verify setting **presence**
   without printing secret values. Confirm health and authenticated readiness. Missing
   secrets or an empty cohort must not be bypassed by switching on the flags anyway.

### C. Deploy, opt in and validate

1. Freeze reviewed source and publish through the GitHub plugin. Run **GitHub →
   Actions → Deploy family API and database** for the selected release branch.
   Require tests, DbUp no-op/checksum/catalog verification and API deployment to pass.
   This notification change must not resize SQL, change firewall rules or re-enable
   the paused legacy infrastructure workflow.
2. With credentials and the approved cohort configured, enable
   `Push__RegistrationEnabled=true`, then `Push__EventCreationEnabled=true`, and
   finally `Push__DeliveryEnabled=true`. Verify availability after each settings
   restart. Broad rollout, if approved, separately sets `Push__AllowAllUsers=true`;
   that permits registration but does not subscribe anyone automatically.
3. Build a **new combined native iPhone/Watch build** with the production Expo
   environment for the updated Watch UI/help; submit the exact finished store build
   to TestFlight. Verify Apple processing before telling testers to update. Do not
   reuse rejected build 31, assume an OTA updates Watch, or uninstall the existing app.
4. Each receiving phone: **Little Days → More → Family entry notifications** → enable
   notifications and desired **Milk feeds / Nappies / Sleep** categories; grant iOS
   permission. These controls require a verified full-family context. Retry any
   pending registration after connectivity is restored; an unresolved request is not
   confirmation that delivery is enabled. Apply the Watch mirroring steps in A.
5. In an agreed disposable family/test workspace, member A adds and then edits one
   record of each category. Member B receives a generic **Family records updated**
   alert; A's own devices do not. If A edits a record originally written by B, B may
   receive it: exclusion is based on who made the latest change, not original authorship.
6. Check unchanged saves and replay do not create extra events; record removal cancels
   pending alerts; changed category obeys B's current selections. Rapid changes before
   delivery may coalesce to the latest record state. Already sent/in-flight provider
   requests cannot be recalled, and provider delivery is not an exactly-once guarantee.
7. Check live sleep cancellation before one minute, long-running feed/sleep completion,
   offline replay, opt-out, logout, removal from family, both languages and Focus.
   Historical **new** entries retain summary batching; updates are processed without
   that backfill delay. Background polling/network/Apple routing can still delay alerts.
8. To stop delivery, set `Push__DeliveryEnabled=false`; disable the other operational
   gates if needed. Keep encrypted bindings, the stable key and additive schema. Do
   not truncate queues or receipts. Record deployed SHA, build/submission IDs and real
   paired-device results separately; local tests are not proof of live APNs delivery.

## Watch milk and notification follow-up: TestFlight build 33 — 18 September 2026

The user authorized commit, push, review and TestFlight submission. Reviewed runtime
and API source was committed/pushed through the GitHub plugin as
`8edfaac08036cea57586fca2ba26e5f82bb97762` on `feature/family-invitations`. The commit
contains the Watch milk selector/default fix, phone/Watch notification help, backend
edit-event handling, tests and only the relevant new runbook sections. Unrelated
infrastructure drafts, screenshots and earlier uncommitted documentation were preserved.

- [CI run 35343601963](https://github.com/github4me/my-little-days/actions/runs/35343601963)
  passed both **TypeScript and browser** and **API and SQL integration** jobs.
  Local `npm run verify`, 252 API tests, four Watch-plugin tests and 12 phone/Watch
  protocol/storage tests also passed. The optional real CNG check explicitly skipped
  on Windows; Swift protocol tests need a Swift toolchain. Neither is claimed as passed.
- Read-back production environment contains the approved HTTPS API URL, customer
  tenant/mobile client/API scope and demo `0`; account-level overrides are absent.
  Profile/channel/environment remain production, distribution STORE, OTA disabled.
- Fresh stage `work/watch-store-build33` contains 167 runtime/build-source files,
  compared byte-for-byte with `work/watch33-clean-archive`. It excludes private work,
  server code, credentials, generated exports and unrelated docs. No-VCS packaging
  means EAS's `gitCommitHash` is null; the reviewed source mapping is recorded here.
- EAS reused the existing phone and Watch profiles/certificate without capability
  changes, incremented build number 32 → 33, and queued **0.2.1 (33)** at
  **12:16:02 UTC**: [build b1c9a9d8-9e3f-4e9f-af83-f518ffa1d3ec](https://expo.dev/accounts/expo4chao/projects/little-days/builds/b1c9a9d8-9e3f-4e9f-af83-f518ffa1d3ec).
  Root app.json was aligned with the generated build number. Aside from this
  version increment, staged app sources match the reviewed commit.
- Fresh Apple readback confirms the previous build 32 is VALID and IN_BETA_TESTING
  internally and externally. It was not re-submitted or expired.
- EAS finished native compilation/signing at **12:21:36 UTC**. Final IPA SHA-256:
  `3B45CCA44E4AF5620E74732DF40FD9EA2278DD99C8B443D5E8770711FEE5FF66`.
  Binary-plist inspection confirms both bundled executables are **0.2.1 (33)**,
  the embedded Watch targets the correct phone identifier, minimum OS versions are
  iOS 16.4/watchOS 9.4, signed profiles are non-debug, the phone profile permits
  production APNs, and `EXUpdatesEnabled=false`. Watch alerts mirror the phone;
  no independent Watch APNs registration was added.
- Submitted this exact store build once with `--no-auto-testflight-setup`:
  [submission 31f9012f-642a-496e-b4df-9fdb1535a84e](https://expo.dev/accounts/expo4chao/projects/little-days/submissions/31f9012f-642a-496e-b4df-9fdb1535a84e).
  EAS submission finished successfully at **12:26:26 UTC**. Apple readback shows
  **VALID**, internal **IN_BETA_TESTING** on final readback, external
  **READY_FOR_BETA_SUBMISSION**, uploaded at **12:24:39 UTC**. This is successful
  upload/processing, not a claim that every tester has access. No tester groups
  were created/modified and no public App Store release was requested.

No Azure/API/SQL deployment or push activation is included in this TestFlight
release. Family remote alerts remain disabled pending protected server credentials
and approved rollout scope; care reminders use the existing phone scheduler and
Apple mirroring. After Apple processing, install over the existing app and check
the 150 mL start/finish selection, Crown adjustment and notification instructions
on paired hardware. Physical-device results remain a separate acceptance step.

If build 33 is not offered in a tester's TestFlight app:

1. Open **App Store Connect → My Little Days (6809826484) → TestFlight → iOS →
   0.2.1 (33)** and verify processing remains VALID and export-compliance information
   is complete. Do not submit another copy of the same build.
2. Select the intended **existing internal testing group** and add build 33 using
   its Builds/add-build control. Confirm that group's testers can see the build.
   Do not create a new group or add unintended recipients.
3. For external testers, select the intended existing external group and build 33,
   complete the already-approved Beta App Review contact/login information if
   requested, and submit for beta review. Wait for approval/availability before
   reporting external access; no public App Store release is needed.
4. Update in TestFlight over the existing installation, then update the companion
   on the paired Watch. Never uninstall/clear records merely to reveal a new build.

## Today Home Screen widget: signing and validation — 18 September 2026

Design/data contract: [iOS Today widget](IOS-TODAY-WIDGET.md). This is a native
extension: OTA cannot add it. It needs no Azure, SQL, Entra or push-delivery changes.
The widget works without a paired Watch and never accesses the API itself.

### Apple configuration (new target and App Group)

Use Apple Developer team **A9974KXQ4G**, not an Azure tenant. These identifiers are
public configuration, not credentials:

| Item                              | Exact value                                               |
| --------------------------------- | --------------------------------------------------------- |
| Existing phone App ID             | `com.littledays.babylog`                                  |
| Existing Watch App ID (unchanged) | `com.littledays.babylog.watchkitapp`                      |
| New widget App ID / Xcode target  | `com.littledays.babylog.widget` / `LittleDaysTodayWidget` |
| Shared App Group                  | `group.com.littledays.babylog.widgets`                    |
| Widget destination                | `mylittledays://today`                                    |

If EAS cannot configure the new capabilities/profile unattended:

1. Open **Apple Developer → Certificates, Identifiers & Profiles → Identifiers**,
   select **App Groups**, then **+**. Register the exact group above with description
   `Little Days Widgets`. If it already exists in this team, reuse it.
2. Under **Identifiers → App IDs**, open the existing phone identifier. Enable
   **App Groups → Configure**, select the group above, and save. Preserve Push
   Notifications and all other existing capabilities.
3. Register an explicit **App ID → App** for `com.littledays.babylog.widget`,
   description `Little Days Today Widget`. Enable App Groups and associate the same
   group. Do not add independent push or sign-in capabilities to this extension.
4. In a local terminal at this repository, run
   `npx eas-cli@24.6.0 credentials -p ios`, choose **production**. Reuse the existing
   distribution certificate; update the phone provisioning profile to include its
   App Group, and generate an App Store provisioning profile for
   **LittleDaysTodayWidget**. Leave the Watch profile unchanged. Complete Apple
   login/2FA privately in the CLI; never paste a password or private key into chat.
5. Expected result: EAS lists **three targets**, with ready App Store credentials.
   Both phone and widget profiles must include the exact shared App Group; a green
   old phone profile without that entitlement is not sufficient.
6. Recheck the resolved production environment, demo `0`, distribution STORE and
   OTA disabled. Build the reviewed source with `eas build --platform ios --profile
production --non-interactive --freeze-credentials --no-wait`. Do not substitute
   an internal/ad-hoc preview IPA for a store build.
7. Inspect the finished IPA: embedded `PlugIns/LittleDaysTodayWidget.appex`, widget
   extension-point `com.apple.widgetkit-extension`, matching phone/Watch/widget
   versions, both required App Group entitlements and OTA disabled. The cloud
   post-install hook runs the Swift snapshot boundary tests before compilation.
8. Submit only that exact EAS build ID using `eas submit --platform ios --profile
production --id <ID> --non-interactive --no-auto-testflight-setup --no-wait`.
   Confirm Apple **VALID**, then the intended tester group's availability. Do not
   duplicate submissions while Apple processing is pending.

### Adding and checking the widget on a device

1. Update the existing app through TestFlight, then open it once so authorized
   local statistics can populate the widget snapshot. Do not uninstall or reset.
2. Long-press an empty area on the Home Screen → **Edit → Add Widget** (or **+**, by
   iOS version) → search **My Little Days / 小日子** → **Today's care / 今日照护**.
3. Select small or medium → **Add Widget → Done**. Tap anywhere on it; Today opens.
   A record-editor sheet already open is retained so its draft is not discarded.
4. Check known-empty totals `0`, record/edit milk and nappies, and start/finish
   sleep. Compare with Today at the snapshot's update time. Sleep includes an
   ongoing timer only through that time; this is not a Live Activity.
5. Check Chinese/English, light/dark/tinted modes, large text, VoiceOver and iPad.
   Native visual checks require Apple hardware/Simulator, not a browser export.
6. After midnight or changing time zones, old totals must not appear as Today;
   open the app to recompute. Offline snapshots expire on their access lease.
   Family changes appear only after the phone receives them; iOS controls widget
   refresh timing. The update timestamp describes the local snapshot, not proof
   that every family device has synchronized.
7. Logout, membership loss and workspace switches request cache removal/reload.
   Test lifecycle scenarios only with disposable test identities/data. iOS may
   retain an already-rendered widget briefly; this feature cannot retract photos,
   screenshots, or promise instantaneous remote revocation while offline.

### Widget release attempt — 18 September 2026, 12:56 UTC

- Implementation pushed through the GitHub plugin as
  [`cfa0913281e9ec435d9e0b22bfbeae04a2227cfd`](https://github.com/github4me/my-little-days/commit/cfa0913281e9ec435d9e0b22bfbeae04a2227cfd).
  Local `npm run verify`, web export and browser regressions passed. The source
  [CI run 35347244057](https://github.com/github4me/my-little-days/actions/runs/35347244057)
  was still running at this checkpoint; this is not a CI success claim.
- Resolved production environment was rechecked: expected HTTPS API, customer
  tenant/mobile client/API scope, demo `0`, STORE distribution and OTA disabled.
  No account-level environment overrides were present.
- An isolated 180-file stage (`work/widget-store-build34`) was byte-compared with
  the reviewed sources. The directory name is only a planned build label: **no
  build 34 was produced**, and staged/root buildNumber remain 33.
- EAS reached credential preparation with the three expected targets. Existing
  phone/Watch profiles were found, and Watch capabilities needed no changes.
  EAS registered the new Widget App ID, Apple identifier **8GYSC98QT3**, but Apple
  rejected automated `APP_GROUPS=ON` capability configuration. The same session
  reported that capability-identifier association requires cookie (Apple login)
  authentication rather than the available App Store Connect API key.
- Configure the widget at [Apple Developer — Widget App ID](https://developer.apple.com/account/resources/identifiers/bundleId/edit/8GYSC98QT3),
  then follow the phone/App Group/profile steps above. Do not disable capability
  syncing or remove the entitlement as a workaround. Both phone and widget need
  the shared group in their signed profiles before the next frozen build.
- **No cloud build ID, native compile, Swift-test result, IPA, submission or Apple
  processing result exists for this attempt.** The installed/current TestFlight 33
  is unaffected. Once signing is ready, refresh the isolated stage from the exact
  reviewed revision and resume the native build, then submit its exact ID.
- EAS displayed 80% included-build-credit usage and an incident affecting Android
  queues/submissions/workflows. No paid upgrade or quota change was requested.

### Watch summary fixes and signing checkpoint — 19 September 2026 (Sydney)

- Source pushed through the GitHub plugin as [`43c932c`](https://github.com/github4me/my-little-days/commit/43c932c6c38388c81cc19cad12189d7c2d642d74).
  Today and its metrics/update time are grouped, locally saved commands update
  totals immediately without double counting phone echoes, Notifications is a
  sibling of Sync status, and update time is an absolute date/time rather than a
  resetting seconds counter. See [implementation and device checks](APPLE-WATCH-IMPLEMENTATION.md#watch-summary-and-navigation-refinement--19-september-2026).
- Local `npm run verify` passed. [CI 35373991978](https://github.com/github4me/my-little-days/actions/runs/35373991978)
  completed successfully, including 20 compiled Swift protocol/summary tests
  (9 new summary tests), TypeScript/unit/native-packaging/browser regressions and
  API/SQL integration. Linux Foundation tests do not compile/render SwiftUI.
- Rechecked production project variables and absence of account overrides: HTTPS
  API, expected customer tenant/mobile client/scope, demo `0`, STORE distribution,
  OTA disabled. Byte-compared 183 runtime/build files in the isolated
  `work/watch-summary-store-build34` stage against source before the attempt.
- EAS credential preparation again failed enabling `APP_GROUPS=ON` for
  `com.littledays.babylog.widget`, with Apple's invalid capability relationship
  response. Phone/Watch profiles were found; Watch capabilities required no changes.
  **No new EAS build ID, IPA, TestFlight submission or native UI compilation was
  produced.** Root/stage build number remains 33; the stage's name is not a release.
- Read-only browser verification found the intended Apple team **A9974KXQ4G**
  signed in, and Widget App ID **8GYSC98QT3** with **App Groups unchecked**.
  Its existing Chrome configuration tab is retained for handoff. No portal
  settings were changed. Confirmation is requested before enabling the shared
  App Group for phone/Widget and updating their signing configuration. The
  existing certificate and Watch capabilities/profile are to be preserved.
- Resume using the exact App Group and profile procedure above once confirmed.
  Do not bypass capability checks, silently remove the Widget or submit the old
  build as these fixes. Then build, inspect all three signed targets, submit the
  exact new build ID and verify Apple processing/tester availability. Physical
  Watch layout, Dynamic Type, offline recording/reconnection remain outstanding.

### Watch and Widget TestFlight 34 — 19 September 2026 (Sydney)

- The user completed Apple App Group/profile setup. Frozen-credential EAS readback
  found all three App Store targets ready in team **A9974KXQ4G**: phone profile
  **Z6BA8UVQM6**, Watch **8MHYYTJZ6Q**, new Widget **93D24AQDY7**. The existing
  distribution certificate was reused; no Watch capability changes were needed.
- Rechecked the resolved **production** project environment, no account overrides,
  expected HTTPS API/customer tenant/mobile client/API scope and demo `0`.
  Distribution is **STORE**, runtime/app version **0.2.1**, OTA disabled.
- The isolated 183-file source stage was byte-compared with the reviewed
  `43c932c` implementation (repository HEAD `3a96fc4` adds documentation only).
  EAS incremented the staged build number from 33 to **34**; repository app.json
  is aligned to 34. Unrelated working-tree files were excluded from the upload.
- [EAS build 6c33cee6-fc08-4598-a088-0e56f9c0abbe](https://expo.dev/accounts/expo4chao/projects/little-days/builds/6c33cee6-fc08-4598-a088-0e56f9c0abbe)
  completed successfully at **18 September 2026, 22:05 UTC**. Cloud macOS tests:
  **20 Watch protocol/summary tests and 5 Widget snapshot tests passed**; all three
  native targets compiled and archived.
- Downloaded IPA inspection passed: phone, Watch and Widget all identify as
  **0.2.1 (34)** with the expected bundle IDs and App Store provisioning profiles.
  Embedded code-signature entitlement blobs (including both Watch architectures)
  and profiles match the team/application IDs and disable debug access. Both phone
  and Widget contain exactly `group.com.littledays.babylog.widgets`; Widget has
  extension point `com.apple.widgetkit-extension`; Expo.plist keeps OTA disabled.
  This is artifact inspection, not independent cryptographic signature validation
  or physical-device acceptance.
- Submitted the exact build using the production profile and
  `--no-auto-testflight-setup`.
  [Submission 864a97ac-3564-420e-a22c-00a1fbaa4fdb](https://expo.dev/accounts/expo4chao/projects/little-days/submissions/864a97ac-3564-420e-a22c-00a1fbaa4fdb)
  uploaded to existing App Store Connect app **6809826484**. Apple readback shows
  build 34 **VALID**, internal **IN_BETA_TESTING**, external
  **READY_FOR_BETA_SUBMISSION**. External Beta review/distribution has not been
  submitted by this operation; do not describe it as available to external testers.
- Internal testers can update the existing installation via TestFlight, without
  uninstalling. Open the phone app once, then check the updated Watch app and add
  the Today widget using the device steps above. Physical Watch immediate totals,
  offline/reconnection reconciliation, notification navigation, stable timestamps,
  and Widget visual/accessibility checks remain outstanding.
- For external testing, use App Store Connect → My Little Days → TestFlight →
  the intended existing external group → add **0.2.1 (34)**, supply accurate test
  notes/review information if requested, and submit for Beta App Review. Preserve
  the existing tester audience and wait for Apple's approval before claiming
  external availability. No Azure, SQL, Entra or notification settings were changed.

### Supplement care rollout — prepared 19 September 2026, not deployed

The new Daily care category requires the compatible API as well as the app update.
No new Azure/Entra/Apple setting, permission, database migration or recurring cost
is required. The existing environment contains production data.

1. In GitHub → this repository → Actions → existing family API deployment, select
   the approved release branch and reviewed immutable revision using the existing
   release procedure. Deploy the API before releasing the new mobile app. Preserve
   the current SQL Basic target and the disabled infrastructure-apply gates.
2. On the configured family API, using an authorized test account, verify
   `GET /v2/capabilities` returns `careSchemaVersion: 2`. For its own family, verify
   `GET /v2/families/{id}/snapshot` with `X-LittleDays-Care-Schema: 2` returns care
   schema 2. Without that header it must return schema 1, omit supplements from the
   representation only, and use a different ETag. Never log family payloads/tokens
   or modify a real family's records to test compatibility.
3. Use the existing Expo **production**, store-distribution TestFlight procedure
   after verifying its resolved configuration. The current build 34 and disabled
   OTA settings are unchanged by this implementation task. Physical iOS checks:
   VD/Probiotics multi-selection, Other name, local save/restart, family offline
   save and later sync on authorized test devices, and an older app still reading
   its supported record categories. Complete the new checks in `VALIDATION.md`.

Expected result: new clients can share supplements; old clients continue to read
their supported records without seeing supplements. If the API has not yet been
updated, shared supplement controls stay disabled with an explanation. Once
supplements exist, do not revert to an API that rejects that record kind; use a
forward-compatible correction. See `FAMILY-API-CONTRACT.md` for the representation
and data bounds. Deployment and physical acceptance are still outstanding.

### Care and supplements release 35 — 19 September 2026 (Sydney)

- App/API source frozen at **531c3097a1a94e917a5f329fd870014a40e285a4** on
  `feature/family-invitations`, committed/pushed with the GitHub plugin.
  Unrelated local infrastructure drafts, instructions and screenshots were excluded.
- [Push CI 35414263823](https://github.com/github4me/my-little-days/actions/runs/35414263823)
  passed. Cloud API tests: **255 passed, 0 skipped**; migrator tests:
  **67 passed, 0 skipped**. The TypeScript/browser job also passed.
- [API deployment 35414547061](https://github.com/github4me/my-little-days/actions/runs/35414547061)
  succeeded for that same SHA. Existing `family-database` and `family-pilot`
  environments remain limited to the release branch; neither has a required
  reviewer/wait timer configured. No protection setting was changed.
- Live schema/checksum/catalog verification succeeded with **0 pending scripts**;
  no schema migration was added or applied. Temporary rule
  `github-db-35414547061-1` was removed. Readback confirmed the administrator IP
  rule remains, and SQL `little-days-family` remains **Basic (5 DTU), Online**.
  Existing infrastructure-apply gates were not touched.
- Azure active deployment `0efc37ee-eb1b-4a0f-9cb6-6594205a1f5e` completed
  successfully. Public `/health/live` returned **200**, and an unauthenticated
  `/v2/capabilities` request returned **401**. This does not demonstrate a
  signed-in family round trip; the authorized-account schema-2/legacy ETag checks
  above still need device acceptance without altering real family data.
- Rechecked Expo **production** project/account variables: expected API URL,
  Entra customer tenant/mobile client/scope, demo **0** and no account override.
  Store distribution, app/runtime **0.2.1**, OTA disabled, existing Apple team
  **A9974KXQ4G** and all three existing Store profiles were preserved.
- Packaging lesson: `EAS_NO_VCS=1` alone still discovers a parent Git root.
  Attempt `a49896a9-6031-458c-8409-9df00d9972cc` failed before compilation
  because the staged project path was not in its uploaded archive; it produced no
  IPA or Apple submission. For an isolated stage, also set **EAS_PROJECT_ROOT to
  its resolved absolute path**. Run `eas build:inspect --stage archive` and
  compare the exact file allowlist/content before building. The corrected upload
  contained **186 reviewed files**, with no local drafts; cloud project root is
  `.`. Only the staged build number changes from 34 to **35**.
- [Build 416d39d6-ee5c-402e-877c-956b863fbbcb](https://expo.dev/accounts/expo4chao/projects/little-days/builds/416d39d6-ee5c-402e-877c-956b863fbbcb)
  finished at **19 September 2026, 02:13:34 UTC** as **0.2.1 (35)**.
  **20 Watch and 5 Widget native model tests passed** on its macOS host.
  IPA inspection verified all three bundle IDs, version/build numbers, Store
  profiles, signed team/application identifiers, disabled debug access, phone and
  Widget App Groups, Widget extension point and disabled Expo OTA. This is artifact
  inspection, not independent cryptographic signature verification.
  IPA SHA-256: `5C7C44EF6BE65F52AB696C448B20EC2C4BD2D60844E3EBDE28E12B9AF3DF92F6`.
- Submitted that exact build to existing App Store Connect app **6809826484**
  using the production profile and `--no-auto-testflight-setup`.
  [Submission 194d9d0a-6ada-4cfc-86ba-89de38a73d1e](https://expo.dev/accounts/expo4chao/projects/little-days/submissions/194d9d0a-6ada-4cfc-86ba-89de38a73d1e)
  finished successfully. Apple readback confirms build 35 **VALID**, internal
  **IN_BETA_TESTING**, external **READY_FOR_BETA_SUBMISSION**. Existing internal
  testers can update via TestFlight without uninstalling. External Beta review
  was not submitted by this operation; no new tester group or public App Store
  release was created. Repository `app.json` is aligned to build **35**.
- Physical iOS SQLite, VoiceOver/Dynamic Type, keyboard, supplement family
  synchronization and older-client acceptance remain unverified. See
  `VALIDATION.md`; cloud success is not a physical-device acceptance result.

### Care and record refinements — TestFlight build 36, 19 September 2026

- Reviewed app source: `6bc595f706cd1d83c9d3a587e03d3548b087ddb3` on
  `feature/family-invitations`, committed and pushed through the GitHub plugin.
  Includes Care ordering/Chinese labels, temperature-method icons, seven-date
  history pagination, and minute-precision duration labels. No API/SQL deployment.
- `npm run verify`, web export and browser regression passed. Production public
  URL, Entra tenant/client/scope and demo `0` were read back before building.
  No environment, credentials, tester-group or infrastructure settings changed.
- EAS CLI 24.7.0 used an isolated source stage with both `EAS_NO_VCS=1` and
  `EAS_PROJECT_ROOT` set. All 186 files matched the inspected archive; unrelated
  local drafts and data were excluded. Production/STORE, version/runtime 0.2.1,
  OTA disabled and the existing three Apple signing profiles were retained.
- Build `dd872de3-9ced-4940-89d2-ca4d6cad13b8` finished at
  **2026-09-19 04:27:00 UTC** as **0.2.1 (36)**. macOS native model tests:
  20 Watch and 5 Widget tests passed. IPA inspection passed for bundle IDs,
  versions, Store profiles, signed entitlements/App Groups and disabled OTA.
  This is artifact inspection, not independent signature verification.
  SHA-256: `502A83E0B134C00F5B8A59F0106CCBA35CF8BA970A9FCA97678AA5F6F218052A`.
- Exact-build submission `03a5e241-3896-452c-b1ef-8961d7f4f2f9` targets existing
  App Store Connect app `6809826484`, using production and
  `--no-auto-testflight-setup`. Apple readback confirms build 36 **VALID**,
  internal **IN_BETA_TESTING**, external **READY_FOR_BETA_SUBMISSION**.
  EAS submission subsequently confirmed **FINISHED**. External beta review was
  not submitted by this operation.
- When available, update via TestFlight over the existing installation; do not
  uninstall. Physical iPhone layout, VoiceOver/Dynamic Type, Watch and Widget
  acceptance remain device checks. No public App Store release was requested.

## Cross-member timer completion and record icons — deployed 19 September 2026

This change has no new Azure resource, Entra registration, secret or environment
setting. It requires the additive database migration, compatible API and client
to be released in that order. The release below used that order and kept the
existing SQL Basic database, API hosting, Entra identities, Apple credentials,
tester groups and Expo production variables unchanged.

Release evidence:

- App/API source was frozen at
  `1f05670d176d215b3485c6e619ad7293d228fa1b` on
  `feature/family-invitations`. The first CI run exposed SQL Server binding the
  new index before the new column in the same batch. The additive, not-yet-live
  migration was corrected with a `GO` separator; no applied migration was
  rewritten. [CI run 35445318746](https://github.com/github4me/my-little-days/actions/runs/35445318746)
  then passed all frontend/browser checks, API **260/260** and migrator
  **72/72** real-SQL tests with zero skips.
- [Deployment 35445602502](https://github.com/github4me/my-little-days/actions/runs/35445602502)
  applied the sole pending `0007_TimerEndAttribution.sql`, removed its temporary
  runner-IP firewall rule and deployed the matching API. A same-SHA idempotency
  [run 35446063155](https://github.com/github4me/my-little-days/actions/runs/35446063155)
  explicitly reported **Pending database scripts: 0** twice, accepted the live
  catalog/checksums, removed its temporary firewall rule and redeployed without
  errors or warnings. OneDeploy `11d1fced-7325-4db4-bb3f-2c04ba514839` was
  complete and active. Public `/health/live` returned **200** with
  `{"status":"ok"}`; unauthenticated `/v2/capabilities` returned **401**.
  This is liveness/auth-boundary evidence, not a signed-in SQL-backed family
  round trip.
- Expo production project variables were read back with the expected API URL,
  Entra tenant/client/scope and demo `0`; account scope had no overrides. The
  isolated exact-SHA upload contained **272** files matching the inspected
  archive byte-for-byte. Store distribution, runtime/app version **0.2.1**,
  disabled OTA, Apple team `A9974KXQ4G` and the existing phone, Watch and Widget
  profiles were retained.
- [EAS build fad6fe5e-6a78-473d-af13-7d043cf40573](https://expo.dev/accounts/expo4chao/projects/little-days/builds/fad6fe5e-6a78-473d-af13-7d043cf40573)
  finished as **0.2.1 (37)** at `2026-09-19T13:36:50Z`. Native model checks
  passed: Watch **20/20**, Widget **5/5**; Xcode validated both embedded targets
  and archived successfully. IPA inspection passed all three bundle IDs,
  versions, Store profiles, signed team/application identifiers, disabled debug
  access, phone/Widget App Groups, Widget extension point and disabled Expo OTA.
  This is artifact inspection, not independent cryptographic signature
  verification. IPA SHA-256:
  `87BC5F47BD0BE96079D27500442827AEB28C3357A842CA97A32A1F046B1651D8`.
- Exact-build [submission e35b6eef-b914-4d74-81cf-9903cf365440](https://expo.dev/accounts/expo4chao/projects/little-days/submissions/e35b6eef-b914-4d74-81cf-9903cf365440)
  finished successfully for existing App Store Connect app `6809826484` using
  `--no-auto-testflight-setup`. Apple readback confirms build 37 **VALID**,
  internal **IN_BETA_TESTING** and external **READY_FOR_BETA_SUBMISSION**. No
  tester group, external Beta submission or public App Store release was changed.
- Physical two-account timer completion, iPhone/Watch/Widget UI, VoiceOver,
  Dynamic Type and keyboard acceptance remain outstanding. Use disposable test
  accounts for the checks below; do not exercise destructive flows on real
  family data. Expo Doctor also reported the existing top-level splash-schema
  warning and ten SDK patch-version mismatches; they did not block the archive
  and were not broadened into this release.

1. **Freeze and verify one source revision.** Run the backend tests with a
   disposable SQL Server, including the v6-to-v7 migration/catalog tests and the
   cross-member completion, sub-minute completion, concurrency and account-cleanup
   tests.
   Review `0007_TimerEndAttribution.sql` without changing any already journaled
   migration. The expected change is one nullable
   `dbo.FamilyRecords.TimerEndedBy uniqueidentifier` column and one filtered
   `IX_FamilyRecords_TimerEndedBy` index; it must not rewrite existing records.
2. **Apply migration 0007 first.** In GitHub Actions, use the existing **Deploy
   family API and database** workflow and protected `family-database` environment
   on the approved release branch/SHA. Keep the existing hosting-tenant OIDC and
   SQL Basic database configuration; add no credential to source, logs or mobile
   configuration. The database stage must finish before API deployment. Read back
   `dbo.DatabaseMigrations`, confirm the exact 0007 journal checksum from the
   reviewed artifact, verify the nullable column and filtered index in the SQL
   catalog, and rerun DbUp `--check`. Expected result: version-7 catalog accepted
   and **zero pending scripts**. Remove only the temporary runner firewall rule
   created by that workflow and confirm the pre-existing rules/tier remain.
3. **Deploy the matching API second.** Promote the same SHA through the existing
   protected `family-pilot` environment. There is no new feature flag to add;
   retain the existing `Family__EnforceSingleActiveTimers` value because that
   separate guard controls new competing timers, not who may finish one. Verify
   App Service deployment state, `/health/live`, authenticated readiness and an
   authorized v2 snapshot. Expected snapshot behavior: entry objects include
   nullable `endedBy` and `crossMemberTimerCompletionEnabled` is explicitly
   `true`; old/non-timer rows remain null and no private payload is emitted in
   logs. Confirm the ETag includes the capability generation. A missing/false
   flag must keep client cross-member controls disabled. A health 200 alone is
   not signed-in SQL-backed acceptance.
4. **Release the compatible client last.** Before starting a timer, refresh the
   family snapshot and present an already-running timer as in progress with the
   starter's member name. Finishing another member's timer must send a normal
   versioned update that preserves ID/type/start/note/feed kind and adds the end
   (plus a finalized bottle amount when applicable). The same completion update
   applies when sleep has run for less than 60 seconds; it must retain the
   completed entry and `endedBy`. Never delete another member's timer—delete
   remains available only under the existing record-author or owner permission.
   Reuse the identical update and operation ID after an ambiguous result, and do
   not infer permission from stale local state.
5. **Accept on two disposable family accounts/devices.** Have account A start a
   sleep and feed, then account B refresh and finish each. Verify both clients show
   A as starter, B as finisher and the same start/end timestamps. Verify a later
   permitted edit does not replace `endedBy`, a simultaneous second finish gets
   `record_changed`, and a new timer can start after completion. Confirm B cannot
   change A's start, note, type or feed kind. For a sleep under 60 seconds, verify
   B's stop still creates a completed entry with B in `endedBy`; verify B cannot
   delete A's timer at any duration. Exercise offline/reconnect and both
   English/Chinese UI without using a real family's records.
6. **Verify privacy cleanup with disposable data only.** Where a deleted test
   account remains solely in `TimerEndedBy` after another editor has superseded
   `LastEditedBy`, confirm cleanup preserves the completed record, clears
   `endedBy`, advances family revision and suppresses related pending push work.
   Existing creator/current-editor deletion rules remain unchanged. Never run
   account deletion against a real family as a release test.

If the API or client needs rollback, leave migration 0007 in place: the nullable
column is backward-compatible and existing rows were not rewritten. Roll back to
a reviewed API/client that ignores the extra field, keep migration checks at zero
pending, and use a forward-compatible correction. Do not drop the column/index or
erase timer history to restore an older build.
## Independent feed and sleep synchronization — TestFlight build 38, 20 September 2026

- App source was frozen at
  `fa6571abeda47d42906a2231e4dea70a4c77e72f` on
  `feature/family-invitations`. Feed and sleep now project their start/finish
  locally before network confirmation, reconcile authority in the background,
  and conflict only with another active timer of the same kind. A feed and a
  sleep may overlap; later valid edits no longer make an already-acknowledged
  completion look unconfirmed. No API, SQL, Azure or Entra deployment was needed:
  the deployed API already enforces its active-timer guard per record kind and
  the server change in this revision is regression coverage only.
- The first push [CI run 35490989131](https://github.com/github4me/my-little-days/actions/runs/35490989131)
  passed API/real-SQL integration and all checks except one pre-existing browser
  assertion whose DOM depth had not been updated when the standalone account
  deletion action became an icon. Test-only commit
  `19a023ea3478f4260888e5247780cfc53ced185e` corrected that locator; final
  [CI run 35491348539](https://github.com/github4me/my-little-days/actions/runs/35491348539)
  passed both **TypeScript and browser** and **API and SQL integration** jobs.
  Local verification also passed `npm run verify`, the full family demo browser
  matrix, iOS export and the .NET test build. SQL-dependent local cases were not
  executed without a disposable connection; CI supplied the real-SQL result.
- Expo production project values were read back before building: the expected
  production API URL, Entra tenant/client/scope and demo `0`, with no account-level
  production overrides. The production profile remained STORE distribution on
  channel `production`, runtime/app version **0.2.1**, with OTA disabled. Existing
  Apple team `A9974KXQ4G`, certificate and the phone, Watch and Widget Store
  profiles were reused; no credential was created or replaced.
- [EAS build 01defad9-0af7-465c-8c57-44afe80dbcae](https://expo.dev/accounts/expo4chao/projects/little-days/builds/01defad9-0af7-465c-8c57-44afe80dbcae)
  finished successfully at `2026-09-20T05:18:49.067Z` as **0.2.1 (38)** from
  the exact app source SHA above (fingerprint
  `5a6e602267d1dc9c14601170412c7e842e97edf0`). Xcode validated the embedded
  Watch and Widget targets and the Store archive succeeded.
- Downloaded IPA inspection verified phone `com.littledays.babylog`, Watch
  `com.littledays.babylog.watchkitapp` and Widget
  `com.littledays.babylog.widget`, all at **0.2.1 (38)**. Watch names the phone
  companion; Widget uses `com.apple.widgetkit-extension`. Embedded Store profiles
  match the team/application identifiers, have debug access disabled and Beta
  reporting enabled; phone push is `production`, and phone/Widget share exactly
  `group.com.littledays.babylog.widgets`. This is artifact/profile inspection,
  not independent cryptographic signature validation or physical-device
  acceptance. IPA SHA-256:
  `7A4181D8A2B99BA350663C46A1AD177D1EA29D9D3E790BE73A7A05991F653B9A`.
- Submitted that exact build ID, never `latest`, to existing App Store Connect app
  `6809826484` with the production profile and
  `--no-auto-testflight-setup`.
  [Submission 99823ae3-4190-4828-96f3-864efb7cb350](https://expo.dev/accounts/expo4chao/projects/little-days/submissions/99823ae3-4190-4828-96f3-864efb7cb350)
  finished at `2026-09-20T05:26:41.227Z`. Apple readback shows build 38
  **VALID**, internal **IN_BETA_TESTING** and external
  **READY_FOR_BETA_SUBMISSION**. Existing internal testers can update without
  uninstalling. No tester group, external Beta review or public App Store release
  was changed.
- Repository `app.json` is aligned to build **38**. No unrelated product feature
  or dependency is included; separately drafted work remains outside these commits.
- Physical acceptance remains outstanding: use two disposable family accounts to
  start feed and sleep in both orders, overlap the two kinds, finish each from the
  same and a different member, and exercise offline/reconnect and a genuine
  same-kind race in Chinese and English. Confirm immediate local feedback changes
  to confirmed/pending/conflict truthfully and both clients converge to the same
  starter, finisher and timestamps. Do not test destructive flows on real family
  data or uninstall a data-bearing app.

## Twelve-locale native and notification rollout — deployed 20 September 2026

This source change adds the canonical locales `en`, `zh-Hans`, `zh-Hant`, `fr`,
`de`, `hi`, `it`, `ja`, `ko`, `es`, `th` and `vi` to phone/native metadata,
local and family reminders, and generic family-entry push content. It does not add
or change the optional Buy Me a Coffee feature. The release changed the compatible
SQL schema, API and native binary as recorded below; live push rollout settings
remained disabled and unchanged.

1. **Freeze one reviewed SHA and keep the rollout schema-first.** In the existing
   GitHub **Deploy family API and database** workflow, apply only the immutable
   additive `0008_WidenPushLocale.sql` to the existing `little-days-family` SQL
   Basic database before deploying the matching API. The expected catalog change
   is `dbo.PushInstallations.Locale varchar(16) NOT NULL`; existing `en` and `zh`
   values and every registration/event/receipt row remain in place. Verify the
   reviewed journal hash, `COL_LENGTH('dbo.PushInstallations','Locale') = 16`,
   runtime CRUD grants unchanged, and **zero pending scripts** after apply. Remove
   only the workflow's temporary runner firewall rule. Do not edit migration 0006,
   truncate push metadata or re-enable the paused infrastructure path.
2. **Deploy the compatible API from the same SHA.** Keep the existing push project,
   encryption key, access token, environment, acceptance cohort and three rollout
   gates unchanged. An authenticated `GET /v2/push/capabilities` must now return the
   12 canonical `supportedLocales`; registration must still accept legacy `en/zh`
   clients. Register one disposable device with a long locale such as `zh-Hant`,
   renew it, and confirm the stored locale and generic localized provider payload.
   An unknown locale must be rejected at registration and must fall back to English
   if encountered only at delivery. Health alone is not this SQL-backed check.
3. **Build and distribute a new native binary last.** `expo-localization` now embeds
   OS-selectable locales and localized app/photo-permission resources, so disabled
   OTA cannot deliver this part to build 38. Resolve the production EAS environment,
   preserve Store distribution and existing Apple credentials, increment the iOS
   build number, then inspect the archived phone, Watch and Widget locale resources
   before submitting the exact build ID. Update through TestFlight over the existing
   installation; do not uninstall a data-bearing app.
4. **Complete language review before exposing a locale.** The generated phone
   catalogs are implementation drafts, not a legal or medical translation
   certificate. A context-safe override glossary protects known ambiguous baby-care
   and destructive labels, but a qualified native speaker must still review the
   full privacy, consent, account/family deletion and urgent-temperature copy for
   each locale. Keep a locale out of the production language picker until that
   review is recorded; do not treat passing placeholder or UI tests as approval.
5. **Accept without destructive family flows.** On disposable accounts/devices,
   select each supported app language and verify the native display name/photo
   prompt, local one-off/daily/after-feed reminders, shared reminders and generic
   family-entry push. Changing language must replace generated notification text
   while retaining an authored reminder title, exact one-off date, daily wall-clock
   time, silence choice and family opt-in. Confirm French/Japanese and every other
   non-Chinese locale never receives Chinese fallback; old API capability responses
   may use legacy `zh` only for `zh-Hans/zh-Hant`, and English for all other locales.
   Record build/submission IDs and physical-device results separately.

Release evidence:

- Application/API source commit
  [`1b32e13953d545bb929f1a1a50836c25a773881a`](https://github.com/github4me/my-little-days/commit/1b32e13953d545bb929f1a1a50836c25a773881a)
  contains the reviewed multilingual implementation and no Buy Me a Coffee runtime
  code. [Family sharing CI 35513108287](https://github.com/github4me/my-little-days/actions/runs/35513108287)
  completed successfully for that exact SHA.
- [API/database release 35513415777](https://github.com/github4me/my-little-days/actions/runs/35513415777)
  completed successfully for the same SHA. DbUp applied only
  `0008_WidenPushLocale.sql`; the journal hash is
  `E166C26301FB6EDC1FD8B840F5FAD19AB445113053DF8134CEA8FB1BCA4882AE`
  and the post-release check reported **zero pending scripts**.
  `dbo.PushInstallations.Locale` is `varchar(16) NOT NULL`. SQL remained Online on
  Basic (5 DTU, 2 GiB). All 33 permanent firewall rules remained exact-IP rules and
  no `github-db-*` temporary rule remained.
- Matching API OneDeploy `dd71bb52-5592-4b0f-b50f-c12657672769` completed and is
  active. Independent checks returned 200 with `{"status":"ok"}` from
  `/health/live`, and 401 from unauthenticated `/v2/capabilities` and
  `/v2/push/capabilities`. Azure deployment metadata does not embed the Git SHA;
  the pinned workflow and its same-run artifact provide the source attribution.
- The production EAS environment resolved the HTTPS API URL, existing Entra tenant,
  client and API scope, and `EXPO_PUBLIC_FAMILY_UI_DEMO=0`. Store build
  [`5a655aa4-8af5-470e-a9b8-34818005b6a5`](https://expo.dev/accounts/expo4chao/projects/little-days/builds/5a655aa4-8af5-470e-a9b8-34818005b6a5)
  finished from exact Git SHA `1b32e139...` as iOS **0.2.1 (39)** with the existing
  Phone, Watch and Widget credentials.
- Exact-ID [submission 97154d89-66de-4cdb-8c1f-a5d45e979693](https://expo.dev/accounts/expo4chao/projects/little-days/submissions/97154d89-66de-4cdb-8c1f-a5d45e979693)
  finished at `2026-09-20T13:42:14.725Z`. App Store Connect readback reports build
  39 **VALID**, internal **IN_BETA_TESTING** and external
  **READY_FOR_BETA_SUBMISSION**. No tester group, external Beta review or public
  App Store release was changed.
- Live push registration/provider acceptance was not run because the existing push
  rollout gates and provider credentials remain deliberately disabled. Full
  native-speaker review, installed-phone language/reminder checks, Watch/Widget
  checks and non-destructive two-device acceptance remain release follow-ups; cloud
  tests and Apple processing do not establish those outcomes.

If the API or client must roll back, leave migration 0008 applied: widening the
column is backward-compatible with the prior `en/zh` API. Roll back only to a
reviewed API/client, keep the existing push gates and encryption key, require zero
pending scripts, and ship a forward correction rather than narrowing the column or
discarding registrations.

## Family recovery navigation repair — TestFlight build 40, 21 September 2026

- App source commit
  [`d9bf542c2a8761abbdf4cb43d89133146d8e76a8`](https://github.com/github4me/my-little-days/commit/d9bf542c2a8761abbdf4cb43d89133146d8e76a8)
  removes the inert Back action from the family-access recovery screen. When a
  cached family workspace cannot yet be authorized, the screen now offers a
  non-blocking Refresh, explicit Login and a confirmed Sign out escape back to
  personal/offline mode. A slow Refresh does not disable Login or Sign out. Sign
  out discloses and permanently discards unsent family changes/private drafts;
  an unresolved create/join activation continues to block sign out so its durable
  lifecycle result can be recovered. Family data remains hidden until authority is
  verified. No Buy Me a Coffee runtime work is included.
- Local verification passed `npm run verify`, `npm run test:browser`, iOS and web
  production exports, focused family UI/navigation regressions and an independent
  code review. The new regression holds Refresh pending and confirms the recovery
  escape remains enabled, its destructive confirmation is accurate and no fake
  Back control is rendered. [Family sharing CI run 35532528433](https://github.com/github4me/my-little-days/actions/runs/35532528433)
  passed both **TypeScript and browser** and **API and SQL integration** for that
  exact source SHA.
- Before build, the Expo **production** project environment was read back against
  section 12.1: API URL, Entra tenant/client/scope and
  `EXPO_PUBLIC_FAMILY_UI_DEMO=0` all matched, with no account-level production
  overrides. The existing STORE profile, Apple team `A9974KXQ4G`, Phone, Watch and
  Widget credentials, runtime/app version **0.2.1** and disabled OTA were retained.
  No Azure, API, SQL, Entra or firewall change was required.
- Exact-source EAS build
  [`ebdc2035-ab0c-419d-a1ba-ad92880989f8`](https://expo.dev/accounts/expo4chao/projects/little-days/builds/ebdc2035-ab0c-419d-a1ba-ad92880989f8)
  finished successfully as iOS **0.2.1 (40)** from `d9bf542c...` with fingerprint
  `b19989c5146f7e32d0ea645232a2e7babe54f5b0`. Downloaded IPA inspection verified
  all three bundle identifiers and versions, the Watch companion, Widget extension
  point, Store profiles, team/application identifiers, production push entitlement,
  disabled debug access, Phone/Widget App Group and disabled Expo OTA. This is
  artifact/profile inspection, not independent cryptographic signature validation.
  IPA SHA-256:
  `7D2E24C68C74151B18581616FB1E7F4A23862422C6748EEF4C87D9DDC7C96D9B`.
- Exact-ID submission
  [`7f4e9178-9e58-4182-b6e3-dc640ee67a16`](https://expo.dev/accounts/expo4chao/projects/little-days/submissions/7f4e9178-9e58-4182-b6e3-dc640ee67a16)
  finished successfully for App Store Connect app `6809826484` with
  `--no-auto-testflight-setup`. Apple readback reports build 40 **VALID**, internal
  **IN_BETA_TESTING** and external **READY_FOR_BETA_SUBMISSION**. No tester group,
  external Beta review or public App Store release was changed. Repository
  `app.json` is aligned to build **40**.
- Physical-device acceptance remains outstanding. Update over the existing
  installation; do not uninstall a data-bearing app. Reproduce the original
  unverified-session state with a disposable account, confirm Refresh remains
  usable without hiding the two escape actions, Login can recover the same family,
  and confirmed Sign out returns to personal/offline mode without exposing cached
  family data. Also verify the data-loss warning when unsent family work exists and
  the activation-pending safety lock. Passing cloud tests and Apple processing do
  not establish those device results.

## Buy-me-a-coffee IAP setup (client implemented; Apple steps not executed)

Added 20 September 2026. The approved client implementation is present locally,
including the pinned iOS package, platform isolation, StoreKit coordinator and
support UI. No products, agreements, banking details, builds or submissions were
changed by this implementation task. See
[the implementation plan](BUY-ME-A-COFFEE-PLAN.md) for scope and acceptance gates
and [the dated validation entry](VALIDATION.md#自愿支持购买源码实现--2026-09-20本机实现未构建或发布)
for local evidence and explicit native gaps.
Do not interpret local tests as deployment evidence or as authorization to
accept financial agreements, create products at unapproved prices, or make a
real-money purchase.

1. **Preserve the baseline — GitHub `github4me/my-little-days`.** Before feature
   implementation, publish and read back the annotated tag
   `pre-buy-me-a-coffee-2026-09-20`, which currently exists locally only, pointing
   to `bc48826a7229f72a099714677c4e7b8860d499bd`. Use the GitHub plugin; if its tag
   capability remains unavailable, resolve an approved publishing method without
   opening a surprise Git credential window. Expected result: remote tag peels to
   the exact baseline SHA. Preserve unrelated worktree changes.
2. **Commercial readiness — App Store Connect, team `A9974KXQ4G` (Chao Wang).**
   Account Holder opens Business → Agreements and confirms the Paid Apps
   Agreement is Active, completing required banking and tax information privately.
   Record only the status and verification date, never banking/tax values. Verify
   the app's actual category and any historical Kids Category obligations; if
   applicable, review a parental gate before exposing purchase opportunities.
   [Apple configuration overview](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/overview-for-configuring-in-app-purchases).
3. **Products — Apps → My Little Days (`6809826484`) → Monetization → In-App
   Purchases → +.** Confirm bundle `com.littledays.babylog`. After owner approval,
   create Consumable products `com.littledays.babylog.tip.small`,
   `com.littledays.babylog.tip.coffee`, and
   `com.littledays.babylog.tip.generous`. Proposed Australian base prices are
   A$2.99/A$4.99/A$9.99; verify available price points before saving. Complete
   reference names, English/Simplified Chinese display names and descriptions,
   availability, appropriate tax category and price schedules. IDs cannot be
   changed or reused; do not create unapproved draft alternatives. Expected
   result: the approved catalog is complete and queryable by the matching bundle
   in sandbox. Allow product metadata propagation, potentially about an hour,
   before concluding a fresh configuration is broken.
   [Create consumables](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/create-consumable-or-non-consumable-in-app-purchases).
   When another app language is added, also add matching product display-name and
   description localization in App Store Connect; the client's English fallback
   is not a substitute for completed storefront metadata.
4. **Review information — each product's Review Information section.** Upload
   actual support-screen screenshots and explain the More entry, voluntary
   single payment, repeatability, no subscription/benefit, and no required app
   login. Do not expose real family records in screenshots. Verify localizations
   against Apple's field limits and complete the app's privacy declarations
   after auditing the selected SDK.
   [IAP information fields](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-information).
5. **Native sandbox candidate — local Mac build, reusing Expo project `@expo4chao/little-days`.** Freeze the
   reviewed SHA, dependency versions, native configuration and resolved production
   environment. Confirm real API URL/Entra IDs/scope and demo flag `0`; do not log
   credentials. Current `eas.json` production lacks an explicit environment field,
   so verify resolution rather than assuming preview values. Build a new iOS
   store-distribution archive, preserving main app, Watch and Widget targets and
   existing app-group settings. In Apple Developer Identifiers, verify the main
   app's existing explicit App ID and matching bundle; in the generated Xcode
   project, verify the main target's In-App Purchase capability. Explicit App IDs
   enable IAP by default; this is a verification step, not a reason to invent an
   entitlement or add Watch/Widget purchasing. Recheck the latest version/build
   before choosing the next values. Do not regenerate profiles unless actual
   capability checks require it. Use local Xcode Archive (or EAS with `--local`),
   never a cloud build unless separately approved. Upload the exact archive
   through Xcode Organizer → Distribute App → App Store Connect. Expected result:
   a finished local archive with all targets correctly
   signed, not merely a successful JavaScript export or an ad hoc preview IPA.
   [Apple App ID configuration](https://developer.apple.com/help/account/identifiers/register-an-app-id).
   Before building, confirm `package.json` still pins `expo-iap` **5.6.3** and
   excludes it only under `expo.autolinking.android.exclude`. Do not add the
   upstream `expo-iap` config plugin: at this audited version its default path
   also adds Android Billing permission/dependencies. Run
   `npx expo-modules-autolinking resolve --platform android --json` and confirm
   `expo-iap` is absent; run the same command with `--platform apple` and confirm
   it is present. On an isolated clean prebuild, inspect the Android merged
   manifest/dependency tree for no Billing/OpenIAP, and the iOS `Podfile.lock`
   for ExpoIap 5.6.3 plus openiap 3.4.0. If CocoaPods cannot resolve without the
   package's generic plugin, review a tiny iOS-only Podfile plugin; do not enable
   the generic plugin as a workaround. Standard StoreKit IAP has no app
   entitlement key—never add the Apple Pay
   `com.apple.developer.in-app-payments` entitlement. Verify the generated main
   target/profile and signed archive instead, leaving Watch and Widget targets
   unchanged.
6. **TestFlight — the same Apple app.** Submit that exact archive, then separately
   verify upload success, processing, tester-group availability and device
   acceptance. Use Apple sandbox/StoreKit test tooling for successful, cancelled,
   pending, repeated and interrupted purchases. TestFlight purchases do not
   charge, but existing family API data remains production unless verified
   otherwise; use disposable family data for lifecycle tests. Record device/OS,
   build, storefront and outcomes without receipts or private payloads.
   [Apple test environments](https://developer.apple.com/in-app-purchase/).
7. **Public release — separate approval required.** Attach the first
   consumable-type submission to a new app version and submit the app/products
   together. Verify product and app approval and availability separately; a
   TestFlight upload is not public IAP approval. A deliberate real-money smoke
   purchase needs explicit separate authorization. Apple financial reports, not
   client counters or sandbox events, determine revenue.
   [Submission rules](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase).

No Azure resource, Entra registration, API deployment or Azure SQL migration is
planned. For normal discontinuation, follow Apple's guidance to announce and stop
merchandising at least 31 days beforehand, end promotions and notify Apple. No
explicit exemption for pure tips is stated; confirm applicability with Apple.
Contact Apple if an urgent issue prevents sufficient notice. Availability changes
do not cancel unfinished transactions or fix installed code: publish a corrective
native build as needed, retain transaction recovery, do not erase family data,
and do not enable OTA as a shortcut. See
[Apple's availability/discontinuation guidance](https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/set-availability-for-in-app-purchases).
Record actual execution evidence here only after approved steps occur.

### Mac setup and preview preflight — 21 September 2026 (Melbourne)

- The Intel Mac checkout was verified clean at
  `093683b7fc885216179c9bebc152504c9a669882` on
  `feature/family-invitations`. Node `24.21.0` and npm `11.19.0` satisfy the
  repository engine range. The local ignored `.env.local` and the EAS `preview`
  environment both matched the five public section 12.1 values, including demo
  `0`; no secret value was added or printed.
- `npm ci`, `npm run verify` and `npm run export:ios` passed. Apple autolinking
  includes `expo-iap` while Android excludes it. A clean local prebuild generated
  the Phone, Watch and Widget identifiers and the Phone/Widget App Group without
  an Apple Pay entitlement. `pod install` completed with CocoaPods `1.16.2`; the
  resulting lockfile contains `ExpoIap 5.6.3` and `openiap 3.4.0`.
- Homebrew is not available on this Intel host, and its current official installer
  refused the architecture. The system Ruby `2.6.10` was left untouched. rbenv,
  Ruby `3.3.12`, Fastlane `2.240.1` and CocoaPods `1.16.2` were installed under
  `/Users/chao/.rbenv`; `/Users/chao/.zprofile` initializes rbenv. libyaml `0.2.5`
  is user-local at `/Users/chao/.rbenv/deps/libyaml`. A fresh login shell must
  report those versions before a release build.
- Xcode `26.5` (`17F42`) is installed at `/Applications/Xcode.app`; its licence
  check passes and the iOS/watchOS 26.5 device and simulator SDKs are present.
  This account could not change the global `xcode-select` path without the Mac
  administrator password, so `/Users/chao/.zprofile` exports
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. New login shells
  therefore use full Xcode even though the system-wide selector remains on the
  Command Line Tools.
- `swift test --package-path watch` passed all 21 tests. A local
  `npx expo run:ios --device "iPhone 17 Pro" --no-bundler` simulator compile
  then passed with zero errors and one duplicate-`-lc++` warning. The installed
  app contains `LittleDaysWatch.app` and `LittleDaysTodayWidget.appex` with the
  expected identifiers, the Phone/Widget App Group, StoreKit/OpenIAP resources,
  runtime `0.2.1`, and Expo updates disabled. This proves local simulator
  compilation and packaging, not signing or behaviour on physical hardware.
- EAS CLI `24.7.0` browser login completed as `expo4chao`. Readback confirmed
  project `@expo4chao/little-days`, ID
  `a5210f78-8729-46d4-82a4-7d1d40d30ac6`, and resolved preview profile
  `internal` / channel `preview` / environment `preview`, with OTA disabled.
  Recent build readback found production build `40` as the highest assigned iOS
  number, so the next candidate was prepared as build `41` in an isolated copy of
  the exact source SHA.
- No preview build was created. A noninteractive, frozen-credentials preflight
  reused the existing phone credentials but found no internal-distribution
  credential suitable for the Watch target. It stopped before queueing or
  consuming a build and did not replace any profile. EAS also reported that the
  account was already 25 builds beyond included credits with USD 5 additional
  usage so far; obtain a deliberate cost decision before retrying. If an ad hoc
  preview is still required, run interactively in the Expo project, select Apple
  team `A9974KXQ4G`, create only the missing Watch/Widget internal profiles, keep
  existing working profiles, verify the registered test devices, and use build
  number `42` or a newer unused number so it cannot be confused with the local
  production candidate below.
- The Account Holder signed in to App Store Connect. Read-only verification found
  the Free Apps Agreement **Active** and the Paid Apps Agreement **New**, with
  Apple requiring a legal-entity update before the paid agreement can be signed.
  No private legal, banking or tax details are recorded here. **My Little Days →
  In-App Purchases** is empty: none of the three consumables exists yet. The
  browser is left on that page, but the Account Holder must first update the
  legal entity and complete the Paid Apps agreement, banking and tax workflow.
  No agreement, product, price, localization, review metadata, build, submission,
  tester group or Apple entitlement was created or changed by this checkpoint.
- No physical iPhone is currently visible to `xcrun devicectl`, and the login
  keychain contains no valid Apple Development/Distribution identity or local
  provisioning profiles. After connecting the iPhone by USB (or pairing it for
  Wi-Fi), enabling Developer Mode and selecting team `A9974KXQ4G` in Xcode, use
  `npx expo run:ios --device` for a free local development build. The same native
  project includes the Watch and Widget; keep their three target identifiers and
  the shared App Group unchanged.
- The least-cost release path is local compilation: Expo CLI for repeated device
  development, and either Xcode **Product → Archive → Distribute App → App Store
  Connect** or `eas build --platform ios --profile production --local` followed
  by a TestFlight upload. A local EAS build uses Mac compute rather than an EAS
  cloud-build credit, while still contacting Expo to verify the project and
  download managed credentials. Production readback on this date matched the
  five public configuration values and resolved to `store`, `production`, remote
  credentials, auto-increment and OTA disabled. Never add `--auto-submit` until
  the generated archive has been checked and an upload is deliberately approved.
- That production path was proven from an isolated `git archive` of
  `093683b7fc885216179c9bebc152504c9a669882`. With `EAS_NO_VCS=1`, `NODE_ENV=production`,
  `--local --non-interactive --freeze-credentials` and an explicit output path,
  EAS reused the active App Store certificate and three existing profiles, bumped
  only the staged copy from build `40` to `41`, ran the 21 Watch and 6 Widget
  Swift tests, and produced the signed, unsubmitted artifact at
  `artifacts/MyLittleDays-0.2.1-local.ipa`. `codesign --verify --deep --strict`
  passed. Inspection found version `0.2.1` build `41`, the correct Phone, Watch
  and Widget identifiers, the App Group only on Phone/Widget, production push and
  TestFlight entitlements, `openiap-versions.json`, OTA disabled, and no Apple Pay
  entitlement. Upload/processing/device acceptance remain outstanding.
- macOS Tahoe 26 currently makes EAS CLI `24.7.0` falsely reject an imported
  certificate because `@expo/build-tools` calls `security find-identity -v`
  against an isolated temporary keychain. The build succeeded after applying the
  upstream-reported one-line cache workaround: remove only `-v` from
  `findIdentitiesByTeamId` in both generated `@expo/build-tools/.../keychain.js`
  copies under the active `~/.npm/_npx/<hash>/node_modules` directory. Reapply
  only if the npm cache is replaced and the exact Tahoe error returns; first
  prefer a newer EAS release once Expo ships the fix. This verifies certificate
  presence and does not alter the certificate, profile or trust settings. See
  [Expo eas-cli issue 3678](https://github.com/expo/eas-cli/issues/3678).
- Expo Doctor reported two non-blocking source-maintenance gaps during the local
  build: SDK 57's current schema rejects the legacy top-level `splash` property,
  and ten locked Expo packages are behind the SDK's current patch recommendations.
  The archive still passed. Upgrade these together in a separate tested source
  change; do not silently change the frozen release candidate.

## Native iOS migration — planned manual gates (21 September 2026)

The [native iOS migration plan](NATIVE-IOS-MIGRATION-PLAN.md) proposes replacing
the Expo phone with Swift/SwiftUI while reusing the native Watch and Widget.
**This is a future checklist, not an executed migration or authorization to change
Apple/Entra/Azure configuration.** The current application still uses Expo. All
Apple builds remain local-only under section 19's cost policy.

### A. Mac, signing and disposable-device access

1. **Location: this Mac, Xcode → Settings → Components and Accounts.** Confirm the
   installed Xcode can build for the actual iPhone/watchOS versions; install only
   missing required platform support. Select the existing Apple team
   `A9974KXQ4G`. Authentication/2FA stays in Apple's UI. Expected: usable device
   SDKs and a valid signing identity; verify with `xcodebuild -version`, device
   discovery and signing metadata, without printing private keys.
2. **Location: proposed `apple/MyLittleDays.xcodeproj` → each target → Signing &
   Capabilities.** The project is not created yet. Preserve Phone
   `com.littledays.babylog`, Watch `com.littledays.babylog.watchkitapp` and Widget
   `com.littledays.babylog.widget`. Phone and Widget use App Group
   `group.com.littledays.babylog.widgets`; Phone retains Push Notifications;
   StoreKit must not add Apple Pay. Match the existing application-identifier
   prefix/Keychain access group. Expected: a local archive containing all three
   correctly signed products. Inspect its actual profiles/entitlements; reuse
   working profiles rather than routinely replacing them.
3. **Location: Xcode → Window → Devices and Simulators; iPhone → Privacy & Security
   → Developer Mode when required.** Connect/trust the designated test phone by
   USB, pair the Watch, and optionally enable network debugging after pairing.
   Use synthetic data and a disposable test installation/device for early native
   upgrades. The same bundle ID replaces the existing app; it does not provide
   side-by-side isolation. Expected: phone Run, Watch installation and Widget
   gallery placement each verified separately. Never uninstall a data-bearing
   application as setup or troubleshooting.

### B. Public configuration and Entra compatibility

1. **Location: proposed native public configuration in `apple/Config/`.** The
   implementation should define `FamilyApiURL`, `EntraTenantID`, `EntraClientID`,
   `EntraScope` and `FamilyUIDemo`. Map them to the existing section 12.1 values;
   production demo is false. These are proposed names, not current live settings.
   Expected: the built app embeds the same HTTPS origin/tenant/client/scope.
   Verify the resolved artifact/configuration; no EAS environment download should
   be necessary for the final native build. Never include Graph, SQL, APNs,
   signing or Apple-account secrets.
2. **Location: Microsoft Entra admin center → customer tenant
   `deab2578-7cd3-4152-b5db-f430d6b638f8` → App registrations → existing mobile
   client `abce8eb9-baf9-4c17-8801-20d0716a0e4d` → Authentication.** Read back the
   existing `mylittledays://auth` redirect and current public-client/user-flow
   configuration before the native authentication spike. Do not create another
   registration or remove existing redirects. Default plan: the existing
   system-browser flow with PKCE and existing delegated scope.
3. Only if the selected supported native library demonstrably requires another
   callback: document the exact URI and platform, obtain approval, and add it to
   this same registration. Preserve the old callback for installed clients.
   Expected: disposable-account email-code sign-in returns to the native app and
   the existing API identifies the same account. Verify separately: token
   recognition, authorized `/v1/me`, SQL-backed snapshot, refresh, cancellation
   and in-place Keychain compatibility. No raw tokens/auth responses in evidence.

### C. Direct APNs — only after the compatible backend is implemented

The existing backend understands Expo tokens, not native APNs registration.
Setting an APNs key on today's deployment does not implement the migration.

1. **Location: Apple Developer → Certificates, Identifiers & Profiles → Identifiers
   / Keys, team `A9974KXQ4G`.** Verify Phone push capability and inspect an existing
   suitable APNs key's ID/topic/environment permissions. Reuse an available private
   key from protected operator storage/managed credentials. An APNs key is not an
   App Store Connect upload key. If none is recoverable/usable, stop for approval
   before creating an additional key; never revoke a shared working key.
2. **Location: GitHub → existing API/database deployment workflow and protected
   environment.** After reviewed schema/API changes and disposable SQL tests,
   deploy the additive APNs migration before the compatible API. Keep the existing
   Expo v2 routes/queue functional. APNs work must not be consumable by the old
   Expo-only worker. Verify catalog/journal/permissions and exact release SHA;
   no Bicep resize or reopening of paused infrastructure gates is required.
3. **Location: Azure portal → hosting tenant
   `7b7e6e31-a778-4334-aee2-e969fa27fd0e` → resource group
   `my-little-days-pilot-rg` → App Service `little-days-api-522fpstfbtds2` → Settings
   → Environment variables → App settings.** Proposed new configuration contract
   below must first be implemented and tested; these keys do not exist in the
   current code. Preserve all existing `Push__*`, SQL, Graph and history settings.

   | Proposed field | Initial value / handling |
   | --- | --- |
   | `ApnsPush__RegistrationEnabled` | `false` |
   | `ApnsPush__EventCreationEnabled` | `false` |
   | `ApnsPush__DeliveryEnabled` | `false` |
   | `ApnsPush__AllowAllUsers` | `false` |
   | `ApnsPush__AllowedUserIds__0`, `__1`, … | Approved disposable customer account IDs only, recorded privately |
   | `ApnsPush__TeamId` | `A9974KXQ4G` |
   | `ApnsPush__Topic` | `com.littledays.babylog` |
   | `ApnsPush__KeyId` | Existing suitable APNs key's actual identifier |
   | `ApnsPush__PrivateKeyPem` | Existing private APNs key, server-only protected input; never in Git/app/logs |
   | `ApnsPush__TokenEncryptionKey` | Persistent protected key for the new provider's token storage; do not rotate the legacy Expo encryption key |
   | `ApnsPush__SandboxEnabled` | `false`; enable only for an approved development acceptance cohort if needed |

4. Keep the existing recovery/maintenance gate authoritative for both senders.
   After compatible deployment, enable APNs registration, then event creation,
   then delivery only for the explicitly approved cohort. Keep broad rollout off.
   After each save/restart, allow bounded startup propagation and verify the
   expected API revision/capability before the next step. Do not infer SQL-backed
   readiness from an ARM result or token-only endpoint.
5. **Location: native test app's family-notification settings.** Opt in
   deliberately. Verify old Expo binding disablement and durable handoff, current
   generation/lease, no dual-provider duplicate, correct Debug sandbox versus
   TestFlight production routing, two-account delivery and actor exclusion.
   Verify Watch mirroring separately; Apple controls presentation. Record safe
   status/error metadata, not tokens or family payloads. APNs acceptance is not
   evidence the user saw the alert.
6. Stop a failing APNs rollout using `ApnsPush__DeliveryEnabled=false`, leaving
   existing Expo clients and family record operations unaffected. Do not
   down-migrate SQL or erase device/operation evidence. Retire the Expo sender
   only after old-client registrations/leases and pending work permit it; do not
   delete the Expo project or cancel a subscription as an implicit cleanup step.

### D. Native TestFlight cutover and commerce

1. Follow migration phases P0–P9 before a release candidate. Record in-place
   upgrade results with pending operations, Keychain guards, Watch commands,
   reminder cleanup and Widget scope invalidation. Use the same current API;
   preview is not an isolated production-data sandbox.
2. **Location: Xcode Organizer → Archives → Distribute App → App Store Connect.**
   Freeze the source/configuration, choose the next unused Apple build number,
   archive locally, inspect all three targets, then deliberately upload the exact
   approved archive. Local candidate `0.2.1 (41)` is already allocated in the
   earlier checkpoint; do not assume a cloud build list alone identifies the next
   number. Retain archive/dSYMs/IPA hash and upload result without private data.
3. **Location: App Store Connect → Apps → My Little Days (`6809826484`) →
   TestFlight.** Verify processing/compliance, intended tester group and any beta
   review, then iPhone/Watch/Widget installation. A new native phone app under the
   same ID is an update to this listing, not another Apple product.
4. **Location: App Store Connect → Business agreements/banking/tax and My Little
   Days → In-App Purchases.** Recheck the existing coffee checklist: complete
   Account Holder legal steps and the three existing planned consumable IDs,
   localization/pricing/review details. A local StoreKit test configuration is
   not proof of sandbox availability. Do not add Apple Pay or create replacement
   product IDs. Record sandbox purchase acceptance separately from processing.

Planning verification: source and storage/transport contracts inspected, current
local Xcode/architecture checked, official Apple/Expo/authentication documentation
reviewed. No native rewrite, APNs backend change, Azure setting, Apple credential,
upload, subscription action or device acceptance was performed in this planning
task.

## Feed and sleep conflict replacement — prepared 21 September 2026

This source change adds reviewed conflict replacement across the Expo iPhone app,
its native Watch companion and the family API. It is **not deployed** by writing
this checklist. Existing Azure, SQL, Entra, Expo and Apple resources stay in use;
there is no new service, secret, entitlement, EAS cloud build or recurring cost.
The Widget does not edit records, but its aggregate must follow the confirmed
replacement after the phone publishes a fresh snapshot.

### Schema and API release

1. **Location: this repository and GitHub → Actions → Deploy family API and
   database.** Freeze the reviewed source SHA on the trusted
   `feature/family-invitations` branch, confirm no competing release/settings
   change, and review `0009_ConflictReplacementAudit.sql`. It only adds four
   nullable `FamilyRecords` audit columns, two filtered indexes and one bounded
   JSON constraint. Never edit an applied DbUp file or enable the paused ordinary
   infrastructure apply path for this release.
2. Run the complete mobile tests, API/DbUp build and SQL-backed suites against a
   disposable SQL database. The SQL tests must exercise exact-intent replacement,
   a second race requiring re-review, cross-member timer limits, migration data
   preservation and schema drift detection. A skipped SQL suite is not release
   evidence; set `FAMILY_TEST_SQL_CONNECTION` only to a disposable test server and
   do not point tests at the live family database.
3. Dispatch the existing protected workflow for the frozen SHA. Keep EF adoption
   disabled. Apply and verify DbUp migration **0009 before the dependent API**;
   require the journal checksum, all four columns, both indexes, the check
   constraint and **zero pending scripts**. Preserve the current paid Basic SQL
   database, identities, firewall, backup policy and all existing app settings.
4. Deploy the matching API, then allow bounded startup propagation with one
   health check in flight. Verify the exact revision and authenticated
   `/v2/capabilities` plus a fresh full snapshot both report
   `conflictReplacementEnabled:true`. Generic liveness, an ARM success or an
   unauthenticated response does not prove SQL-backed family readiness.
5. Do not roll the API back after it has issued `record-conflict-v2` receipts.
   The schema is additive, but an older API does not understand that durable
   receipt action. Stop new client rollout if necessary and ship a compatible
   corrective API. Never delete receipts or family records as rollback.

### Local-only Apple build and TestFlight

1. **Location: this Mac.** Use the verified Xcode command-line selection and local
   Node/CocoaPods installation. From the frozen checkout run `npm ci`,
   `npm run verify`, `npm run export:ios`, `npx expo prebuild --platform ios
   --no-install`, `cd ios && pod install`, then compile the generated workspace.
   Confirm Phone, Watch and Widget schemes/embedded products all build. This uses
   Expo tooling as source/native generation only; it does not consume an EAS cloud
   build credit and does not bypass the family API.
2. **Location: generated Xcode workspace → Signing & Capabilities.** Reuse team
   `A9974KXQ4G`, Phone `com.littledays.babylog`, Watch
   `com.littledays.babylog.watchkitapp`, Widget
   `com.littledays.babylog.widget`, and App Group
   `group.com.littledays.babylog.widgets` on Phone/Widget. Do not replace a
   working certificate/profile without an actual signing error. StoreKit tips do
   not use Apple Pay; do not add that entitlement.
3. For quick device development, connect/trust the iPhone, enable Developer Mode
   if Xcode requests it, choose the phone in Xcode and Run. Before opening the
   installed **Debug** app, run `npx expo start --host lan --port 8081` from this
   checkout and keep that terminal running. Check the Mac's current LAN address,
   keep the iPhone on a network that can reach it, and allow local-network access
   if iOS asks. If `No script URL provided` appears, check that
   `http://<Mac-LAN-IP>:8081/status` returns `packager-status:running` in iPhone
   Safari; then reopen the app without uninstalling it. Debug has no embedded JS;
   a Release/archive build does. Verify the paired Watch installs separately and
   add the Widget from the gallery. This local development route needs no Expo
   cloud build. It still needs Apple device signing and cannot replace TestFlight
   acceptance.
4. For TestFlight, choose the next unused build number, use **Product → Archive**
   locally, inspect all three signed products/entitlements, then deliberately use
   Organizer **Distribute App → App Store Connect** for that exact archive. Record
   SHA, archive/build number, upload, Apple processing, tester availability and
   device installation as separate results. Do not publish an OTA: updates remain
   disabled and this native/server contract needs a new binary.

Mac signing checkpoint, 22 September 2026: `app.json` now declares
`expo.ios.appleTeamId=A9974KXQ4G`; a clean prebuild verified that Debug and Release
for Phone, Watch and Widget all inherit that team. The connected device inventory
shows `MyPhone` (iPhone 11). One existing App Store profile for
`com.littledays.babylog` is present, belongs to team `A9974KXQ4G` and expires in
September 2027, but `security find-identity -v -p codesigning` currently reports
zero valid local identities. A profile alone cannot sign without its matching
private key.

To finish, use **Xcode → Settings → Accounts**, sign in to the existing Apple
account privately, select **Chao Wang (Individual) / A9974KXQ4G**, then use
**Manage Certificates** to obtain an Apple Development identity only if Xcode
still reports it missing. Do not revoke the existing distribution certificate.
Open `ios/MyLittleDays.xcworkspace`, select the `MyLittleDays` target and confirm
**Signing & Capabilities → Automatically manage signing → Team A9974KXQ4G**;
verify the embedded Watch and Widget targets show the same team and their existing
bundle IDs/capabilities. Expected result: the connected iPhone Run action signs
and installs all eligible products. Verification is a successful signed device
build plus Keychain showing a valid identity; the current unsigned simulator
success is not that verification. For a local archive, reuse/import the matching
existing distribution identity or let Xcode resolve managed distribution signing
only after login; do not create replacement profiles unless Xcode gives a concrete
profile error.

Physical Debug checkpoint, 22 September 2026: after Xcode account setup,
`security find-identity -v -p codesigning` reported one valid Apple Development
identity for team `A9974KXQ4G`. Xcode built and signed `0.2.1 (40)` for the connected
iPhone 11, and the phone reported the app installed. The generated Debug app had
`ip.txt` pointing to the Mac's current LAN IP and **no** `main.jsbundle`. Initially
Metro was not listening on 8081 and the phone showed `No script URL provided` /
`unsanitizedScriptURLString = (null)`. After starting the local Expo/Metro server
on port 8081, the user confirmed that the app runs. This confirms phone Debug
launch only; Watch/Widget behavior, Release offline launch, TestFlight processing
and StoreKit sandbox acceptance remain unverified.

Local reinstall checkpoint, 22 September 2026: from the current dirty working
tree at base commit `093683b7fc885216179c9bebc152504c9a669882`,
`npx expo run:ios --device 00008030-000458143ADA402E --no-bundler
--no-install --scheme MyLittleDays` built and signed Phone, Watch and Widget with
team `A9974KXQ4G` (zero build errors). Expo's subsequent device-install step
returned `InvalidHostID`; this was not a build or signing failure. Without
uninstalling the data-bearing app, `xcrun devicectl device install app --device
F396A40C-A97F-58E3-A56C-B0DBC3D7BA5B <built MyLittleDays.app>` installed it
in place, and `xcrun devicectl device process launch --device
F396A40C-A97F-58E3-A56C-B0DBC3D7BA5B com.littledays.babylog` launched it.
The phone reported `0.2.1 (40)`, the app process was present, and local Metro
on port 8081 returned HTTP 200. The built app contains
`Watch/LittleDaysWatch.app` and `PlugIns/LittleDaysTodayWidget.appex`; their
presence is not physical Watch/Widget acceptance. This Debug installation
requires the phone to reach this Mac's Metro server. The family backup export
and conflict flows still require user-visible on-device testing, and the
server-dependent conflict replacement is not confirmed deployed.

### Physical acceptance after both releases

Use disposable accounts/records and two authorized members; preview still reaches
production data. Do not uninstall a data-bearing app, reset a family, or test
leave/removal/deletion as part of this feature check.

1. Create a feed and a sleep record, sync both devices, then edit each same record
   concurrently in both directions: iPhone A versus iPhone B, Watch versus its
   phone, and owner versus caregiver where the existing edit authorization permits
   it. Also race two members finishing the same live timer.
2. On the losing device verify the prompt identifies the current editor and shows
   current versus proposed start/end and milk amount. Check **Keep family version**,
   **Decide later**, and destructive **Replace with my change**; VoiceOver,
   Dynamic Type, Light/Night, Chinese/English and a small Watch must remain usable.
   A caregiver must not gain arbitrary permission to overwrite someone else's
   non-timer record.
3. While the replacement is pending, confirm the record list, daily totals,
   charts and Widget retain the server winner. After server acceptance plus a
   fresh snapshot, all surfaces must use the replacement and the record screen
   must show replacer, previous editor, time and before/current summary. Force a
   second concurrent edit and verify it requires a new review instead of silently
   rebasing.
4. Check offline/relaunch durability, phone-to-Watch receipt delivery, Watch
   discard/replace actions, sign-out/account switch while pending, and an older
   capability response. The older path must preserve the failed change for review
   but never expose an unverified replacement action. Record server-deployed,
   binary-built, Apple-processed and physical-device outcomes separately.

Prepared verification on this Mac: TypeScript and source tests, Watch/Widget
static tests, Swift package tests, .NET build and non-SQL API/DbUp tests pass.
SQL integration currently reports explicit skips because
`FAMILY_TEST_SQL_CONNECTION` is not configured; live deployment and physical
iPhone/Watch/Widget acceptance remain outstanding until the steps above are
deliberately performed.

### Family backup export — device acceptance (client only, 22 September 2026)

This supersedes earlier entries in this runbook that say family exports are
disabled. Current policy allows every active member to download confirmed server
records, while family-file import/restore remains disabled. In-app backup, care
help and privacy copy plus both READMEs describe the same boundary. External
saved/shared files are unencrypted, are not anonymized, and cannot be recalled
by logout, revocation or account/family deletion. The SQLite OS-backup exclusion
does not cover them. No App Store Connect text or externally hosted privacy
policy was published by this source update.

No Azure, SQL, Entra or Expo configuration change is required for this read-only
client feature. It uses the existing authenticated v2 snapshot endpoint; do not
start an EAS cloud build. The generated family file is **not** an import or a
server restore. Source changes still need a new signed native build for release
because OTA is disabled; a local Xcode Debug build with Metro is sufficient for
development checks.

1. **Location: a disposable family on two signed-in iPhones.** After creating
   the family from the reviewed admin seed, let the owner and a caregiver each
   open **My → Backup and restore**. Confirm both can tap **Download and export
   family backup** and see the system share sheet. Save into a private Files
   location for this test, then remove only these test copies when done. Do not
   export a real family's data into chat, Git, logs or test fixtures.
2. Add one safe test record on the other phone, wait for server confirmation,
   then export again. Verify the second JSON's `family.revision` and record set
   reflect the authorized server snapshot; inspect only synthetic data. Check
   a pending offline edit/conflict is absent and the screen states that clearly.
   Confirm the file includes profile, entries, care and extras but omits member
   emails, invitations and tokens.
3. Retry without network, after account switch/sign-out, and after removing the
   disposable member. No stale file should be offered when the fresh authorized
   request fails or its session changes. Confirm family mode offers **no import
   or restore** action. Test Chinese/English, both appearances, larger text,
   VoiceOver, and Files save/cancel. Opening a share sheet is not proof the file
   was saved; verify in Files. Do not delete the installed data-bearing app or
   restore production family data as a test.

As of this source change, automated tests cover validation and read/session
isolation; physical Files export and two-device acceptance remain outstanding.

## Coffee setup read-only follow-up — 22 September 2026

The existing App Store Connect Business page for Chao Wang was inspected without
changing or dismissing its open form. The visible Free Apps Agreement now says
**Pending User Info**, and **Legal Entity Compliance Screening** requests proof
of the legal entity name in English. This supersedes the earlier Free Apps
Agreement status, not the unverified product or Paid Apps Agreement state. No
current Paid Apps Agreement row was visible; do not treat it as Active. The
product catalog was not rechecked in this follow-up.

1. **Location: App Store Connect → Business → Agreements → Add info; existing
   team `A9974KXQ4G`.** The Account Holder privately completes Apple's existing
   compliance form: passport/national-ID evidence (the page specifies a 7 MB
   maximum), Birth Country, Birth City and the applicable Public Company choice.
   Do not copy identity documents or entered values into chat, Git or this
   runbook. Expected result: Apple accepts the submission for verification;
   separately recheck the warning and agreement status after Apple's review.
   Submission alone does not prove verification is complete. The page also
   requests a DSA trader declaration for EU distribution; the Account Holder
   must supply the correct status rather than assuming trader/non-trader.
2. **Location: the same Business → Agreements page.** Follow the existing
   commercial-readiness checklist above: Account Holder acceptance of the Paid
   Apps Agreement and private banking/tax completion. Verify Active status and
   absence of unresolved required information before claiming commerce ready.
3. **Location: Apps → My Little Days (`6809826484`) → Monetization → In-App
   Purchases.** Recheck the three exact existing-code product IDs before creating
   anything. Complete only owner-approved consumable prices, availability,
   localizations and review information. A$2.99/A$4.99/A$9.99 remain proposals,
   not approved or saved prices. Then perform the existing local-build,
   sandbox/TestFlight and first-consumable App Review steps above.

The current client already loads these IDs and StoreKit-localized prices when
the support screen opens; there is no additional Expo/Azure enable switch or
BuyMeACoffee.com integration. Product readiness still needs real sandbox
verification. This follow-up did not accept agreements, upload identity
documents, create products, modify prices, build, install, upload or publish.

## Coffee deferred for the recording/family-fixes release — 22 September 2026

The user chose to release the other features and fixes without coffee purchases.
`src/support/release.ts` now sets `SUPPORT_PURCHASES_ENABLED = false`. This
source-controlled gate hides the More entry in every locale, makes controller
actions inert, and does not load the iOS store adapter, connect to StoreKit,
register its foreground listeners, fetch products or process transactions.
A stale support route returns to More. The optional-purchase privacy paragraph
is also hidden; normal privacy information and contact help remain available.

Keep the three product IDs, translations, dependency and verified-transaction
implementation for later. No transaction is consumed or deleted by this gate;
unfinished StoreKit reconciliation is deferred until an enabled build. Existing
Apple products, agreements, prices and signing resources have not been changed.
This section supersedes the assumption in the earlier setup checklist that the
current client actively loads products. It does not affect an already installed
older build.

- **Current release location:** the existing Expo checkout/branch
  `feature/family-invitations`, using the existing Apple team `A9974KXQ4G` and
  project `@expo4chao/little-days`. Keep the source switch false, build locally,
  and verify More/Privacy in Chinese/English and light/dark on the signed device
  candidate. Expected: no coffee entry/page, product loading or purchase prompt;
  the recording, family, Watch and Widget acceptance checks remain required.
  Do not enable or submit coffee products as part of this fixes-only release.
- **Later re-enablement:** after the Account Holder completes the existing
  Apple agreement/product checklist and approves coffee release, change the
  source gate in a separate reviewed change and update its regression test.
  Verify sandbox purchases and unfinished-transaction recovery, then produce a
  new local signed build. Do not add an environment/remote activation path.

No Azure/API/SQL/Entra change or paid Expo build is required for this gate.
OTA remains disabled; a new native build and separate release acceptance are
needed to deliver it. This source change does not itself archive, install,
upload, publish or alter App Store Connect.

Local verification for this gate: `npm run verify` passed type checking and
686 tests; the full browser regression and iOS Hermes/web exports passed.
Provider tests exercise iOS/Android/web with store-module loading forbidden,
inert callbacks, stale-route recovery and conditional privacy copy. Browser
checks cover the Chinese/English hidden entry and preserved contact help.
These checks do not establish signed-device behavior or App Review acceptance.

## Local fixes-only release — TestFlight build 42, 22 September 2026

- **Frozen app source:** `6cb55d8febae3972022fe8b2a908accd3145c01d` on
  `feature/family-invitations`, including `fef491ec6170ab8b867c924688180f714e005863`
  (care-save confirmation and family-import privacy feedback) and the disabled
  coffee feature. Both commits were pushed through the GitHub plugin. An isolated
  `git archive` matched all 430 tracked source files before building; the only
  release configuration difference was the staged build number, incremented to
  **0.2.1 (42)**. Build 41 remains the older, unsubmitted local candidate. The
  repository build-number baseline is now 42; choose the next unused number for
  a future build rather than rebuilding/uploading 42.
- **Verification:** 686 unit tests, TypeScript, full browser regression and iOS
  Hermes/web exports passed. Fresh isolated-source native tests passed: Watch
  **22**, Widget **6**. [GitHub CI run 69](https://github.com/github4me/my-little-days/actions/runs/35722666872)
  passed both **TypeScript and browser** and **API and SQL integration** for
  `6cb55d8f...`.
- **Environment and signing:** the signed-in Expo owner was `expo4chao`, project
  `@expo4chao/little-days` / `a5210f78-8729-46d4-82a4-7d1d40d30ac6`.
  `eas config --platform ios --profile production` resolved Store distribution,
  production channel/environment and existing remote credentials. A production
  `eas env:exec` check matched all five public values in section 12.1, including
  demo `0`. No local secrets or `.env.local` were copied into the release source.
  Apple team `A9974KXQ4G`, existing distribution certificate and all three existing
  Store provisioning profiles were reused with `--freeze-credentials`.
- **Local archive:** EAS CLI `24.7.0` with `--local --non-interactive`,
  `EAS_NO_VCS=1` and `NODE_ENV=production`; Xcode `26.5` (`17F42`), Node
  `24.21.0`, CocoaPods `1.16.2`, Fastlane `2.240.1`. The previously documented
  Tahoe cached-tool workaround was already present; no certificate/profile or
  trust setting was changed. Build completed at about `2026-09-22T11:54:15Z`.
  Expo Doctor still reports the two documented maintenance gaps (legacy splash
  schema and ten package patch recommendations); dependencies were not changed
  inside this frozen release.
- **Signed artifact inspection:** `codesign --verify --deep --strict` passed for
  Phone `com.littledays.babylog`, Watch `com.littledays.babylog.watchkitapp` and
  Widget `com.littledays.babylog.widget`, each at **0.2.1 (42)**. Verified all
  twelve locale bundles, Watch companion, Widget extension point, production
  push, disabled debug access, Store/TestFlight entitlements, unexpired Store
  profiles and the App Group only on Phone/Widget. No Apple Pay entitlement.
  Embedded Hermes JavaScript is 4,510,965 bytes with the expected production
  endpoint/identity values; OTA remains disabled, runtime `0.2.1`, coffee gate
  false. This artifact does not need Metro to obtain its JavaScript bundle.
  IPA SHA-256:
  `0a38c618bcee50d7c6000d93ef4d3c2749e7bc3134b3a2007493e3eed87b2d54`.
- **Local recovery artifacts:** ignored files
  `artifacts/MyLittleDays-0.2.1-42.ipa`,
  `artifacts/MyLittleDays-0.2.1-42.dSYM.zip` and
  `artifacts/MyLittleDays-0.2.1-42.inspection.json`. Xcode Organizer retains
  `~/Library/Developer/Xcode/Archives/2026-09-22/MyLittleDays 2026-09-22 21.47.43.xcarchive`.
  Do not commit credentials, private build logs or these generated binaries.
- **Apple submission location:** App Store Connect → Apps → My Little Days
  (`6809826484`, `com.littledays.babylog`) → TestFlight → iOS → **0.2.1 (42)**.
  Upload directly using local `xcrun altool --upload-app`, the existing
  Expo-managed App Store Connect API key for team `A9974KXQ4G`, and a temporary
  owner-readable key file removed after the uploader exits. Expected: upload
  accepted, then Apple `VALID` processing and internal `IN_BETA_TESTING` status.
  Verify these independently through Apple's build and buildBetaDetail API;
  read existing group access with `betaGroups?filter[builds]=<build-id>` (Apple
  allows only one relationship filter here). Do not replace signing resources
  or create another Expo/Apple project.
- **Upload result:** Apple's local uploader returned **UPLOAD SUCCEEDED with no
  errors** at `2026-09-22T11:57:58Z`, delivery UUID
  `985a6b71-b789-4de9-a7ec-8357a934fb53`, for the exact inspected 16,951,888-byte
  IPA. The temporary upload key file was removed after success; EAS also removed
  its temporary signing keychain and imported profiles after the local build.
  No credential was committed or placed in `.env.local`.
- **Processing checkpoint (`2026-09-22T12:03Z`):** Apple's filtered builds API
  had not yet returned build 42 after the successful upload. Processing,
  compliance and tester availability are therefore **not yet verified**. Do not
  upload the same IPA again merely because initial ingestion has not appeared.
  Before declaring TestFlight ready, read back this build's Apple ID, `VALID`
  processing state, internal/external beta states and existing group access.
  Existing groups are `Team (Expo)` and `Early Birds` (internal, all builds),
  plus `Outside birds` (external); no group membership or Beta App Review
  submission was changed. The previous build 40 remains available while Apple
  processes the new upload.
- **Scope and acceptance:** no EAS cloud build/Workflow, EAS cloud submission,
  Azure/API/SQL/Entra deployment, IAP creation, agreement acceptance, tester
  invitation or public App Store release is part of this operation. Physical
  iPhone/Watch/Widget acceptance remains outstanding. Update over the existing
  installation via TestFlight, without uninstalling. Check cold launch with
  Metro stopped, Chinese/English and light/dark coffee hiding, care-save feedback,
  family export/import restrictions, synchronization, Watch recording and Widget
  refresh. Artifact inspection and Apple processing do not prove those behaviors.

## Compact calendar toolbar — local TestFlight build 43, 22 September 2026 UTC

- **Source:** `07ed2ed66feab247699df56c2ab0f65994cbeda5` on
  `feature/family-invitations`, committed and pushed through the GitHub plugin.
  Records calendar now groups the existing period/type controls in one 1-point
  semantic border with adaptive surface, 14-point corners and 4-point inset.
  Button order, labels/translations, 44-point targets, filtering and large-text
  fallbacks are unchanged. Coffee remains disabled. No API/schema change.
- **Local verification:** TypeScript and **689 tests**, full browser regression
  (including every selectable language's calendar toolbar at 320-point width),
  and six isolated Apple-guidance browser scenarios passed. The latter cover
  Chinese/English, 320/375/390/768 widths, light/dark and increased contrast.
  Light and dark screenshots were inspected. Fresh frozen-source Swift suites
  passed **22 Watch** and **6 Widget model** tests. The final test-log wording
  reports the dynamic scenario count rather than the obsolete capture count;
  this reporting-only follow-up does not change the archived app.
- **Remote verification:** [Family sharing CI](https://github.com/github4me/my-little-days/actions/runs/35736608635)
  passed both **TypeScript and browser** and **API and SQL integration** for the
  exact frozen app source `07ed2ed6...`.
- **Freeze and configuration:** all **431** tracked files in the isolated
  `git archive` matched the source SHA before building. EAS auto-increment changes
  only the staged iOS build number from 42 to **43**; version/runtime remain
  **0.2.1**, OTA disabled. Production readback again verified Expo owner
  `expo4chao`, project `a5210f78-8729-46d4-82a4-7d1d40d30ac6`, Store distribution,
  channel/environment `production`, exact five public variables from section
  12.1 and demo `0`. Browser acceptance instead used an isolated no-service web
  export (`EXPO_NO_DOTENV=1`, empty public API/auth values); `.env.local` was not
  edited or copied into the release archive.
  The builder applies the existing `.easignore` exclusions for `server/` and
  `docs/FAMILY-SHARING-TECH-PLAN.md`. Expo prebuild rewrites only the generated
  copy's `android`/`ios` launch scripts to `expo run:android`/`expo run:ios`;
  dependency versions and lockfile must still match the frozen input. Account
  for these exact expected transformations when comparing builder inputs, not
  arbitrary missing files or package changes.
- **Build path:** local EAS CLI `24.7.0` with `--local --non-interactive
  --freeze-credentials`, `EAS_NO_VCS=1`, `NODE_ENV=production`. Same Xcode
  `26.5` (`17F42`), Node `24.21.0`, CocoaPods `1.16.2` and Fastlane `2.240.1`.
  Existing Apple team `A9974KXQ4G`, three Store profiles and certificate are
  reused. The previously documented Tahoe cached-tool workaround and Expo
  Doctor maintenance warnings remain; no dependency upgrade or signing-resource
  replacement is part of this UI release.
- **Archive and inspection result:** local build succeeded at about
  `2026-09-22T14:11:44Z` (23 September, 00:11 Melbourne). Strict deep signature
  verification passed for Phone, Watch and Widget, each **0.2.1 (43)**, using
  the same profile UUIDs as build 42. Verified all 12 locale bundles, companion
  and extension identifiers, Store profiles, production push, disabled debug
  access, App Group only on Phone/Widget, and no Apple Pay entitlement. The
  4,511,142-byte embedded Hermes bundle contains the new toolbar and expected
  production configuration; OTA is disabled and coffee remains off. Inspection
  matched all **431** staged tracked files and **353** packaged files, allowing
  only the exact transformations/exclusions above. IPA size: **16,952,163 bytes**;
  SHA-256 `7ff43985aa95e711f8a2dcb0a4f991d95bfdb690b71e607e5aae3e147739b0c8`.
  Ignored recovery files: `artifacts/MyLittleDays-0.2.1-43.ipa`,
  `artifacts/MyLittleDays-0.2.1-43.dSYM.zip` and
  `artifacts/MyLittleDays-0.2.1-43.inspection.json`. Xcode Organizer retains
  `~/Library/Developer/Xcode/Archives/2026-09-23/MyLittleDays 2026-09-23 00.02.28.xcarchive`.
  EAS removed its temporary signing keychain and imported provisioning profiles
  after the successful local build.
- **Apple location and sequence:** App Store Connect → Apps → My Little Days
  (`6809826484`) → TestFlight → iOS → **0.2.1 (43)**. After strict IPA signature,
  target/configuration and embedded-JavaScript checks, upload that exact file via
  local `xcrun altool` using the existing managed submission key. Then separately
  verify Apple's build ID/processing and beta states. Keep tester groups and
  agreements unchanged. The preflight now confirms previous build 42 is `VALID`
  and `IN_BETA_TESTING` internally/externally, with its existing three groups;
  this supersedes its earlier ingestion-pending checkpoint.
- **Upload result:** local `altool` returned **UPLOAD SUCCEEDED with no errors**
  at `2026-09-22T14:15:40Z` (23 September, 00:15 Melbourne), delivery UUID
  `0dbd42ea-dde9-449b-a65b-ae724e1f21fa`, for the exact inspected
  16,952,163-byte IPA. The temporary owner-readable submission key file was
  removed after upload. This is upload acceptance, not yet proof of Apple
  processing or tester availability; do not re-upload because ingestion takes
  time.
- **Initial processing checkpoint (`2026-09-22T14:16Z`):** the filtered Apple
  builds API had not yet listed build 43. Keep processing/compliance/tester access
  pending until a later readback reports this exact build's state. Existing build
  42 remains available; no tester groups, external review or public release were
  changed by this submission.
- **Acceptance boundary:** local archive/signature verification, Apple upload,
  processing, tester access and physical acceptance are distinct. No EAS cloud
  build/Workflow or cloud submission, infrastructure deployment, IAP enablement,
  new tester invitation or public App Store release is requested. The repository
  baseline is advanced to 43 to avoid build-number reuse. On the eventual signed
  TestFlight update, verify the toolbar in both appearances, Chinese/English,
  largest text sizes and VoiceOver, plus normal Phone/Watch/Widget recording and
  refresh. Do not uninstall a data-bearing app; physical acceptance is pending.
