# AI reference prompt and one-tap controls — 0.2.3 (74)

## Checkpoint

**14 October 2026, 04:55 UTC / 15:55 AEDT.** The owner requested the approved
prompt/UI update, TestFlight delivery and Apple App Review. This is an updatable
release record, not a declaration that the outstanding stages have completed.
The previously selected `AFTER_APPROVAL` release policy is preserved.

| Boundary | Verified status at this checkpoint |
| --- | --- |
| Backend prompt and SDK tests | Complete; exact reviewed revision deployed successfully |
| Frozen mobile tests | Complete |
| Local signed mobile artifact | Built, inspected and Apple-validated; single upload succeeded |
| Public support/privacy pages | Published and exact-content readback verified |
| App Store version/metadata | 0.2.3 draft and metadata saved; exact processed build 74 selected |
| App Privacy Health purpose | Pending authenticated App Store Connect access and publication |
| Apple processing/TestFlight access | VALID; available to the two existing internal tester groups |
| App Review submission/public approval | Pending; no review submission or public release claimed |
| Physical iPhone/Watch/widget and real-provider acceptance | Not established by these checks |

## Scope and verification

The server embeds the reviewed WHO daily-sleep and Raising Children Network
tiredness references as soft context for sparse history. Usable recent records
outrank population references and previous predictions; missing activity is not
fabricated. The AI does not browse. Existing whole-day/old-client schemas,
validation, saved records, model, quotas, timeouts, consent version, credentials
and provider retention/spending settings are unchanged. See the
[prompt and source record](AI-REFERENCE-PROMPT-2026-10-14.md).

The mobile change makes Enable AI / Turn off AI one-tap actions and keeps an
optional, read-only AI consent link. No forced confirmation popup or inline
disclosure remains. Existing durable jobs, automatic updates, sliding single
colour-coded ring, breathing brain, collapsed help and no-debug/no-refresh UI are
preserved. This is not a local-prediction implementation.

| Verification | Result / retained evidence |
| --- | --- |
| Isolated prompt/SDK tests | 195 passed, 0 failed/skipped; `work/ai-prompt-release74-20261014/test-results/prompt74-focused.trx` |
| Backend non-incremental Release build | 0 warnings/errors; scoped prompt record |
| Frozen `npm run verify` | Exit 0, 1,156 tests passed; `release-prep/prepare-complete.json`, `release-prep/ui-acceptance.json` |
| Frozen AI client tests | 199 passed, 0 failed/skipped; `release-prep/ai-client-receipt.json` |
| Frozen browser checks | 57 component, 4 full-app, 5 privacy cases passed; `frozen-browser-verification.json` |
| Frozen general browser suite | Exit 0; `frozen-general-browser-receipt.json` |

The abbreviated mobile evidence paths above are under
`work/ai-guidance-release-20261014/`. Browser checks use synthetic records and
blank family configuration. They cover English, Simplified/Traditional Chinese,
light/night, narrower screens, larger text and reduced motion, but are not native
VoiceOver/Dynamic Type, installed networking, app-switch or clinical-accuracy
acceptance. No real family data or live provider request was used for these tests.

## Immutable sources and local artifact

Backend GitHub revision: `bf69205e77f2fe0216cd21e7f01c99b65540009f` on
`github4me/my-little-days` / `feature/family-invitations`, parent
`622330cbe9743c5119c4b602d2c9cb857a01d610`. Exact five-file publication and unchanged
migration scripts were independently verified. Deployment run **38512741393**
completed successfully at **04:47:54 UTC**: API/SQL tests **493**, migrator tests
**91** and remote TypeScript tests **718** passed without failures/skips. The
immutable database runner reported **zero pending scripts** before, at and after
apply; no script was added or applied. The run-owned firewall rule was removed
and its absence rechecked. Exact API/database artifact digests matched upload
and download; OneDeploy completed and became active. Sequential live/ready and
anonymous protected-route checks passed. Evidence:
`work/ai-prompt-release74-20261014/deployment-verification.json` and its referenced
boundary receipt. These are not signed-in SQL/provider or native acceptance.

Mobile source tree: `63ce47eaf1bd19c6f867242372326690a49c6f76`, frozen at
04:33:43 UTC, **535 files**. It preserves build 73 tree
`e85aa2477fa6643ae26f4ac3384fe308b4d60153` plus only the reviewed five overlays:
`app.json`, `src/SleepGuidanceSection.tsx`, `src/locales/aiSleepOverrides.ts`,
`tests/ai-sleep-app-browser.mjs`, `tests/ai-sleep-browser.mjs`.

- Source archive: `artifacts/MyLittleDays-0.2.3-74-source.tgz`; SHA-256
  `c9313a91c74ce977d7934a096359eab43f184ab66a1f19ce1a25796afe55ca1b`.
- Inspected IPA: `artifacts/MyLittleDays-0.2.3-74.ipa`; SHA-256
  `18d57578daf9ae1e5e579203328e731c7e77e95226fdac24e473318163d89439`.
