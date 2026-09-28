# Automatic Bicep checks and approved GitHub deployment

The full family-sharing release retains existing `pilot` resource names, ownership tags and environment identifiers so existing RBAC/OIDC setup remains valid. This workflow provisions hosting only; after it succeeds follow [full Azure activation](AZURE-FAMILY-SETUP.md) for Directory admission, Graph consent and native configuration, and [database/API deployment](AZURE-DATABASE-DEPLOYMENT.md) for one-time SQL bootstrap followed by the unified DbUp/API release workflow. Do not enter customer email allowlists for the Directory release.

The **Family infrastructure** workflow runs when Bicep, its deployment helpers, infrastructure tests or this workflow change. It is separate from the manual API-code deployment workflow. No GitHub environments, Azure identities, role assignments or resources have been configured by adding these files.

## What runs automatically

| Event                                                   | Result                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Relevant pull request, including a fork                 | Compile Bicep and run local tests; no Azure login or OIDC permission                                    |
| Relevant push on any branch                             | The same credential-free checks                                                                         |
| Relevant push on the trusted branch, cloud jobs enabled | Checks, then automatic read-only Azure what-if and a run-summary preview                                |
| Successful preview                                      | Deployment waits for the configured `family-infra` environment approval                                 |
| Approved deployment                                     | Check the revision and configuration still match, then apply through the existing safety-checked script |

The trusted branch defaults to the repository's default branch, currently **`master`**. During this pilot you can deliberately set `FAMILY_INFRA_BRANCH=feature/family-invitations`, but both environment branch restrictions must then allow that exact branch. Other branches continue to receive local checks only. The current feature branch is not automatically merged into `master`.

