# Pure-AI sleep integration

Status: local implementation and automated verification, 12 October 2026. Not deployed or enabled. No real child records have been submitted to a model. Synthetic fake-provider tests establish software behavior, not prediction quality or clinical effectiveness.

## Approved behavior

The app derives exact age in **calendar days** from a valid birth date. It selects the previous **seven complete local dates plus today**, using an IANA timezone rather than subtracting 168 hours. Sleep overlapping the history boundary retains its true start (bounded to 24 hours before the cutoff). The request contains only sleep/feed times, running state, bottle type/breast (without side), and bottle amount. Names, full DOB, notes, photos, entry identifiers and unrelated records are excluded.

An authenticated first-party API calls the configured OpenAI Responses API through `Microsoft.Extensions.AI.IChatClient`. The model—not the app or API—produces all predicted times. The server forwards only the allowlisted age/time/record fields, never account/family/grant/history identifiers. No embeddings, training, retrieval, agents or tool execution are involved.

The UI draws recorded facts and the AI result. The dial shows the current local 00:00–12:00 or 12:00–24:00 half-day. Predicted whole sleep and windows to **begin** settling are distinct, with full dated endpoints preserved across clipping. The result contains no generated explanation or confidence prose. A short fixed safety notice remains visible: suggestions may be inaccurate; respond to tiredness/hunger, not the clock.

## API contract

`GET /v2/sleep-predictions/capabilities` returns `{ enabled, consentVersion: "sleep-ai-v1", provider: "OpenAI", requiresSignIn: true }`. It accepts no child records. The client does not send predictions when the capability is disabled or unknown.

`POST /v2/sleep-predictions` accepts schemaVersion 1, a SHA-256 inputRevision, consentVersion, current familyId/membershipId/historyId (all null for personal mode), ageDays, timeZone, now and records. Maximum 512 records; input timestamps and overlap are validated. The endpoint is authenticated and directory-admitted. SQL-backed account and optional current family grant/history authorization happens before each provider attempt and after generation; no SQL lock is held during the external call.

Response:

```json
{
  "schemaVersion": 1,
  "inputRevision": "<matching SHA-256>",
  "status": "ready | insufficient_data | unavailable",
  "generatedAt": "<ISO timestamp>",
  "expiresAt": "<ISO timestamp>",
  "periods": [
    {
      "sootheStart": "<ISO timestamp>",
      "sootheEnd": "<ISO timestamp>",
      "sleepStart": "<ISO timestamp>",
      "sleepEnd": "<ISO timestamp>"
    }
  ]
}
```

This is a contract illustration, not an actual prediction. Settling timestamps delimit when to **start** settling, not how long to persist. Empty periods are required for non-ready states. Maximum 12 chronological nonoverlapping periods. Require `now <= sootheStart < sootheEnd <= sleepStart < sleepEnd`, no overlap with recorded sleep or earlier predicted sleep, sleepStart before next local midnight, and sleepEnd no later than next local noon. An ongoing sleep cannot produce a guessed wake boundary or ready schedule.

Strict structured output is followed by independent server and client semantic validation. No sorting, truncation, moving, filling or local fallback repairs a model response. One bounded model-format retry is allowed, sharing the 30-second deadline and charging another quota unit; provider automatic retries and background/stored responses are off. Cancellation, refusal, invalid or incomplete outputs fail closed. Network failures do not cause retries in the client.

## Consent and stale-response isolation

- Explicit opt-in names OpenAI and the precise data/use. It is independent of family sharing, sign-in and any old records-accuracy confirmation.
- Consent is device-local and account/server/family-grant-history/profile scoped, stored with a hashed key. Neither consent nor predictions sync to other caregivers automatically. A changed consent version requires new opt-in.
- Enabling waits for a successful consent write. Revoking immediately stops sending, aborts pending work and removes results; it does not pretend to recall data already sent. Failed persistence stays denied for the process and offers retry; a failed write cannot guarantee persistence across an app restart.
- Predictions stay in memory only. The exact minimized input revision, account/access epoch, family grant/history and baby context guard every publication. Updates invalidate old output before a new request finishes. Editing notes, excluded old records or reordering identical data does not request another prediction.
- Responses expire after 15 minutes; clock ticks do not silently buy new predictions. Expired output is removed and can be refreshed. Navigating to Records or changing relevant records can request new output only with current capability, consent and authority.
- The first-party HTTP client receives no OpenAI key. Provider keys belong only in server secrets. No request/response payload, raw provider exception or identifiable child data is logged by this feature.

## Activation is blocked pending verification

The API defaults off. Enabling requires explicit configuration flags for child-data processing approval, Zero Data Retention approval and **enforced** hard spending controls, plus the explicitly selected supported model and secret key. These flags record operator decisions; they do not obtain approval or enforce provider policies by themselves.

