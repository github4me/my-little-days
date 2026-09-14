# Invitation pilot operations

Follow [the Azure setup guide](../docs/AZURE-FAMILY-PILOT-SETUP.md) in order. These files are templates for an operator; adding them to Git does not provision or deploy anything.

| File                           | Use                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `mobile.env.example`           | Four public native build settings; contains no credentials                             |
| `api-appsettings.example.json` | Server setting reference; an empty identity list admits nobody; keep the Graph secret blank |
| `github-oidc.example.json`     | Federation subject tied to the protected `family-pilot` GitHub environment             |
| `sql-bootstrap.sql`            | Interactive Entra admin creates separate migration/runtime users in the named database |
| `sql-runtime-grants.sql`       | After migration, grants scoped DML and content-table DELETE for the cleanup worker     |

Replace non-secret placeholders in an untracked local copy. Identity bindings include personal email addresses and must stay in restricted App Service configuration, outside Git. Keep `GraphClientSecret` blank in the tracked template and all local copies; enter the actual secret directly in the server-side App Service setting `AccountDeletion__GraphClientSecret`, alongside `AccountDeletion__GraphClientId`. Exclude credentials from mobile/EAS configuration, Git, build/deployment artifacts and logs. This iteration uses explicit portal setup and reviewed SQL; Bicep automation can follow after the pilot's region, cost and networking choices are known.

Key Vault is optional for this initial release. Restrict App Service configuration and deployment access, record the Graph secret's expiry, and rotate it manually before expiry; verify deletion after rotation. The revised migration must precede runtime grants. `AccountDeletion` credentials are optional only for a synthetic unconfigured test: without valid external-tenant Graph credentials, directory deletion stays pending, never completed. Configure and verify identity deletion before admitting real users. See the guide's deletion section before enabling real account deletion. Static admission bindings, configuration backups and restored SQL copies require explicit operator cleanup.
