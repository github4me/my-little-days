# Failed AI output diagnostics — seven-day retention

18 October 2026. The owner subsequently requested automatic capture without a
separate diagnostic opt-in. The [automatic rollout](AI-AUTOMATIC-FAILURE-CAPTURE-2026-10-18.md)
records implementation/deployment status. Automatic capture is deployed and
active for new resumable jobs from 18 October 2026, 06:30 UTC. This is separate
from the metadata-only App Service timing log.

## Scope

Under the automatic policy, newly enqueued resumable AI jobs retain each failed
provider attempt (initial or repair), including an invalid first attempt
subsequently repaired successfully. No separate diagnostic consent is required;
initial AI consent and authoritative access checks remain unchanged:

- Failed assistant response text, a fixed validation/error reason, and the
  zero-based output-period index where applicable.
- Attempt/run correlation, configured model, provider elapsed milliseconds,
  failure timestamp, expiry, and the minimum account/consent/family/history
  identifiers needed for access isolation and deletion.
- At most two attempts per worker run. Response text is bounded to 16,384 UTF-16
  code units; oversized text is marked `Truncated` with its original length.
  No surrogate pair is split at the boundary.

No successful response is copied into diagnostics. The collector does not
accept the prompt, input record history, age, birthday, name, photo, note,
credential, reasoning content, raw provider exception or HTTP body as extra
diagnostic fields. A timeout/transport failure has a
fixed reason and duration but no response payload. Admission failures before
provider dispatch remain covered by existing metadata-only logs.

Failed text can still echo supplied context, including sleep times, so it is private
data, not anonymous telemetry. It is stored in the existing SQL database's
`dbo.SleepAiFailedOutputs`, never ordinary application logs, Git, client job
responses, or a new public diagnostic endpoint. Administrative inspection must
use restricted database access and only rows with `ExpiresAt > current UTC` and
the current history epoch; do not paste payloads into ordinary incident logs.

## Expiry and deletion

`ExpiresAt = OccurredAt + 7 × 24 hours`, using UTC instants rather than local
calendar dates or DST. The existing worker deletes expired rows in batches of
500 on its hourly cleanup pass, also while AI generation is disabled. Thus
rows are ineligible for inspection at seven days; physical deletion normally
follows within an hour while the service is running. An outage delays physical
cleanup until the worker resumes. Do not promise deletion at an exact second.

Turning AI off / cancelling its consent clears corresponding diagnostics even
after the parent job has expired at midnight. Individual job cancellation,
account deletion, ended family access, closed families and obsolete history
epochs also clear diagnostics. Final persistence rechecks authorization, AI
consent revocation and the server-assigned job history epoch so late responses
cannot recreate revoked data.
Failure to save optional diagnostics must not undo a completed prediction or
trigger another paid inference. Capture is best-effort after job completion,
in a second authorization-checked transaction. Cancelled, expired or revoked
work is not retained; a process shutdown or diagnostic-storage failure can
leave no diagnostic payload. This is not a guarantee to recover every failure.

These are active-database expiry rules, not a change to SQL backup retention.
Any restored database must have diagnostic payloads purged under maintenance
before traffic is reopened. The same purge and clearing of job diagnostic
consent are required before rolling back to an older API without these deletion
hooks. Do not export payloads into unmanaged backups.

## Automatic policy and compatibility

The existing durable-job consent remains `sleep-ai-jobs-v1`. The optional
job-envelope field `diagnosticsConsentVersion` is omitted when absent, preserving
legacy serialized request hashes and operation replay. Under the new policy,
missing/null no longer prevents capture for newly enqueued resumable jobs.
The server assigns the current history epoch separately; it does not fabricate
a client consent version. Unknown supplied versions remain rejected for
compatibility. Existing cancellation/revoke generations remain unchanged.

Old jobs with null diagnostic epochs are not backfilled. Null also marks
lifecycle suppression and must not be re-enabled when claiming or recovering a
job. The new additive script 0012 permits null diagnostic consent with a
server-assigned epoch; applied script 0011 is unchanged. Historical synchronous
routes remain outside the resumable-job diagnostic store.

The public policy is updated without a new diagnostic popup. Initial AI
sharing remains optional. The earlier additive migration and API were deployed in
[release 39101954963](https://github.com/github4me/my-little-days/actions/runs/39101954963).
See the [release receipt](AI-CONCURRENCY-50-DEPLOYMENT-2026-10-18.md) for exact
SHA/artifact/SQL verification, and the manual runbook for the restore procedure.

## Initial local verification (before release)

The .NET testing skills guided focused reason/consent/retention boundary tests,
alongside regression tests preserving the existing AI output contract. The
full server test command exited successfully; API tests: **499 passed, zero
failed, 135 SQL-dependent tests skipped**. No real inference or production
database was used.

Focused migration/parser verification: **14 passed, zero failed**, with three
SQL-dependent test methods skipped. `git diff --check` is clean.

Examples: `RepairKeepsOnlyFailedResponseAndReason`,
`SuccessfulOutputIsNotRetained`, `FailedResponsesRequireExplicitDiagnosticConsent`
and `FailedOutputExpiresExactlySevenDaysAfterFailure` passed. New migration,
expiry deletion, revocation and late-completion SQL cases are present and
compile, but require a disposable SQL Server before rollout. This local result
does not verify actual database cleanup, deployed behavior or renewed consent
on a device.

## Release verification

Final frozen code SHA `ba389416d8ad40ae7c310af5d2b1cc80e059905f` passed **658 API
tests and 122 migration tests**, zero failures/skips, against disposable SQL in
both push CI and the production release's verification stage. This includes
expiry/deletion, explicit-consent, legacy-client, isolation and migration/catalog
tests. Production script 0011 applied; post-apply catalog verification reported
zero pending scripts, with temporary firewall access removed. Independent live
health checks passed. These results do not prove new client consent or live
payload capture; neither was activated by this backend-only release.