There is also **Run workflow** for retrying after setup changes without making an artificial Bicep edit. GitHub only exposes `workflow_dispatch` after the workflow exists on the default branch. A file edit must be committed and pushed to trigger a run. Documentation-only changes do not trigger this workflow. [GitHub event rules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

## One-time setup

### 1. Create two GitHub environments first

In repository **Settings → Environments**, create:

- `family-infra-preview`: allow the exact trusted branch only; no required reviewer, so preview can run automatically.
- `family-infra`: allow the same exact branch and configure **required reviewers** for applying infrastructure. Disable administrator bypass. If someone else reviews deployments, also prevent self-review; a solo maintainer can leave self-review allowed to approve their own run.

Use **Selected branches and tags** with an exact branch rule; do not rely on “Protected branches only” without actual branch protection. The YAML environment name does **not** create reviewers or branch restrictions. Protect changes to the deployment branch and workflow files as well. Do not enable apply until these controls exist. [GitHub environment protections](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments).

Confirm the repository's plan/visibility supports required reviewers. On GitHub Free, Pro and Team, this protection is available only for public repositories. If protection is unavailable, keep apply disabled; do not replace the gate with an unchecked boolean. [GitHub availability](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

### 2. Configure two Azure OIDC identities

Use the **hosting subscription's Entra directory**, not the customer External ID directory. Give each identity its own service principal and client ID:

| Identity   | Azure access                                                                                                                                | Trusted GitHub environment |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Preview    | Subscription metadata reads plus ARM what-if/validation actions; **no resource writes**                                                     | `family-infra-preview`     |
| Deployment | Reviewed infrastructure deployment rights for the pilot, including subscription deployment/RG creation and attaching to `ProdRG/reticelASP` | `family-infra`             |

The two client IDs must be different. Do not reuse the write-capable deployment identity for preview, and do not reuse the customer account-deletion app or assume the API-code deployer's Web App-only permissions are enough.

For preview, an authorized subscription administrator can create and assign the [read-only preview role](../infra/github-infra-preview-role.example.json). It contains `*/read`, `Microsoft.Resources/deployments/whatIf/action` and `Microsoft.Resources/deployments/validate/action`, with no data-plane permissions. This allows subscription infrastructure metadata to be read; it does not grant access to baby records inside SQL. Do not additionally grant Contributor, Owner or deployment-write roles to this principal. The workflow uses **ProviderNoRbac**, which requires Azure CLI **2.76.0+** and does not require resource-write permission. Older CLIs fail rather than fall back to a more privileged preview. [Microsoft validation levels](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/deploy-what-if), [Azure's read-only preview role example](https://github.com/Azure/accelerator-bootstrap-modules/blob/main/alz/local/variables.tf).

Scope the deployment identity's role assignments to the required operations/resources. This template creates a resource group at subscription scope, so permissions only on the Web App or plan are insufficient. It also needs to enumerate pilot resources, manage SQL server/database/firewall/retention, manage the new Web App/identity/publishing policies, and join the existing plan. It does not need Owner, role-assignment management, Graph account-deletion permission or SQL data-plane grants. The workflow does not grant itself permissions, initialize SQL or modify the existing plan. Have the hosting administrator review these assignments before enabling it.

For each identity configure a federated credential with issuer `https://token.actions.githubusercontent.com` and audience `api://AzureADTokenExchange`. Bind it to the exact repository/environment subject. **Do not guess the subject from the old repository name:** current GitHub subjects may include immutable owner/repository IDs, especially after a rename. The workflow's OIDC-binding step prints only issuer, subject and audience, never the token; use those actual claims when setting up federation. The preview job can reach this step before Azure variables are complete. For the deployment subject, an initial approved run can show the binding and then safely fail its configuration check while apply is disabled. Never print the raw token or enable Azure CLI debug output. [GitHub OIDC subjects](https://docs.github.com/en/actions/reference/security/oidc), [Azure OIDC setup](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect).

### 3. Add GitHub Actions variables

Use repository **Actions variables** for the common, non-secret configuration so preview and deployment receive the same values:

| Variable                        | Value                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `FAMILY_INFRA_BRANCH`           | Optional; defaults to `master`. Use the exact branch permitted by both environments      |
| `FAMILY_INFRA_ENABLED`          | Keep absent/`false` during setup; set exactly `true` to enable trusted-branch cloud jobs |
| `AZURE_SUBSCRIPTION_ID`         | `4768a858-f23f-4a39-bb64-eabc9c142627`                                                   |
| `AZURE_TENANT_ID`               | Hosting directory's tenant ID                                                            |
| `AZURE_INFRA_PREVIEW_CLIENT_ID` | Read-only preview identity's application client ID                                       |
| `AZURE_INFRA_DEPLOY_CLIENT_ID`  | Separate deployment identity's application client ID                                     |
| `SQL_ADMIN_OBJECT_ID`           | Existing hosting-directory SQL administrator user/group Object ID                        |
| `SQL_ADMIN_DISPLAY_NAME`        | Its checked display name                                                                 |
| `SQL_ADMIN_PRINCIPAL_TYPE`      | `User` or `Group`; defaults to `User`                                                    |

Only in the **`family-infra` environment**, add:

- `FAMILY_INFRA_APPLY_ENABLED=true`, after reviewers and exact branch restrictions are configured.
- `FAMILY_INFRA_CAPACITY_CONFIRMED=true`, after reviewing spare CPU/memory on the existing B1 plan. Reassess this before approving each deployment; the flag is not a load test.

There is **no Azure client secret or Key Vault** for this workflow. Do not place customer identity bindings, Graph secrets, SQL passwords or app-setting exports in these variables or workflow inputs. The helper creates the deployment parameter file temporarily from the checked-in non-secret example and the SQL-admin variables, then deletes it. It does not upload that parameter file as an artifact.

### 4. First run and approval

1. Complete the identities, variables and environment protections. Set `FAMILY_INFRA_ENABLED=true` last (or temporarily enable just to inspect the non-secret OIDC binding, with apply disabled).
2. Push an infrastructure change to the trusted branch, or run the workflow manually after it is available on the default branch.
3. Review the **Preview Azure changes** job summary together with the exact commit diff. The summary shows resource IDs/change types, not property-level configuration differences. Runtime-dependent firewall addresses may not fully resolve before first creation. A successful read-only preview does not prove the deployer's permissions or free-offer availability.
4. Approve the waiting `family-infra` deployment only if the preview, code, capacity and cost assumptions are acceptable. It rejects an old commit when a newer trusted-branch revision exists, and rejects changes to the previewed parameter/configuration fingerprint. Review and run a fresh preview if either changed.
5. The deployment script repeats live checks and its full-permission what-if, then creates/updates infrastructure. Azure state may change after the earlier preview; this is not a Terraform-style immutable execution plan. Failed/partial deployments remain for review, with no automatic paid fallback or resource deletion.

Deployment jobs are serialized and never cancelled automatically by a newer push. Do not run the local deployment script concurrently. API deployments remain a separate workflow, so avoid changing hosting while publishing API code.

The workflow does not publish an Expo update, migrate SQL, configure customer login, rotate secrets or enable real family-history sharing. Continue [Azure activation](AZURE-FAMILY-PILOT-SETUP.md) after infrastructure exists. The [existing free-SQL limits and cleanup-worker caveat](AZURE-BICEP-DEPLOYMENT.md) still apply.

## Local checks

The GitHub runners use PowerShell 7.3+, Azure CLI 2.76+ and Bicep 0.46.1. No Azure login is required for these tests:

```powershell
./infra/tests/bicep.Tests.ps1
./infra/tests/deploy-pilot.Tests.ps1
./infra/tests/github-infra.Tests.ps1
node --test infra/tests/github-workflow.test.cjs
```

The last command uses `js-yaml` from the locked npm dependencies (`npm ci --ignore-scripts`). The existing local deployment commands remain available as an operator fallback; CI passes `-ReadOnlyPreview` only to `-Mode WhatIf`.
