# AI concurrency and failed-output diagnostics release

18 October 2026. Owner requested: “提高至50人，并和log改动一起deploy”.
Status: implementation and release verification in progress; this document is
not evidence of deployment or diagnostic activation.

## Scope

- Raise simultaneous AI generation capacity to 50, not a limit of 50 app users.
- Use one concurrency option for the worker, process guard and shared SQL
  provider-reservation guard. Keep a single queue-polling/cleanup dispatcher and
  isolated scopes for active jobs rather than 50 independent idle pollers.
- Preserve account/hour and daily request limits, existing cost protections,
  model, Fast tier, timeouts and client polling. No hosting/SQL tier upgrade,
  paid monitoring service, provider-dashboard change or mobile release.
- Include the additive, opt-in seven-day failed-output diagnostic changes in
  [AI-FAILED-OUTPUT-DIAGNOSTICS.md](AI-FAILED-OUTPUT-DIAGNOSTICS.md). Existing app
  consent does not enable the new capture. Client consent and public disclosures
  are a separate activation prerequisite; backend deployment alone cannot make
  installed clients submit the new optional diagnostic-consent field.

## Release contract

Read-only preflight verified the existing Azure API is Running/Healthy on Linux
B1 x 1 in Australia Southeast, and has no `SleepAi__MaxConcurrentRequests`,
hourly/daily quota, tier or timeout environment override. Model remains
`gpt-6-luna`. No secret value was revealed or changed. The explicit shipped
`SleepAi:MaxConcurrentRequests = 50` therefore requires no app-setting change.

Publish only reviewed backend files and these operational documents through the
GitHub plugin, based on the current trusted remote branch rather than the older
local HEAD. Preserve unrelated mobile, Watch, widget and infrastructure edits.
Use the existing manual API/database workflow, with disposable SQL tests before
production migration 0011, catalog verification and zero pending scripts before
the dependent API is deployed. Never modify prior applied migrations.

Fifty permitted calls is a software ceiling, not a measured guarantee of fifty
fast responses. Provider limits, daily quota, SQL capacity and lifecycle-lock
contention can still constrain throughput. No real-family load test or fifty-call
paid-provider stress test is authorized by this release procedure. Existing
busy responses under cross-instance/legacy-call contention remain distinct from
cross-user data isolation.

## Verification receipt

Local validation completed with SDK 10.0.401:

`env -u FAMILY_TEST_SQL_CONNECTION /Users/chao/Applications/.dotnet/dotnet test server/LittleDays.slnx --configuration Release --no-restore`

- API: 522 passed, zero failed, 136 SQL-dependent cases skipped.
- Migrator: 27 passed, zero failed, 33 SQL-dependent cases skipped.
- The focused AI/concurrency suite separately passed 162, zero failed, 14 SQL
  cases skipped. Local skips are not production acceptance; real disposable SQL
  execution is required by the release workflow.
- Exact regression evidence: `FiftyConcurrentRequestsProceedAndFiftyFirstDoesNotSpendWithReleasedSlotReusable`,
  `FiftyProductionScopesKeepEachJobsFailurePayloadIsolatedAndClearItAfterCompletion`,
  `DispatcherHonorsFiftyOrLowerLimitReusesSlotAndDrainsAllWorkOnShutdown`, and
  `EmptyQueueUsesOneFiveSecondPollAndOnlyOneHourlyCleanup`.
- SQL gate includes `GlobalFiftyLeaseLimitIsAtomicAcrossContextsAndRejectedAttemptDoesNotSpend`,
  `ExactSevenDayBoundaryDeletesDiagnosticsButNeverFamilyRecords`, and
  `FailureDiagnosticsUpgradePreservesOldJobsAllowsLegacyInsertsAndHasVerifiedNoOp`.

Pending frozen release SHA, real-SQL workflow results, migration receipt,
deployed artifact and live readiness checks. Record these separately; generic
health is not authenticated SQL/provider acceptance.