**Model selection — 13 October 2026:** The owner selected `gpt-6-luna`. The local
options default and `appsettings.json` now use that exact ID. The current
[official model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna)
lists `gpt-6-luna` itself as its default snapshot and supports Responses and
structured outputs; it publishes no dated suffix to configure. The activation
validator therefore accepts this one exact reviewed ID as well as its existing
dated-ID format, without admitting other undated aliases. No automatic model
substitution or fallback was added. `SupportsTemperature=false`, all four
activation flags, key requirements, quotas, schema validation and no-store
behavior remain unchanged. This is a local configuration change, not deployment,
proof of immutable model behavior, retention eligibility or prediction quality.

Selection verification: **Passed: 84, Failed: 0, Skipped: 0** with
`env -u FAMILY_TEST_SQL_CONNECTION /Users/chao/Applications/.dotnet/dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj --configuration Release --filter 'FullyQualifiedName~LittleDays.FamilyApi.Tests.SleepAiTests' --no-restore`.
The final non-incremental Release solution build also passed with zero warnings
and errors. Tests use fictional records and an in-memory HTTP handler; no provider
credentials, model calls or SQL connections were used.

| Requirement | Evidence |
| --- | --- |
| “use gpt-6-luna model” | `ModelPolicyAllowsOnlySelectedLunaOrDatedIds` accepts the exact selection and rejects unreviewed aliases; `ActualSdkWireSendsStoreFalseStrictJsonNoBackgroundAndNoTools` verifies the actual SDK request's model is unchanged |
| Keep configuration disabled and preserve safeguards | `EveryActivationGateIsRequired` exercises both dated and Luna IDs; `HttpRequiresJwtAndDirectoryAdmissionAndDisabledCapabilitiesNeverResolveProvider` verifies the bound model, disabled capability and zero provider resolutions |

