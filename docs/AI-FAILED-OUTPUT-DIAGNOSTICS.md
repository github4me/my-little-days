# Failed AI output diagnostics — seven-day retention

18 October 2026. **Local implementation; not deployed or activated.** Existing
apps continue using their current AI consent and do not opt in automatically.
This is separate from the metadata-only App Service timing log.

## Scope

For a job with explicit `sleep-ai-failed-output-v1` diagnostic consent, retain
each failed provider attempt (initial or repair), including an invalid first
attempt subsequently repaired successfully:

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
epochs also clear diagnostics. Final persistence rechecks authorization and
authoritative job consent so late responses cannot recreate revoked data.
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

## Consent and compatibility

The existing durable-job consent remains `sleep-ai-jobs-v1`. The new optional
job-envelope field `diagnosticsConsentVersion` is omitted when absent, preserving
legacy serialized request hashes and operation replay. Missing/null means no
capture. Unknown versions are rejected. Supported version and seven-day
duration are additive capability metadata; they do not enable capture.

A future client must send this field only after the server advertises support
and the user explicitly agrees to the diagnostic retention. Existing enabled
AI sessions must not inherit it. Keep the consent generation's revoke/retry
behavior. Do not send the field to older servers that reject unknown fields.

Suggested concise consent addition, **not yet published**:

> With your permission, failed AI responses and failure details are kept in our
> restricted server database for up to seven days to diagnose problems, then
> automatically removed on the next cleanup. These responses may include sleep
> times. We do not additionally retain the input history for diagnostics.
> Turning off AI also removes these diagnostics once the app reconnects.

Chinese draft:

> 经你同意，失败的 AI 返回和失败原因会保存在受限的服务器数据库中，
> 保留 7 天后由定期清理任务自动删除。返回内容可能包含睡眠时间；
> 不会为此额外保存输入的历史记录。关闭 AI 后，联网时也会清除这些诊断数据。

Client consent UI, public disclosures, migration deployment and activation are
pending; none was changed online in this task. See the manual runbook for the
release gate and restore procedure.

## Local verification

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
