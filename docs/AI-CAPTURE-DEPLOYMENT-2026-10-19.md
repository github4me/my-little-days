# All-user AI capture deployment — 19 October 2026

Backend activation completed at 18 October 14:02:51 UTC / 19 October
01:02:51 Melbourne. Runtime source is
`d19200022d32bf760f8986318799abf65f51e51a`, tree
`8de6801f89d0380392e8c26b0af6a4d98af7badf`.
[Deployment #31](https://github.com/github4me/my-little-days/actions/runs/39133786764)
completed all five jobs successfully. Documentation-only receipts published
after this release do not change that runtime SHA.

## Scope and configuration

The owner explicitly requested seven-day request/response capture enabled for
all users without public privacy or consent wording changes. The reviewed
package sets `SleepAi:FullRequestCaptureEnabled=true`. At deployment, Azure
App Service Environment variables had no override for this key. Capture applies
to newly enqueued resumable AI jobs for users who enabled AI; it does not
enable AI for users who opted out, backfill existing jobs, or capture the legacy
synchronous endpoint. The current clients use resumable jobs.

The actual provider JSON request/response, safe provider request ID, HTTP status,
timing, attempt/run, byte counts and truncation flags are retained in restricted
`dbo.SleepAiExchanges`. Authorization headers and the configured API key are
excluded/redacted. Each body has a 1 MiB retained-prefix limit; oversized or
unreadable bodies are explicitly marked. Storage is best effort, not a lossless
audit trail. Expiry is seven UTC days from request start; the existing hourly
worker deletes expired rows in bounded batches. This does not change backups.
Cancellation, revocation, deletion and history-epoch cleanup remain enforced.
See [the capture contract](AI-REQUEST-CAPTURE-2026-10-19.md).

Existing Azure settings, identities, model `gpt-6-luna`, Fast configuration,
30/account/hour, 50 concurrent requests and 200/instance/day remain unchanged.
No Azure resource resize, provider configuration, billing/retention dashboard,
public policy/support page, app consent or mobile source changed. The existing
request-clearing disclosure remains inconsistent with this diagnostic retention;
that discrepancy is outstanding, not resolved by this release.

## Release verification

- GitHub plugin commits/pushes only; no CLI push or credential extraction.
- The first candidate `5aaab84b160dc030792864c9d8681dd30c7616c5` failed
  disposable-SQL CI before deployment. SQL Server normalized new CHECKs using
  negative numeric literals and BETWEEN, unsupported by the catalog parser.
  `d192000` adds bounded parser support and 14 regression cases without changing
  script 0014 or weakening its checks.
- Release CI: API **806 passed, zero failed/skipped**; migrator **157 passed,
  zero failed/skipped**. The new SQL capture/cleanup/lifecycle/catalog tests ran
  against disposable SQL Server, never production fixtures. TypeScript, browser,
  Apple-browser, sleep-chart, family-demo and Watch protocol gates passed.
- Frozen local verification: API 661 passed / 145 SQL-dependent skips;
  migrator 44 passed / 41 SQL-dependent skips. PathMap avoids the known unrelated
  Graph test's `/private/` source-path false positive. CI above supplies actual
  SQL acceptance, superseding the earlier local-only pending receipts.
- Frozen source archive SHA-256:
  `ab6571e24351b55dea16c042088d6ad5ed9f4342b68d0251e78005d5fa941fb7`.
- Deployed API artifact 12139037540 SHA-256:
  `87afc19aa4ac1c77ead2c54a991af0d9e6f1b03ae4db5148d5c2c95d3528239d`.
  Download hash matched; packaged appsettings enabled capture and DLL
  informational version contained the exact runtime SHA.
- Database artifact 12139600502 SHA-256:
  `7c3ff94bd11bc8312ef4a7ce2b701ad7cc0f5337d07280e9f128d4172eeffaac`.

## Azure and SQL acceptance

Target remains tenant `reticle.com.au`
(`7b7e6e31-a778-4334-aee2-e969fa27fd0e`), subscription
`4768a858-f23f-4a39-bb64-eabc9c142627`, `my-little-days-pilot-rg`, API
`little-days-api-522fpstfbtds2`, SQL server `little-days-sql-522fpstfbtds2` /
database `little-days-family`. Actual environment controls were read before
dispatch: selected trusted branch only; required reviewers/wait timers off,
admin bypass on. These were not changed or described as manual approval gates.

Workflow dispatched on `feature/family-invitations` with
`database_bootstrapped=true`, `adopt_ef=false`. The only pending/applied script
was additive `0014_SleepAiExchangeCapture.sql`. Migration completed
14:01:42 UTC, catalog verified and explicit pending count **0** at14:01:47.
The run-owned exact-IP firewall rule was removed14:01:50; the previously approved
retained operator rule was preserved. Existing scripts were not rewritten.

Read-only live SQL confirmed the new table, 16-byte nullable job epoch column,
and all five trusted/enabled CHECKs. Current configured history epoch was freshly
verified as `64136b6e-01e2-4c48-890f-bef208eac9e3`. Before deployment, data files
were48 MiB, used32.94 MiB, maximum2,048 MiB; no size/cost change was made.
Capacity is finite and must be monitored if captures grow; seven-day retention
is not a guarantee against exhaustion at worst-case body sizes.

Independent checks14:03:10–11 UTC: `/health/live`200,
`/health/ready`200, unauthenticated `/v2/sleep-prediction-jobs/capabilities`401;
all returned `Cache-Control: no-store`. These prove startup/access behavior,
not a successful AI generation or live wire capture.

The first post-release metadata-only SQL query returned zero unexpired exchange
rows. No real-user inference was initiated, credentials exported or private
family payload copied to Git, logs or screenshots. First signed-in live capture,
provider failure diagnosis and physical-device acceptance remain outstanding.
After an authorized new request, inspect current-epoch unexpired metadata/body
privately; do not infer capture success from generic health.

## App distribution

Backend-only change: no TestFlight rebuild/upload is necessary. Existing
TestFlight0.2.4(77) and public0.2.3(75) were not changed or resubmitted. App Review
and public release are outside this capture deployment.
