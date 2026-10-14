# AI failure categories and hourly limit — 14 October 2026

## Status

Published through the GitHub plugin over parent `47c52fb8740b0a68da2e1dba8888dc65750d2d38` as `d1cef775b8ea628c02b487e268aeb5648cd83cc3`. Deployed successfully in [run 38487274921](https://github.com/github4me/my-little-days/actions/runs/38487274921), attempt 1, completed **14 October 00:03:30 UTC**. This does not establish a live provider response or native device acceptance. The specific cause of the earlier generic “AI unavailable” result is still unproven.

## Scoped change

- Raise the default per-account hourly **provider-attempt** limit from 6 to 30 in `SleepAiOptions` and `appsettings.json`. An invalid-output repair attempt still consumes a second attempt. The existing fixed UTC-hour window is retained (`UnixTimeSeconds / 3600`); this is not a rolling-window redesign.
- Preserve the 200-attempt per-instance UTC-day limit, two concurrent requests, bounded account map, 60-second limits, approved model and prompts, authentication/access rechecks, privacy controls, and existing AU$50 safeguards.
- Return safe, fixed categories through the existing HTTP `{ "code": "…" }` error envelope. The client can localize these in the usage-help section without exposing technical/provider details. Successful response keys and disabled-feature behavior are unchanged.

| Condition | HTTP | Safe code |
| --- | --- | --- |
| Provider/stage timeout, but caller has not cancelled | 504 | `ai_timeout` |
| Two invalid or absent model outputs | 503 | `ai_invalid_response` |
| Provider reports HTTP 429 | 503 | `ai_provider_busy` |
| Other provider/transport failure | 503 | `ai_provider_unavailable` |
| Account hourly attempt limit | 429 | `ai_hourly_limit` |
| Instance daily attempt limit | 429 | `ai_daily_limit` |
| Concurrent-request or bounded-account-map capacity | 429 | `ai_busy` |

Caller cancellation remains cancellation, including when it races with a provider exception. Provider failures are not retried internally; only the existing one invalid-output repair remains. No exception messages, bodies, private provider codes, credentials, or record contents are included in the public errors. Null or malformed output is classified as an invalid response, not an inferred model-specific cause.

## Verification

SDK `10.0.401`; existing xUnit/VSTest project and pinned provider SDK; no dependency changes. The focused Release test run passed **193 tests, 0 failed, 0 skipped**:

```sh
/Users/chao/Applications/.dotnet/dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj --configuration Release --filter 'FullyQualifiedName~SleepAiTests|FullyQualifiedName~SleepAiWholeDayTests' --logger 'console;verbosity=minimal' --logger 'trx;LogFileName=backend-focused.trx' --results-directory work/ai-failure-release-20261014/backend-tests
```

Evidence: `work/ai-failure-release-20261014/backend-tests/backend-focused.trx` (operation-local artifact, not a deployment receipt).

Coverage includes the 30th/31st attempt and exact hourly boundary; unchanged 200th/201st daily limits and UTC reset; two concurrent requests and slot recovery; unchanged invalid-output repair accounting and account isolation; before/during/racing caller cancellation; actual pinned-SDK error parsing through an offline HTTP handler; exact status/code mapping; and the existing authenticated HTTP middleware's code-only, no-store envelope without leaked details. Existing whole-day validation, access and minimization tests also pass. The focused selection does not include SQL integration tests or live provider/device testing.

## Publication handoff

Five-file source/test payload: `work/ai-failure-release-20261014/backend-scoped-payload.json`; human-readable diff: `work/ai-failure-release-20261014/backend-scoped.patch`. Both compare current file bytes with the exact parent above, including files that are untracked in this local checkout. The only `appsettings.json` change in that diff is the hourly value `6` → `30`.

Fresh Azure App Service masked app-settings inspection found no hourly or daily limit override; packaged appsettings therefore applies the reviewed hourly30/daily200 values. No settings, retention or spending dashboard changes. Exact target and manual verification steps are in [the Azure runbook](AZURE-MANUAL-SETUP-RUNBOOK.md).

Deployment evidence: `work/ai-failure-feedback-20261014/backend-deployment.json`.
Same-run API461 and migrator80 tests passed; uploaded/downloaded artifact hashes
matched. Production catalog/checksum validation reported pending scripts0/0/0,
none applied. Only run-owned firewall rule `github-db-38487274921-1` was removed
and verified. OneDeploy `9e9d1f66-2667-4939-86f5-c55d3323ef5e` is active/complete,
status4; public liveness passed at00:03:26.951UTC. No paid inference or production
child records used. Signed-in provider success and authenticated application
SQL-backed readiness remain unverified, distinct from migrator/catalog success.
