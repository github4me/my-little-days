# Database migrations and API release

The database now has its own .NET 10 console project, **LittleDays.DatabaseMigrator**, using DbUp. It belongs to `server/LittleDays.slnx` alongside the API and their tests. Initial schema creation and future changes use the same numbered SQL scripts. The API uses EF Core for data access only; it cannot run migrations.

The release workflow is **Deploy family API and database** (`deploy-family-pilot.yml`):

`Reviewed commit → CI + real SQL tests → database approval → DbUp → firewall cleanup → API approval/deploy → liveness`

No new App Service, SQL database, Key Vault or permanent migration service is needed. The console runs on GitHub's runner and exits. Bicep remains a separate infrastructure workflow. No Azure database was updated merely by adding this code.

## 1. Azure: create a hosting deployment identity

In **App registrations**, in hosting tenant `7b7e6e31-a778-4334-aee2-e969fa27fd0e`, create `my-little-days-db-migrate`. Record its **Application (client) ID**. Do not reuse the customer API/mobile registration, App Service managed identity or API deployment identity. Do not create a client secret.

Under **Certificates & secrets → Federated credentials**, add the GitHub environment binding:

- Issuer: `https://token.actions.githubusercontent.com`
- Audience: `api://AzureADTokenExchange`
- Environment: `family-database`
- For this repository's previously observed immutable-ID subject format, expected subject: `repo:github4me@4475381/my-little-days@1360277237:environment:family-database`

Verify the exact subject against the release's **Recheck approved revision and show only federation binding claims** step. It prints issuer/subject/audience, never the token. If the portal's GitHub preset generates a different subject, use the custom/Other issuer form with the exact observed subject. Do not assume the older `repo:owner/repo:environment:...` form matches this repository.

## 2. Azure: allow only SQL-server firewall management

As an Azure role administrator, create the custom role from [github-database-role.example.json](../infra/github-database-role.example.json), then assign it to **my-little-days-db-migrate** at this SQL server's **Access control (IAM)** scope:

```text
/subscriptions/4768a858-f23f-4a39-bb64-eabc9c142627/resourceGroups/my-little-days-pilot-rg/providers/Microsoft.Sql/servers/little-days-sql-522fpstfbtds2
```

The role permits server read and firewall-rule read/write/delete. Its subscription `AssignableScopes` allows the role to be assigned there; **do not assign the identity at subscription scope**. No Contributor/Owner, Web App deployment or Azure role-assignment permission is needed. Azure RBAC does not constrain this role to a rule-name prefix: the reviewed helper restricts deletion to its own run's rule, so protect the identity and workflow.

These are Azure management permissions, not database login permissions. Complete step 3 too.

## 3. Azure SQL: one-time identity bootstrap

1. On `little-days-sql-522fpstfbtds2`, temporarily allow **your current public IPv4 only**. Keep Allow Azure services off.
2. Connect using SSMS or the VS Code MSSQL extension with Microsoft Entra authentication, as the configured SQL admin **Chao Wang**, to server `little-days-sql-522fpstfbtds2.database.windows.net`, database **little-days-family**, not `master`.
3. Open [sql-bootstrap.sql](../infra/sql-bootstrap.sql) and replace its three placeholders in a local, untracked copy:

   | SQL variable | Value |
   | --- | --- |
   | `@ExpectedDatabase` | `little-days-family` |
   | `@RuntimeIdentity` | `little-days-api-522fpstfbtds2` |
   | `@MigrationGroup` (legacy variable name, accepts an app identity) | `my-little-days-db-migrate` |

   Verify the runtime principal resolves to object ID `fbb9ee76-3e03-4089-a94c-3548f74ad35a`. The migration identity must resolve to the **Enterprise application/service principal**, not its app-registration object. Names must resolve uniquely in the hosting tenant. If directory resolution fails, stop and resolve the SQL/Entra lookup permission with the administrator; do not give Graph rights to the API runtime or substitute a SQL password.
4. Review and run the script. It creates the contained users and `family_pilot_runtime` role. The migration user receives `CONNECT`, `CREATE TABLE` and `CONTROL` on the dedicated database's `dbo` schema. This allows schema/data changes and per-table grants, but does not grant `db_owner` or Azure deployment rights. Treat it as a privileged identity. Runtime receives only membership in the runtime role; DbUp assigns its table permissions after creating the tables.
5. Remove your temporary operator firewall rule. Do **not** execute the old API `--migrate` command or manually run the normal runtime-grants script. They have been replaced by DbUp.

If an older migration group already exists with broader roles, review its membership/permissions separately. This bootstrap does not silently revoke someone else's access.

## 4. GitHub: protect and configure the database environment

In repository **Settings → Environments**, create **family-database**. Configure required reviewers and allow only the trusted release branch (currently `feature/family-invitations`). Environment names alone do not create approval protection. Keep migrations disabled until these controls are configured; if the repository plan does not support them, do not enable unattended privileged deployment.

Add these **environment variables**, not secrets:

