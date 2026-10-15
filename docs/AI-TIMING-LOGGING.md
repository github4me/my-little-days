# AI latency logging

15 October 2026. **Deployed; existing Azure log collection enabled.** Release
`2f4304ec0c1073eece979520b59452aa364a8c93` completed in
[workflow 38720666974](https://github.com/github4me/my-little-days/actions/runs/38720666974).
Post-startup health checks passed. No genuine AI timing sample has yet been
captured, so no live latency or bottleneck finding is claimed. No app build,
schema change or new monitoring service was needed. Existing Pkcs dependencies
were security-patched as a deployment prerequisite; see the runbook.

## What is recorded

The existing application logger emits event **4100 / SleepAiTiming**, category
`LittleDays.FamilyApi.SleepAiDiagnostics`. Only this category is enabled at
Information; the application-wide Warning level and SDK content-logging
restrictions are unchanged.

| Stage | Measured work |
| --- | --- |
| Enqueue | Job validation/authorization and SQL enqueue, after HTTP JSON parsing |
| Claim | Worker claim transaction, including its authorization checks |
| QueueWait | Original job creation to successful claim transaction completion |
| Access | Account/family authorization and current-job/consent checks |
| Budget | Concurrency admission (attempt 0), or per-provider-attempt quota reservation |
| Provider | One complete SDK response call, including transport and generation |
| Validation | Structural/temporal validation of one provider output |
| Processing | Service execution including access, budget, provider, validation and reservation disposal |
| Persist | Completion transaction and its final authorization/lease checks |
| ServerTotal | Original job creation to attempted completion, with committed/failure outcome |
| Poll | Server-side authorized job read; not the phone's network round trip |

Fields are `Stage`, `Job`, `Run`, `Attempt`, `DurationMs`, `Outcome`, `Model`,
`ServiceTier`, `InputTokens`, `OutputTokens`, and `CachedInputTokens`.
`Job` is a truncated SHA-256 correlation of the random operation UUID, not the
raw ID. HTTP reads/enqueue use run 0; worker runs use 1 or 2. Provider attempt 1
is the initial call and 2 is the existing invalid-output repair. Every stage
logs its elapsed time on failure too; error outcomes are fixed categories,
never exception messages. Empty queue checks emit nothing.

The returned provider tier is captured when available, not inferred from the
project's Fast setting. Unknown/missing tiers are `unknown`; missing token
counts are null, not zero. Model values are restricted to the configured
selected model or `other_configured_model`. Prompt/output text, records, child
details, account/family IDs, input revisions, credentials, URLs and raw
exceptions are excluded. Correlations are still operational metadata: keep
logs access-restricted and do not publish them as user analytics.

## Reading the timings correctly

- Most stage timers use a monotonic clock. QueueWait/ServerTotal use stored UTC
  creation time; negative values caused by clock movement are clamped to zero.
- **Do not sum all stages.** Processing contains its sub-stages; QueueWait
  already includes Claim. ServerTotal contains queueing plus service and save.
- For recovered run 2, QueueWait is cumulative age since original creation,
  including the earlier run and lease wait, not pure new queue delay.
- Processing also includes reservation release and small uninstrumented
  overhead. A large residual after its measured children is a reason to
  investigate that path; it is not automatically AI time.
- Provider `ok` means the SDK returned, not that the prediction is valid.
  Check Validation and Processing. A successful Persist may store a failure;
  check ServerTotal's outcome. `not_committed` never means saved success.
- Poll measures server work only. The existing 4-second phone polling cadence,
  suspension/background time, connectivity and rendering delay are not measured
  by these server logs. They remain possible causes if ServerTotal is fast but
  the UI is slow. Polling, request deadlines and prediction behavior are unchanged.

For a representative sample, group by stage, outcome, returned tier, run and
attempt. Compare median and p95 durations, sample counts and failure/timeout
rates. Keep failed/timeout attempts separate but visible rather than silently
dropping them. Compare similar input/output token sizes when evaluating Fast
mode. Second provider attempts identify repair overhead. No live sample is
available yet, so no bottleneck or speed improvement is asserted.

## Collection and rollout boundary

The approved backend deployment uses the existing Azure App Service log
destination, not a new paid monitoring resource. Verified target from the current
runbook: Azure Portal → **reticle.com.au** tenant → subscription
`4768a858-f23f-4a39-bb64-eabc9c142627` → `my-little-days-pilot-rg` →
`little-days-api-522fpstfbtds2` → Monitoring → **Log stream**. Filter for
`SleepAiTiming`. Verify the current target and deployed revision first.

On 15 October, Application logging changed **Off → File System**, preserving
the **35 MB** quota and setting retention to **3 days**. Saved values were
read back; Log stream connected and displayed runtime/application output,
including the post-deployment startup. No broad HTTP, SDK, SQL or payload logging
was enabled. The first genuine `SleepAiTiming` trace is still pending a real app
AI request; generic health and startup output do not prove that end-to-end path.
Deployment, package verification and manual-setting evidence are recorded in
[the runbook](AZURE-MANUAL-SETUP-RUNBOOK.md#ai-timing-logging-rollout--15-october-2026).

## Verification

The .NET testing guidance led to an internal worker test seam: the public
production constructor still uses the same SQL store and prediction service.
Tests use deterministic clocks and synthetic responses; no provider calls,
private records or production SQL were used.

- Release build: zero warnings/errors.
- New focused timing tests: **21 passed, 0 failed, 0 skipped**.
- Full solution: API **389 passed / 125 skipped**, migrator **13 passed /
  30 skipped**, zero failures. SQL-dependent cases skipped because no disposable
  database connection was supplied. Independent static review found no blockers.
- Exact durations, stage separation, returned tier/token metadata, repair,
  timeout/transport/cancellation, access/quota failures, save failure,
  non-committed results, empty queues, correlation, clock movement and a broken
  log sink are covered.
- Claim creation/run mapping assertions were added to the existing SQL tests.
  Those require a disposable `FAMILY_TEST_SQL_CONNECTION`; the local skipped
  SQL tests were subsequently exercised by the release workflow.
- Release CI, with disposable SQL: API **514 passed**, migrator **91 passed**;
  **605 passed, 0 failed, 0 skipped**. TypeScript/watch/browser checks also passed.
  Artifact inspection verified the logger configuration and actual patched Pkcs
  DLL/deps entry, rather than relying on restore or tests alone.
- Production migration verified **zero pending scripts**, and the workflow
  verified removal of its exact temporary firewall rule. Post-startup liveness
  and recovery-gate readiness returned 200. Signed-in/provider timing and native
  app behavior remain unverified in this backend-only rollout.

Commands (using the installed SDK with an isolated environment):

```sh
dotnet build server/LittleDays.slnx --configuration Release --no-incremental
dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj --configuration Release --no-restore --filter 'FullyQualifiedName~SleepAiDiagnosticsTests|FullyQualifiedName~SleepAiJobTimingTests|FullyQualifiedName~SleepAiTimingServiceTests'
dotnet test server/LittleDays.slnx --configuration Release --no-restore --logger 'console;verbosity=quiet'
```

Examples of requirement evidence:

| Requirement | Test |
| --- | --- |
| “add the loggings so that we can identify the bottle neck” — separate stages | `SuccessfulPredictionRecordsSeparateStageTimesAndReturnedProviderMetadataWithoutPayloads` |
| Same requirement — queue/save/total | `WorkerSeparatesQueueClaimAndPersistenceAndOnlyReportsCommittedSuccess` |
| Same requirement — repairs | `InvalidOutputRepairRecordsBothProviderAttemptsValidationOutcomesAndOneProcessingTotal` |
| Same requirement — safe, non-intrusive logging | `TimingsUseMonotonicClockAndAllowlistedMetadataWithoutPrivateText`; `BrokenLoggerCannotFailSuccessfulWorkOrReplaceOriginalFailure` |
