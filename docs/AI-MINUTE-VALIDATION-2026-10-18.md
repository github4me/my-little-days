# Minute-precision AI validation and failure fields

18 October 2026. **Backend deployment authorized by the subsequent “deploy”
request; release verification in progress, not yet live. No app upload or
production inference.** Implementation request: “更改校给，时间精确至分钟即可。所有错误都记录具体原因，字段”.

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
| Persist private fields without changing compatibility/expiry | `SpecificFailureFieldMetadataIsPersistedWithPrivateReasonOnly`; `FieldMetadataUpgradePreservesFailuresAllowsPreviousApiInsertsAndHasVerifiedNoOp` — compile, but real-SQL execution pending |

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

## Rollout still required

Use disposable SQL/CI to execute the SQL persistence, migration, catalog drift,
legacy insert and verified no-op cases before release. Local disposable SQL was
unavailable, so those skips are not passes. Apply 0013 before deploying the API.
Older app builds still enforce exact anchors and may reject minute-rounded AI
results even when the new API accepts them; publish a matching client build and
verify on a physical phone. Do not change request hashes/raw record times or
silently bypass the old client validation to work around that limitation.

The model, Fast setting, quotas, concurrency, polling, consent and retention
configuration were not changed. No universal operational-exception capture is
claimed; admission/authorization/SQL/shutdown errors retain existing safe job
and timing handling, and optional payload capture remains best-effort.