- Phone/Watch/widget all Store-signed **0.2.3 (74)**; deep/strict signature check,
  matching dSYM UUIDs, production configuration, runtime 0.2.3, OTA off, demo off
  and compiled feature inspection passed. Existing signing assets were reused.
- Evidence: `.inspection.json`, `.symbols.json` beside the IPA, and
  `release-prep/feature-inspection.json`. Build used local Mac compute, not EAS
  cloud build. No install/uninstall or data reset is implied.

Apple validation succeeded at **04:48:06 UTC**, then one direct Apple upload
succeeded at **04:50:08 UTC** for the exact **17,344,772-byte** inspected IPA.
Delivery UUID: **`0997c5b8-ed69-4f67-abf2-55c71baca6a6`**. Receipts:
`release-prep/validate.json` and `release-prep/upload.json`. At **04:54:07 UTC**,
Apple confirmed the same build ID as **VALID / IN_BETA_TESTING**, assigned to
existing internal groups **Team (Expo)** and **Early Birds**. Delivery is
**COMPLETE**, with no errors/warnings. Evidence:
`release-prep/apple-status-1791953647042.json`. External state remains
`READY_FOR_BETA_SUBMISSION`; no external-beta approval or device installation is
claimed. No duplicate upload or tester/group change was needed.

## Public pages and Apple metadata

Only the approved one-tap/link and public 0.2.3 wording replaced exact spans in
the fetched current HTML. Existing asynchronous-storage, minimization, OpenAI,
expiry and cancellation disclosures were preserved; stale local Markdown was
not published over the remote pages.

`github4me/my-little-days-privacy` commit
`f8626f0c4e1b34dfe0ffad857c8794eaae556f3a`, Pages run **38512555712**, succeeded.
At 04:40:53 UTC both pages returned HTTP 200 and exact reviewed bytes:

- [Support](https://github4me.github.io/my-little-days-privacy/): SHA-256
  `d82e5a1a4c232e7c6a79729c8d40969def21b5cad68c8db43ba16e69302d12d6`.
- [Privacy](https://github4me.github.io/my-little-days-privacy/privacy/): SHA-256
  `9b91a11b01097fd7e35297ac5b35a25a8ab0b2d79ff012ebe19384f26882d276`.

Receipt: `work/ai-guidance-release-20261014/review/privacy-publication.json`.
All other website files remained unchanged.

App Store Connect app **6809826484**, bundle `com.littledays.babylog`: version
**0.2.3**, ID `c76215c3-f614-4d15-a1b6-ae28cab3372b`, is
`PREPARE_FOR_SUBMISSION`, release type `AFTER_APPROVAL`. The en-AU description,
What's New and review notes were saved/read back; contacts and prior reviewer
access policy were preserved. At **04:54:42 UTC**, the exact processed build 74,
ID `0997c5b8-ed69-4f67-abf2-55c71baca6a6`, was selected and read back. Published
0.2.2 (58) remains unchanged. Evidence: `review/create-1791952981595.json`,
`review/metadata-1791953015233.json` and `review/select-1791953682894.json` in the
operation folder. No ReviewSubmission was created; this draft is not submitted.

Review notes explain one-tap consent, sparse-data references, durable jobs,
minimized OpenAI inputs and reviewer-owned email/OTP access. No fixed demo
password/account was invented. Authenticated reviewer-path success remains a
separate readiness check, not a consequence of saved notes.

## Retained screenshots and remaining review gates

All **12 genuine retained assets** (5 iPhone, 6 iPad, 1 Watch) were visually
reviewed and their hashes, order, dimensions and COMPLETE processing checked
against Apple. They depict the fictional Willow profile and representative core
features; no AI result images or AI-accuracy claims were created.

They are **not current build 74 pixel captures**: Overview/Daily rhythm show the earlier
Records order without the inserted Sleep guidance card; iPad Today/Growth show
the old “Version 0.2.2 · Update 58” footer. Watch depicts the retained summary, not
the changed feed actions. See `review/screenshots-review.md`. Root explicitly
accepted retaining these as representative core-feature marketing assets without
changes or claims of current build 74 capture. Root also reviewed the documented
native gaps; that disposition does not establish native acceptance. The helper
uses `retainedScreenshotsRepresentative`, not a claim of pixel accuracy, while
still requiring unchanged inventory, order, dimensions and processing state.

App Privacy currently needs **Product Personalization** added to **Health**, in
addition to its existing App Functionality purpose, with linked-to-identity and
not-tracking answers preserved. Location: App Store Connect → Apps → My Little
Days → App Privacy → Health. Expected readback retains all 11 existing categories
and adds Health to Product Personalization. Owner login is pending; a published
website policy is not publication of Apple's questionnaire. The optional-link
consent design remains subject to Apple's review, not a compliance certificate.

App Review remains blocked on authenticated App Store Connect access and the
Health-purpose privacy update. Before actual submission, verify published privacy
answers, reviewer access and final readiness. Root's documented screenshot/native
gap disposition does not imply those native tests passed. Append actual receipt
times and IDs here as each stage completes; never infer later-stage success from
an earlier checkpoint.
