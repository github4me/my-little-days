# Minute-precision AI validation and failure fields

18 October 2026. **Backend deployed successfully at 08:35:21 UTC (19:35 Melbourne),
authorized by “deploy” / “try again”. No app upload or production inference.**
Implementation request: “更改校给，时间精确至分钟即可。所有错误都记录具体原因，字段”.

## Changes

- API and app match isolated recorded start/end anchors by the same UTC minute,
  ignoring seconds/fractions without rewriting stored records or AI output.
- Provider instructions explicitly allow same-minute `:00`, not rounding into
  a neighboring minute. Output chronology, positive durations, bounded horizon,
  required settling ranges and ongoing future wake remain strict.
- Preserve one-to-one isolated matching: neither multiple distinct short records
  nor multiple output segments may collapse/reuse a minute-matched anchor.
- Every classified output failure has a fixed reason and canonical affected
  fields; period index remains available where the validation rule identifies
  an output period. Parser errors include the canonical field path. Provider
  failures identify `$provider`, not an invented output field.
- Private failed-attempt storage adds nullable `FailureFieldsJson` via additive
  migration 0013. No raw input-field values, unknown JSON keys or exception
  messages are added. Seven-day retention and existing lifecycle safeguards stay.

## Behavioral evidence

| Requirement | Exact tests |
| --- | --- |
| “时间精确至分钟即可” | `RecordedSleepMatchesSameMinuteAcrossSecondsFractionsAndOffsetsWithoutMutation`; `RecordedSleepRejectsDifferentMinuteEvenAcrossOneMillisecondBoundary` |
| “时间精确至分钟即可” without merging facts | `MinuteMatchingCannotReuseOneRecordedSleepForTwoOutputPeriods`; `AI minute matching accepts one short recorded sleep but rejects reusing it for split output periods` |
| “所有错误都记录具体原因，字段” for classified AI output/call failures | `EveryValidationReasonHasItsExpectedCanonicalFields`; `InvalidTimestampIdentifiesItsExactOutputField`; `ProviderFailuresIdentifyProviderRatherThanOutputFields`; `CaptureCopiesDistinctCanonicalOutputFieldsWithoutRetainingCallerMutation` |
| Persist private fields without changing compatibility/expiry | `SpecificFailureFieldMetadataIsPersistedWithPrivateReasonOnly`; `FieldMetadataUpgradePreservesFailuresAllowsPreviousApiInsertsAndHasVerifiedNoOp` — passed against disposable SQL in both push CI and release verification |

Commands:

```sh
env -u FAMILY_TEST_SQL_CONNECTION /Users/chao/Applications/.dotnet/dotnet test server/LittleDays.slnx --configuration Release --no-restore --logger 'console;verbosity=quiet'
npm run verify
npm run typecheck
node --import tsx --test --test-reporter=dot src/*.test.ts
node --import tsx --test src/aiSleep.test.ts
git diff --check
```

The full `npm run verify` passed. Following the review's final short-record reuse
fix, typecheck and the complete `src/*.test.ts` suite passed again; focused AI
client suite: **40 passed, zero failed/skipped**. Final .NET run: API **591 passed,
141 skipped**; migrator **29 passed, 39 skipped**; zero failures, exit 0. All
skips require unavailable disposable SQL. No browser/device runtime or paid
provider call was used to claim acceptance.

Static gap/assertion review found and resolved the split-anchor reuse case and
added exact field assertions for all fixed validation categories. The pairing
analyzer could not run because its tree-sitter dependency is absent; no dependency
was installed merely for that tool, and no analyzer coverage is claimed.

## Production deployment evidence

Frozen release SHA: `d3199262be188e930285acb2eac722abbd4c12c7`, committed through
the GitHub plugin from trusted parent `67b10ea146dc520e576a69e7cf2eb77461432b27`.
The candidate contains only 17 scoped backend/migration/test/documentation files;
old migration scripts 0001–0012 are byte-unchanged. The older dirty local checkout
was not published wholesale. The branch stayed frozen through deployment.

Push CI `39109659763` and release verification job `117628342258` both ran:

