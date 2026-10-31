# AI revocation recovery — 31 October 2026

Status: backend fix implemented; final verification and deployment pending.

## Incident and scope

The affected physical iPhone has TestFlight 0.2.11 (97). Its new 12:47 screenshot
reports service/connection failure when enabling AI, after the client begins
reconciling an earlier consent revocation. Production Claim timings at 01:47 UTC
show approximately ten-second database failures; ordinary family reads succeed.
The previous thirty-minute SQL sample peaked at 89.55% log-write usage. The later
request sample did not capture an active blocker. These observations do not
prove the precise failing endpoint, continuous saturation, or a need to upgrade SQL.

Source matching deployed `4699aecec152c12a3c375c4d72975bae168262a6` shows Cancel
loads every matching job and deletes all captured payloads in one global AI
transaction. A timeout rolls back all that cleanup, so a retry repeats its work.

## Changes

- Commit the user/job-or-consent revocation fence first, then clear each job
  payload and delete each failure/exchange row in its own short transaction.
- Recheck account authority and recovery state in each batch; preserve the
  existing AI lock, shared family lifecycle barrier, generation isolation,
  retention policy and cleanup-before-204 acknowledgement.
- Keep committed progress when a request fails or is cancelled; a retry resumes
  remaining rows and does not rewrite already cleared jobs.
- Suppress revoked results during polling before payload cleanup finishes;
  retain the existing cancelled/expired response shape. Late workers, captures
  and enqueues remain fenced.
- Add metadata-only Cancel/Revoke timings and fixed SQL timeout, deadlock,
  application-lock-failure and other-database-error categories. Never log raw
  identities, revocation identifiers, URLs, tokens, exception messages or payloads.

No schema, quotas, retention, provider model, app polling, consent semantics,
family records, mobile/native code or Apple distribution changes are required.

## Limits and acceptance

A single large payload row may still be slow on the current SQL tier. A large
backlog can still require retry, but successful batches no longer roll back.
Old API processes do not have the new polling suppression; verify completed
rollout before device acceptance, and do not assume a rollback to the old API
preserves that protection for partially drained jobs.

Tests use disposable local SQL and synthetic data only. Deployment health is
not device acceptance: successful Enable AI on the affected phone remains an
explicit outstanding check until demonstrated.
