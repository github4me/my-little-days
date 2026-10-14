# Durable AI sleep jobs — TestFlight 0.2.3 (73)

## Scope and release status

The user authorized durable asynchronous AI sleep suggestions and a TestFlight build. Public App Store submission remains paused. Backend deployment, local signing, Apple validation and one upload succeeded. At02:44:32UTC Apple reports PROCESSING with no errors or warnings; tester availability and physical-device acceptance are not yet confirmed.

The active client now submits a separately consented server job instead of holding a generation HTTP request open. A committed job is processed by the existing server worker. The app stores scoped recovery metadata before submission, polls while foregrounded, and resumes the same operation after an interrupted acknowledgement, app reload or temporary connection loss. No local sleep prediction, manual refresh button, raw debug output or new display controls were added. The sliding twelve-hour ring, actual-record priority, brain animation, bottle picker and Watch behavior remain in scope for regression verification but are unchanged from build72.

## Client behavior and privacy boundary

- Consent version `sleep-ai-jobs-v1` is separate from the prior synchronous consent. The confirmation explains server storage and continued processing while the app is closed. Existing users must explicitly consent before the new job path sends their records.
- Input remains the minimized schema2 snapshot: age in days, timezone/current time, the prior seven complete local days plus today, sleep/feed timing/type/amount and the previous same-day estimate when available. Names, exact birth date, notes and photos are excluded.
- Local recovery storage contains metadata, not a second copy of child records or prediction payloads. Scope binds account/family/history/recovery authority and consent generation. The server retains the job result under the disclosed expiry; the app can recover it and use it as the previous estimate for a changed revision.
- Temporary same-account authority loss can retain the pending presentation, but does not grant access or permit new API calls. Authoritative revalidation is required before polling resumes. A different account/scope cannot adopt that work.
- Backgrounding pauses client polling without cancelling the acknowledged server job. Turning AI off records revocation intent and reconciles it on reconnect; a provider request already sent cannot be recalled. Sign-out, family lifecycle changes, replacement work and late responses are isolated by scope and generation.
- Safe failure reasons remain under Usage instructions. Retryable status-read failures keep the pending state; they do not create another paid generation. The legacy synchronous endpoint remains compatible for earlier builds; it is not the active new hook transport.

See [the backend contract](AI-DURABLE-JOBS-BACKEND-2026-10-14.md) for transaction, lease, quota, expiry and cleanup rules. Public disclosure publication and live endpoint readback are recorded in the runbook by the root agent; this mobile source includes the corresponding in-app disclosure changes.

## Frozen source boundary

Immutable predecessor is build72 tree `da211f246f6e796adfc688bca16676229904b1a7`, not the dirty checkout or current branch HEAD. Frozen build73 tree is **`e85aa2477fa6643ae26f4ac3384fe308b4d60153`**. Its535 files contain exactly24 reviewed overlays, eight additions and no removals. All other predecessor paths are unchanged.

The exact overlays are `App.tsx`, `app.json`, `src/PrivacySupport.tsx`, `src/SleepGuidanceSection.tsx`, `src/aiSleepAccess.ts`, `src/aiSleepJobCoordinator.ts`, `src/aiSleepJobCoordinator.test.ts`, `src/aiSleepJobStorage.ts`, `src/aiSleepJobStorage.web.ts`, `src/aiSleepJobStorageCore.ts`, `src/aiSleepJobStorage.test.ts`, `src/aiSleepJobs.ts`, `src/aiSleepJobs.test.ts`, `src/family/api.ts`, `src/family/useFamilyDemo.ts`, `src/family/useFamilyPilot.ts`, `src/familyApi.test.ts`, `src/locales/aiSleepOverrides.ts`, `src/useAiSleep.ts`, `src/useAiSleep.test.ts`, `tests/ai-sleep-app-browser.mjs`, `tests/ai-sleep-browser.mjs`, `tests/family-controller.mjs` and `tests/privacy-links-browser.mjs`.

`app.json` in the immutable input retains build72 bookkeeping; the existing local EAS auto-increment changes only the operation-owned staging input to signed build73. The source archive remains authoritative and is not rewritten after building.

