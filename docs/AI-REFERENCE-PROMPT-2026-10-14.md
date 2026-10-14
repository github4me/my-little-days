# Embedded sleep references — 14 October 2026

## Scope and current status

The owner approved the displayed prompt and requested the simplified AI controls,
TestFlight delivery and Apple App Review submission. This checkpoint records the
**tested backend prompt update only**. GitHub publication, deployment, the new
signed mobile artifact, Apple processing, tester availability and review submission
are pending at this checkpoint. Prior build 73 evidence is not evidence for this
new candidate. Public approval or release is not claimed.

Only `OpenAiSleepProvider` instructions and their SDK request tests change on the
backend. No SQL migration, authorization, consent version, job contract, provider
model, timeouts, quotas, credentials, retention or spending setting changes.
The mobile UI and its acceptance are tracked separately.

## Embedded reference and behavior

The reference was checked against these primary pages on 14 October 2026:

- [WHO: sleep guidance for children under five](https://www.who.int/news/item/24-04-2019-to-grow-up-healthy-children-need-to-sit-less-and-play-more):
  approximate total daily sleep, including naps, is 14–17 hours at 0–3 months,
  12–16 hours at 4–11 months, 11–14 hours at 1–2 years, and 10–13 hours at 3–4 years.
- [Raising Children Network: tired signs](https://raisingchildren.net.au/babies/sleep/understanding-sleep/tired-signs):
  some newborns tire after roughly 60–90 minutes awake while others remain
  comfortable for two hours or longer; approximate tiredness timing is 90–180
  minutes at 3–6 months and 120–180 minutes at 6–12 months.

These are broad references, not proven optimal individual wake windows, fixed
nap counts or prescriptions. They are embedded in the server instruction; the
AI has no browsing tools and does not fetch reference pages during prediction.
No local prediction or extra output fields were added.

Sparse histories use these references as soft starting points anchored to usable
recorded timing. The prompt must not invent missing sleep, count missing records
as wakefulness, derive wake gaps from daily totals, infer tiredness from feeding,
or force a complete-looking schedule. No usable timing anchor or repeatable
pattern means `insufficient_data`, not fabricated clock times. Credible recent
records increasingly outweigh the reference, and new observations always outweigh
the previous AI estimate.

Schema 2 still returns the whole-day plan, preserving isolated recorded sleep,
handling ongoing timers and interpreting overlaps without changing saved records.
The existing strict output validator and nullable settling rules remain unchanged.
Schema 1 keeps its future-only, non-null settling contract, 12-period cap and
stricter ongoing/conflict handling. The unused `PromptVersion` constant is unchanged;
it is not a deployed-version or cache-invalidation mechanism.

## Verification

Tests use synthetic records, a mocked HTTP transport through the actual pinned
OpenAI SDK and an allowlisted process environment. No real provider request,
production SQL connection or private family payload was used.

| Requirement | Evidence |
| --- | --- |
| "update the prompts" | `ActualWholeDaySdkPromptUsesEmbeddedReferencesAndSparseDataLimitsWithoutBrowsing` validates the actual normal/retry SDK system payload, reference ranges, sparse-data safeguards, record precedence and absent tools. |
| Preserve earlier-client behavior | `ActualSdkWireSendsStoreFalseStrictJsonNoBackgroundAndNoTools` validates the unchanged schema 1 future-only, ongoing/conflict and non-null constraints alongside embedded references. |
| Existing whole-day/temporal behavior | Scoped `SleepAiWholeDayTests` and `SleepAiTests`: **195 passed, 0 failed, 0 skipped**. |
| Full backend build | Non-incremental Release solution build: **0 warnings, 0 errors**. |

Using `/Users/chao/Applications/.dotnet/dotnet` (SDK 10.0.401):

```sh
dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj \
  --configuration Release --no-restore \
  --filter 'FullyQualifiedName~LittleDays.FamilyApi.Tests.SleepAiWholeDayTests|FullyQualifiedName~LittleDays.FamilyApi.Tests.SleepAiTests' \
  --logger 'trx;LogFileName=prompt74-focused.trx' \
  --results-directory work/ai-prompt-release74-20261014/test-results
dotnet build server/LittleDays.slnx --configuration Release --no-restore --no-incremental
```

The executed wrapper preserved only ordinary process paths/home/temp/user values
and explicit .NET telemetry/root settings; it did not inherit application,
provider or SQL configuration. The TRX is local operation evidence, not a
publication artifact. These checks prove submitted instructions and protocol
behavior, **not medical validity or model prediction accuracy**.

## Publication boundary and outstanding gates

Reviewed against remote `feature/family-invitations` commit
`622330cbe9743c5119c4b602d2c9cb857a01d610`, tree
`e71b02f1b705e619e4ec8a5c331f38d3ddca4266`. The three source/test diffs contain only
this prompt update and SDK assertions. Publish them plus this document and the
scoped runbook insertion using the GitHub plugin with an expected-parent check.
Do not publish the unrelated dirty working tree or replace the remote runbook
with the local copy.

| File | SHA-256 |
| --- | --- |
| `server/LittleDays.FamilyApi/SleepAiService.cs` | `ad39f8463fbe7563604f870075db11ca4fe770d25336f412032aae21ce2aab19` |
| `server/LittleDays.FamilyApi.Tests/SleepAiWholeDayTests.cs` | `81d12cd47d2ac3c2f891c0c13f8a3d2130b4c242d0d616e10969ba0126cf967d` |
| `server/LittleDays.FamilyApi.Tests/SleepAiTests.cs` | `7d9887c36015a2cc15cd4f065dd27668d78e68559d7455afda801dc46d4ed8e7` |

Deployment must target the existing App Service and trusted branch, preserving
all current settings. Record the immutable revision, same-run CI results,
artifact hashes, explicit zero-pending migration check, temporary firewall
cleanup, deployment and bounded health evidence after execution. Then separately
record the locally signed mobile artifact, one Apple upload, processing and
TestFlight availability, and actual App Review submission state. Health checks
do not prove authenticated SQL/provider or physical iOS app-switch acceptance.

## Backend deployment checkpoint — 04:48 UTC

The preparation status above is superseded for the backend only. The GitHub plugin
published the exact five-file scope at
`bf69205e77f2fe0216cd21e7f01c99b65540009f`, tree
`ca46c02c167061660e5fb55b9e4d327d0e33d0f5`, over the reviewed parent. Independent
readback at 04:41:52 UTC confirmed all five blobs byte-for-byte, no other changed
paths, and unchanged immutable migration script blobs.

[Deploy run 38512741393](https://github.com/github4me/my-little-days/actions/runs/38512741393),
attempt 1, completed **successfully at 04:47:54 UTC** for that exact revision.
All five jobs succeeded. Same-run real SQL/API tests passed **493**, migrator
tests **91**, with zero failures or skips. Remote-tree TypeScript tests passed
**718**, with zero failures or skips; general, Apple-guidance, sleep-chart and
family-demo browser jobs passed. This remote backend tree is not the separately
frozen mobile candidate, so these are not that candidate's test counts.

The immutable uploaded and downloaded artifact SHA-256 values matched:

- API `family-api-38512741393`, artifact `11870822045`:
  `ee515d22648d3dcfa28024d844c91b7cad800355d84e52d159af76fcfa8f5d76`.
- Database `family-database-38512741393`, artifact `11870617579`:
  `386add3a0d74b860febee04f4157b1e2b345b70b826b535fb9bcab94463786c9`.

Production migration checks reported zero pending before, during and after the
no-op apply. The post-apply catalog/checksum-journal check completed at
**04:46:47 UTC**, explicitly **zero pending scripts**; no new scripts were applied.
Only run-owned firewall rule `github-db-38512741393-1` was removed, with absence
rechecked, at **04:46:48 UTC**. The recovery cleanup step also succeeded.

OneDeploy `73c79631-e79e-42e4-a37a-3bcbcdb3e9a3` completed at
**04:47:48 UTC**, status 4, complete and active. Workflow liveness passed at
04:47:51 UTC. Independent sequential anonymous GET checks at
**04:48:26–04:48:27 UTC** returned live/ready **200**, and session, legacy AI
capabilities and job capabilities **401**. No cookies, bearer token, child records
or provider credentials were sent. These checks do not demonstrate signed-in
SQL operations, live OpenAI completion or physical-device acceptance.

Sanitized local receipts are under `work/ai-prompt-release74-20261014/`:
`publication-verification.json`, `workflow-artifacts.json`, `ci-verification.json`,
`deployment-run-success.json`, `deployment-verification.json`, and
`boundary-check-1791953307710.json`. They contain metadata only, not private family
payloads. No new services, settings, credentials, migrations or provider dashboard
changes occurred in this scoped prompt release. The mobile/TestFlight and App
Review gates remain separate and are not claimed complete by this checkpoint.
