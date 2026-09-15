# Family-sharing operations

Start with [GitHub infrastructure setup](../docs/AZURE-GITHUB-INFRA.md): relevant pushes/PRs run local checks automatically; an enabled trusted-branch push runs read-only Azure preview, then waits for configured environment approval before deployment. Azure identities, variables and real environment protections must be set up first. The [local Bicep guide](../docs/AZURE-BICEP-DEPLOYMENT.md) remains an operator fallback. Follow [Azure activation](../docs/AZURE-FAMILY-SETUP.md) afterward for customer identity, database initialization and the separate manual API-code deployment.

Legacy `pilot` filenames, resource-group names, SQL roles, ownership tags and GitHub environment identifiers are intentionally retained. They are deployment identities, not restrictions to synthetic feeds. Renaming them could create duplicate infrastructure or invalidate existing OIDC trust. The v2 API serves complete record histories; no API code, customer registrations or credentials are installed by Bicep alone.

| File                                     | Use                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `deploy-pilot.ps1`                       | Local Validate by default; read-only WhatIf; explicitly approved Deploy with safety checks                     |
| `github-infra.ps1`                       | GitHub configuration/commit guards, read-only preview and approved apply, temporary parameters and run summary |
| `github-infra-preview-role.example.json` | Read-only metadata/what-if role reference; an authorized Azure operator must create and assign it              |
| `bicep/main.bicep`                       | Subscription deployment: dedicated RG, existing Linux B1 plan, Web App/identity and free-only SQL              |
| `bicep/pilot.parameters.example.json`    | Non-secret input reference; copy to ignored `pilot.parameters.local.json` and fill SQL admin values            |
| `tests/*.Tests.ps1`                      | Compiled-template safety checks and fake-Azure deployment-wrapper tests; no Azure login needed                 |
| `mobile.env.example`                     | Four public native build settings; contains no credentials                                                     |
| `api-appsettings.example.json`           | Directory admission and deletion settings; keep credentials blank in source, artifacts and logs               |
| `github-oidc.example.json`               | Federation subject tied to the protected `family-pilot` GitHub environment                                     |
| `sql-bootstrap.sql`                      | Interactive Entra admin creates separate migration/runtime users in the named database                         |
| `sql-runtime-grants.sql`                 | After migration, grants scoped DML and content-table DELETE for the cleanup worker                             |

Replace non-secret placeholders in an untracked local copy. Keep both `GraphClientSecret` values blank in tracked templates and local copies; enter actual secrets directly in the server-side App Service settings `Admission__GraphClientSecret` and `AccountDeletion__GraphClientSecret`, alongside their client IDs. Explicit credential reuse is supported if intentionally configured. Exclude credentials from mobile/EAS configuration, Git, build/deployment artifacts and logs. Bicep deliberately does not manage/export app settings or connection strings; repeat deployments use existing Web App/SQL-server references to preserve separately configured values. Customer identity setup, reviewed SQL and protected GitHub code deployment remain separate steps.

No Key Vault is required. Restrict App Service configuration and deployment access, record Graph secret expiry, and rotate manually before expiry; verify admission and deletion after rotation. Apply the full-domain migration before the updated runtime grants. Release admission is `Directory`, not a per-person allowlist. Configure an actual email-OTP-only customer flow before setting `Admission__EmailOtpOnly=true`; this flag cannot configure or independently prove the tenant flow. Startup fails closed when release credentials or required settings are missing. Static admission remains only for compatibility fixtures.

Local infrastructure checks (PowerShell 7, Azure CLI/Bicep installed):

```powershell
./infra/tests/bicep.Tests.ps1
./infra/tests/deploy-pilot.Tests.ps1
./infra/tests/github-infra.Tests.ps1
node --test infra/tests/github-workflow.test.cjs
```

The free-SQL option pauses at monthly exhaustion and can have cold-start latency. Cleanup now runs at startup and every 120 minutes by default (configurable 120–1440); access revocation is synchronous, but content/directory erasure remains pending on failure and is retried. Do not disable cleanup as a cost workaround. This setup makes no free-tier performance, availability or monthly-cost guarantee; measure usage and existing B1 capacity before wider rollout.

Plan preflight now reads documented ARM properties and reports the specific mismatched field. It still requires the approved Linux B1 / one-instance / Australia Southeast plan and never resizes it. A missing health field fails closed; rerun preview to obtain the actual diagnostic rather than assuming the earlier combined error proved a specific cause.