| Variable | Value |
| --- | --- |
| `AZURE_SUBSCRIPTION_ID` | `4768a858-f23f-4a39-bb64-eabc9c142627` |
| `AZURE_TENANT_ID` | `7b7e6e31-a778-4334-aee2-e969fa27fd0e` |
| `AZURE_DB_MIGRATION_CLIENT_ID` | New application's client ID from step 1 |
| `FAMILY_DB_RESOURCE_GROUP` | `my-little-days-pilot-rg` |
| `FAMILY_DB_SERVER_NAME` | `little-days-sql-522fpstfbtds2` |
| `FAMILY_DB_NAME` | `little-days-family` |
| `FAMILY_DB_MIGRATIONS_ENABLED` | `true`, only after bootstrap and protection |

Keep repository variable `FAMILY_INFRA_BRANCH=feature/family-invitations`. The workflow, source and reviewed release SHA must initially match the current head of this trusted branch; it rechecks after database approval. No database password, connection-string secret or customer Graph secret is used here.

The existing **family-pilot** environment remains the API deployment gate. Configure its separate OIDC deployment identity and variables as described in [Azure setup, section 6](AZURE-FAMILY-SETUP.md#6-release-api-code-manually). Its identity needs Web App deployment rights, not SQL rights. App Service customer-auth/Graph settings must still be configured before the API can start.

## 5. GitHub: run the initial release

1. Commit/push the reviewed code and SQL files. Run from the trusted branch at its latest commit. The workflow must exist on the repository's default branch for GitHub's normal manual **Run workflow** discovery; if it is not listed, first review and merge the workflow onto the default branch. Do not bypass the trusted-branch check.
2. Under **Actions → Deploy family API and database → Run workflow**, choose the trusted branch and paste its full lowercase 40-character SHA into `release_sha`.
3. Check `database_bootstrapped` after step 3 above and SQL review. This acknowledges identity setup, **not** that schema has already been created.
4. Leave `adopt_ef=false` for the newly provisioned empty database. Use `true` only for a reviewed database already initialized with this app's historical EF migrations. Unknown tables/history fail closed; no automatic baseline or dropping/recreating the database.
5. CI builds the API and migrator from that same SHA and tests against disposable SQL Server. Approve **family-database** only after reviewing the SQL diff.
6. The helper opens one firewall rule named `github-db-<run-id>-<attempt>`, for that runner's exact public IPv4. It performs a read-only pending check, applies DbUp once, then removes its own rule. Migration and cleanup must succeed before the API job becomes eligible.
7. Approve **family-pilot**. It deploys the already-built API artifact and checks `/health/live`. Verify authenticated `/v2/capabilities`, database access and two-device family flows separately: liveness is not end-to-end acceptance.

## Future changes and failure recovery

- Add `0003_DescriptiveChange.sql`, then `0004_...` under `server/LittleDays.DatabaseMigrator/Scripts`. They are embedded automatically. Never edit, rename, delete or insert before applied migrations. Add a test for the intended schema/data behavior.
- `dbo.DatabaseMigrations` stores ordered script names, normalized SHA-256 checksums and applied timestamps. Repeated runs skip already-applied scripts. CRLF/LF checkout differences are normalized. Checksums detect changed files, not all possible out-of-band schema drift; SQL changes must remain controlled and reviewed.
- Each run uses an exclusive SQL application lock and a single transaction covering all pending scripts and journal entries. A failed run rolls back that run; it never automatically runs destructive down migrations. Scripts must be transaction-compatible: no explicit COMMIT/ROLLBACK or nontransactional operations. Split long transformations across compatible releases.
- Database changes run **before** the API is replaced. Use additive, backward-compatible changes so the existing API remains usable during deployment or after an API-deployment failure. Remove old columns only in a later reviewed release after all consumers have stopped using them. Back up/review recovery before destructive changes.
- If DbUp succeeds but the API fails, keep the successful database migration and fix/retry the compatible API release. An unchanged SHA can rerun; applied scripts are skipped. Do not edit the migration journal to force a rerun.
- The helper cleans up in `finally`, plus a workflow `always()` recovery step. A hard runner termination/network outage can still leave a firewall rule. There is no automatic expiry on Azure SQL firewall rules. A later release rejects stale `github-db-*` rules; an operator must inspect and remove **only that exact stale rule** under SQL server → Networking. Never delete the App Service outbound rules or add broad ranges as a workaround.
- Infrastructure apply and API/database releases share a concurrency group. A read-only infrastructure preview may encounter a temporary rule and stop; rerun it after cleanup. Before future Bicep apply, ensure temporary operator/runner rules are gone.

Implementation references: [DbUp journaling](https://dbup.readthedocs.io/en/latest/more-info/journaling/), [DbUp transactions](https://dbup.readthedocs.io/en/latest/more-info/transactions/), [SQL schema permissions](https://learn.microsoft.com/en-us/sql/t-sql/statements/grant-schema-permissions-transact-sql?view=sql-server-ver17).