- Source archive: `artifacts/MyLittleDays-0.2.3-73-source.tgz`.
- Source archive SHA256: `5db01a1e438064f12bcb287b20852d4f7db1ee27ee2b5ba75d63a0e05688a464`.
- Source/audit evidence: `work/async-ai-20261014/release-prep/source-manifest.json` and `freeze-audit.json`.
- Static iOS import graph:164 files; SHA256 `76b0694df10c327a4990dc3701093d84fa4dc9065316eba32f19e1f1b1e1b8fa`.

The audit matches every frozen/archive file by Git blob and SHA256, verifies all packaged source transformations, and excludes tests, fixture seams, debug controls and local-prediction modules from the native graph. The new coordinator is the active transport; retained legacy code is separately identified rather than misrepresented as removed.

## Fresh verification of this exact source

| Gate | Result |
| --- | --- |
| Locked dependencies and TypeScript/full verification |1,156 passed across14 suites; no failures, skips or cancellations |
| Focused AI/client/dial suite |199 passed |
| Component browser |57 passed |
| Exported App browser |4 passed |
| Privacy browser |5 passed |
| Native post-install model tests |Watch35 and widget10 passed; not native UI acceptance |

All commands exited0. Frozen source hashes were checked before and after verification. Evidence is in `prepare-complete.json`, `verify.log`, `ai-client-receipt.json` and `work/async-ai-20261014/frozen-browser-verification.json`. The browser receipt binds42 capture artifacts; the root actually reviewed all19 required fresh captures before binding acceptance. Coverage includes English/Simplified/Traditional Chinese, light/night, narrow layouts, large-font branch, privacy/consent, ring/brain, safe failure messages and whole-App job recovery.

The new actual-App scenario exercises one synthetic job through tab changes, same-scope authority-null intervals with zero API calls, background/foreground, failed status reads, reconnect, reload and eventual completion. It checks no duplicate POST, no unintended cancel/revoke, no record/profile mutation, metadata-only local persistence and disappearance of the brain only after completion. These are test-port/browser observations, not signed-in production, native suspension or paid-provider acceptance.

## Local signed artifact

Fresh read-only preflight at **2026-10-14 02:29:05 UTC** confirmed candidate73 absent, predecessor72 VALID/internal testing, correct production URL/IDs/scope, demo disabled, runtime0.2.3, OTA disabled, Store distribution and all three existing managed signing sets. Toolchain: Node24.21.0, EAS24.8.0, Expo57.0.20 and Xcode26.5(17F42). No cloud build or paid preview workflow was started.

Local archive/export succeeded. Actual IPA inspection verified535 frozen files and457 packaged files, Phone/Watch/widget strict Store signatures, matching profiles/entitlements, all targets version0.2.3/build73 and12 locales, production flags, native purchases, price safeguards and privacy links. All existing profiles expire6September2027. The feature inspector reads the signed Hermes bytes and binds the accepted source, not merely checkout strings.

- IPA: `artifacts/MyLittleDays-0.2.3-73.ipa`; SHA256 **`6244129c298ab01025f8874881a2976deba86fbbf696d51e24402ddb51a92559`**.
- Embedded Hermes:5,008,266 bytes; SHA256 **`8d28f764e29166896fab201222ba6626ae679e32b55b9e7a4916941dbefed3c4`**.
- dSYM ZIP: `artifacts/MyLittleDays-0.2.3-73.dSYM.zip`; SHA256 **`4213e028d6dca8ec618f3db4750e91775080e4b16e69c670a1c41916c1b22981`**.
- Xcode archive: `/Users/chao/Library/Developer/Xcode/Archives/2026-10-14/MyLittleDays 2026-10-14 13.32.41.xcarchive`.
- Root UI acceptance SHA256: `09b0b7fc229dc195707b6c8c639a4b3266f0af6bd857315e4a3d2753286e6fff`.
- Feature inspection SHA256: `db5fd36444edc4d5ab723481b0ad3b0ec0ccb6a2302355b99fcd1d4330ad7175`.

