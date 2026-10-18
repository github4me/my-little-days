# AI output-schema correction — 19 October 2026

Owner requested “fix deploy” after the first live exchange-capture diagnosis.
This is backend-only, not a TestFlight or public App Review submission.
Deployment and post-release signed-in acceptance remain pending until a
completion receipt is added.

## Confirmed failures and bounded correction

Current-epoch unexpired SQL captures contained five calls across three jobs:
four HTTP200 responses for schema2 and one HTTP400 for schema3. None was
truncated; each expiry was604800 seconds after request start. Latest schema3
failed18 October16:02:59 UTC /19 October03:02:59 Melbourne in301ms:
`invalid_json_schema`, `text.format.schema`, with a `$ref` carrying a
`description` sibling in `sleepStart`. It was not a network timeout.

The embedded schema now keeps reference objects as `$ref` only, moving their
field explanations to the containing definition descriptions. Timestamp
format/pattern, strict object keys, paired settling branches, period limits,
minute/DST and remaining-day validation are unchanged. The supported-reference
shape is documented in [official OpenAI Structured Outputs
documentation](https://developers.openai.com/api/docs/guides/structured-outputs);
the captured provider rejection identifies the exact incompatible sibling.

The four schema2 completions took9.1–15.8seconds but both jobs failed
`recorded_sleep_missing`. Sanitized SQL projections confirmed each missed an
input sleep record crossing midnight. The legacy prompt now explicitly retains
that original prior-date start and actual completed end, checks mandatory
anchors before returning ready, and repeats the check on repair. Validation is
not loosened; no record or response is silently rewritten. This prompt change
cannot guarantee model compliance; a new real schema2 request is needed before
claiming live success.

No raw child histories, payloads, account identifiers or credentials belong in
this receipt. No privacy wording, consent, quota, model, Fast, timeout, polling
or seven-day capture behavior is changed. Existing opt-in and authority/
revocation boundaries remain enforced.

## Focused verification

SDK10.0.401, SDK-style net10.0, xUnit2/VSTest, existing pinned packages; no
run-tests repository overlay exists. OpenAI Docs informed the reference shape;
.NET testing skills drove SDK-wire/validator regressions.

```sh
/Users/chao/Applications/.dotnet/dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj --configuration Release --filter 'FullyQualifiedName~SleepAiRemainingDaySchemaTests|FullyQualifiedName~SleepAiWholeDayTests' --logger 'console;verbosity=quiet'
```

Passed:106, Failed:0, Skipped:0. The new reference regression first failed
against the old schema (Failed:1, Passed:0, Skipped:0) and passes after correction.
Synthetic SDK transport tests do not contact or bill the provider.

| Requirement | Evidence |
| --- | --- |
| “fix” — current schema | `RemainingDaySchemaReferencesHaveNoSiblingKeywords`; `RemainingDayWirePreservesExactStrictSchemaAndPrivacyOptions` recursively checks initial/retry serialized schema |
| “fix” — displayable output | `RemainingDayWireReturnsDisplayableReadyPredictionWithoutRecordedHistory` passes SDK-shaped completed text through the real validator, both awake and currently asleep |
| “fix” — legacy omission | `WholeDayProviderRetainsCrossMidnightAnchorsInInitialAndRetryInstructions` pins exact context endpoints and initial/retry instructions; strict anchor rejection remains tested |
| “deploy” | Pending guarded release with exact source/artifact hashes, zero pending scripts, health and live capture acceptance |

No model/SDK/package upgrade or new Azure service is needed. Reuse the trusted
branch API+DbUp workflow; no SQL migration should be pending. Preserve all
runbook target, identity and firewall safeguards.

## Deployment completed

Runtime `bb826c70e898cd068289703d7321a6194771fffb`, tree
`eb89b48c3fdec98cd9d9cbbf66473787637d3860`, deployed in
[run39144141365 / deployment32](https://github.com/github4me/my-little-days/actions/runs/39144141365).
All five jobs succeeded. Published through the GitHub plugin with an expected
branch-head lease; only four reviewed source/test/resource files plus this
receipt and an appended runbook section entered the candidate. Unrelated dirty
checkout files were not included. The branch remained fixed through deployment.

Frozen non-incremental build:0 warnings/errors. Full local solution test:
API Passed:666, Failed:0, Skipped:145; migrator Passed:44, Failed:0, Skipped:41.
Skipped tests require disposable SQL, unavailable locally. Release CI supplied
real-SQL acceptance: **API Passed:811, Failed:0, Skipped:0; migrator Passed:157,
Failed:0, Skipped:0**. TypeScript/browser, Apple-browser, sleep-chart, family-demo
and Watch protocol gates also passed. The known `/private/` source-path false
positive in an unrelated Graph test was avoided with PathMap, not test changes.

Source archive SHA-256:
`38144cfc5feb33b01526f8b275aed9cf476d134c400edd3bb84bdb6438a5606a`.
API artifact12141929144 SHA-256:
`145738f178216c14f057de286088a17174864d76ca1191400d9944cba14c93db`.
The downloaded artifact matched that digest. Its DLL contains the exact frozen
schema bytes and runtime SHA; package capture/model/limits remain unchanged.
Database artifact12142484251 SHA-256:
`aa9cea41d1b1f8103392b46c5f72d0c0c4da77e80430c4705d2617fd4403c950`.

Both GitHub environments' current targets, selected trusted branch, reviewer/
timer settings and admin bypass were read before dispatch; no settings changed.
`database_bootstrapped=true`, `adopt_ef=false`. Catalog verification reported
pending scripts0 before, during and after the no-op at16:21:00/04/11 UTC.
The temporary exact runner-IP firewall rule was removed16:21:13 UTC; retained
operator access was preserved. No immutable SQL script was changed.

Package upload completed16:22:09 UTC. Bounded startup checks initially saw503,
then live returned200 at16:23:35; no restart/redeployment loop was introduced.
Independent16:24:20 UTC checks: live200, ready200, unauthenticated jobs
capabilities401, all no-store. Melbourne dates/times are19 October03:22–03:24.
Existing tenant/subscription/RG/API/SQL, model/Fast/quota and AI capture settings
were preserved. No credential, spend/retention dashboard, privacy wording,
app consent, mobile build or Apple distribution change occurred.

A read-only current-epoch/unexpired SQL check after startup returned zero
post-fix exchange rows. Live schema acceptance, model compliance and display on
an installed app remain pending the next authorized user request; health or
fake-transport tests are not that proof. No private request/response was exported
to Git, ordinary logs or screenshots. This documentation-only completion receipt
does not change the runtime SHA above.
