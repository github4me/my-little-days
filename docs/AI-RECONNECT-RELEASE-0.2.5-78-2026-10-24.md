# AI connection recovery — production candidate 0.2.5 (78)

Owner requested production release and Apple review on24October2026 Melbourne.
Fresh official App Store Connect readback23October21:06UTC confirms0.2.4(77)
is READY_FOR_SALE / READY_FOR_DISTRIBUTION, prior review submission COMPLETE,
releaseType AFTER_APPROVAL. No active review submission existed. The next unused
build is78; candidate version is0.2.5, not a replacement of the public0.2.4.

## Frozen scope

Predecessor mobile tree `be594e3ad473a8f5927743a1f0edbb276675556a`.
Candidate tree `0155f90e639843e1c529cea99e1ee30c5ef8dc90`,537files,12scoped
changes: nine app/test reconnection files plus app/package/lock version metadata.
Source TGZ SHA256 `9337c761906471fa54f9ae60fdbdae44b6ac245572447b16190ba28d008d4ca8`.
No unrelated dirty-checkout changes, dependency upgrade, native module change,
backend deployment, database migration or provider setting change is included.

Explicit status refresh rechecks AI capability only after current-account access
recovers. Same-scope offline controls remain available, including local opt-out
and Reconnect AI. Reconnection resumes the durable job, not a duplicate request.
Cached presentation never grants sending permission or displays stale forecasts.
See [implementation receipt](AI-RECONNECT-AND-QUOTA-2026-10-20.md).

## Release preflight

Existing Expo project/account and all five production public configuration values
matched fresh readback. Target app6809826484, bundlecom.littledays.babylog,
teamA9974KXQ4G, production/store channel/environment, runtime0.2.5, OTAoff.
Existing managed signing/submission material is reused, never printed or committed.
Build uses local Mac compute, Xcode26.5 /EAS24.8.0; no paid EAS cloud build.

Frozen `npm run verify` passed1,165tests with zero failures/skips plus strict
TypeScript. Fresh frozen browser gates and signed archive inspection are tracked
below when complete. The physical iPhone11 was listed unavailable; no native
device/background/VoiceOver, paired Watch, widget or purchase acceptance is claimed.

The existing live1,000/day,50concurrent,30/account/hour limits, AU$50 safeguards,
model/Fast and diagnostic capture settings are not changed. No signed-in live
inference or capacity test is performed by this release. `/health/ready` returned
HTTP200; this is not proof of signed-in SQL/provider readiness.

Public/in-app wording still differs from restricted seven-day full minimized
request/response diagnostics. It is unchanged under the owner's prior explicit
instruction; new review notes disclose the discrepancy truthfully. No new App
Privacy accuracy declaration, legal agreement or security exception is accepted.
Submission does not resolve that outstanding disclosure issue.

## Signed artifact and frozen acceptance

Local archive completed23October21:18:51UTC /24October08:18:51Melbourne.
IPA `artifacts/MyLittleDays-0.2.5-78.ipa`, SHA256
`05c5bbacb6e17d110227fafdbc1a3dfca58014c22c6bd57b41c32c58ac3b68c7`.
All537 frozen source files were checked against the retained native builder,
459 packaged files matched after documented exclusions/build transformations.
Phone/Watch/widget all0.2.5(78), original Store profiles/team/bundle identifiers,
12locales, expected App Groups, production push, no debug entitlement, demooff,
coffeeon, runtime0.2.5 and OTAoff verified in the signed artifact.

Recompiled production Hermes input reproduces the signed bytecode exactly,
SHA256 `9a5a7a6d4ce52b2bbe306f1748d5c807fb3563e3717435cfda5b1eb7e2ea09b6`;
schema3 remaining-day minute guards and new AI reconnection guards are present.
All three dSYM UUIDs match archived/exported executables. Symbols ZIP SHA256
`bc23e77566d22d956357c0b836345d97b05a614d99478de9932e09404d368546`.
Operation-owned temporary keychain/profiles and three p12 copies were cleaned;
existing managed credentials were not changed.

Frozen browser acceptance:72AI component,4full-App AI,5privacy-link cases plus
navigation/local-record suite passed. Native Swift model checks:35Watch and
10widget passed. These are not physical-device/provider acceptance.

First navigation run compared an export made before the expected EAS build77→78
increment against post-increment config78. Re-exported with a cleared isolated
cache after the increment, verified every source file (only that expected
metadata transformation allowed), and reran all browser gates successfully.
Version assertion was not weakened. Initial symbol/feature/cleanup helper calls
preceded the inspection receipt; retained those local missing-file errors and
reran successfully after inspection completed. No artifact or app fix changed.

## Apple progress

Apple validation succeeded with no errors23October21:21:45UTC. Direct upload
completed21:24:03UTC /24October08:24:03Melbourne, uploader exit0, exact inspected
IPA/hash, delivery `23e3abb4-bb8f-401b-a08e-10ec0f092b9f`,17,344,035bytes.
Fresh21:24:10readback confirms correct0.2.5/78 delivery PROCESSING with no errors
or warnings, but no selectable build yet. No duplicate upload was attempted.

Apple processing completed with VALID/APP_STORE_ELIGIBLE, unexpired build78,
non-exempt encryptionfalse. At21:27:50UTC /08:27:50Melbourne, readback confirms
IN_BETA_TESTING with the existing internal Team(Expo) and Early Birds groups.
No new testers/groups or external beta submission were created.

Official App Review submission completed **23October2026 21:29:34.768UTC /
24October08:29:34Melbourne**. Fresh21:29:42readback confirms the version and
parent submission **WAITING_FOR_REVIEW**:

- Version0.2.5: `11743ac0-5be4-49b8-93d8-443063ce723a`.
- Exact build78: `23e3abb4-bb8f-401b-a08e-10ec0f092b9f`.
- [Review submission](https://appstoreconnect.apple.com/apps/6809826484/distribution/reviewsubmissions/details/761b8120-4e43-4cbf-b00b-58a48981755d):
  `761b8120-4e43-4cbf-b00b-58a48981755d`, one IOS app-version item only.
- AFTER_APPROVAL automatic release retained. Public0.2.4(77) unchanged.
- All12 COMPLETE screenshots, existing en-AU listing fields, private contacts
  and ordinary reviewer-own-email OTP access were preserved/read back. Only the
  new version's [review notes](app-store/review-notes-0.2.5-78.txt) and
  [What's New](app-store/whats-new-0.2.5-78.txt) changed. The note explicitly
  discloses the unresolved full-capture/public-wording discrepancy; no false
  request-clearing claim, App Privacy attestation or agreement acceptance.

This confirms upload, processing, internal TestFlight availability and review
submission—not approval or public0.2.5 availability. Physical iPhone/Watch/widget
acceptance remains outstanding. No backend deployment, database/settings change,
OTA, Android release, new commerce, availability/region or price change occurred.
Operation receipts are retained under `work/ai-reconnect-release-20261024/`.
