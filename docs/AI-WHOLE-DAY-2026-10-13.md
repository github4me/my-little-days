# Whole-day AI and TestFlight build 65 — 13 October 2026

## Scope and current checkpoint

The owner requested a whole-day AI sleep plan, automatic updates from relevant
records and a temporary client debug view, followed by TestFlight testing.
The implementation contract is retained locally at
`work/ai-whole-day-20261013/contract.md`.

This record began as preparation and was updated after completed stages at
**2026-10-13 13:15:00 UTC / 14 October 00:15:00 AEDT**. Backend deployment,
public disclosure publication, frozen-source checks and the signed build 65
artifact are now verified, and Apple validation and the single upload succeeded.
**Apple's exact delivery is COMPLETE without errors or warnings; 0.2.3 (65) is
VALID / IN_BETA_TESTING and available to Team (Expo) and Early Birds internal
testers.** This is TestFlight-only;
no public App Store release is approved by these checks.

No new provider, model, credential or Azure resource was introduced. Retention
and spending dashboards were not rechecked. Existing consent, access, rate/cost
and provider approval guards remain in place. Signed-in live AI/SQL and physical
device acceptance remain pending, independently of the completed stages below.

## Compatibility and behavior

- Backend remains on `/v2/sleep-predictions`; schema 1 / `sleep-ai-v1` remains
  supported unchanged for build 64 and older AI clients. New client schema 2 /
  `sleep-ai-v2` requires explicit renewed sharing consent. Capabilities retain
  old fields and add `wholeDaySchemaVersion:2` and
  `wholeDayConsentVersion:"sleep-ai-v2"`.
- New requests can send the last accepted plan's generation time and bounded
  periods from the same local day/account/baby/authority/consent/time zone.
  Observed records outrank previous predictions. No explanation or arbitrary
  provider response is reused as context; no identity is sent to OpenAI.
- Schema 2 covers the local day, including exact completed sleep anchors and
  actual starts with estimated ends for ongoing sleep. Recorded sleep has no
  invented settling window. Other estimates have validated sleep/settling times.
  Expiry is the next local midnight, not 15 minutes. Crossing the request's local
  day fails closed with 409 `prediction_day_changed`.
- UI remains a current-half-day clock. Tapping it cycles an individual period's
  exact range; the static text dump and refresh action are removed. A scoped
  coordinator lives across tabs; meaningful sleep/feed changes and a new day can
  update the plan, while clock ticks, reorder and notes alone do not.
- The initially collapsed debug panel is limited to iOS build 65 and explicit
  isolated test fixtures. It displays validated suggestion status/periods and
  allowlisted local/API codes, not raw provider output, records, IDs or secrets.
  Later builds must not automatically enable it. A signed-bundle witness is
  required because the build-number gate reads bundled app configuration.

## Historical starting checkpoint — before this release

Read-only GitHub checks found trusted branch `feature/family-invitations` at
`857122d60ea2f6b170332986ec88365983cb66a1`; its CI run `38386565812` succeeded.
These are previous-release checks, not validation of this new feature.
The then-latest deployed API visible in GitHub was
`7a79d5ebccd2ba0205fae5624b59e508de304c72`, successful deployment run
`38380435550`. See [the backend deployment record](AI-BACKEND-DEPLOYMENT-2026-10-13.md).

At **2026-10-13 12:31:31 UTC**, existing managed credentials were used only for
read-only Expo/Apple queries; no key material was printed or saved:

- Latest build: **0.2.3 (64)**, VALID / IN_BETA_TESTING, in internal groups
  Team (Expo) and Early Birds; external READY_FOR_BETA_SUBMISSION.
- Build 64 delivery `bd969f16-8ea1-44dd-9469-10334f602cb4`: COMPLETE, no errors
  or warnings. This supersedes the earlier PROCESSING checkpoint.
- Exact build 65 query: no build present at that time. This historical
  observation did not reserve the number or prove subsequent upload status.
- Public **0.2.2 (58)** remains READY_FOR_SALE; no public release was changed.
- All five expected production Expo public values matched the existing target.

## Frozen source and tests — completed

Native baseline is build 64's exact frozen tree
`8979b8b8924f945daa3802788ab058a1d4511f34`, archive SHA-256
`09c3a4965335ee98749e6721ede1ff288275357c1d87d04bcf315713cd9f65de`.
Do not use the dirty checkout or remote branch wholesale as the native source.
At **12:48:02 UTC**, the coordinator approved the final 24 scoped overlays,
including two additions (`src/aiSleepDebug.ts` and its test), in
`work/ai-whole-day-20261013/release-prep/freeze-approval.json`. The coordinator
then removed the draft execution gate and ran the freezer/audit. The earlier
`proposed-overlays.json` is historical, not the release manifest.