```sh
dotnet test server/LittleDays.slnx --configuration Release
```

Literal release totals: **API Passed 732, Failed 0, Skipped 0, Total 732**;
**migrator Passed 137, Failed 0, Skipped 0, Total 137**. These runs used real
disposable SQL, including persistence, drift, legacy insert and verified no-op
tests that could not execute locally. TypeScript, Watch and browser checks also
passed in both workflows.

[Production release 39111462996](https://github.com/github4me/my-little-days/actions/runs/39111462996)
was dispatched from `feature/family-invitations` with `database_bootstrapped=true`
and `adopt_ef=false`. Immediately before dispatch, both `family-database` and
`family-pilot` environments restricted deployments to that branch, with required
reviewers/wait timer disabled and administrator bypass enabled. These existing
settings and the previously verified target variables were observed, not changed.

Targets: tenant `reticle.com.au` / `7b7e6e31-a778-4334-aee2-e969fa27fd0e`,
subscription `4768a858-f23f-4a39-bb64-eabc9c142627`, resource group
`my-little-days-pilot-rg`, SQL `little-days-sql-522fpstfbtds2` / `little-days-family`,
API `little-days-api-522fpstfbtds2`. Production migration job `117629407148`:

- 08:33:01 UTC: exactly one pending script, `0013_SleepAiFailureFields.sql`.
- 08:33:12 UTC: migration completed successfully.
- 08:33:17 UTC: post-apply catalog/journal verification returned
  `Pending database scripts: 0`.
- 08:33:19 UTC: this run's temporary exact runner-IP SQL firewall rule removed;
  recovery cleanup also succeeded. The expressly retained operator rule was not
  targeted or removed.

Actual release API artifact `12130143133` (`family-api-39111462996`) was
independently downloaded and inspected. ZIP SHA-256
`40a4daa89bae093b3a62dd98e1600c013544add5aece50b9256ab0364828b191` matches GitHub;
the DLL embeds the frozen SHA and the new minute/field symbols. Packaged settings
retain `gpt-6-luna`, concurrency 50, account/hour 30, daily 200. Packaged Pkcs is
10.0.13, file version 10.0.1326.50504, DLL SHA-256
`eff9ed505c194f0f5c9faef1a175459cd0560eeb4ad08890c7c0c0e1ff4d34c3`.
Database artifact `12130382475` has published ZIP SHA-256
`be7baca93cc3fa214ce3aa3264d94268bc5c5081d2beacde07ab4e830fa7842d`.
Provider code still inherits the project-default service tier; artifact inspection
does not independently verify that external setting. No provider dashboard was
reopened, paid inference triggered, or live configuration changed.

API job `117629620468` deployed OneDeploy
`ea781b4a-a476-419a-9a64-22454ba36f71`, then liveness passed at 08:35:19 UTC.
All five release jobs completed successfully at 08:35:21 UTC. Independent
sequential HTTP checks at 08:35:33 UTC returned `/health/live` 200 / `ok`,
`/health/ready` 200 / `ready`, and unauthenticated
`/v2/sleep-prediction-jobs/capabilities` 401 / `unauthorized`. Readiness is the
recovery gate, not a SQL probe or proof of signed-in runtime access.

## Outstanding client and live acceptance

The backend is active for subsequent requests. Existing stored failure rows were
not backfilled; new field persistence is proven by disposable SQL tests, not by
inducing a live-family failure. Signed-in runtime SQL/device acceptance and
restricted readback of a naturally occurring new eligible failure remain separate.

Matching app changes remain local and were not included in this backend release.
Older installed apps still enforce exact anchors and may reject minute-rounded
AI results even when the new API accepts them. Publish a matching client build
and verify on a physical phone. Do not change request hashes/raw record times or
silently bypass the old client validation to work around that limitation.

The model, Fast setting, quotas, concurrency, polling, consent and retention
configuration were not changed. No universal operational-exception capture is
claimed; admission/authorization/SQL/shutdown errors retain existing safe job
and timing handling, and optional payload capture remains best-effort.