The Phone UUID is `957059E6-EA98-301F-8725-607FF1CDA78F` (arm64); Watch UUIDs are `7624622A-B813-38F6-B227-B7025D013B49` (arm64_32) and `9E58F527-EC1B-3CE8-95F4-030A79299931` (arm64); widget UUID is `1F708ED8-55AF-366E-90AF-43586204996C` (arm64). Archive, exported executables and packaged dSYMs match. Inspection and symbol receipts are `artifacts/MyLittleDays-0.2.3-73.inspection.json` and `.symbols.json`.

After successful inspection, the authorized cleanup removed exactly three operation-owned temporary p12 copies, after dry-run, path and ownership validation. The EAS temporary keychain and three temporary profiles were already removed. Original managed credentials and the IPA/source/archive/symbols are preserved. Cleanup receipt: `work/async-ai-20261014/release-prep/credential-cleanup.json`,02:40:33UTC. No signing rotation or app installation/uninstallation occurred.

## Compatible backend deployment

The approved existing workflow [run38500938755](https://github.com/github4me/my-little-days/actions/runs/38500938755) completed successfully at02:33:27UTC using commit `ad894407ce2c641740cfcf9d3230dbe4b8c68b8a`, tree `f4d33654d35a58d4b50c1308a048c79ac42df671`.

- Disposable SQLServer2022 CI: API491 and migrator91 passed, zero failures/skips, including the hosted-worker/caller-disconnect test. Disposable SQL cleanup succeeded.
- Additive `0010_DurableSleepAiJobs.sql` applied at02:30:51UTC; subsequent catalog/checksum verification found **zero pending scripts**. Only the run-owned temporary firewall rule was removed at02:30:57UTC.
- Exact API artifact SHA256 `3d783b9858e1487b4ad04c386d23b4e40fdf642cc6bb493ae8662620fc1a97df` was deployed. OneDeploy `6bb3a355-1369-4b24-9306-15f0c0593c9b` completed with status4. Bounded startup checks reached healthy liveness at02:33:23UTC.
- Root independently read live200, ready200 and anonymous capabilities401 at02:35:30UTC. These are availability/authentication-boundary checks, not a signed-in job or provider result.

Full sanitized receipt: `work/async-ai-20261014/backend-deployment.json`. The earlier CI failure was a synthetic migration fixture collision fixed only in tests; existing production migrations/services were not changed by that forward fix. Existing Azure resources, model and spending/retention settings were not changed. No live child payload or paid inference was used for verification.

## Acceptance gaps and distribution handoff

The paired physical iPhone was available but locked; the lock-state query failed CoreDevice10003/RemotePairing1016. No production-data-bearing app was removed or reset. Native SecureStore recovery, installed-app authentication/networking, iOS suspension/termination/resume, native consent interaction, VoiceOver, OS Dynamic Type and real-device animation remain pending. Browser/model tests do not close these gaps.

A production signed-in durable-job round trip and real provider completion are also unverified. CI proves the isolated SQL/HTTP/worker contract, not a real user's provider account or records. The accepted disposition is **TestFlight beta only, native recapture pending**, not public release certification.

Root and the independent reviewer passed the exact artifact: all three strict signatures/profiles/entitlements, source/Hermes bytes and flags, archive/export/dSYM UUIDs, ZIP-contained DWARF bytes and source-bound acceptance. Apple validation at **2026-10-14 02:42:06.847 UTC** returned **VERIFY SUCCEEDED**, with no errors.

Root recorded upload approval, cleared only the upload hold and completed **one upload of the exact IPA** at **02:44:23.143UTC**. Apple returned **UPLOAD SUCCEEDED with no errors**, delivery `0152f42c-0c53-40d0-895e-e981166ba39f`. Upload receipt and deduplication marker are retained under `work/async-ai-20261014/release-prep`; **do not upload again**. Readback at02:44:32.131UTC reports PROCESSING, no errors/warnings and no indexed build73 yet. Tester availability is not implied by upload success.

Checkout build-number bookkeeping now reads73; the frozen source archive was not changed. The uploader's scoped `finally` cleanup removes its temporary submission key and directory. Public0.2.2(58) remains READY_FOR_SALE and unchanged; no public review submission or release occurred.
