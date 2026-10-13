# AI backend deployment — 13 October 2026

## Scope and release target

Owner request: deploy and test without repeating retention or spending-cap
checks. Deploy with AI disabled; do not mark provider gates verified, send real
child data, change credentials, provision services, or release a mobile build.

Publish only the seven AI runtime files, two AI test files, synthetic HTTP
fixture, AI integration documentation and this release record. Preserve the
unrelated dirty mobile/Watch/UI checkout. Include the narrowly scoped database
post-apply verification fix and its regression tests.

Reviewed parent: `43e7885257cd18c9d97ad2766c6124a6aec4aadf` on
`feature/family-invitations`. Latest previous deployment visible in GitHub:
`1b32e13953d545bb929f1a1a50836c25a773881a`, run `35513415777`.
Publishing, dispatch, SQL migration, API deployment and signed-in acceptance
are separate checkpoints; none is inferred from local tests.

Existing target (no new Azure resources):

- Tenant: `7b7e6e31-a778-4334-aee2-e969fa27fd0e`.
- Subscription: `4768a858-f23f-4a39-bb64-eabc9c142627`.
- Resource group: `my-little-days-pilot-rg`.
- App Service: `little-days-api-522fpstfbtds2`, production/no slot.
- API: `https://little-days-api-522fpstfbtds2.azurewebsites.net`.
- SQL: `little-days-sql-522fpstfbtds2` / `little-days-family`.

## Live GitHub configuration readback

In repository Settings → Environments, both `family-pilot` and
`family-database` allow only `feature/family-invitations`, have no required
reviewers or wait timer, and allow administrator bypass. No protection was
changed. Do not expect a human-approval pause after dispatch.

The pilot URL/app/tenant/subscription match the target above;
`FAMILY_PILOT_DEPLOY_ENABLED=true`. Database server/name/group/tenant/subscription
match; `FAMILY_DB_MIGRATIONS_ENABLED=true`. Identity bindings remain
`aed2ef4a-881b-47c0-9423-304b7bf3f42a` (API) and
`f122630b-8e09-4aa1-a6c4-1bb122945afb` (migration).
Repository `FAMILY_INFRA_BRANCH=feature/family-invitations`,
`FAMILY_INFRA_ENABLED=false`; environment `FAMILY_INFRA_APPLY_ENABLED=false`.
These values were read, not changed.

## Database prerequisite and recovery

AI adds no schema, but the current committed base includes conflict replacement
and timer-completion support plus immutable migration `0009`. It adds four
nullable audit fields, a bounded JSON constraint and two filtered indexes.
Scripts `0001`–`0008` are unchanged. Apply schema before the API; this is not
an AI-only/no-migration upgrade from the last deployed revision. The new API
advertises conflict-replacement support independently of AI flags.

The existing workflow checks checksums/catalog, applies reviewed pending scripts
transactionally, and removes only its exact runner-IP firewall rule. The new
post-apply check must validate the final catalog and report exactly
`Pending database scripts: 0`; a missing, nonzero or duplicate result or a
nonzero check exit blocks API deployment. No broad firewall fallback is allowed.

Once `record-conflict-v2` receipts exist, do not routinely roll back to
`1b32e13`; use a compatible forward fix, preserving receipts and data. AI's own
kill switch remains `SleepAi__Enabled=false`.

## Local verification

Command:

```sh
env -i HOME=/Users/chao PATH=/usr/bin:/bin:/usr/sbin:/sbin DOTNET_ROOT=/Users/chao/Applications/.dotnet /Users/chao/Applications/.dotnet/dotnet test server/LittleDays.slnx --configuration Release --no-restore --verbosity minimal
```

- FamilyApi.Tests: Passed 240, Failed 0, Skipped 112.
- DatabaseMigrator.Tests: Passed 9, Failed 0, Skipped 28.
- SQL-only skips are outstanding locally, not passes; deployment CI must run
  them against its disposable SQL Server before any production migration.
- Workflow/action-pin checks: 18 passed, 0 failed.
- Focused regression command: `/tmp/little-days-pwsh-x64.4vfcUr/pwsh -NoLogo
  -NoProfile -File infra/tests/github-database.Tests.ps1`; PASS: 41 migration
  firewall cases plus two cleanup recovery checks, no Azure requests. New cases
  `PostMigrationCatalogFailureBlocksReleaseAndCleansOwnRule` and
  `PostMigrationRequiresExactlyOneExplicitZeroPendingResult` cover catalog
  failure and missing/nonzero/duplicate final counts; the success case verifies
  ordering before cleanup. Used Microsoft's official portable PowerShell 7.6.6
  archive in a temporary directory, not a system-wide installation.

## Dispatch and acceptance procedure

1. Commit the scoped files with the GitHub plugin, record the exact release SHA,
   and verify the trusted branch still points to it. No force push.
2. Actions → **Deploy family API and database** → **Run workflow**, select
   `feature/family-invitations`. Set `database_bootstrapped=true` after the
   existing SQL bootstrap and migration review; keep `adopt_ef=false`.
3. Freeze the branch during the run. The workflow checks the SHA initially and
   before migration, but has no additional final deploy-job stale-SHA check.
   Recheck the frozen branch before deployment. Do not bypass failed CI/schema,
   identity/target or firewall checks.
4. Verify same-run artifacts, disposable-SQL results, final zero-pending catalog
   check, own-rule cleanup, Azure deployment result and public liveness.
5. Check the new route's authentication boundary. Signed-in capabilities should
   remain `enabled:false`. Disabled predictions return unavailable before SQL;
   that is not evidence of account/family SQL readiness. Signed-in `/v1/me` and
   dedicated synthetic-family reads remain separate acceptance if credentials
   are unavailable. Do not log tokens or private records.

Deployment state: **not dispatched yet**. No native-device acceptance is claimed.
