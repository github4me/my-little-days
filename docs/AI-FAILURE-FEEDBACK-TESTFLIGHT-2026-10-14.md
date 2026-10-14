# AI allowance and friendly failure feedback — build 71

## Scope

Owner requested 30 AI requests/hour and nontechnical failure reasons inside
How to use, followed by TestFlight. This release raises the existing backend
provider-attempt limit to 30/account/fixed UTC hour; an invalid-output repair
consumes another attempt. It does not raise daily/spending/concurrency limits,
change consent, retry scheduling, prompts or model, add local predictions, or
change brain animation. The exact cause of the earlier generic error is unknown.

Only allowlisted failure code/status pairs become in-memory display categories.
The app distinguishes waiting too long, a busy AI service, hourly or daily
allowance, connection/sign-in/access problems, invalid input, a changed day and
an unusable sleep plan. Unknown errors remain generic. Raw server/provider text,
records, credentials and debug output are never displayed. EN/zh-Hans/zh-Hant
are reviewed; other languages use the established English fallback.

Reasons appear only in the existing expandable help. New requests, successful
results, revocation and account changes clear/mask the previous error. Existing
success-response validation and older-client compatibility are preserved by
using the existing HTTP error envelope rather than adding success fields.

## Verification checkpoint

- Backend focused Release suite: 193 passed, zero failures/skips, including exact
  HTTP code-only error envelopes, cancellation precedence, 30/31 hourly and
  unchanged 200/201 daily/concurrency limits. No live provider requests.
- Client focused suite: 106 passed; TypeScript passed.
- Fresh isolated `npm run verify`: 1,077 passed across 14 suites, zero
  failures/skips/cancellations; frozen source checked before and after.
- Actual-component browser suite: 48 passed, including help-only rendering,
  localized failure copy, malicious raw text exclusion and failure/loading/ready.
- Fresh isolated App browser: 3 passed; privacy browser: 5 passed; production
  web export succeeded. All browser fixtures fictional, no live provider calls.
- Main reviewed outcome assertions and backend/client contract; independent
  client review found no blocking issues. No dependency/schema changes.
- Physical iPhone acceptance is pending; browser tests do not establish native
  background/resume behavior or live provider success.

## Release status

Candidate 0.2.3 (71) is frozen from immutable build 70 tree
`4b498a21bedac51ceb4b6ca1e0c61c3cfa9e4ba3` plus exactly twelve scoped client/test
files and app build bookkeeping. No unrelated dirty-workspace changes.
New source tree `51a438b896839038194560b1dc4f6a4baf1c05de`; 524 files, one new
test and no removals. Source archive SHA256
`585beda219dcdf9e39f64b0fa00af28b4fa516e99bc057b81702c44655f5ded0`.
Frozen source build bookkeeping is 70; the unchanged local production profile
auto-increments only the staging build to 71. Local signed archive/export passed.
Current operation receipts: `work/ai-failure-feedback-20261014/release-prep/`.
Upload succeeded once; Apple processing is recorded below.
Public App Store version 0.2.2 (58) is unchanged.

## Exact signed artifact

- IPA: `artifacts/MyLittleDays-0.2.3-71.ipa`; SHA256
  `87d00d175c8292aa86a0286372ebbb585c2af71433854638871532b41c394aad`.
- Embedded Hermes SHA256
  `09b48990793662d794a2937660fee436ba1900cd6ac2a2a3c6821da164d61a0c`.
- dSYM ZIP SHA256
  `f424b92a340fe194bf64e8451b95cfde863e746d1e81bed632cc975ae8075d69`;
  all three target UUID sets match archive and IPA.
- Phone, Watch and widget Store signatures/profile IDs/entitlements and version
  0.2.3(71) verified. All 524 frozen and 446 packaged source files match;
  production URL/identity fields, runtime0.2.3, demo-off and OTA-off verified.
- Feature receipt confirms 17 actual failure-copy strings in signed Hermes,
  exact allowlisted reason mapping, unchanged60s timeout, existing brain/Now/
  consent/recording behavior. No debug UI or manual refresh control introduced.
  Unused older translations remain in the locale catalog, not executable controls.
- Watch35 and widget10 model tests passed during the local build. These are not
  physical-device acceptance. Main reviewed all ten required frozen captures and
  bound fresh source/test acceptance with native disposition explicitly pending.
- Exactly three operation-owned temporary p12 signing copies removed after a
  scoped cleanup preview. Existing managed credential originals remain intact.
- Independent read-only artifact review passed at00:14:43UTC for exactly the IPA
  hash above: actual ZIP bytes, three strict signatures/profile identities,
  524 source /446 packaged files, production Hermes configuration/friendly copy,
  archive/export/dSYM UUIDs and DWARF bytes matched. Main independently hashed
  the IPA and reviewed the generated feature/config/symbol receipts.

Apple validation passed **14 October00:15:54.738UTC**, exit0, no errors, for the
exact IPA above. Upload succeeded once at **14 October00:17:57.565UTC**, exit0,
no errors. Delivery `c2a15f43-47fc-4f4f-9687-a82cb1a17b8a`;17,327,237bytes sent.
Latest readback **00:20:01.579UTC**: delivery **PROCESSING**, errors/warnings empty;
build71 not yet indexed. Do not upload again. Processing/tester availability
must not be assumed until a later readback. Checkout iOS build number advanced
70→71 after success; immutable release evidence remains unchanged. Temporary
submission-key copies were removed by the uploader's cleanup; managed originals
remain. Public0.2.2(58) remains READY_FOR_SALE; no external beta review or group
configuration was changed.

No Expo cloud build or public App Store release was performed.
