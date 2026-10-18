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
