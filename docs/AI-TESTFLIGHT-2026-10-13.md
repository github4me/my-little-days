# AI client TestFlight release — 13 October 2026

## Owner request and boundaries

The owner requested a testable TestFlight app and AI activation after the
disabled backend deployment. Keep the public App Store version unchanged.
Build locally; no paid EAS build, new Azure resource, credential rotation,
account/family deletion or real-child diagnostic payload is authorised.

Do not repeat provider retention or spending-cap dashboard checks. Existing
owner ZDR approval is recorded in the Azure runbook; this is owner attestation,
not a new independent provider-policy verification. An outstanding currency
choice was asked because the earlier enforced limit was recorded as USD 50
while the owner's budget was AUD 50. The owner was also asked to approve the
necessary public OpenAI privacy/support disclosure update. Responses and actual
activation must be recorded separately below; no approval flags are inferred
from starting this release.

## Read-only release preflight

- Live Apple/Expo read at 10:21:01 UTC confirmed latest internal TestFlight
  `0.2.3 (63)` is VALID / IN_BETA_TESTING; next candidate is 64. Existing
  Team (Expo) and Early Birds groups are unchanged.
- All five approved production public connection/demo fields matched through
  the existing managed credential/read-only operator. No key was printed.
- Local Xcode is 26.5 (17F42). `MyPhone` (paired iPhone 11) is available;
  prefer it over a simulator for native testing. Do not uninstall or reset it.
- Build 63 contains the earlier local prediction implementation. The reviewed
  pure-AI app files are not in that signed build. The backend is deployed at
  `7a79d5ebccd2ba0205fae5624b59e508de304c72`; see
  [deployment evidence](AI-BACKEND-DEPLOYMENT-2026-10-13.md).

## Freeze and delivery procedure

Use the build-63 source tree `613f1fa742fb0a2171178ee807e0e63de9f18d30`
as a preservation baseline. Overlay only explicitly reviewed app/AI, test and
privacy changes, not every dirty predecessor path. Preserve all other source
bytes, including unrelated backend/infrastructure work. Record source-tree and
file hashes, and bind verification to those exact bytes before signing.

Resolve production Store distribution, existing credentials, connection URL,
IDs/scope, demo 0, runtime 0.2.3 and disabled OTA again for this candidate.
Run frozen-source verification and AI browser/privacy checks. Build locally,
inspect Phone/Watch/Widget signatures, profiles, entitlements, bundle IDs,
actual Hermes configuration/AI features and matching dSYM UUIDs. Validate with
Apple, recheck candidate occupancy, upload once, retain delivery receipt and
verify processing plus existing internal group availability. Upload success is
not device acceptance or public App Review.

## Activation procedure

Before changing the existing production App Service settings, resolve the
currency decision and publish the approved privacy/support disclosures. Keep
separate per-user AI opt-in; sign-in or family membership is not consent.
Retain `gpt-6-luna`, no provider key in the app, no local prediction fallback,
current request quotas and all authorization/validation/cancellation controls.

Any setting change must target the same hosting tenant, subscription and
`little-days-api-522fpstfbtds2` production app recorded in the deployment record;
leave unrelated settings masked and untouched. Record the exact non-secret
activation fields and basis for each. Applying settings restarts the API; use
bounded propagation with one health request in flight. Verify authenticated
capabilities and synthetic app-to-API predictions if a dedicated signed-in
test context is available. Never extract a user's token or send real family
records to prove connectivity. Setting `SleepAi__Enabled=false` is the rollback;
already returned predictions can remain until expiry/context change.

## Completion checkpoints

- Owner chose the original AUD 50 budget and approved public OpenAI disclosures.
- OpenAI project `proj_Z63Ed6CGtNfXyC5QIHmui8gg`, Reticle Information Technology
  Pty Ltd / My Little Ones: lowered the existing enforced monthly limit from
  USD 50 to USD 25. An existing USD 50 alert initially blocked saving; changed
  that alert to USD 25 first, then saved the lower limit. Final page readback:
  `Limit enforced`, `$0.00 / $25.00`, alerts USD 5 (20%) and USD 25 (100%).
  Other model/recipient settings unchanged. Provider warns enforcement may have
  small overrun; this is not an exact AUD-denominated guarantee. RBA 13 October
  rate was USD 0.6961 per AUD, so USD 25 is about AUD 35.91 before tax/fees,
  leaving conservative conversion/enforcement headroom. No retention page was
  reopened. Screenshot: `/tmp/my-little-days-ai-budget-20261013.jpg`.
- Public privacy/support commit `6d99f4e467bf614f87797cce05754ed69f9f062c`
  in `github4me/my-little-days-privacy`, main, published through GitHub plugin
  with expected-head lease. Pages run `38383450174` succeeded; both existing
  URLs returned HTTP 200 and exact approved bytes. Only README/date and the
  two pages changed; existing retention clauses preserved. Evidence:
  `work/ai-privacy-20261013/README.md`.
- Fresh synthetic UI evidence: 17 AI component cases, 3 full-App cases and
  5 privacy cases passed. In-app privacy copy now describes separately opted-in
  OpenAI sharing and revocation limits. No real records sent. Source/evidence
  manifest: `work/ai-browser-acceptance-20261013/evidence-manifest.json`.
