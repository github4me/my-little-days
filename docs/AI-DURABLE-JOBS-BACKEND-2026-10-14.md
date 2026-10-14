# Durable sleep AI jobs — backend implementation

14 October 2026. Source implementation, isolated-SQL CI and production deployment
evidence are recorded below. Signed-in durable-job completion, live provider
completion and physical iPhone background acceptance remain unverified. No live
child data or paid inference was used for these tests and deployment checks.

## Contract

Existing `/v2/sleep-predictions` and its capabilities remain compatible. The new
JWT/directory-admitted routes use the same account/family authorization boundary:

- `GET /v2/sleep-prediction-jobs/capabilities`: `{enabled, consentVersion}` where
  consent is independently `sleep-ai-jobs-v1`.
- `POST /v2/sleep-prediction-jobs`: `{operationId, consentVersion,
  consentGeneration, request}`. IDs are non-empty UUIDs; `request` is the existing
  minimized schema-2 request with inner consent `sleep-ai-v2`.
- The POST returns **202 after SQL commit**, with `Location` and a job envelope.
  `jobId == operationId`, allowing recovery when acknowledgement was lost.
- `GET /v2/sleep-prediction-jobs/{jobId}` reads that account's job without spending
  inference quota. Unknown and other-account IDs both return `404/job_not_found`.
- `DELETE /v2/sleep-prediction-jobs/{jobId}` cancels/purges the account's job and
  records a tombstone even if its original POST outcome was unknown.
- `DELETE /v2/sleep-prediction-jobs/consents/{consentGeneration}` revokes the
  account-bound consent generation and cancels/purges its jobs. Both DELETEs return
  204; an in-flight provider request cannot be recalled after sending.

The exact job envelope is `{jobId,inputRevision,status,requestNow,createdAt,
updatedAt,expiresAt,prediction,errorCode}`. Status is `queued`, `running`,
`completed`, `failed`, `cancelled` or `expired`. Only completed jobs include the
existing strict prediction envelope; errors are allowlisted codes, never provider
bodies. All routes retain no-store and authentication middleware.

## Persistence, processing and bounds

Migration `0010_DurableSleepAiJobs.sql` adds jobs, revocation tombstones and
provider-attempt receipts with explicit runtime grants and catalog checks. No old
migration, family record, operation receipt or history identifier is rewritten.

Enqueue validates freshness (five-minute clock tolerance), schema and authority.
Idempotent replay compares the entire canonical request hash before returning the
existing job, even after that admission window. Worker execution retains original
`requestNow`; queue delay alone does not make a previously accepted request invalid.
The original whole-day expiry remains next local midnight.

An existing-App-Service hosted worker claims SQL rows under the existing lifecycle
transaction barrier, commits a two-minute UUID lease, then does network work
outside the transaction. Completion requires the same live lease and rechecks
account/grant/history/recovery/consent. Two worker loops share SQL-backed provider
reservations with the legacy endpoint. An expired job lease permits one recovery
(maximum two processing runs); exactly-once paid inference is **not** promised if
a process stops after provider dispatch but before storing its result.

The generation/repair sequence retains its 60-second deadline and at most one
invalid-output repair. The provider still receives the approved model, no-store,
non-background request and existing minimized schema. HTTP cancellation is not
used by a committed worker job; host shutdown cancels worker execution and leaves
its lease recoverable.

Provider limits remain 30 attempts per account/fixed UTC hour, 200 per fixed UTC
day and two concurrent provider reservations. These now survive process restarts;
each repair also reserves an attempt. Reservations last at most 75 seconds if a
process dies, and normal completion releases the slot. GET polling never spends
an attempt. Pending jobs are globally bounded to 256; a new revision cancels older
unfinished work in the same account/consent/family scope, retaining completed prior
plans for the next request. A delayed older snapshot cannot supersede newer work.

Raw minimized input is removed when a job becomes terminal. Cancelling, leaving,
removal and account deletion purge affected local server job payload/results;
authorization still rechecks on reads. Results become inaccessible at local
midnight. Hourly bounded cleanup deletes expired AI jobs; attempt metadata and
revocation tombstones are eligible for cleanup after 48 hours. Cleanup does not
touch domain operation receipts. Service outages can delay physical cleanup;
existing database backup retention is separate, unchanged by this implementation.

## Verification

Local SDK: .NET 10.0.401, xUnit 2/VSTest. Existing provider tests use synthetic
fakes/intercepted HTTP only. No packages, model, timeout, spending ceiling or Azure
resources/settings changed.

