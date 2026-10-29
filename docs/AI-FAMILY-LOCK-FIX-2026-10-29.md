# Family synchronization / AI SQL lock separation — 29 October 2026

Status: deployed to production as `4699aecec152c12a3c375c4d72975bae168262a6`
by successful deployment #36 at09:17:59UTC /20:17:59Melbourne. Signed-in family
and two-phone acceptance remain unverified. The earlier client request-reduction
changes remain separate. Deployment evidence is recorded below.

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

## Production deployment — 29 October 2026, 09:17:59 UTC / 20:17:59 Melbourne

The owner requested deployment of the reviewed backend contention fix. Release
`4699aecec152c12a3c375c4d72975bae168262a6` was published through the GitHub plugin
with an expected-head, non-force update of `feature/family-invitations`.
[Deploy family API and database #36](https://github.com/github4me/my-little-days/actions/runs/40847569580)
completed successfully. Only four API files, three test files and two task docs
changed; unrelated local client work was excluded. The frozen source archive
SHA256 is `88bfcdbd8e42f2df03dc11135c9631b9bbd6bc871bcc8747e449c8f2e77bfc5f`.

- Both GitHub environments were freshly inspected: selected trusted branch only;
  required reviewers and wait timers are disabled; administrator bypass is enabled.
  No protection, identity, target, permission or setting was changed. These are not
  human-approval gates. Manual dispatch used database_bootstrapped=true/adopt_ef=false.
- Release CI passed API878 and migrator157, zero failures/skips, plus TypeScript
  and browser checks. The migration job verified checksums/catalog and reported
  zero pending scripts before and after the no-op apply. It removed only its own
  temporary runner-IP firewall rule; the retained operator rule was untouched.
- API artifact12884979033 has ZIP SHA256
  `94847840e7b533684e1a7f641cc8b3cad7f78f5d682c3909978bfef03283ba30`.
  In-memory inspection confirmed the exact release SHA, dedicated AI transaction/
  lock, existing conditional reads and diagnostics. Assembly SHA256:
  `d682fd78eb2387c1ddf8726b41a6b3ce7b84690c6a928cf198faca8e0bbfcc44`.
  appsettings.json is byte-identical to the previous package (SHA256
  `a1b3989d62bd799450239c2bc11a455977433b8763c6fdeef107a282e5eb6e39`).
- App Service OneDeploy `efeda928-ac1c-4ed7-a268-13f6fed51620` returned status4,
  complete=true, active=true, no build errors/warnings. Production target remains
  the same tenant/subscription/API/SQL described above; no infrastructure apply,
  tier/quota/retention change, production fixture or destructive test was run.
- Serial public checks at09:19 and09:20UTC returned live200, ready200 and the
  scoped unauthenticated read401 with Bearer/no-store. Health does not query SQL
  or attest the running assembly; it is not signed-in family/device acceptance.
  The runtime log showed startup propagation and old-container AI claim warnings
  during replacement; the deployment success alone does not prove those cleared.

App/TestFlight/App Review versions are unchanged and this server-only fix requires
no new app install. Signed-in family reads/writes, two-phone latency and sustained
error-rate improvement remain to be verified. Sanitized deployment/artifact/
health receipts and the success-page screenshot are under
`work/ai-lock-release-20261029/`; no private records, tokens, raw AI payloads or
signed artifact URL were saved there.

09:22:06UTC runtime readback: from09:19:36 onward the portal showed no further
AI claim warnings or family failures. The old-container warnings ended at09:19:35.
The only observed post-switch family endpoint request was the intentional
unauthenticated401 probe (zero SQL commands); no signed-in acceptance or sustained
latency improvement is inferred from this limited, low-traffic window.

## Lock purpose and user impact

| Lock / limit | Why it remains | Affected scope |
| --- | --- | --- |
| Global lifecycle barrier `LittleDays:FamilyPilot:v1` | Keeps membership/account deletion, invitations, ownership and device-token binding changes atomic with authorization and commits. | Ordinary family/AI work takes Shared and can coexist. Lifecycle Exclusive temporarily queues participating requests across all families in this SQL database. |
| Family lock `LittleDays:Family:{id}` | Serializes snapshots and record mutations/receipts to preserve last successful server save wins and first deletion wins. | One family only; different families use different locks. It is not a global user-count limit. |
| AI state lock `LittleDays:SleepAi:v1` | Atomically claims jobs, checks quotas and stores/cancels/results/capture. | One short AI SQL transaction at a time across API instances; model inference is outside this lock. Ordinary family sync does not acquire it. |
| Migration lock `MyLittleDays.DatabaseMigrator` | Prevents concurrent migrators from altering/verifying the same migration journal/catalog. | Deployment/migration processes only. A second migrator fails immediately; actual DDL or shared SQL load can still affect normal requests. |

The three application locks wait up to10seconds to acquire each lock. This is
not a maximum lock-holding time: commit/rollback releases transaction-owned locks.
AI capacity50 is a limit on active provider requests, not registered/online users;
short serialized admission/state operations coexist with parallel provider calls.
Process-local semaphores/counter/token-cache guards are not additional distributed
SQL barriers. Shared SQL resources and lifecycle operations can still cause waits.


