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

## Published revision and verification

Frozen runtime candidate: `b965493f1ba9f164d99b48698b9945721d49363e`, tree
`4c43e3f9391365b53ac3bb3c914d14c5c6239cd6`. GitHub publication changed exactly the
four files above and this report. The remote branch lease succeeded; the local
checkout/index were not reset or staged. Source archive SHA256:
`2633e865485e31e49e19eb19b1691eab598d8e31dd92f86e4b3e1a10bfce3db2`.

The deployment workflow is [run 40392392849 / deployment 33](https://github.com/github4me/my-little-days/actions/runs/40392392849).
Exact-revision .NET 10 xUnit/VSTest CI passed **API 845 and migrator 157; failed 0,
skipped 0** against disposable real SQL. No production destructive test was run.
The .NET run-tests skill informed test execution/reporting; no package upgrade
or test expectation was changed. Migration/workflow safeguard tests also passed.

API artifact 12686245659, ZIP SHA256
`4bace42c96b870c527605f9b20038a8e7966175ceab108171416ef0308be1112`.
The downloaded ZIP matches; the assembly contains the frozen candidate SHA.
Database artifact 12685660798, ZIP SHA256
`f18e370e0872b3b5ec6cf0e94a223b16702f8dc86ebdf9d1b8ab733c2a6681f7`.
Both artifacts belong to that same run and source revision.

Independent push CI [run 40392269730](https://github.com/github4me/my-little-days/actions/runs/40392269730)
passed after one unchanged browser-job retry. First attempt failed the existing
family-demo input assertion (expected 135, received 1); the retry retained the
same source and all assertions. No test was skipped or loosened.

Deployment attempt 1's browser dependency download remained unusually slow for
over 7 minutes. It was cancelled before migration/deployment, and only the
browser verification job (with its dependent jobs) was rerun on the same SHA.
The prior API/SQL success and artifact remain bound to the same release run.
No production write occurred during the cancelled attempt.

Azure read-only preflight confirms the existing B1 single-instance plan and
the non-secret `SleepAi__MaxRequestsPerInstancePerDay=1000` override. The package
retains concurrency 50 and account/hour 30; its daily default 200 is overridden by
that App Service value. No configuration was saved or changed.

## Deployment completed

Deployment 33 attempt 2 completed successfully; all five required jobs passed.
The retried browser job 121822327076 passed TypeScript/unit, Watch protocol,
browser, Apple-browser, sleep-chart and family-demo checks. It used the same
frozen source and unchanged tests. The production jobs remained gated behind
that verification; no protection was bypassed.

The migrator validated the existing catalog and journal. Pending scripts were
explicitly 0 at 20:19:56, 20:20:02 and 20:20:11 UTC on 26 October (27 October Melbourne).
The no-op completed 20:20:06 UTC. Its exact runner-IP rule
`github-db-40392392849-2` was removed 20:20:13 UTC; existing operator rules were
not removed. No immutable migration, schema, SQL tier or data reset was applied.

The deployment job downloaded artifact 12686245659 and verified its digest
against the value above before upload. Azure reports deployment
`1ca0846f-b45d-4025-8e52-be9ec9ca1f52` **Succeeded (Active)**. Package deployment
completed 20:21:18 UTC; the workflow reported success 20:21:25. Normal bounded
startup checks initially timed out, then liveness returned 200 /ok20:22:55 UTC;
there was no restart loop or second production deployment.

Independent sequential checks at 20:23:39 UTC /07:23:39 Melbourne on 27 October:

- `/health/live`: 200, `{"status":"ok"}`.
- `/health/ready`: 200, `{"status":"ready"}`.
- Anonymous `/v2/capabilities`: 401, `{"code":"unauthorized"}`.
- All three responses carry `Cache-Control: no-store`.

The same existing tenant/subscription/resources, B1 instance, database,
credentials, model/Fast, AI limits and capture configuration were preserved.
No mobile build, TestFlight upload or Apple review mutation was performed.
The owner-requested unchanged deletion wording remains unchanged. This
documentation-only completion record does not change the runtime SHA above.

## Acceptance still separate

No destructive account/family test was performed against production users.
The disposable-SQL tests establish retention/collaboration semantics; package
and health verification establish deployment/startup, not an authenticated
two-phone round trip or live account-deletion acceptance. Those native checks
remain separate. Existing older unmarked operations keep their legacy contract;
capability-aware clients must refresh their family state to use the new policy.
