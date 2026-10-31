# AI revocation recovery — 31 October 2026

Status: backend fix deployed; affected-phone acceptance remains pending.

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

## Local verification and release checkpoint

`CONSENT_TEST_SCOPE=all node work/consent-backend-20261031/test-sql.cjs`
completed successfully: API897 + migrator157, zero failures/skips; the
non-incremental build had zero warnings/errors and test discovery completed.
The focused suite passed64 tests. Independent scoped review found no blocking
issue and rated the assertions Strong; no empirical mutation claim is made.

Only three API files, two regression test files and two task documents were
published over remote28d157af through the GitHub plugin, preserving unrelated
local work. Release42ca16a912aadcd6718d05ad83562b95db895b39 has tree
f1f788a0a49147faf5eb72cd1ba1c633d2d6dcda; source archive SHA256
c245f22103978ea118a84ff71ee229416081e0ef63efa053a0a024571b0c13fc.

Workflow37/run41158367119 was dispatched with database_bootstrapped=true and
adopt_ef=false on feature/family-invitations. Its completion, artifact audit,
readiness checks and physical-device acceptance are not yet confirmed at this
checkpoint. No TestFlight/App Review/public version change was made.

## Production deployment receipt

[Workflow37/run41158367119](https://github.com/github4me/my-little-days/actions/runs/41158367119)
completed successfully in6m34s. Cloud API897 and migrator157 passed with zero
failures/skips; TypeScript and browser checks passed. The migration path checked
the current catalog/checksums, reported zero pending scripts before/after the
no-op apply, and removed only this run's temporary SQL firewall rule.

API artifact13025634466 ZIP SHA256:
`5e91a79bf24ee952fe07a662ea7d01ef1190816e5ffc0066dc4a5a326995c53f`.
In-memory inspection confirmed exact release SHA, new revocation/batch/diagnostic
markers and preserved family diagnostics/conditional reads. API assembly SHA256:
`e56fdb534cca8f66c172ec6fe662a19e2792113e412e9c3260b2ce23b0827b8f`.
appsettings.json remains byte-identical, SHA256:
`a1b3989d62bd799450239c2bc11a455977433b8763c6fdeef107a282e5eb6e39`.

App Service OneDeploy0a112e53-d9ed-46c3-b5df-855af079312e reported status4,
complete=true and active=true, last success02:11:41UTC. Serial public checks at
02:12:38UTC returned live200, ready200 and scoped-unauthenticated401 with
Bearer/no-store. These are not signed-in SQL readiness or a device success claim.
The existing GitHub actions emitted Node20-deprecation/Ubuntu-runner notices;
no action pins or protection settings were changed in this targeted incident fix.

Sanitized receipts and success screenshot: work/consent-backend-20261031/.
No production payload fixture/reset, infrastructure/tier/retention change or new
TestFlight upload occurred. Installed97 remains the client for the retry.