`dotnet test server/LittleDays.slnx --configuration Release` exited 0 locally:
API **366 passed / 0 failed / 125 skipped**; migrator **10 passed / 0 failed /
30 skipped**. The final focused AI run passed **210**, with **15 SQL skips**;
the focused migration run passed **1**, with **2 SQL skips**. SQL skips
are explicit: no `FAMILY_TEST_SQL_CONNECTION` and Docker is not running. They are
not SQL acceptance; the later isolated-SQL CI gate below supplies that evidence.

## Production deployment checkpoint

The approved run [38500938755](https://github.com/github4me/my-little-days/actions/runs/38500938755)
completed successfully at **2026-10-14 02:33:27 UTC**, using frozen commit
`ad894407ce2c641740cfcf9d3230dbe4b8c68b8a`.

- API and real SQL tests: **491 passed, 0 failed, 0 skipped**. This includes the
  13 durable-job SQL tests, including the hosted-worker/caller-disconnect case.
- Migrator and real SQL tests: **91 passed, 0 failed, 0 skipped**. The earlier
  run was stopped by a synthetic `0010` fixture collision, not a production
  migration error. Its test-only fix chooses the next unused fixture version,
  adds three offline regression cases and requires the intended SQL exception
  in rollback tests. Existing migration scripts remain unchanged.
- Database artifact `11865429592` was downloaded with matching SHA-256
  `3c17e5c3877a60c3150944a8a4bd5d419accfd95affa3865038eb13e01bf2f49`.
  `0010_DurableSleepAiJobs.sql` applied successfully at 02:30:51 UTC. The
  post-apply catalog/checksum check reported **0 pending scripts** at 02:30:55.
  The run-owned SQL firewall rule was removed at 02:30:57; the recovery cleanup
  step also succeeded. These are actual migration-job receipts, distinct from
  the mocked firewall lifecycle tests in CI.
- API artifact `11865474463` was downloaded with matching SHA-256
  `3d783b9858e1487b4ad04c386d23b4e40fdf642cc6bb493ae8662620fc1a97df`.
  OneDeploy `6bb3a355-1369-4b24-9306-15f0c0593c9b` completed with status 4.
  After bounded cold-start 503 responses, `/health/live` returned
  `{"status":"ok"}` at 02:33:23 UTC and its workflow check succeeded.

Sanitized receipt: `work/async-ai-20261014/backend-deployment.json`.
Public liveness does **not** prove a signed-in SQL-backed job or provider call.
The workflow's mobile checks cover its checked-in branch; build 73's local app
overlay and physical background/resume acceptance require separate evidence.

## Requirement-to-test mapping

| Requirement | Exact test evidence |
| --- | --- |
| Committed work survives caller loss | `HostedWorkerContinuesAfterAcknowledgedHttpCallerDisposesAndLegacyRouteSharesDurableQuota` (isolated SQL/HTTP/hosted worker) |
| Replay and competing workers | `CommittedJobSurvivesCallerCancellationAndContextRestartWithoutDuplicateEnqueue`; `ParallelDuplicatePostsCommitOneJobAndOnlyOneWorkerClaimsIt` |
| Bounded recovery/fenced completion | `LeaseRecoveryIsBoundedAndOldWorkerCannotPublishAfterReplacement` |
| Revocation, account/family isolation and purge | `ConsentAndAbsentOperationTombstonesRejectLatePostsAndCancelLateCompletion`; `AccountIsolationAndDeletionPreventReadAndSynchronouslyPurgePrivatePayloads`; `RevokedFamilyGrantPreventsPublicationAndPurgesSnapshot` |
| Maintenance and revision isolation | `MaintenancePreventsEnqueueClaimAndPublicationWithoutLosingLease`; `NewRevisionCancelsOnlyUnfinishedOlderWorkAndKeepsCompletedPriorPlan` |
| Time and retention | `QueuedExecutionPreservesOriginalSnapshotAfterAdmissionWindowAndUsesDurableAttemptPerRepair`; `LocalMidnightExpiryAndCleanupDoNotDeleteFamilyRecordsOrConsumeProviderBudget` |
| Persisted limits and no paid polling | `DurableThirtiethAttemptAndUtcHourResetSurviveNewDbContexts`; `DurableConcurrencyAndDailyLimitsRemainAfterRestartAndStaleLeaseExpires`; `TwoHundredthDailyProviderAttemptIsAllowedAndNextAttemptIsDenied`; hosted-worker test above |
| Additive schema/grants/catalog | `UpgradeAddsQueueAndRuntimeGrantsWithoutChangingExistingRecordsAndNoOpHasZeroPending`; `QueueBudgetAndRevocationCatalogDriftFailsClosed` |

API examples use fictional input in `server/LittleDays.FamilyApi/SleepAiJobs.http`.
The separate app/privacy work must be released with the new consent before users
can submit real records to durable storage. No new paid Azure service is needed.
