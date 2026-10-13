# AI handling of overlapping sleep — 14 October 2026

Status: owner-authorized TestFlight upload and Apple processing completed; build 66 is available to the existing internal test groups.
Scoped backend commit
`fc5e8ecccf626e419d23c688d16f878e32c4f009` is frozen for workflow
[`38445012598`](https://github.com/github4me/my-little-days/actions/runs/38445012598).
The new local client target is **0.2.3 (66)**. This is not a public App Store
release. No real family payload or live provider inference has been accessed;
existing managed signing credentials are reused without rotation. Spending and
retention settings remain untouched. Completion evidence is recorded below.

## Authorized behavior

User: “有可能重叠，人工误差，告诉ai，自主判断”.

- Send otherwise-valid minimized overlapping sleep records unchanged. Do not
  union, deduplicate, shift endpoints, select an authoritative record or predict
  sleep locally. Age, seven complete local dates, today and the previous accepted
  same-day AI plan remain the existing bounded context.
- Explicitly tell AI that conflicts can be manual timing errors or duplicates.
  It may choose, combine or discount conflicting evidence for the prediction
  only. Overlap alone is not `insufficient_data`; truly unusable evidence may
  still produce an empty insufficient-data response, never a forced schedule.
- Saved calendar entries and running timers are untouched. The UI distinguishes
  original recorded sleep from changed AI intervals. Raw-versus-AI endpoint
  selection remains available through the dial; no manual refresh or text log
  list is reintroduced. Existing separate consent and revocation remain.

## Contract and boundaries

Schema 2, `sleep-ai-v2`, provider/model selection and strict response shape remain
unchanged. Schema 1 still rejects overlapping sleep for older client compatibility.

For validation only, a raw sleep record is uncertain if it strictly intersects
any other sleep occurrence, with ongoing end bounded by request `now`. Compare
occurrences by index, so duplicates count; feeds and exactly adjacent intervals
do not. This is conflict membership, not local reconciliation.

Isolated completed sleep intersecting today remains an exact mandatory anchor;
isolated ongoing sleep retains its recorded start and an explicitly estimated
end after `now`. Started model interpretations intersecting uncertain raw sleep
may use AI-chosen boundaries. Both anchors and these interpretations require
null settling fields; other plan segments retain valid settling ranges. The
model can omit unusable conflicting evidence. Coincident zero-elapsed ongoing
timers may share one exact-start estimated-wake segment without merging inputs.

Retain chronological/non-overlapping output, day/duration/settling limits,
isolated-record collision checks, timestamp validity, request/revision/expiry
checks, bounded retry, rate/concurrency controls and account/family isolation.
No unsafe inference such as treating feeds as proof of sleepiness was added.
Structured output constrains format, not factual accuracy; application validation
remains necessary ([OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)).

## Rollout procedure and verification boundaries

1. Review/freeze the scoped source SHA and publish through the GitHub plugin,
   preserving unrelated checkout changes. Re-read remote files and current
   trusted-branch/environment protections. Existing repository is
   `github4me/my-little-days`; last documented trusted branch is
   `feature/family-invitations`, not implicitly revalidated here.
2. In GitHub Actions, use **Deploy family API and database**
   (`.github/workflows/deploy-family-pilot.yml`) from that reviewed trusted branch.
   Set `database_bootstrapped=true` only after confirming existing bootstrap and
   reviewing this release's SQL diff; leave `adopt_ef=false`. No new migration is
   introduced. Require catalog/journal verification with zero pending scripts
   rather than accepting a no-op from logs alone; preserve firewall cleanup and
   the protected `family-database` and `family-pilot` deployment gates.
3. Target the existing production App Service `little-days-api-522fpstfbtds2`,
   no new slot, resource group `my-little-days-pilot-rg`, hosting tenant
   `7b7e6e31-a778-4334-aee2-e969fa27fd0e`, subscription
   `4768a858-f23f-4a39-bb64-eabc9c142627`. Preserve all settings, credentials and
   `gpt-6-luna`; this change requires no Azure fields to be changed.
4. Verify the exact deployed revision and bounded startup health sequentially.
   Check protected routes still reject anonymous access. Under an authorized
   test identity, send synthetic schema-2 overlapping sleep to the prediction
   endpoint: overlap alone must no longer cause 422; validate the returned plan
   or truthful insufficient-data state, unchanged input and current consent.
   Also check non-overlap and legacy schema-1 behavior. Health and schema-2
   capability readback alone are insufficient to prove this feature.
5. After backend acceptance, freeze a new local signed iOS release, recheck
   resolved production configuration/OTA/runtime and upload once using Apple
   tooling. Build 65 still blocks overlap locally, so it cannot exercise this
   change. The owner's later TestFlight request authorizes candidate build 66,
   not a public App Store release.
   Track archive/upload/processing/device acceptance separately. Use a physical
   iPhone by default, without resetting or uninstalling its data-bearing app.

Native iPhone/iPad/Watch acceptance and real-provider interpretation quality
remain unverified. Browser fixtures are synthetic, not evidence of clinical
accuracy. Native finish disposition: **recapture**, not release certification.

## Build 66 release checkpoint — available in internal TestFlight

- Fresh GitHub UI preflight verified both `family-database` and `family-pilot`
  restrict deployment to `feature/family-invitations`. Both currently have no
  required reviewers or wait timer; administrator bypass is enabled. These are
  observed protections, not a claim that separate approval is enforced. No rule
  was changed. SQL/API names, tenants, identities and enable flags match the
  existing targets above. Ordinary `FAMILY_INFRA_ENABLED` and
  `FAMILY_INFRA_APPLY_ENABLED` remain false.
- The GitHub plugin published exactly `SleepAiContracts.cs`, `SleepAiService.cs`
  and `SleepAiWholeDayTests.cs` over parent
  `b97a7421bd9b93c60980c68382c22b2365facea8`. No SQL, provider, budget, identity,
  environment or infrastructure file was included. Workflow #18 was dispatched
  from that frozen commit with `database_bootstrapped=true`, `adopt_ef=false`.
- Client source tree `f45fbe3036632791c6d146baff6820ec1864da5b` contains 523 files,
  exactly 13 approved overlays on immutable build65 tree
  `7c74ff35f0c19326f9e44b4e56611754b91b3327`, and no added/deleted files. Source
  archive SHA-256 is
  `4062e9f2645bfe8eff172a7b24499d9d8d2fb30db49bc8fbd81a0fe9b684f53a`.
  Freeze audit passed with zero unresolved or unexpected production imports.
- Fresh Apple/Expo preflight found build66 absent and build65 internally
  testable. Production public fields match; OTA remains off. Temporary AI debug
  output is explicitly limited to iOS build66; builds65/67 and other platforms
  are disabled. Build66 uses a local EAS Store archive, not a paid cloud build.
- Fresh frozen-source verification passed: strict TypeScript plus **1,063** full
  tests, **75** focused AI client tests, **25** component browser cases, **3**
  full-App browser cases and **5** privacy cases; zero failures/skips. All 523
  source files were checked before/after isolated browser execution. The browser
  used empty production connection fields, synthetic data and a separate Metro
  cache. There are 28 hashed captures; scoped browser disposition is ship,
  native disposition remains recapture. Acceptance receipt SHA-256:
  `443d436322b50fabc990bd80107d4e716b8acc05163583a1df379d2b2404a619`.
- Backend workflow **38445012598**, attempt 1, completed successfully on the
  frozen SHA: 435 API and 80 disposable-SQL migrator tests passed. Catalog and
  checksum-journal verification passed with **zero pending scripts** before and
  after; none applied. Only run-owned firewall rule `github-db-38445012598-1`
  was removed and its absence rechecked. The deployed API artifact digest matched
  `da247bdfd19d4657964679e51e228a7ba8490166c10bc102e9b7e30c0d347b4b`.
  OneDeploy ID `23b3b48d-1ed9-4e9c-840c-26ff9d480fb8`; package success
  **18:20:42 UTC**, bounded liveness success **18:22:03 UTC** after one startup
  500. No restart or second deployment was needed.
- Independent sequential anonymous boundary checks at **18:23:46 UTC** passed:
  `/health/live` and `/health/ready` 200; `/v1/session`, AI capabilities and an
  empty prediction POST 401. These do not prove signed-in SQL/provider behavior.
  Evidence: `release-prep/backend-release-evidence.json` and
  `release-prep/public-boundaries.json` under the operation directory.
- The local Store archive completed and produced
  `artifacts/MyLittleDays-0.2.3-66.ipa`, SHA-256
  `36775a1de30c462cc913abe3e314cadcfbbebd8cfa63c305a99cc95cf1a9a3b1`.
  All three Phone/Watch/widget targets are Store-signed **0.2.3 (66)** with the
  existing profiles. Production public configuration, runtime, OTA-off, privacy
  links, purchase safeguards and all dSYM UUIDs passed inspection. The signed
  Hermes hash is `35323eb5a2ca8dc6680f21da488af41cc71d76f88fa93f655bda3e474e22cbec`.
  Its exact configuration-to-debug-predicate dataflow passed; adding collapsed
  help moved only the verified debug branch label L22→L27. No condition was
  weakened. Final feature inspection passed **18:25:10 UTC**. Three operation-
  owned temporary certificate copies were removed; existing managed credentials
  were unchanged. Apple validation passed **18:27:19 UTC**. The single exact-IPA
  upload succeeded **18:29:31.441 UTC**, no errors, delivery
  `aa6187f0-ebe0-43b3-ad87-83442af43fc6`. Preserve this delivery and do not upload
  it again. Final Apple readback at **18:40:12 UTC** confirmed delivery
  **COMPLETE**, no errors/warnings, and **0.2.3 (66)** **VALID / IN_BETA_TESTING**
  in the existing internal **Team (Expo)** and **Early Birds** groups. External
  state is READY_FOR_BETA_SUBMISSION; no external review/group change was made.
  Public **0.2.2 (58)** remains READY_FOR_SALE. No device install occurred.
  Only working-checkout iOS build-number bookkeeping advanced
  65→66 after upload success; the frozen source and signed IPA are unchanged.
- Operation receipts live under `work/ai-overlap-release-20261014/`; credentials,
  personal records and tokens must not be copied into the operation record.

Backend completion, signed archive inspection, Apple upload/processing and
physical acceptance must be recorded separately. Signed-in synthetic live-model
validation requires an authorized test identity; anonymous health and mocked
tests are not substitutes. Do not obtain a real family's session or send its
records merely to remove this acceptance gap.

## Local verification

Final clean runs (all exit 0):

| Scope | Evidence |
| --- | --- |
| TypeScript and existing regression suites | `npm run verify`: 1,063 passed, 0 failed, 0 skipped across 14 test groups, plus strict typecheck |
| API overlap, output and legacy guards | `env -u FAMILY_TEST_SQL_CONNECTION /Users/chao/Applications/.dotnet/dotnet test server/LittleDays.FamilyApi.Tests/LittleDays.FamilyApi.Tests.csproj --configuration Release --no-restore --filter 'FullyQualifiedName~SleepAiWholeDayTests\|FullyQualifiedName~SleepAiTests' --logger 'console;verbosity=minimal'`: 167 passed, 0 failed, 0 skipped |
| Component browser | `AI_SLEEP_SCREENSHOTS=.impeccable/review/ai-overlap-inference-20261014 node tests/ai-sleep-browser.mjs`: 25 passed |
| Full exported App | `SLEEP_WEB_ROOT=.git/testagent/ai-overlap-inference-20261014/web AI_SLEEP_SCREENSHOTS=0 node tests/ai-sleep-app-browser.mjs`: 3 passed |
| Existing browser flows | `BROWSER_EXPORT_DIR=.git/testagent/ai-overlap-inference-20261014/web SCREENSHOT_OUTPUT_DIR=.git/testagent/ai-overlap-inference-20261014/general-browser npm run test:browser`: PASS |

The browser export was freshly cleared and built with API/auth environment
fields empty and family demo disabled. Network/provider data is synthetic or
mocked. Formatting ran; unrelated format-only App-browser churn was reverted.
The first full run found a test-only TypeScript narrowing error; its correction
asserts the exact fresh debug result, and the final full run above is clean.

| Requirement | Named regression evidence |
| --- | --- |
| “有可能重叠，人工误差，告诉ai，自主判断” | `WholeDayProviderReceivesEveryRawOverlapAndExplicitManualErrorInstructions` asserts unchanged minimized payload and explicit model instructions; `WholeDayLetsAiReconcileRawManualOverlapsWithoutChangingRecords` asserts exact model-selected boundaries and unchanged raw records |
| Automatic re-estimation with prior context | `AI hook sends overlaps unchanged and automatically reestimates a changed overlap with its previous accepted plan` |
| Preserve simultaneous newly started timers | `AI response matches simultaneous zero-elapsed timers to one estimated wake without changing records` and `WholeDayPreservesCoincidentZeroElapsedOngoingAnchorsWithOneExactOutput` |

Independent contract/assertion review found and closed the zero-elapsed timer
parity edge (new TypeScript witness failed before the fix, passed afterwards).
Scoped assertion quality is Strong: exact outputs, unchanged source payloads,
automatic request revisions/prior context, forbidden outputs and isolation are
asserted. No mutation score or project-wide coverage claim is made. Source
pairing analysis was unavailable because its optional tree-sitter package was
missing; known target suites were inspected directly, not a repo-wide inventory.
