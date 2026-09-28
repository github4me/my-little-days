# Azure SQL Basic tier migration plan

**Status: deployed in place on 17 September 2026 at 09:44 UTC.** Deployment `little-days-sql-basic-20260917` succeeded. The same database is Online on paid Basic/5 DTU/2 GiB. SQL baseline comparison and infrastructure-preservation checks passed. See manual runbook section 24 for the operational record and remaining device acceptance. The old free-only infrastructure cloud gates remain disabled; do not re-enable them without section 7's integration.

**Goal:** remove SQL auto-pause/wake-up latency at a small predictable cost while preserving all family records and access decisions.

**Architecture:** change the service tier of the existing Azure SQL database in place. Keep SQL Server, the database resource/name, schema, connection string, managed identity, Entra authentication, family history ID and mobile configuration unchanged. Do not export/import data or run a new initialization migration.

**Tech stack:** Azure SQL Basic, Bicep 0.46.1, Azure CLI, PowerShell 7, existing .NET API and DbUp verifier.

**Spec:** the 17 September 2026 request to work out Bicep and a migration plan for SQL Basic; existing privacy/recovery requirements in [security remediation](SECURITY-REMEDIATION-2026-09-17.md#restore-safety--mandatory-stop-point).

## Constraints and target

| Item | Preserve / target |
| --- | --- |
| Subscription | `4768a858-f23f-4a39-bb64-eabc9c142627` |
| Hosting tenant | `7b7e6e31-a778-4334-aee2-e969fa27fd0e` |
| Resource group | `my-little-days-pilot-rg` (do not rename) |
| SQL server | `little-days-sql-522fpstfbtds2` |
| Database | `little-days-family` |
| Location | `australiasoutheast` |
| Target SKU | `name: Basic`, `tier: Basic`, `capacity: 5` DTUs |
| Storage ceiling | `2147483648` bytes (2 GiB); includes data and indexes |
| Free offer | `useFreeLimit: false`; **conversion to paid is irreversible for this database** |
| Serverless settings | Omit Gen5 family, minimum vCores, auto-pause and free-quota-exhaustion settings from the Basic target |
| Backups | Preserve local redundancy and seven-day short-term point-in-time retention |
| Network | Preserve all existing approved exact-IP rules, including the operator's administration IP; no firewall resources in this template |
| App Service | Reuse `little-days-api-522fpstfbtds2` and `ProdRG/reticelASP`; no plan resize or credentials change |

Estimated Basic database charge: **A$7.49/month** at 730 hours, based on the 17 September Australia Southeast retail rate of A$0.2463/day; excludes tax, existing API hosting and any separately approved recovery/monitoring resources. Recheck the portal estimate before approval. Basic removes SQL sleeping, not every source of latency: it has 5 DTUs, limited I/O and HDD-backed storage. It is not a promise of high-volume performance. [Retail catalogue](https://prices.azure.com/api/retail/prices?currencyCode=%27AUD%27&%24filter=serviceName%20eq%20%27SQL%20Database%27%20and%20armRegionName%20eq%20%27australiasoutheast%27%20and%20skuName%20eq%20%27B%27), [Basic limits](https://learn.microsoft.com/en-us/azure/azure-sql/database/resource-limits-dtu-single-databases?view=azuresql).

Earlier read-only management/metrics checks on 17 September found 25.5 MiB used and 32 MiB allocated, with free serverless configured for 0.5–2 vCores and 60-minute idle pause. Those are **dated observations**, not clearance to downsize later. Run fresh size and feature checks below. No live SQL inspection, provider validation, benchmark, backup restore or conversion was performed when preparing this plan.

Azure supports in-place vCore/DTU changes generally. Its free-offer documentation does not explicitly guarantee that disabling this offer and selecting Basic succeeds in one ARM request. The provided template is the **desired Basic state**, not proof of an accepted conversion route. Provider validation and deployment remain gates. If Azure rejects the combined transition, stop; investigate the exact error before authorizing any two-stage paid General Purpose transition or another migration route. **Do not silently enable paid serverless overages as a fallback.** [Purchasing-model migration](https://learn.microsoft.com/en-us/azure/azure-sql/database/migrate-dtu-to-vcore?view=azuresql), [free-offer restrictions](https://learn.microsoft.com/en-us/azure/azure-sql/database/free-offer-faq?view=azuresql).

## Files and scope

- `infra/bicep/sql-basic.bicep`: isolated resource-group-scope target; manages only the database and its seven-day backup policy. Required paid acknowledgement and target/tag parameters have no defaults.
- `infra/sql-basic-preflight.sql`: read-only live sizing, feature and aggregate baseline queries for the operator. Running it wakes paused SQL; it is not a DbUp migration.
- `infra/tests/sql-basic.Tests.ps1`: local compiled-template checks, also called by existing `infra/tests/bicep.Tests.ps1`.
- `infra/bicep/main.bicep`, `resources.bicep`, `deploy-pilot.ps1`, `github-infra.ps1` and the cloud jobs remain unchanged and **free-only**.

There is deliberately no automatic Basic apply job in this change. Merely pushing a Bicep file can trigger the existing infrastructure workflow, so disable that workflow's cloud gate before publishing/using these artifacts. The current API/database release workflow remains usable after the tier change because the SQL endpoint, schema and identities remain the same.

## 1. Freeze infrastructure changes and approve the operation

- [ ] In GitHub → `github4me/my-little-days` → **Settings → Secrets and variables → Actions → Variables**, record current infrastructure gate values, then set `FAMILY_INFRA_ENABLED=false` and `FAMILY_INFRA_APPLY_ENABLED=false`. Check environment-scoped overrides too. This does not stop the existing API.
- [ ] In **Actions → Family infrastructure**, wait for active runs to finish or cancel jobs that have not started applying. Do not interrupt an ARM operation already underway; inspect it first. Do not run the API/DbUp release concurrently with the tier change.
- [ ] Keep the normal infrastructure gate disabled after the migration until section 7 is implemented. Its current wrappers reject paid databases; do not weaken/remove that guard to make a deployment pass.
- [ ] Record approval for the Basic recurring charge, irreversible loss of free-offer eligibility, brief maintenance window, and a separate paid scale-up fallback if needed. Selecting Basic does not authorize creating copies, restoring databases, deleting resources or changing firewall rules.
- [ ] Select an operator with existing SQL-administrator access for SQL checks and management-plane permission to update this database/backup policy and create the resource-group deployment. Reuse existing hosting identities; no new customer Entra registration or client secret is needed. The read-only preview identity cannot apply changes; the DbUp identity's firewall role is not a tier-change role.

## 2. Capture the current resource and run read-only SQL checks

Use PowerShell 7 from the repository checkout. The following management-plane commands do not wake the database. Keep outputs in a restricted operator record, not public issue comments or CI artifacts. Never dump App Service settings, access tokens or connection strings.

```powershell
$ErrorActionPreference = 'Stop'
$sqlBasicSubscription = '4768a858-f23f-4a39-bb64-eabc9c142627'
$sqlBasicGroup = 'my-little-days-pilot-rg'
$sqlBasicServer = 'little-days-sql-522fpstfbtds2'
$sqlBasicDatabase = 'little-days-family'
$sqlBasicAccountJson = az account show --subscription $sqlBasicSubscription --query '{id:id,tenantId:tenantId,state:state}' --output json --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Sign in separately with the approved hosting account; do not continue.' }
$sqlBasicAccount = $sqlBasicAccountJson -join "`n" | ConvertFrom-Json
if ($sqlBasicAccount.id -ne $sqlBasicSubscription -or $sqlBasicAccount.tenantId -ne '7b7e6e31-a778-4334-aee2-e969fa27fd0e' -or $sqlBasicAccount.state -ne 'Enabled') { throw 'Wrong or disabled hosting account.' }
$sqlBasicId = "/subscriptions/$sqlBasicSubscription/resourceGroups/$sqlBasicGroup/providers/Microsoft.Sql/servers/$sqlBasicServer/databases/$sqlBasicDatabase"
$sqlBasicBeforeJson = az rest --method get --url "https://management.azure.com${sqlBasicId}?api-version=2023-08-01" --subscription $sqlBasicSubscription --output json --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Existing database GET failed; do not create a replacement.' }
$sqlBasicBefore = $sqlBasicBeforeJson -join "`n" | ConvertFrom-Json -AsHashtable
if ($sqlBasicBefore.id -ine $sqlBasicId -or $sqlBasicBefore.location -ne 'australiasoutheast' -or $sqlBasicBefore.tags.managedBy -ne 'my-little-days-family-pilot') { throw 'Unexpected target or ownership.' }
if ($sqlBasicBefore.properties.useFreeLimit -ne $true -or $sqlBasicBefore.sku.name -ne 'GP_S_Gen5' -or $sqlBasicBefore.sku.capacity -ne 2 -or $sqlBasicBefore.properties.currentServiceObjectiveName -ne 'GP_S_Gen5_2') { throw 'Source tier changed; review this plan before continuing.' }
az sql db str-policy show --subscription $sqlBasicSubscription --resource-group $sqlBasicGroup --server $sqlBasicServer --name $sqlBasicDatabase --output json --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Could not read backup retention.' }
az sql server firewall-rule list --subscription $sqlBasicSubscription --resource-group $sqlBasicGroup --server $sqlBasicServer --output json --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Could not capture firewall baseline.' }
$sqlBasicServerUrl = "https://management.azure.com/subscriptions/$sqlBasicSubscription/resourceGroups/$sqlBasicGroup/providers/Microsoft.Sql/servers/${sqlBasicServer}?api-version=2023-08-01&" + '$expand=administrators/activedirectory'
az rest --method get --url $sqlBasicServerUrl --subscription $sqlBasicSubscription --query '{id:id,administrators:properties.administrators,minimalTlsVersion:properties.minimalTlsVersion,publicNetworkAccess:properties.publicNetworkAccess}' --output json --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Could not capture administrator/network baseline.' }
```

- [ ] Verify SQL → **Compute + storage** offers Basic in this subscription/region; view only, do not save. Confirm no elastic pool, replicas/failover group, customer-managed encryption or other unplanned configuration needs special handling. The template must not reset a newly introduced feature.
- [ ] Verify SQL → **Backups / Restore** shows seven-day retention and a usable recent restore window. Record the earliest restore time and the planned pre-change UTC timestamp. Automated backup coverage is not the same as a tested restore or zero-data-loss rollback. Do not request a database copy while the source is still on the free offer; Microsoft documents that restriction.
- [ ] Connect with the existing hosting Entra SQL administrator directly to `little-days-family` and execute [sql-basic-preflight.sql](../infra/sql-basic-preflight.sql). This step wakes SQL and can consume free quota; close the client afterward. It only selects metadata/aggregates and does not shrink, delete or update anything.
- [ ] Require allocated ROWS data files ≤ 2 GiB and used data ≤ 1.5 GiB (our conservative 25% growth-headroom gate). Review all tier-dependent features; stop on any returned feature except `TransparentDatabaseEncryption`, or any memory-optimized table, columnstore index or CDC. TDE is supported on Azure SQL Basic and must remain enabled; the persisted-feature DMV is not by itself an Azure tier compatibility verdict. Do not drop features or automatically shrink files to fit. See [Azure SQL TDE](https://learn.microsoft.com/en-us/azure/azure-sql/database/transparent-data-encryption-tde-overview?view=azuresql).
- [ ] Record the DbUp journal hashes, enabled critical indexes/trigger, contained principals/role memberships/grants and zero operation-counter mismatches. Run the existing migrator in **check-only** mode using hosting Entra credentials; expected: zero pending scripts and passing schema verification. This uses **Azure CLI credentials**, not the SQL editor's login. Confirm the CLI account is the approved hosting SQL administrator (or already-authorized migration operator), and `dotnet --list-sdks` includes .NET 10. Stop for missing access; do not add privileges or automatically sign in as part of the check:

```powershell
$env:FAMILY_DB_SERVER = 'little-days-sql-522fpstfbtds2.database.windows.net'
$env:FAMILY_DB_NAME = 'little-days-family'
$env:FAMILY_DB_TENANT_ID = '7b7e6e31-a778-4334-aee2-e969fa27fd0e'
$sqlBasicCheck = dotnet run --project server/LittleDays.DatabaseMigrator --configuration Release -- --check
if ($LASTEXITCODE -ne 0) { throw 'Schema check failed; stop tier migration.' }
$sqlBasicCheck
if (@($sqlBasicCheck | Where-Object { $_ -ceq 'Pending database scripts: 0' }).Count -ne 1) { throw 'Pending scripts exist or zero-pending status was not confirmed; do not proceed.' }
```

The migrator can exit successfully **with pending scripts**; a zero exit code alone does not satisfy this gate. Do not run `--apply`, `--adopt-ef`, SQL bootstrap, or a new 0006 script solely for the tier change. Existing migrations and their hashes must remain unchanged. Approximate row counts are useful comparison evidence, not a backup or proof that all data is identical.

## 3. Performance and recovery go/no-go

- [ ] Record current phone-to-API latency for an authenticated refresh, a normal record write/retry, invitation listing and a representative full-history sync. Do not use `/health/live`, `/health/ready` or `/v1/session` as a SQL benchmark; those paths can succeed without SQL.
- [ ] Before broad rollout, benchmark Basic on an explicitly approved isolated **synthetic-data** database. Additional database cost and cleanup need their own approval; this plan creates none. Exercise a near-expected-largest family, concurrent writes, seed import, snapshots and cleanup, not only empty-table reads.
- [ ] Proposed acceptance gates: no authorization/data-integrity failures or duplicate operations, no timeouts/throttling during representative load, p95 normal read/write API latency ≤ 2 seconds, and no sustained >80% DTU/data/log-I/O utilization over 15 minutes. These are review thresholds, not provider guarantees. Large seed/snapshot requests must remain comfortably within existing client/server timeouts. If they cannot pass, choose a reviewed higher paid tier rather than claiming Basic scales to arbitrary row counts.
- [ ] If no isolated benchmark is authorized, record that limitation and obtain approval for a supervised production trial plus the paid scale-up fallback. Do not imply current serverless CPU metrics predict 5-DTU performance.
- [ ] Review [restore safety](SECURITY-REMEDIATION-2026-09-17.md#restore-safety--mandatory-stop-point). An actual restore requires independent deletion/removal/closure/ownership-decision reconciliation. That external recovery evidence is still a separate prerequisite, not provided by this Bicep or a recent backup. Stop if the operator requires tested disaster recovery before this conversion and that evidence is unavailable.

## 4. Compile, validate and preview the exact Basic target

Run local checks first (no Azure resource access):

```powershell
./infra/tests/bicep.Tests.ps1
if (-not $?) { throw 'Local Bicep checks failed.' }
```

Build the parameter file from the verified existing resource, preserving all tags. Creating this local file is not consent to deploy; `confirmPaidBasic` is an ARM guard, not a substitute for the approval in section 1. Keep the generated file and preview in a restricted temporary folder, not Git.

```powershell
$sqlBasicWork = Join-Path ([IO.Path]::GetTempPath()) ('little-days-basic-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $sqlBasicWork
$sqlBasicParameters = Join-Path $sqlBasicWork 'parameters.json'
$sqlBasicCompiled = Join-Path $sqlBasicWork 'template.json'
@{
  '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
  contentVersion = '1.0.0.0'
  parameters = @{
    sqlServerName = @{ value = $sqlBasicServer }
    databaseName = @{ value = $sqlBasicDatabase }
    location = @{ value = $sqlBasicBefore.location }
    existingDatabaseTags = @{ value = $sqlBasicBefore.tags }
    confirmPaidBasic = @{ value = $true }
  }
} | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $sqlBasicParameters -Encoding utf8
az bicep build --file infra/bicep/sql-basic.bicep --outfile $sqlBasicCompiled --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Compilation failed.' }
$sqlBasicDeployment = 'little-days-sql-basic-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
az deployment group validate --subscription $sqlBasicSubscription --resource-group $sqlBasicGroup --name $sqlBasicDeployment --template-file $sqlBasicCompiled --parameters "@$sqlBasicParameters" --validation-level ProviderNoRbac --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Provider validation failed; no fallback is authorized.' }
az deployment group what-if --subscription $sqlBasicSubscription --resource-group $sqlBasicGroup --name $sqlBasicDeployment --template-file $sqlBasicCompiled --parameters "@$sqlBasicParameters" --mode Incremental --validation-level ProviderNoRbac --result-format FullResourcePayloads --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'What-if failed; stop.' }
Get-FileHash -LiteralPath $sqlBasicCompiled, $sqlBasicParameters -Algorithm SHA256
```

Review only this database and its existing `backupShortTermRetentionPolicies/default` resource. Expected changes: Basic/5 DTU, 2 GiB maximum, free limit disabled; existing seven-day/local backup policy unchanged. Serverless properties may show removal. **Reject any Create/Delete, other target, firewall/server/app/identity change, or unexplained reset.** ARM can create a missing database; `existing` on the parent alone does not prevent that. A successful what-if does not prove the final free-to-Basic transition will be accepted. Retain the compiled template/parameters and hashes for the apply; do not recompile silently after approval.

## 5. Controlled in-place apply — only after explicit deployment approval

The commands below describe the controlled execution procedure. The 17 September deployment record is in manual runbook section 24; do not repeat the free-to-paid conversion on an already converted database.

1. Announce a quiet window. Ensure intended phone changes are synced, then stop recording during the window. Do not log out/reinstall, discard unsynced data, or generate replacement operation IDs for ambiguous writes.
2. In Azure Portal → App Service `little-days-api-522fpstfbtds2` → **Settings → Environment variables → App settings**, record the prior `Recovery__Blocked` value, set it to `true`, and apply. Do not modify any credential or connection string. This restart is part of the maintenance window.
3. Verify `/health/ready` returns `503 / recovery_blocked` and data routes are gated. Wait for existing requests/workers to drain, then stop **this Web App only** from Overview to prevent background writes. Do not stop or resize the shared App Service plan or its other app. A maintenance flag does not abort already-running operations.
4. With the API stopped and no other release/operator connected, repeat the SQL preflight, record the final baseline and UTC timestamp, and verify recovery coverage. Check for active user transactions before proceeding; stop and investigate rather than killing unknown sessions. Keep only the administrator's checking session, then disconnect it.
5. Re-read ARM metadata. It must still be the same source database, tags, free-offer state and expected configuration. Recheck the two local file hashes and the reviewed preview; changed resources/inputs require a new preview and approval.
6. Apply only the frozen resource-group template, in incremental mode:

```powershell
az deployment group create --subscription $sqlBasicSubscription --resource-group $sqlBasicGroup --name $sqlBasicDeployment --template-file $sqlBasicCompiled --parameters "@$sqlBasicParameters" --mode Incremental --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Apply failed or is uncertain. Keep maintenance in place and inspect Azure; do not retry blindly.' }
```

7. If the command times out, inspect the existing deployment and SQL operation rather than issuing another apply. If Azure rejects direct conversion, leave data intact and examine actual SKU/free-limit state. A two-stage conversion needs a separately reviewed cost/time bound; never click **Continue using with additional charges** merely to see if it fixes the problem.
8. Expect dropped SQL connections at cutover and potentially longer total preparation/maintenance time; do not promise zero downtime. Uncommitted transactions can roll back. Existing receipt-based operation IDs must be preserved when reconciling a retry. [Scaling behaviour](https://learn.microsoft.com/en-us/azure/azure-sql/database/scale-resources?view=azuresql)

## 6. Verify, reopen and observe

- [ ] Inspect `az sql db show` for the same resource: `Online`, current and requested SKU/objective `Basic`, capacity 5, maximum 2147483648, no free-offer operation. `useFreeLimit` may be omitted/null for a paid tier; it must not be true. Serverless-only properties should be absent/null or inactive, not relied on as the proof of success.
- [ ] Repeat seven-day/local backup and firewall checks. Compare tags, server/database identifiers, Entra administrator, contained runtime/migration users and permissions with the baseline. Do not re-run bootstrap to hide a mismatch.
- [ ] Run `sql-basic-preflight.sql` and DbUp `--check` again. Require the same journal hashes/schema, enabled indexes and counter trigger, zero counter mismatches, unchanged baseline counts while writers remain stopped, and no unexplained differences. No migration was expected.
- [ ] Start the same Web App while `Recovery__Blocked=true`; verify liveness works and readiness/data routes remain blocked. Do not change `Family__HistoryId` for an in-place tier change.
- [ ] If validation passes and the prior maintenance state was not already blocked for another reason, clear only the gate introduced by this operation, apply/restart, and perform authenticated two-phone refresh/sync. Verify one **intended** new record/edit propagates once; do not insert fake baby records into production. A 200 health response is insufficient.
- [ ] Confirm pending writes retain their operation IDs and reconcile once, removed members cannot regain access, invitations/membership are unchanged, and cleanup processing resumes. Do not test real account deletion without separate explicit authorization.
- [ ] Observe for 24–48 hours: API latency, 503s/timeouts, SQL DTU percentage, data/log I/O percentage, worker/session pressure and storage. Proposed alerts: >80% DTU or I/O for 15 minutes, >75% used storage, and any recurring normal-write timeout. New Azure alert resources may incur costs; review before creating them.
- [ ] Record actual completion time, Basic state, cost approval, checks, observed latency and remaining phone/recovery gaps in section 24 of the manual runbook. Keep private account/child data out of the evidence.

## 7. GitHub/Bicep steady-state follow-up (required before re-enabling infrastructure)

The existing free-only workflow must **not** be re-enabled after Basic merely by setting its flags back to true. It currently rejects paid SQL and also rejects the retained manually named operator firewall rule. Do not delete that rule to appease the older wrapper; the user explicitly retained it.

The later implementation must change these files together in one reviewed commit:

| Files | Required change / acceptance |
| --- | --- |
| `infra/bicep/main.bicep`, `resources.bicep`, parameters | Add an explicit `FreeServerless` / `Basic` profile; default remains free until migration is approved. Basic matches the isolated template exactly; no automatic profile inference or paid fallback. Preserve existing app/server references. |
| `infra/deploy-pilot.ps1` | Validate desired versus current SKU/free state; require separate explicit consent for a free-to-paid transition; allow only the approved steady-state profile afterward. Preserve and validate approved exact-IP rules, including the operator rule, without changing/removing them. Verify actual target SKU/storage/retention after apply, replacing the unconditional `freeSqlVerified` assumption. |
| `infra/github-infra.ps1`, workflow | Bind SQL profile and paid approval to the existing configuration fingerprint in preview AND apply. Make free-to-paid transitions manual-only, not an automatic trusted-branch push. Reuse the existing preview/deploy OIDC identities and restrict environments to the deployment branch. |
| `infra/tests/bicep.Tests.ps1`, `deploy-pilot.Tests.ps1`, `github-infra.Tests.ps1`, `github-workflow.test.cjs` | Test both profiles; reject missing consent, invalid SKU/size, source drift, stale configuration, broad firewall rules and unapproved conversion. Keep tests proving ordinary free deployments cannot bill paid overages. |
| `docs/AZURE-GITHUB-INFRA.md`, manual runbook | Document the chosen profile/approval variables, manual transition and post-conversion behaviour. Do not imply environment names alone enforce human review. |

After those changes pass local tests and a reviewed read-only preview, set the protected environment's explicit Basic profile, configure actual required reviewers if available, then re-enable ordinary infrastructure runs. No new SQL schema migration, EAS variables, iOS build, customer app registration or API package is required just for Basic.

## 8. Rollback / abort

**Before paid conversion:** abort without resource writes; if this operation alone enabled maintenance, restore the prior gate state and resume the existing Web App after checking source health. Do not leave it stopped accidentally.

**After successful conversion but poor performance:** keep the same live database and scale up to a separately approved paid tier (for example S0, approximately A$22.51/month at the previously checked rate). Preserve all current data and operation receipts. Review a new target/what-if first; do not run the old free-only template. If writes are already accepted, no database restore is involved.

**Failed/ambiguous apply:** inspect deployment operations and the database's actual requested/current tier and provisioning status before deciding to reopen or retry. Do not assume failure means no billing/configuration changes occurred. If the platform is mid-transition, wait for a terminal state rather than issuing competing operations.

**Data corruption or recovery requirement:** retain the live database, keep access blocked, and follow the existing independent recovery/revocation procedure. PITR produces another database and may resurrect stale deleted data or membership privileges. Do not simply swap connection strings to a backup, re-enable old members, reset history IDs, or erase the original. Free-offer rollback is not available after paid conversion; an actual restore requires separate authorization.

## 9. Verification record for this preparation

- Passed on 17 September 2026: `./infra/tests/bicep.Tests.ps1` (eight existing contracts plus the isolated Basic target compilation/contract checks).
- Passed: `./infra/tests/deploy-pilot.Tests.ps1` (83 fake-Azure cases), `./infra/tests/github-infra.Tests.ps1` (20 cases), `node --test infra/tests/github-workflow.test.cjs infra/tests/action-pins.test.cjs` (14 cases).
- Independent design review checked tier size, free-offer irreversibility, connection interruption, transactional retry safety and restore/privacy risks.
- Not executed: live SQL preflight, Azure provider validation/what-if, paid deployment, performance trial, restore drill or phone acceptance. No new cloud resources, settings or billing were changed.

Additional official references: [file-space sizing](https://learn.microsoft.com/en-us/azure/azure-sql/database/file-space-manage?view=azuresql), [backup retention](https://learn.microsoft.com/en-us/azure/azure-sql/database/automated-backups-overview?view=azuresql), [database ARM properties](https://learn.microsoft.com/en-us/azure/templates/microsoft.sql/2023-08-01/servers/databases).
