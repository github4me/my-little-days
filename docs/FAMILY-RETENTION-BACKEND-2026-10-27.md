# Family collaboration and account-retention backend — 27 October 2026

## Authorized scope

The owner explicitly requested backend deployment without waiting for the
previously identified account-deletion wording update. That wording is unchanged
by this release. The 26 October coordinated-copy hold is therefore no longer a
deployment blocker; it remains a documented wording gap, not a claim that the
copy matches. No Apple submission, mobile build, privacy page or resource-tier
change is part of this operation.

Deploy account retention together with the already-published family
collaboration implementation: active members can edit/delete shared records;
marked saves use last successful server save wins, and the first successful
deletion leaves a tombstone that later saves cannot resurrect. Legacy unmarked
operations retain their existing compatibility behavior.

Account deletion revokes the account and removes its access/operational data,
but retains shared family records, current content, conflict summaries and
tombstones for remaining members. Matching account-attribution fields are
anonymized. Whole-family closure remains a distinct lifecycle operation.

## Frozen release preparation

Base: `86841a7c5909cbe06d538907bc95f3a6ccdfe36d` on
`feature/family-invitations`. Overlay only these reviewed backend/test files:

- `server/LittleDays.FamilyApi/DeletionWorker.cs`
- `server/LittleDays.FamilyApi/FamilyService.cs` (comment only)
- `server/LittleDays.FamilyApi.Tests/FullHistoryDeletionSqlTests.cs`
- `server/LittleDays.FamilyApi.Tests/LifecycleSqlTests.cs`

No new/changed SQL migration or API response shape is required. Unrelated local
app/widget/HTTP sample changes are excluded. Publish through the GitHub plugin
with an expected-head lease, preserving the dirty local working tree.

## Deployment procedure and safeguards

Target: reticle.com.au tenant `7b7e6e31-a778-4334-aee2-e969fa27fd0e`, subscription
`4768a858-f23f-4a39-bb64-eabc9c142627`, resource group
`my-little-days-pilot-rg`; existing App Service
`little-days-api-522fpstfbtds2` and database `little-days-family` on
`little-days-sql-522fpstfbtds2`.

Fresh GitHub environment checks found `family-pilot` and `family-database`
restricted to the trusted branch, with required reviewers and wait timers
disabled and administrator bypass allowed. Their OIDC identities, tenant,
subscription and target names match the existing deployment. Deployment and
database gates are enabled. These settings were inspected, not changed.

Dispatch **Deploy family API and database** on the frozen trusted branch with
`database_bootstrapped=true`, `adopt_ef=false`. The workflow must pass full
same-revision CI (including real disposable SQL), validate the catalog and zero
pending scripts, remove only its own runner firewall rule, and deploy the exact
verified API artifact. Keep the branch head frozen until completion.

Do not invoke the paused infrastructure workflow, resize SQL, change provider
credentials/AI quotas, or remove retained operator firewall rules. Production
checks are non-destructive: no real account/family deletion and no test records
inserted into a real family. Liveness alone is not signed-in SQL readiness.

## Result

Release publication, exact-revision CI, deployment and post-deployment checks
are pending at this preparation checkpoint. Append measured results after the
workflow completes; do not interpret this document as deployment confirmation.
