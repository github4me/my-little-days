# Apple App Review submission — 0.2.4 (77)

Owner explicitly directed submission of the existing build without changing
public privacy or in-app wording. Official App Store Connect API submission
completed **18 October2026 19:51:55.614 UTC /19 October06:51:55 Melbourne**.
Fresh readback19:52:02 UTC confirms version and submission **WAITING_FOR_REVIEW**.
This is successful submission, not Apple approval or public distribution.

- App6809826484, `com.littledays.babylog`, existing Apple teamA9974KXQ4G.
- Version0.2.4: `73bed9b0-213d-42a2-b657-0efb65eee7f2`.
- Exact build77: `93de67a9-6f84-44c0-8307-95d251c62c13`.
- [Review submission](https://appstoreconnect.apple.com/apps/6809826484/distribution/reviewsubmissions/details/eee36c47-2c86-4165-b385-7154c667e7f6):
  `eee36c47-2c86-4165-b385-7154c667e7f6`, one IOS app-version item only.
- `AFTER_APPROVAL`: preserve the prior release preference, announced before
  submission. The interface also confirms automatic release to all users,
  not phased release. Public0.2.3(75) remained available and unchanged.

## Checked and preserved

Build77 is VALID, APP_STORE_ELIGIBLE, unexpired, with non-exempt encryptionfalse,
matching app and prerelease0.2.4. No replacement IPA, TestFlight upload, signing
change or paid EAS build was required. Frozen mobile source tree
`be594e3ad473a8f5927743a1f0edbb276675556a`, IPA SHA-256
`adb8a860727cbc0736bd13fab42effbb459aa298b51df1166a9aad4a8bf2cff8`.
Exact IPA/symbol hashes, Phone/Watch/Widget version/build/signature/configuration
inspection, signed-Hermes parity and remaining-day feature receipt were
rechecked through the existing release records. See
[the original build receipt](AI-REMAINING-DAY-TESTFLIGHT-2026-10-18.md).

The new draft inherited the existing en-AU description, keywords, promotional
text, marketing/support URLs and all12 screenshots. Screenshot checksums,
dimensions/order and COMPLETE state matched the published version before final
submission. Only the new version's What's New and review notes changed.
Private contact values and owner-approved reviewer-email/one-time-code access
were preserved and verified without printing/saving credentials or contacts.
Existing approved coffee purchases were not resubmitted or modified.

[Exact saved review notes](app-store/review-notes-0.2.4-77.txt) describe
remaining-day-only predictions, seven prior complete dates, actual records kept
separate, optional AI/sign-in, background tasks, uncertainty, one-tap controls,
the clock and unchanged Watch/widget/purchase/account flows. They truthfully
state that restricted successful/failed provider exchanges are retained seven
days and explicitly identify the still-unupdated public/in-app retention copy.
No inaccurate request-clearing claim was copied into this new review note.

Public privacy/support pages, App Privacy answers and in-app content were not
changed. The known disclosure discrepancy remains outstanding; submission does
not resolve it or certify compliance. No new App Privacy accuracy declaration,
legal agreement, permission expansion or review-access bypass was accepted.
This operation makes no new real-provider/device acceptance claim. Backend
health was ready, but that is not a signed-in inference test.

## Submission sequence and evidence

Existing Expo-managed submission credentials were reused in memory after exact
project, account, team and production public-value checks. No key rotation,
secret printing or browser-token extraction. App Store Connect's owner-prepared
browser sign-in was completed with its existing filled fields; no credentials
were read or changed.

1. Confirmed no0.2.4 draft or active submission; prior0.2.3(75) public.
2. POST appStoreVersions created the exact0.2.4 draft. Refreshed prior-version
   snapshots remained identical after draft creation and metadata changes.
3. Saved/read back truthful review notes, What's New and preserved private
   contacts; selected the already accepted77 by its exact build ID.
4. POST reviewSubmissions and reviewSubmissionItems created one owned draft,
   with only the intended app version. READY_FOR_REVIEW was not claimed as sent.
5. After fresh build, screenshot, metadata, contact and prior-version checks,
   PATCH reviewSubmissions with submitted=true completed. Readback confirms
   WAITING_FOR_REVIEW and the exact submittedDate above. The item's own
   READY_FOR_REVIEW state while queued is distinct from the parent submission.

The signed-in Apple browser independently shows iOS Submission, Waiting for
Review, Items Submitted(1), iOS App0.2.4 /0.2.4(77), and the same submission ID
and06:51 Melbourne time. Saved screenshot:
`work/app-store-submit77-20261019/apple-waiting-for-review.png`. This is the
actual Apple page, not a mockup or generated status image.

Sanitized operation records are under `work/app-store-submit77-20261019/`.
The operator allows only app-version/localization/review-detail/submission API
writes, never pricing, availability, App Privacy, users, builds or purchases.
No automatic retry of ambiguous writes. An initial read used an incomplete item
relationship projection; it was corrected to request include=appStoreVersion,
then status confirmed no draft existed before the first external write.

No production user records, private family payloads, purchases or destructive
account/family flows were used for submission checks. Physical native acceptance
and Apple's review outcome remain separate from upload/submission evidence.
