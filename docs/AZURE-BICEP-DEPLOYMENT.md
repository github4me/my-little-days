# Provision the family pilot with Bicep

This provisions **hosting infrastructure only**. It does not create customer accounts, publish API code, initialize database tables, enable real-history sharing or release a mobile build. No Key Vault is used. Run the commands yourself only after reviewing the target subscription, permissions, costs and shared-plan capacity. Do not use real baby records for the current controlled pilot.

**Preferred execution is now GitHub Actions:** see [automatic checks and approved deployment](AZURE-GITHUB-INFRA.md). Relevant pushes/PRs trigger checks; configured trusted-branch pushes also preview Azure changes and queue deployment for approval. The commands below remain available locally. Do not run local and GitHub deployments concurrently. The GitHub read-only preview uses `-ReadOnlyPreview` with Azure CLI 2.76+; the ordinary local preview still uses full deployment-permission validation.

## What is created and reused

| Item                      | Initial deployment                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Existing subscription     | `4768a858-f23f-4a39-bb64-eabc9c142627` (`Azure subscription 1`)                                                                         |
| Existing App Service plan | Reuse Linux B1 `ProdRG/reticelASP`, Australia Southeast; never resize or recreate it                                                    |
| Dedicated resource group  | `my-little-days-pilot-rg` by default; never use `ProdRG` as the new target                                                              |
| Web App                   | Deterministically named `little-days-api-<suffix>`, Linux .NET 10, HTTPS/TLS, Always On, password-based publishing disabled             |
| Managed identity          | System-assigned to the new Web App; SQL database grants are a later step                                                                |
| SQL logical server        | `little-days-sql-<suffix>`, Entra-only authentication with the hosting-directory administrator you select                               |
| Database                  | `little-days-family`, General Purpose serverless, free offer only, 32 GiB maximum data, local backup, seven-day point-in-time retention |
| SQL firewall              | Individual possible outbound IPv4 addresses of the new Web App only; no all-Azure/all-Internet rule or operator IP by default           |

The new app shares the existing plan's CPU/memory with the current app. Check recent **CPU Percentage** and **Memory Percentage** before approving deployment. The plan stays at B1/one instance; this deployment does not scale it or alter the existing app.

The SQL settings explicitly request `useFreeLimit: true` and `freeLimitExhaustionBehavior: AutoPause`; there is no paid fallback parameter. If the free offer is unavailable, stop and resolve that rather than changing to paid SQL. When the monthly free allowance runs out, the database becomes unavailable until the next month. Subscription budgets/alerts are not a hard spending cap, and the existing plan still has its normal charge. Free-offer eligibility, regional availability, Azure policies and permissions are not proven by local template compilation. If this subscription already has a free-offer database in another region, check the offer's region restriction before deployment. [Microsoft free-offer guidance](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer?view=azuresql).

**Current application caveat:** the API cleanup worker queries SQL every minute when enabled. This can prevent idle auto-pause and consume the free allowance quickly. Its scheduling/cold-start behavior still needs a deliberate change and live validation before a sustainable free-tier or real-user release. Do not disable deletion processing to reduce costs. These infrastructure files do not change the API worker or waive deletion deadlines.

No Key Vault, email delivery, VNet, private endpoint, storage account, Log Analytics workspace, Application Insights resource, deployment identity or Azure role assignment is created by this template.

## 1. Supply the two missing administrator values

The Azure CLI selects the hosting directory from the target subscription. You do not need customer-login tenant/client IDs to provision hosting.

Copy [the example parameters](../infra/bicep/pilot.parameters.example.json) to `infra/bicep/pilot.parameters.local.json` (ignored by Git). Replace:

- `sqlAdministratorObjectId`: the **Object ID** of an existing hosting-directory user or group, not a subscription ID, application client ID or email address.
- `sqlAdministratorDisplayName`: its display name. Use `sqlAdministratorPrincipalType: Group` for a group, or `User` for your own initial administrator account.

Keep other defaults unless you deliberately choose different names. Resource names/suffixes are deterministic: changing the target resource group creates a different environment, not a move of the original data. Do not add passwords, Graph secrets, customer emails or app settings to this file. The script rejects unknown parameters; resource-existence flags are computed internally, not user inputs.

## 2. Validate locally

Use PowerShell 7, Azure CLI and Bicep CLI. The implementation was locally checked with Azure CLI 2.61.0 and Bicep 0.46.1; newer versions may also work. `az bicep version` checks the compiler. If absent, install it with `az bicep install` before continuing; no infrastructure is created by installing the compiler.

From the repository root:

```powershell
./infra/deploy-pilot.ps1 -Mode Validate -ParametersFile ./infra/bicep/pilot.parameters.local.json
```

The default mode is `Validate`. It checks local parameter values and compiles Bicep; it does not sign in or read/change Azure resources. The unchanged example deliberately fails until real administrator values are supplied. Local validation cannot confirm that the chosen administrator exists or that Azure will permit the deployment.

## 3. Sign in and preview the deployment

Sign in to the **hosting directory** with an authorized operator account using `az login`. This is not customer-app login. Then:

```powershell
./infra/deploy-pilot.ps1 -Mode WhatIf -ParametersFile ./infra/bicep/pilot.parameters.local.json | ConvertTo-Json -Depth 10
```