`store:false` is not Zero Data Retention. OpenAI's under-18 guidance requires ZDR before processing personal data of children under 13. Removing a name does not prove that detailed infant records are anonymous. Validate the chosen project/endpoint/model's retention, region and contractual applicability before any real-data trial. Sources: [OpenAI under-18 guidance](https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance), [data controls](https://developers.openai.com/api/docs/guides/your-data), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

Per-process counters and two-call concurrency protect the service, but are not a distributed billing cap: scaling and restarts change them. A dashboard budget alert is not a hard stop. Before enabling, verify a genuinely enforced provider/project ceiling or implement a durable cross-instance admission ledger and stop conditions.

Update the public privacy/support policy in `github4me/my-little-days-privacy`, in-app disclosures and Apple's App Privacy/review notes before a release that sends records. No public page, App Store label or legal declaration is changed by this implementation. Manual gates/settings are in the [Azure runbook](AZURE-MANUAL-SETUP-RUNBOOK.md).

## Verification and remaining acceptance

### Integration-test rerun — 13 October 2026

The owner's integration-test request was checked with the existing synthetic
suites. SDK `10.0.401`, xUnit 2 / VSTest, no repository test overlay. Both commands
start from an empty environment and allowlist runtime settings only, excluding
provider credentials and `FAMILY_TEST_SQL_CONNECTION`. No package restore or
live SQL/provider access was performed.

Server, exit 0 — **Passed: 84, Failed: 0, Skipped: 0**:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/Users/chao DOTNET_ROOT=/Users/chao/Applications/.dotnet DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 /Users/chao/Applications/.dotnet/dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj --no-restore --filter 'FullyQualifiedName~LittleDays.FamilyApi.Tests.SleepAiTests&FullyQualifiedName!~SleepAiSqlTests' --logger 'console;verbosity=normal'
```

Client, exit 0 — **Passed: 36, Failed: 0, Skipped: 0**:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/Users/chao /usr/local/bin/node --import tsx --test src/aiSleep.test.ts src/aiSleepCoordinator.test.ts src/useAiSleep.test.ts src/aiSleepConsentStorage.test.ts
```

The SDK wire tests use a mocked HTTP transport, including the selected
`gpt-6-luna`, and verify strict JSON, `store:false`, no background mode/tools,
and the 4096-token output limit. HTTP and client tests verify consent, access
rechecks, cancellation/late-response isolation, malformed-output rejection and
no local prediction fallback. These passes do not verify actual model output,
credential validity, SQL-backed authorization or physical-device behavior.

The initial live synthetic attempt did **not** run: the Azure SSH browser tab was
blocked by an extension UI. The subsequent explicit retry succeeded as recorded
below. AI remains disabled. Current provider-control observations are in the
[Azure runbook](AZURE-MANUAL-SETUP-RUNBOOK.md).

### Live provider smoke tests — 13 October 2026

Two sequential bounded Responses requests ran inside the existing Azure App
Service using its saved key without exposing/copying it. Both explicitly selected
`gpt-6-luna` and project `proj_Z63Ed6CGtNfXyC5QIHmui8gg`, with strict current
output schema, `store:false`, `background:false`, no tools/temperature, maximum
4096 output tokens, no retries/redirects, and a 35-second overall timeout. Both
returned HTTP **200**, model **gpt-6-luna**, status **completed**, with curl and
output-filter exit codes **0**. No real child data, SQL or authenticated app
endpoint was involved; no production activation flags changed.

1. Empty-record input returned exactly
   `{"status":"insufficient_data","periods":[]}`; JSON and exact expected
   keys/status were checked locally. Usage: 243 input / 38 output tokens.
2. Generated fictional history (86 sleep/feed records spanning the previous
   seven local days and today, age 100 days, Australia/Melbourne, fictional now
   13 October 2026 at 16:55 AEDT) used the current provider instructions and
   returned `ready` with the two periods below. Usage: 4635 input / 677 output
   tokens. The output was transcribed from the SSH result and passed
   `validateAiSleepResponse` unchanged with a synthetic response envelope and
   the fixture's clock. This checks client semantic acceptance, not the deployed
   server authorization/response-envelope path.

| Fictional settling-start window | Fictional predicted sleep |
| --- | --- |
| 13 Oct 16:55–17:05 AEDT | 13 Oct 17:05–17:30 AEDT |
| 13 Oct 19:55–20:05 AEDT | 13 Oct 20:05–14 Oct 06:40 AEDT |

These are synthetic technical test results, **not advice for the owner's baby**
or evidence of prediction accuracy. The empty-record smoke test used a shortened
insufficient-data instruction; the history test used the implementation's
provider instructions. Requests were direct HTTPS smoke tests, not execution of
the .NET SDK in production; the actual SDK request shape is covered separately
by the local mocked-transport tests above. Effective ZDR, the AUD-equivalent
spend ceiling, disabled backend deployment, SQL-backed authorization and
signed-in physical-device end-to-end acceptance remain outstanding.

### Earlier implementation verification

Completed locally with synthetic inputs and no provider credentials:

| Scope | Result / evidence |
| --- | --- |
| Client contract, coordinator, consent storage and hook | 36 passed: `node --import tsx --test src/aiSleep.test.ts src/aiSleepCoordinator.test.ts src/useAiSleep.test.ts src/aiSleepConsentStorage.test.ts` |
| Whole app typecheck and configured unit/VM regressions | `npm run verify` passed after updating the explicit VM dependency fixtures for the new hook; existing behavior assertions were retained |
| Server build | Release solution build passed, zero warnings/errors |
| Server focused sleep AI | 72 passed, 2 isolated-SQL tests skipped |
| Complete .NET solution | 237 passed, 140 isolated-SQL tests skipped; `FAMILY_TEST_SQL_CONNECTION` deliberately unset, not pointed at production |
| Production JavaScript bundling | Web and iOS exports passed with dotenv disabled, family public settings blank and demo `0`; these are test bundles, not signed/releasable native builds |
| Existing full-App browser regression | `npm run test:browser` passed, including local records, calendar/history, bilingual/account and sleep flows |
| Pure-AI component browser matrix | 17 passed, including separate consent/revocation, exact model ranges, half-days, fail-closed states, narrow Chinese and Night layouts |
| Pure-AI full-App browser integration | 3 passed: narrow English Light with live noon transition, phone Simplified Chinese Night with missing birth date, iPad-sized Traditional Chinese Light with future birth date. All assert signed-out no-prediction/no-external-request behavior, actual recorded endpoints, Records placement/default disclosure, sign-in navigation and unchanged local records |
| Independent review | Original null bottle-amount validation finding fixed; deferred initial/post/retry authorization, late account consent hydration, continuation/non-text output and recovery-gate regression assertions added; bounded re-review resolved the original findings |
| Design review | Impeccable finish verdict **ship** for supplied browser-component evidence only, in `.impeccable/review/ai-sleep/finish-review.md`; preserves incumbent controls, system typography, semantic surfaces and readable interval lists |

The corrected `font-scale-branch-keeps-complete-text-ranges.png` exercises the custom layout branch before and after capture; React Native Web does **not** demonstrate actual iOS Dynamic Type scaling. These captures contain deliberately fictional times, not a live AI result. New sharing copy has reviewed English, Simplified and Traditional Chinese; other locales currently fall back to English.

Run `npm run test:ai-sleep` (alias of `test:sleep-guidance`) for the new full-App plus component browser coverage after the isolated web export. Historical `tests/sleep-guidance-browser.mjs` and `tests/sleep-halfday-browser.mjs` describe the superseded local-prediction UI and must not be treated as acceptance of this pure-AI revision. Their sources remain unchanged as historical tests and are no longer the `test:sleep-guidance` entry point. The historical domain modules/tests remain for traceability, but the active `SleepGuidanceSection` never calls them; its only local computation positions recorded facts and AI intervals for display.

Remaining gates: physical iPhone/full native integration (including native secure storage and family/account changes), VoiceOver, actual OS large text, measured contrast, and an isolated SQL-backed authorization run. The connected data-bearing production iPhone was not overwritten, reset or used for destructive tests. No local fake-provider test can establish useful or clinically safe model output; a separately approved, privacy-compliant evaluation and pediatric review remain release prerequisites. Live provider behavior and prediction quality have **not** been tested. No build number, TestFlight release, Apple submission, GitHub push or Azure deployment was changed by this task.