- Frozen tree: `7c74ff35f0c19326f9e44b4e56611754b91b3327`.
- Source archive: `artifacts/MyLittleDays-0.2.3-65-source.tgz`.
- Archive SHA-256: `bda8da9ac7c4535d948d743fb36031b30cf483b4da6b08d0cf6d0c72a318bb71`.
- Audit: 523 files, exactly 24 approved overlays / two additions; untouched
  baseline preserved, dependency graph resolved, no unrelated dirty source swept in.
- Frozen `npm run verify`: typecheck and **1,042/1,042** tests across 14 groups,
  zero failures/skips. This is the frozen source's log, not the checkout's log.
- Separate frozen AI client tests: **54/54**, including the build-65 debug gate.
- Frozen browser checks: **19 component + 3 full-App + 5 privacy** scenarios,
  zero failures/skips. Fresh web export used blank family configuration and an
  isolated Metro cache; all 523 source-file hashes matched before and after.
  Twenty-two synthetic captures are retained. No browser test sent real records.

Evidence: `release-prep/source-manifest.json`, `freeze-audit.json`, `verify.log`,
`ai-client-receipt.json` and `ui-acceptance.json`, plus
`work/ai-whole-day-20261013/frozen-browser-verification.json` and
`frozen-browser-captures/`. The acceptance receipt binds 33 relevant runtime/test
hashes. Its browser disposition is **ship for scoped TestFlight testing**;
native disposition remains **recapture**, with `productionReleaseApproved:false`.

### Requirement-to-test evidence

This compact index carries forward the reviewed internal test status without
publishing its generated/private operational artifacts. Names below are exact
test names, not claims of physical or live-provider acceptance.

| Requirement | Representative exact test / artifact evidence |
| --- | --- |
| Whole-day estimates preserve observed sleep and ongoing starts | Backend `WholeDayReturnsObservedOngoingAndFutureExactlyWithMidnightExpiry`; client `AI ongoing sleep requires an anchored estimated wake and never invents settling` and `AI whole-day output includes exact past recorded anchors and cloud estimates without altering facts` |
| Re-estimate relevant new records using the last accepted plan | `AI coordinator carries only the latest accepted plan on sleep start stop and feed revisions without response loops`; `App-owned AI hook keeps prior continuity and reestimates new sleep while Records is hidden` |
| No manual refresh or clock-tick requests | `AI coordinator reuses unchanged input all day without clock-tick requests or a manual refresh method`; all 19 component cases assert absence of Refresh |
| Clean clock view with selected complete ranges, not a static text log | Component `ready-periods-and-settling-remain-distinct`, `chinese-narrow-endpoint-labels` and `font-scale-branch-keeps-complete-text-ranges`; cases assert no static range dump and activate the clock to expose selected endpoints |
| Temporary safe debug, limited to build 65 | `debug-is-collapsed-and-contains-only-validated-output`, `debug-is-absent-outside-explicit-test-build`, `temporary AI output is enabled only for iOS build 65`, and `AI sleep debug class boundary translates only allowlisted PilotApiError code and status pairs`; separate signed-Hermes witness below |
| Old clients, local-day boundaries and disclosure isolation remain safe | Backend `SchemaOneKeepsSkippedMidnightCompatibilityWhileWholeDayFailsClosed`; client `AI whole-day calendar bounds use DST-safe midnight expiry and reject a late next-day response` and `AI coordinator clears prior plans on profile authority scope zone consent and local-day changes` |
| TestFlight distribution | Exact IPA inspection, Apple validation and upload/status receipts below; unit/browser tests do not establish processing or tester availability |

Executed validation commands, with frozen-source logs/receipts named above:

```sh
npm run verify
node --import tsx --test src/aiSleep.test.ts src/aiSleepCoordinator.test.ts src/useAiSleep.test.ts src/aiSleepConsentStorage.test.ts src/aiSleepDebug.test.ts
node tests/ai-sleep-browser.mjs
node node_modules/expo/bin/cli export --platform web --clear --output-dir dist-web --max-workers 2
node tests/ai-sleep-app-browser.mjs
node tests/privacy-links-browser.mjs
```

The browser commands ran in the exact archived source's isolated extraction with
`EXPO_NO_DOTENV=1`, blank public family/auth configuration, demo off and a private
Metro temporary cache. Do not copy these blank values into the native release.
Pre-freeze transport validation also ran
`node --test --test-name-pattern='AI sleep' tests/family-controller.mjs` (3 passed);
the complete 185-case controller suite is included in frozen `npm run verify`.
Backend focused schema 1/2 tests passed **138/138**, including 54 new cases, in
the retained `whole-day-backend-final.trx`; deployed CI independently passed the
larger API/SQL suites described below.

