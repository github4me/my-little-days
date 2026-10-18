# Provider request/response capture — local implementation

Status: release candidate prepared with capture **enabled for all new resumable
AI jobs**. Deployment and live verification are pending. The owner explicitly
instructed all-user activation on 19 October 2026 after the initial disabled
implementation. No public privacy/support page, app consent text or Apple build
is being changed in this backend release.
This adds diagnostics; it does not establish or fix the cause of the latest
`ai_provider_unavailable` failures.

## Capture contract

For newly enqueued resumable jobs stamped with the capture epoch, when the
operator feature flag is enabled:

- Capture the actual serialized provider HTTP JSON: system prompt, history and
  today's projected records, age/timezone, prior estimate, model, schema and
  generation settings. No reconstruction from later database records.
- Write a `dispatching` receipt before sending. Record each initial/repair call
  separately by user/job/run/attempt. A dispatching receipt proves an attempted
  dispatch, not that OpenAI received the request.
- Retain successful and failed HTTP response bodies, including provider error
  code/message/parameter, HTTP status and the allowlisted `x-request-id` value.
  Record transport/cancellation and response-read failures explicitly.
- Retain start/finish timestamps and transport duration. That duration excludes
  the pre-dispatch database write; the existing outer Provider timing includes
  capture overhead when enabled. Existing failed-output validation details can
  be correlated through job/run/attempt.
- Store only in restricted `dbo.SleepAiExchanges`; never expose bodies through
  the prediction API or ordinary application logs. Never copy authorization or
  other HTTP headers. Redact the configured API key if an error body echoes it.
- Keep each body up to 1 MiB UTF-8 and mark truncation/unreadability explicitly
  with original byte counts (or -1 when unknown). This is bounded diagnostic
  capture, not a guarantee of every byte for oversized/unreadable responses.

The SDK remains non-streaming, no-store, with no hidden SDK retries. Capture
uses cached HTTP content so the SDK reads unchanged bytes. The collector and
HTTP client are scoped per worker; only the inner HTTP transport is pooled.
Legacy synchronous endpoints remain outside this durable capture policy.

## Retention and lifecycle

Expiry is exactly `StartedAt + 7 days` in UTC. Administrative reads must filter
`ExpiresAt > SYSUTCDATETIME()` and the freshly verified current history epoch.
The existing hourly worker removes expired/obsolete rows in batches of 500,
also with AI generation disabled. Physical deletion can lag expiry until the
worker runs; this does not change SQL backup retention.

Turning AI off / cancelling the corresponding job or consent purges its rows.
Ended membership, family closure and account deletion use the existing cleanup
boundaries, including other affected family captures on account deletion.
Publication rechecks authority, live lease, run, epoch, consent and job expiry,
so late responses cannot recreate revoked capture. Old unstamped jobs are never
backfilled. A recovered worker run has a distinct run key.

Capture is best effort: failed SQL writes, shutdowns and revoked/expired jobs can
leave gaps. A fixed metadata-only `SleepAiCaptureGap` warning records rejected
or failed writes without exception text. It must never cause another paid AI
call or change generation success/failure. Do not promise lossless audit logs.

## Activation boundary and deployment prerequisites

`SleepAi:FullRequestCaptureEnabled` is explicitly true in the reviewed release
configuration; default unconfigured option instances remain false. Existing AI
opt-in and authorization are still required; no extra diagnostic prompt or app
upgrade is introduced. The current app disclosure says request contents are
cleared when a task ends. The owner directed activation for all users without
changing that wording; the discrepancy remains outstanding and is not presented
as resolved. No public policy or consent text was changed.

Before release: exercise the SQL tests against a
disposable SQL Server, review storage capacity (live Basic is finite), freeze
the release, apply additive script 0014 before the API and verify catalog plus
zero pending scripts. Preserve the retained operator firewall rule. Restore or
rollback maintenance must clear this table together with failed-output captures
before reopening traffic. There is no client/UI change requiring TestFlight.

