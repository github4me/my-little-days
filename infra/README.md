# Invitation pilot operations

Follow [the Azure setup guide](../docs/AZURE-FAMILY-PILOT-SETUP.md) in order. These files are templates for an operator; adding them to Git does not provision or deploy anything.

| File                           | Use                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `mobile.env.example`           | Four public native build settings; contains no credentials                             |
| `api-appsettings.example.json` | API configuration reference; empty identity admission list deliberately fails startup  |
| `github-oidc.example.json`     | Federation subject tied to the protected `family-pilot` GitHub environment             |
| `sql-bootstrap.sql`            | Interactive Entra admin creates separate migration/runtime users in the named database |
| `sql-runtime-grants.sql`       | After migration, grants the runtime only the five pilot tables' DML permissions        |

Replace placeholders in an untracked local copy. Identity bindings include personal email addresses and must stay in restricted App Service configuration, outside Git. No template contains client secrets, SQL passwords or real invite tokens. This iteration uses explicit portal setup and reviewed SQL; Bicep automation can follow after the pilot's region, cost and networking choices are known.