Review limitations remain explicit: no dedicated deletion-only coordinator test,
and hidden-Records lifetime uses a deterministic real-hook harness rather than
an authenticated native session. No mutation score or coverage percentage was
measured. Native VoiceOver/Dynamic Type/SecureStore and signed-in live-provider
behavior remain pending. The local debug predicate's additional test explains
why the frozen focused count is 54, versus the earlier four-file 53-case run.

## Backend deployment and anonymous acceptance — completed

Only the six reviewed backend AI files were published through the GitHub plugin
at `bb0209163d769272df455e7542d4081809c35686`. **Deploy family API and database**
[run 38399539520](https://github.com/github4me/my-little-days/actions/runs/38399539520),
attempt 2, completed successfully at **12:59:50 UTC** on the unchanged frozen SHA.
The existing production target is App Service `little-days-api-522fpstfbtds2`,
resource group `my-little-days-pilot-rg`, subscription
`4768a858-f23f-4a39-bb64-eabc9c142627`, hosting tenant
`7b7e6e31-a778-4334-aee2-e969fa27fd0e`; no slot or settings change was introduced.

- Attempt 1 failed in the unrelated existing family-demo browser amount-fill
  assertion (`135` expected, `1` observed). Migration and deployment were skipped;
  no SQL firewall rule was created. Independent same-SHA CI passed that suite;
  one failed-job rerun passed all nine scenarios without changing assertions or
  source. The transient cause is not proven to be a product defect or timing bug.
- Backend CI: **406 API + 80 disposable-real-SQL migrator** tests passed, no
  failures/skips; firewall lifecycle and workflow-policy checks also passed.
  Its remote mobile suite is the remote branch baseline, not the separately
  frozen build65 client; the frozen client checks above remain required evidence.
- Unchanged immutable migrations 0001–0009: catalog and journal checksums verified,
  **zero pending scripts** before/apply/postcheck, zero applied; no schema change.
- Only operation-owned rule `github-db-38399539520-2` was created and removed.
  Workflow cleanup re-listed and required no matching rule; the recovery-cleanup
  step passed. No unrelated firewall rules were modified.
- Same-run API artifact `11813913184` was deployed; digest
  `0f860f3da3432048a72cc3092497696f8b3bb62ca57e3fef4798c46d80ee356c` verified.
  Package deployment completed at 12:57:56 UTC; bounded cold-start 502 responses
  resolved to liveness success at 12:59:46 UTC, without another restart.
- Sequential, unauthenticated probes at **13:00:48 UTC** returned 200 for
  `/health/live` and `/health/ready`, and 401 for `/v1/session`,
  `/v2/sleep-predictions/capabilities` and a `{}` POST to
  `/v2/sleep-predictions`. These establish anonymous routing/authentication
  boundaries, not signed-in SQL access or live model inference.

Full evidence: `work/ai-whole-day-20261013/backend-release-verification.json`.
No provider call or real child/family payload was used for this acceptance.

Current workflow checks the trusted SHA initially and before migration, but not
again in the final deploy job. Keep the branch frozen and recheck it before
deployment. Earlier same-day live environment readback found branch restrictions
but no reviewers/wait timer; do not expect a manual pause. The present audit read
current remote workflows but did not repeat the admin protection UI checks.

## Public disclosures — published and verified

Updated local privacy/support Markdown and corresponding proposed public HTML
describe renewed consent and previous-plan sharing, automatic whole-day updates,
ongoing estimated wake times, selected-range interaction and temporary debug.
Older builds are explicitly distinguished. All non-AI sections are unchanged,
including family/account deletion, support-email retention, backup and payments.
No new provider-retention, no-training or Australia-only promise was added.

The two proposed HTML files match the existing generator's output byte-for-byte;
local fragments and IDs validate, and no active content was added. The coordinator
reported publishing only `docs/index.html` and `docs/privacy/index.html` as
`be0b4d481d6138d167464a485523f2b7ed045c83` in the existing public privacy repo.
The coordinator verified [Pages run 38399720457](https://github.com/github4me/my-little-days-privacy/actions/runs/38399720457)
completed successfully and both existing URLs returned HTTP 200 with exact
approved bytes. Local reviewed-file digests were rechecked for this record:

| Page | Bytes | SHA-256 |
| --- | --- | --- |
| [Support](https://github4me.github.io/my-little-days-privacy/) | 14576 | `4417b9d5099453bcef49c02c941b821b6577be733aedccab5fe841f09d85e785` |
| [Privacy](https://github4me.github.io/my-little-days-privacy/privacy/) | 20076 | `484c9730efec4f602aa4c90dd46ac9e32afceabf86ff608ce953b707408869fe` |

Existing App Store URLs remain unchanged. App Store declarations and public
release submission are separate from publishing these Pages documents.

## Local signed artifact and symbols — completed

The coordinator archived **0.2.3 (65)** locally; no paid EAS cloud build was used.
`artifacts/MyLittleDays-0.2.3-65.inspection.json` passed at **12:59:40 UTC**:

- IPA `artifacts/MyLittleDays-0.2.3-65.ipa`, SHA-256
  `b49fe3811af22eb10e1d8ddac639975d2c9c4b7fe8e7231ad9517c3f961ad2e5`.
- Store-signed Phone `com.littledays.babylog`, Watch
  `com.littledays.babylog.watchkitapp` and widget
  `com.littledays.babylog.widget` all contain version 0.2.3 / build 65 and 12
  locales; expected App Group placement and production configuration passed.
- OTA is off, runtime 0.2.3, family demo off and coffee enabled. Embedded Hermes
  SHA-256 is `d0c01461dd999b66a107b078f345f0885171073369cdcf9990b7c17a2126a1c2`.
- `MyLittleDays-0.2.3-65.symbols.json` verifies the exact Phone/Watch/widget dSYM
  UUIDs. Retained dSYM zip SHA-256:
  `314a05020f2265893c85594d583a4dd7ea5a1767c5b0ff0a66ce0769645c9462`.
- `release-prep/debug-artifact-witness.json` passes **signed-hermes-dataflow**:
  the exact signed bundle resolves bundled `expo.ios.buildNumber` to string
  `65`, passes it with `ios` to the strict predicate, and uses its result for
  the debug branch. Other builds/platforms remain disabled. This is compiled
  data/control-flow evidence, not merely source inspection or a string search.
- `release-prep/feature-inspection.json` passed at **13:06:38 UTC**, binding
  the frozen source, actual IPA/Hermes hashes, new whole-day/debug behavior and
  inherited milk/Watch features. The earlier UI receipt's pending artifact
  statements are historical; this later artifact witness closes only those
  compiled-artifact checks, not native or signed-in acceptance.
- `release-prep/credential-cleanup.json` confirms the operation's temporary
  keychain, three temporary profiles and three temporary certificate files
  were removed; existing managed credentials were not changed.

Evidence above is local artifact inspection, not Apple upload or installation.

## Apple validation, upload, processing and internal availability — completed

Apple validation passed at **13:08:41 UTC** with no errors, recorded in
`work/ai-whole-day-20261013/release-prep/validate.json`. The single upload then
succeeded at **13:11:06.042 UTC**, uploader exit 0 and no errors, recorded in
`release-prep/upload.json`. Its exact IPA hash matches the signed inspection:
`b49fe3811af22eb10e1d8ddac639975d2c9c4b7fe8e7231ad9517c3f961ad2e5`.

- Delivery UUID: `322d122f-0c08-4b94-97ae-01c3512d18fd`.
- Latest exact Apple readback at **13:15:00.440 UTC**: version **0.2.3 (65)**,
  build **VALID**, internal state **IN_BETA_TESTING**, in **Team (Expo)** and
  **Early Birds**, both internal tester groups. Delivery is **COMPLETE** with
  errors/warnings/information arrays empty. This establishes internal tester
  availability, not installation or physical-device acceptance.
- External state is **READY_FOR_BETA_SUBMISSION**; no external beta approval or
  public App Store release is claimed.
- Final receipt: `release-prep/apple-status-1791897300440.json`. Earlier
  13:11:32 and 13:13:58 UTC receipts remain historical PROCESSING observations.
- Public **0.2.2 (58)** remains READY_FOR_SALE. No public release was changed.
- After upload success, the coordinator advanced only the working checkout's
  `app.json` iOS build number from 64 to 65. This bookkeeping did not change the
  frozen source archive, signed IPA or their hashes.

Do not repeat an ambiguous delivery or remove the upload-attempt marker; inspect
this existing delivery first. Processing and internal tester availability are
now complete; do not upload a duplicate build 65.

## Outstanding acceptance

- Install the available TestFlight build 65 and complete owner/device acceptance;
  external beta submission is a separate step if external distribution is wanted.
- Signed-in live capabilities, SQL-backed access and synthetic schema 1/2 model
  requests, including meaningful-record automatic updates and consent revocation.
- Physical iPhone/iPad rendering, real Dynamic Type/VoiceOver, retained-data
  upgrade, native consent persistence and Phone/Watch/widget interaction.
- App Store privacy declarations/public-review release readiness, if a later
  public release is requested. Public **0.2.2 (58)** was not changed here.

Record each stage separately; neither successful deployment nor signed browser-
tested packaging establishes model integration, native acceptance or clinical
prediction quality. The approved TestFlight distribution is for owner testing.
