# Invitation pilot operations

Start with [GitHub infrastructure setup](../docs/AZURE-GITHUB-INFRA.md): relevant pushes/PRs run local checks automatically; an enabled trusted-branch push runs read-only Azure preview, then waits for configured environment approval before deployment. Azure identities, variables and real environment protections must be set up first. The [local Bicep guide](../docs/AZURE-BICEP-DEPLOYMENT.md) remains an operator fallback. Follow [Azure activation](../docs/AZURE-FAMILY-PILOT-SETUP.md) afterward for customer identity, database initialization and the separate manual API-code deployment.

| File                                     | Use                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `deploy-pilot.ps1`                       | Local Validate by default; read-only WhatIf; explicitly approved Deploy with safety checks                     |
| `github-infra.ps1`                       | GitHub configuration/commit guards, read-only preview and approved apply, temporary parameters and run summary |
| `github-infra-preview-role.example.json` | Read-only metadata/what-if role reference; an authorized Azure operator must create and assign it              |
| `bicep/main.bicep`                       | Subscription deployment: dedicated RG, existing Linux B1 plan, Web App/identity and free-only SQL              |
| `bicep/pilot.parameters.example.json`    | Non-secret input reference; copy to ignored `pilot.parameters.local.json` and fill SQL admin values            |
| `tests/*.Tests.ps1`                      | Compiled-template safety checks and fake-Azure deployment-wrapper tests; no Azure login needed                 |
| `mobile.env.example`                     | Four public native build settings; contains no credentials                                                     |
| `api-appsettings.example.json`           | Server setting reference; an empty identity list admits nobody; keep the Graph secret blank                    |
| `github-oidc.example.json`               | Federation subject tied to the protected `family-pilot` GitHub environment                                     |
| `sql-bootstrap.sql`                      | Interactive Entra admin creates separate migration/runtime users in the named database                         |
| `sql-runtime-grants.sql`                 | After migration, grants scoped DML and content-table DELETE for the cleanup worker                             |

Replace non-secret placeholders in an untracked local copy. Identity bindings include personal email addresses and must stay in restricted App Service configuration, outside Git. Keep `GraphClientSecret` blank in the tracked template and all local copies; enter the actual secret directly in the server-side App Service setting `AccountDeletion__GraphClientSecret`, alongside `AccountDeletion__GraphClientId`. Exclude credentials from mobile/EAS configuration, Git, build/deployment artifacts and logs. Bicep deliberately does not manage/export app settings or connection strings; repeat deployments use existing Web App/SQL-server references to preserve separately configured values. Customer identity setup, reviewed SQL and protected GitHub code deployment remain separate steps.

Key Vault is optional for this initial release. Restrict App Service configuration and deployment access, record the Graph secret's expiry, and rotate it manually before expiry; verify deletion after rotation. The revised migration must precede runtime grants. `AccountDeletion` credentials are optional only for a synthetic unconfigured test: without valid external-tenant Graph credentials, directory deletion stays pending, never completed. Configure and verify identity deletion before admitting real users. See the guide's deletion section before enabling real account deletion. Static admission bindings, configuration backups and restored SQL copies require explicit operator cleanup.

Local infrastructure checks (PowerShell 7, Azure CLI/Bicep installed):

```powershell
./infra/tests/bicep.Tests.ps1
./infra/tests/deploy-pilot.Tests.ps1
./infra/tests/github-infra.Tests.ps1
node --test infra/tests/github-workflow.test.cjs
```

The free-SQL option pauses at monthly exhaustion and can have cold-start latency. The current API's minute-by-minute cleanup polling still needs adjustment/validation before a sustainable free-tier or real-user release; do not disable required cleanup as a cost workaround.