Cloud calls explicitly target subscription `4768a858-f23f-4a39-bb64-eabc9c142627`; they do not change your CLI's default subscription. A different subscription requires the explicit `-SubscriptionId` option and its own reviewed plan/resources.

The script checks the enabled subscription, required resource providers, the Linux B1/one-instance plan and region, and availability of the .NET 10 Linux runtime. On reruns it also checks target-resource ownership, Web App identity/HTTPS/runtime/TLS configuration, SQL administrator/TLS/network configuration, existing firewall rules and free-SQL settings. It does not automatically register providers, elevate permissions, grant roles or choose a paid tier. If a provider is not registered, have the subscription operator register it explicitly, then rerun the preview.

You need deployment/resource-creation permission for the new resource group and permission to attach a Web App to the existing plan in `ProdRG`. If you cannot create a resource group at subscription scope, have an administrator arrange the scoped deployment. Entra directory permissions/admin consent and SQL database access are separate from Azure resource-management roles.

Review the what-if resource list: expect only the dedicated pilot resource group, Web App, SQL server/database, publishing policies, backup-retention/firewall configuration and deployment records. **No existing-plan resize, deletion, Key Vault or paid networking should appear.** The preview uses resource-ID-only results and never reads app-setting values. What-if can show unresolved runtime values for the newly created Web App's outbound IPs; final creation and post-deployment checks still matter. [Bicep what-if](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/deploy-what-if).

## 4. Deploy only after reviewing the preview

```powershell
./infra/deploy-pilot.ps1 -Mode Deploy -ParametersFile ./infra/bicep/pilot.parameters.local.json -ApproveDeployment -ConfirmExistingPlanCapacity
```

Both switches are required. `-ConfirmExistingPlanCapacity` confirms that you reviewed capacity; it is not a load test. Deploy reruns preflight/what-if and creates the subscription deployment. Each run uses a temporary snapshot of its validated non-secret parameters and compiled template so edits to the source files during the preview cannot change what is submitted. The generated snapshots are cleaned up on exit.

Infrastructure creation is not atomic: on failure, some new resources may remain. The script stops without paid fallback, automatic resource deletion, resetting settings or retrying a different configuration. Inspect the failure and existing pilot resources before rerunning. CLI diagnostics are deliberately not printed verbatim; for a failed deployment, inspect `my-little-days-pilot` under the selected subscription's **Deployments** in Azure Portal (or your custom `-DeploymentName`). Keep deployment diagnostics private and do not export app settings or credentials to troubleshoot.

Keep the non-secret outputs: API HTTPS origin, Web App name/resource ID/managed-identity object ID, SQL hostname/database, and managed-identity connection string. These are the handoff values for later setup. No token or secret should appear in outputs.

### Repeat deployments and manual settings

The script recognizes owned pilot resources by the `managedBy: my-little-days-family-pilot` marker and validates existing configuration. It refuses unrelated resource groups/resources or existing paid/overage-enabled databases. Do not manually apply the marker to adopt an unrelated resource.

Existing Web Apps and SQL logical servers are referenced rather than PUT again; separate internal existence flags support recovery when only one was created. Publishing policies, the free-only database configuration and firewall/retention children remain template-managed. **App settings, connection strings, customer identities, `Family__HistoryId` and Graph secrets are not managed or exported by Bicep.** Enter them separately in App Service; infrastructure reruns must not clear or regenerate them. Use the wrapper instead of invoking the raw template with guessed existence flags.

This uses incremental deployment, not complete-mode deletion. Unknown manually named, broad or malformed SQL firewall rules block deployment and require separate review; the script never removes them automatically. Previously generated single-IP rules that are no longer needed can remain, so inspect them after plan/network changes and remove obsolete rules explicitly. Remove temporary operator rules after SQL initialization and before rerunning Bicep. Never add `0.0.0.0`/all-Azure access as a migration shortcut. [Existing resources](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/existing-resource), [incremental deployment behavior](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deployment-modes).

## 5. After hosting exists

Continue the [Azure setup guide](AZURE-FAMILY-PILOT-SETUP.md), using the deployment outputs instead of creating hosting resources manually:

1. Configure the customer external tenant, mobile/API registrations and email-OTP flow; grant the reviewed consent. This does not send family-invitation emails.
2. Temporarily allow your operator IP to SQL. As the hosting-directory SQL administrator, create the separate migration group/runtime contained users, apply reviewed migrations and runtime grants, then remove the temporary firewall rule. See sections 5 and 10 of the guide for migration/restore safeguards.
3. Enter non-secret server configuration, checked synthetic identities and a once-generated `Family__HistoryId` in App Service. Set the dedicated directory-deletion app credential directly there, with expiry/rotation tracking. Never put it in Bicep, Git, mobile/EAS or logs.
4. Configure the protected GitHub OIDC deployment environment and run the manual API-code deployment for a reviewed commit. Liveness alone is not proof of functioning SQL/authentication.
5. Configure the native pilot build with the API origin/customer tenant/mobile client/API scope, then complete two-iPhone login/invitation/conflict/deletion testing with synthetic data.

The existing API is a restricted bottle-feed/family-lifecycle pilot. Full-history owner migration, full-domain sharing and public verified onboarding remain separate implementation work; provisioning Azure does not activate them. [Mobile/API handoff](FAMILY-OWNER-ONBOARDING.md).
