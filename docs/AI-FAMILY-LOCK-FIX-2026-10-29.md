# Family synchronization / AI SQL lock separation — 29 October 2026

Status: local implementation; production deployment and device acceptance have
not occurred. The earlier client request-reduction changes remain separate.

The incident logs showed family reads/writes returning503 during acquisition of
`LittleDays:FamilyPilot:v1`, often at its10-second wait limit. SQL log-write usage
also peaked during failures. No live blocking transaction was captured, so this
change removes the source-proven AI/global-lock coupling without claiming to have
identified every production holder or eliminated every possible503.

## Transaction behavior

| Operation | Lock order / behavior |
| --- | --- |
| Family records / snapshots | Existing global Shared → family Exclusive |
| Family/account lifecycle | Existing global Exclusive |
| AI job admission, poll, cancel, claim, complete, capture, budget reservation | AI Exclusive → existing global Shared |
| AI retention | Same AI transaction, with a separate commit for every small batch |

`LittleDays:SleepAi:v1` serializes AI SQL state, including cross-instance budget
and claim checks. Provider inference remains outside the SQL transaction. Waiting
for the AI lock happens before taking the lifecycle barrier, so queued AI calls
do not delay a membership/account change by holding that shared barrier.
Authorization checks and SaveChanges still occur within the lifecycle barrier.
An older API instance using the original global Exclusive lock remains excluded
during rolling deployment. No schema, public API, quota, polling interval or
retention-policy change is required.

Cleanup retains the existing predicates and maximum500 deletions per table per
invocation. Failed-output, exchange and job tables delete one potentially large
payload row per transaction; small revocation/attempt metadata uses25 rows. Prior
commits survive a later failure. The recovery gate is rechecked for each batch.
Domain records and operation receipts are not cleanup targets.

The dispatcher runs one cleanup task in its own existing production scope,
alongside paid-job dispatch. Success schedules the next cleanup one hour after
completion; failure retries after five minutes. Cleanup does not consume a
provider slot, cannot overlap itself in one dispatcher, and is awaited on shutdown.
Exceptions still omit private contents from application logs.

## Verification

Verification uses SQL Server2022 in an owned local Docker network with no exposed
host port. SqlFixture creates and deletes only generated test databases. No Azure
database, private family payload, deployment, setting change or phone install is
part of these tests.

Initial targeted suite:31passed,0failed,0skipped (existing worker, durable job and
AI authorization tests). Contention/cleanup/worker suite:28passed,0failed,0skipped.
The final shutdown test additionally pins scope disposal after an inline pending
claim continuation; the complete API run below includes that final assertion.

| Requirement | Exact evidence |
| --- | --- |
| “解决竞争问题”: AI SQL work must not block ordinary family synchronization | `HeldAiJobPollAllowsFamilyIdentitySnapshotAndSleepFeedWritesButExcludesLifecycle` holds a real AI poll open while Me/full snapshot, sleep/feed records and durable receipts complete. |
| Keep serialized AI SQL commits and the global50-provider limit | `AiTransactionsSerializeTrackedWritesAndCommitBeforeTheNextTransactionObservesThem`; existing `GlobalFiftyLeaseLimitIsAtomicAcrossContextsAndRejectedAttemptDoesNotSpend`. |
| Preserve account/lifecycle exclusion and release canceled waits | `AccountDeletionExcludesQueuedAiAdmissionAndNewRequestSeesCommittedRevocation`; `AiLockWaitDoesNotHoldLifecycleBarrierAndCancellationLeavesBothLocksAvailable`. |
| Keep retention/restore-epoch boundaries and bounded work | `CleanupBoundsPayloadAndMetadataBatchesAndPreservesRetentionBoundaries` pins expired/current/stale-epoch evidence, one-row payload batches,25-row metadata batches,500-row work caps, and unchanged family/receipt data. |
| Earlier cleanup commits survive interruption | `FailedSecondPayloadBatchLeavesFirstCommitDurableAndRetryFinishesRemainder`; `CancellationAfterCommittedPayloadBatchStopsFurtherDeletesAndReleasesLifecycleBarrier`; `RecoveryGateActivatedBetweenBatchesStopsCleanupBeforeAnotherDelete`. |
| Release locks between cleanup batches | `PayloadCleanupReleasesBothApplicationLocksBetweenCommittedBatches`. |
| Cleanup does not block dispatch or overlap itself | `PendingCleanupDoesNotBlockQueuePollingOrStartASecondCleanupEvenAfterAnHour`. |
| Bound cleanup retry frequency and preserve hourly success cadence | `FailedCleanupStillDispatchesAndRetriesOnlyAtFiveMinuteBoundaryWithoutPrivateLogs`; `SuccessfulCleanupSchedulesNextRunAnHourAfterCompletionRatherThanStart`. |
| Shutdown awaits maintenance scope disposal | `ShutdownWaitsForTheOutstandingCleanupToFinishAndDisposesItsScope`. |

Full solution rebuild: `dotnet build server/LittleDays.slnx --configuration Release
--no-incremental`, exit0,0warnings/0errors. Final solution command
`dotnet test server/LittleDays.slnx --configuration Release` exited0:

- API: **Passed:878,Failed:0,Skipped:0** (41seconds).
- Database migrator: **Passed:157,Failed:0,Skipped:0** (1minute35seconds).

Console logs and targeted TRX reports are preserved in
`/tmp/mld-ai-lock-tests.3sfn2V/`. The solution command used the same explicit TRX
filename for both projects, so its final TRX contains the migrator run; the full
console log preserves both successful project summaries. No database scripts or
catalog verifier changed. The unrelated local edits to SleepAi.http and
SleepAiJobs.http were preserved and are not part of this fix.

One first-pass test incorrectly required only OperationCanceledException while
canceling a waiting SQL application lock. The observed SqlClient error0 is also a
[documented cancellation surface](https://github.com/dotnet/SqlClient/issues/2424).
The test now accepts only those two forms with a canceled token and still requires
that the action never ran and both locks are available afterwards. Production
error handling was not weakened to satisfy that assertion.

Source/assertion review found no remaining critical gap in the changed contract.
No line-coverage percentage, executed mutation score, production latency reduction
or native-device acceptance is claimed. The four production-file pre-change Git
blobs exactly match deployed tree `996511af3b4102efc85bf428f8d15cdfb946f0d8`:

- FamilyService.cs: `0ddda90c30656c814145166460801c1d65f5c174`
- SleepAiJobStore.cs: `efadef0ffc1753c1cb1b082beeda24504c818572`
- SleepAiAttemptStore.cs: `22b6d0937980e48b1a53533ecb2ee3150ad894d2`
- SleepAiJobWorker.cs: `224d5cd54a38d737e1360913c8e4694968f09878`