- Frozen build64 source tree `8979b8b8924f945daa3802788ab058a1d4511f34`:
  521 files, 31 reviewed overlays (15 additions), no removals. Archive SHA-256
  `09c3a4965335ee98749e6721ede1ff288275357c1d87d04bcf315713cd9f65de`.
  Independent blob/archive audit and 158-file iOS import graph passed, with no
  unresolved/dynamic/unexpected imports. Frozen `npm run verify` completed
  successfully before the local production archive began.
- Azure activation saved around 10:33 UTC on the existing production target:
  `SleepAi__Enabled=true`, `SleepAi__ChildDataProcessingApproved=true`,
  `SleepAi__ZeroDataRetentionApproved=true`,
  `SleepAi__HardSpendControlVerified=true`. The child-data gate is based on
  the owner's explicit enablement/public-disclosure approval plus separate
  per-user consent; ZDR gate records the prior owner approval; spending gate
  is backed by the current enforced USD 25 readback. `SleepAi__Model=gpt-6-luna`
  and `SleepAi__SupportsTemperature=false` stayed unchanged. API key remained
  hidden and untouched; no other setting, role, resource or policy changed.
  Final values read back with Apply/Discard disabled. Screenshot:
  `/tmp/my-little-days-ai-enabled-20261013.jpg`.
- Post-settings checks at 10:34:10 UTC: `/health/live` 200/ok,
  `/health/ready` 200/ready, `/v1/me` and
  `/v2/sleep-predictions/capabilities` 401/unauthorized. All returned no-store,
  no-referrer and nosniff. This verifies restart/routing/authentication boundary,
  **not** authenticated capabilities, SQL access or a model prediction.
- Local Store archive completed. IPA SHA-256:
  `a8958bd2b26d4ac23a4346f902b0ae942ac6784e89bffb94877a59fb07d0a5fa`.
  Phone `com.littledays.babylog`, Watch `.watchkitapp` and widget `.widget`
  are all Store-signed 0.2.3/64 with the expected team, provisioning, locales
  and entitlements. Frozen-source equality and production configuration passed;
  OTA remains off, demo remains off, existing coffee/price safeguards remain on.
  Signed Hermes SHA-256:
  `ed935764e9b1592ee05c49dc3d88518e9613114808608ba06dc6b70e51c9aa19`.
  AI/privacy feature inspection passed with obsolete forecast controls absent.
  All three target archive/export/dSYM UUID sets match. dSYM ZIP SHA-256:
  `d5b1827e234e362b080b14baaa9235bde54dfa0ac68bc18275f03239c9fb7eef`.
- Frozen `npm run verify`: 1,023 passed, zero failed/skipped, typecheck passed;
  focused AI client: 36 passed. Acceptance is bound to the frozen source and
  actual browser evidence, not inferred from a previous build. Temporary
  operation-owned p12 copies were removed after dry-run validation; the EAS
  temporary keychain/profiles were already removed. Managed credentials stayed
  unchanged. Inspection, symbols, feature and cleanup receipts are under
  `work/testflight-20261013-64/` and `artifacts/`.
- Existing locked dependency audit reports 26 advisories (2 critical, 22 high,
  2 moderate), with the lockfile byte-identical to build63. The scoped review
  found the critical paths in development/build tooling or development-only
  React DevTools, not demonstrated reachable Release app behavior. This is
  tracked remediation debt, not a clean dependency audit or security assurance.
  No automatic dependency update/downgrade was applied. Evidence:
  `work/ai-browser-acceptance-20261013/npm-audit-summary.md`.
- Apple validation passed at 10:44:14 UTC with no errors for the exact IPA.
  The guarded single upload succeeded at 10:46:11 UTC with no errors; delivery
  UUID `bd969f16-8ea1-44dd-9469-10334f602cb4`, 17,315,930 bytes. The delivery
  readback at 10:46:25 UTC shows PROCESSING with zero errors/warnings and exact
  version/build 0.2.3/64. Public App Store 0.2.2 (58) remains READY_FOR_SALE;
  no App Store version/review/release was changed. Workspace buildNumber was
  advanced from 63 to 64 only after successful upload; retained frozen source
  and signed artifact proofs are unchanged. TestFlight availability and
  signed-in physical-device AI acceptance are still outstanding. No real-child
  diagnostic request sent.

## Owner device acceptance after TestFlight processing

Update the existing installation through TestFlight to 0.2.3 (64); do not
uninstall or reset it. Confirm existing records and current family context
remain intact. In Records, expand Sleep guidance, sign in if prompted, and
review the separate OpenAI disclosure before choosing **Agree to sharing and
enable AI** (`同意分享并启用AI`). Installing an update or signing in alone
must not grant consent. A valid baby birth date is required; the transmitted
input contains age in days, not the full date of birth.

Confirm that the current half-day dial and list display both predicted sleep
start/end and settling-start window endpoints. A running sleep, insufficient
records, ineligible account, network error or rejected model output can prevent
a prediction; there is no local fallback. Do not end a real sleep timer merely
to obtain a test prediction. Check English/Chinese, light/night, large text,
VoiceOver and narrow-screen layout on the physical device.

Use **Turn off AI and stop sharing** (`关闭AI并停止分享`) to verify that results
clear and new requests stop without deleting records. This cannot recall data
already sent. Device and signed-in provider success must be recorded separately
from synthetic browser tests and this upload. Apple App Privacy/review metadata
for a future public AI release still needs a scoped review; this TestFlight task
does not publish a new App Store version or accept a new legal declaration.