## Verification

The .NET test-generation/run guidance drove HTTP-wire, error, scope, expiry and
revocation checks. Static pairing tooling could not run because the installed
Python lacks `tree-sitter-language-pack`; it was not installed or replaced with
a heuristic coverage claim.

Focused command:

```sh
/Users/chao/Applications/.dotnet/dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj --configuration Release --filter 'FullyQualifiedName~SleepAiExchangeCaptureTests' --logger 'console;verbosity=normal'
```

Initial implementation: Passed: 19, Failed: 0, Skipped: 0. Activation regression:
Passed: 20, Failed: 0, Skipped: 0, including
`ReleaseConfigurationEnablesFullCaptureWithoutChangingAiQuotasOrModel`.
These are fake-transport tests, not paid
provider calls or production acceptance.

| Requirement | Evidence |
| --- | --- |
| “implement thr full request capture” | `ActualSdkRequestAndErrorResponseAreRetainedBeforeSdkConvertsError`; `CapturesExactRequestBeforeDispatchAndFullResponseWithoutHeadersOrApiKey` |
| “responses” / failures | `HttpErrorsRetainStatusFullErrorBodyAndRequestWhileRedactingKnownKey`; `TransportAndCancellationKeepRequestAndSafeFailureWithoutChangingException`; `UnknownLengthChunkedResponseIsCapturedAndRemainsReadable`; `UnreadableResponseHasStatusAndExplicitCaptureGapInsteadOfFalseEmptySuccess` |
| “retsin for 7 days” | `CapturesExactRequestBeforeDispatchAndFullResponseWithoutHeadersOrApiKey` pins exact expiry; `DispatchAndResponseAreUpsertedBeforeCompletionAndRemainExactlySevenDays` tests physical cleanup just before/at expiry, **SQL execution pending** |
| Preserve generation, isolation and limits | `BrokenDiagnosticStoreCannotFailOrRetryGeneration`; `InitialRepairAndConcurrentScopesKeepSeparateBodiesAndAttemptNumbers`; `RegistrationKeepsCollectorAndWireClientScopedAndCaptureDisabledByDefault`; `SizeBoundsRetainExactByteCountAndExplicitTruncation`; `Utf8PrefixDoesNotLeaveBrokenEmojiAndApiKeyCannotLeakAsRequestId` |

Four new API SQL tests and five new migrator SQL methods/cases require a
disposable SQL connection. Local Docker daemon is unavailable and
`FAMILY_TEST_SQL_CONNECTION` is absent; no production database was used as a
substitute. SQL cleanup/catalog/lease acceptance must not be claimed from the
passing fake HTTP tests.

Final non-incremental solution build: zero warnings/errors. Final regression:

```sh
/Users/chao/Applications/.dotnet/dotnet build server/LittleDays.slnx --configuration Release --no-incremental
/Users/chao/Applications/.dotnet/dotnet test server/LittleDays.slnx --configuration Release --no-build --logger 'console;verbosity=quiet'
```

API: Passed: 660, Failed: 0, Skipped: 145.
Migrator: Passed: 30, Failed: 0, Skipped: 41.
Skipped methods require disposable SQL; they are not successful SQL evidence.
`git diff --check` and explicit new-file whitespace checks passed. Tests use
only synthetic inputs; no real AI request, release, credentials change or
private-payload export occurred.

## Subsequent activation receipt

The owner subsequently authorized all-user activation. Backend runtime
`d19200022d32bf760f8986318799abf65f51e51a` was deployed successfully in
run39133786764, with806 API +157 migrator tests passing against disposable SQL
(zero failures/skips), additive0014 applied and zero pending scripts verified.
This supersedes the local-only SQL-pending statements above. Capture is enabled
for new resumable AI jobs; first signed-in live capture remains unverified.
No mobile build or public disclosure update was made. See the exact evidence,
limitations and outstanding checks in
[the deployment receipt](AI-CAPTURE-DEPLOYMENT-2026-10-19.md).
