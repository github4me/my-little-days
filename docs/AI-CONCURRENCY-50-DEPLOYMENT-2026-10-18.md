# AI concurrency and failed-output diagnostics release

18 October 2026. Owner requested: “提高至50人，并和log改动一起deploy”.
Status: backend deployed successfully at 05:59 UTC on 18 October 2026. Failed
output capture remains consent-gated; existing clients have not opted in.

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

The initial local validation above was followed by the real-SQL and deployment
receipts below. Generic health is not authenticated SQL/provider acceptance.

First scoped commit `c21106055947b620a3da6ac4e26890de71589fb0` failed disposable
SQL CI [39101221820](https://github.com/github4me/my-little-days/actions/runs/39101221820)
before any production release: SQL Server compiled the new-column check before
recognizing the preceding ALTER ADD. Corrected the still-unreleased script 0011
with the repository's normal `GO` batch boundary. Scripts 0001–0010 remain
unchanged. A fresh green real-SQL run is required; no failure gate is bypassed.

Corrected migration commit `cfba2b87129f0875fd53a1395aa9be190afee1b9` passed all
real-SQL migration cases (122 passed, zero skipped), and the API suite reached
656 passed / two failed / zero skipped in CI 39101423238. Both failures were a
test-only race: the next dispatcher wait could be observed before .NET completed
the previous timeout timer's disposal. The controlled test timer now exposes an
explicit disposal completion signal. Tests await it while retaining every
50-slot/reuse/shutdown assertion; replacement-timer shutdown disposal is also
asserted. Production worker behavior is unchanged by this test correction.

Final candidate: `ba389416d8ad40ae7c310af5d2b1cc80e059905f`.
[Push CI 39101725226](https://github.com/github4me/my-little-days/actions/runs/39101725226)
completed successfully: API **658 passed**, migrator **122 passed**, both zero
failed/skipped, plus TypeScript, Watch, browser, workflow and firewall checks.
The production-source files in the candidate match local reviewed files; prior
applied migrations 0001–0010 are unchanged.

Downloaded API artifact `12127176135` matched its published SHA-256
`b6eb1f9d13242d348d599ea2a80336b4cb3dd14a1e048d06edda0449c232eeb7`.
Actual shipped appsettings contain concurrency **50**, account/hour **30** and
daily **200**. App-local Pkcs **10.0.13** is present in both DLL and deps metadata;
DLL SHA-256 `eff9ed505c194f0f5c9faef1a175459cd0560eeb4ad08890c7c0c0e1ff4d34c3`
matches the previous patched baseline. No secret settings changed.

Manual [release 39101954963](https://github.com/github4me/my-little-days/actions/runs/39101954963)
was dispatched from that frozen SHA using the existing Chrome GitHub session,
trusted branch `feature/family-invitations`, `database_bootstrapped=true`,
`adopt_ef=false`. All five release jobs completed successfully at 05:59:29 UTC.

Production SQL migration job `117600523184` completed successfully:

- 05:55:22 UTC: one pending script, exactly `0011_SleepAiFailedOutputDiagnostics.sql`.
- 05:55:34 UTC: migration completed.
- 05:55:39 UTC: post-apply catalog/journal verification returned explicit
  `Pending database scripts: 0`.
- 05:55:41 UTC: this run's temporary SQL firewall rule removed; cleanup succeeded.

The manual release's own API artifact `12127176527` was independently checked:
ZIP SHA-256 `390f7b67c16200f46246dd93315dadfe4b3a2b9a9242a818862f61c4ff8f205c`
matches GitHub's digest; concurrency 50, quotas 30/200 and the patched Pkcs DLL
match the verified push artifact.

API package deployment completed at 05:56:57 UTC, OneDeploy ID
`cf39ce18-c029-4bdd-bdf7-d07f4c38aed2`. Bounded startup checks encountered a
transient timeout/502 before liveness succeeded at 05:59:25 UTC. No repeated
manual restart or simultaneous health polling was used.

Independent sequential checks at **05:59:48 UTC** confirmed:

- `/health/live`: 200, `status: ok`.
- `/health/ready`: 200, `status: ready` (recovery gate, not a SQL probe).
- Unauthenticated `/v2/sleep-prediction-jobs/capabilities`: 401,
  `code: unauthorized`; authentication was not bypassed for verification.

Deployment and software limits are verified. Authenticated device acceptance,
50 simultaneous paid-provider calls and real consented diagnostic capture were
not exercised. The current app does not send `diagnosticsConsentVersion`;
client consent/public disclosure work remains required before collecting new
failed-output payloads. Existing metadata-only timing logs continue unchanged.
No TestFlight build or paid hosting change was made.
