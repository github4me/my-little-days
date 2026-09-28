# Apple-guided app UI — preview 26

18 September 2026. Implements the app-wide design rule in
[AGENTS.md](../AGENTS.md#apple-first-design-standard), beyond the earlier
[Night-only pass](NIGHT-APPEARANCE.md).

## What changes

- Shared text uses the system font, a 17-point body default, uncapped content
  scaling and Bold Text support. Choices reflow into rows instead of shrinking
  or hiding labels; buttons grow for wrapped text and expose unavailable/busy
  states. Normal recording, membership and permission rules are unchanged.
- Light appearance uses neutral grouped surfaces and darker secondary text.
  Both appearances have increased-contrast variants. One OS-preference provider
  observes iOS Increase Contrast/Bold Text and motion preferences, Android high
  text contrast, and corresponding supported web media queries. Preference
  reads do not block rendering or call the API; stale reads cannot replace newer
  events. Foregrounding refreshes OS preferences.
- All app modal boundaries respect Reduce Motion and iOS Prefer Cross-Fade.
  Accessibility Escape uses the dialog's existing safe close handler, including
  busy/confirmation guards. Surfaces stay opaque; dimming backdrops are not
  decorative blur, and no new translucent material depends on transparency.
- Navigation has explicit localized titles, stable labeled destinations, vector
  icons, selection semantics and web keyboard navigation. Native route changes
  announce the destination without stealing focus from a modal or active input.
  iOS tab labels remain compact with native Large Content Viewer support; that
  navigation exception does not cap form or content text.
- Care, feeding and settings use native date/time input where applicable. iOS
  wheel changes stay as a draft until Done; Cancel and Android dismissal do not
  save them. Native switches represent boolean choices. Local/shared storage
  disclosures describe the actual workspace, not merely sign-in status.
- Larger-text calendar views show the same filtered records as a readable list
  instead of relying on densely positioned timeline labels. Record actions,
  privacy navigation, family dialogs and form layouts receive corresponding
  touch-target/readability improvements. Charts retain textual record access.

## Care hierarchy follow-up — preview 27

General Care/Play introductions and references now live in initially collapsed
help after the main content. Daily care opens with category choices and the
recording form; help expansion does not save, clear or reset an in-progress
record. Urgent temperature guidance, the prefilled-reading warning, unadjusted
measurement instructions, bath supervision and baby-safe nail-tool guidance,
errors and permission/consent notices remain visible.
Medical wording, storage behavior and validation are unchanged.

This applies Apple's [secondary help](https://developer.apple.com/design/human-interface-guidelines/offering-help)
and [disclosure](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls)
guidance without moving critical information into hidden help. Preview **0.2.1 / 27**
finished successfully from source `5dea17c`; preview 26 does not contain it.
The exact build and installation link are recorded in the manual runbook;
physical-device acceptance remains separate.

Local verification: `npm run verify` passed (TypeScript and 517 tests), the full
browser regression passed, and the Apple layout suite passed all four bilingual
light/dark viewport scenarios with 16 isolated captures. Tests cover initially
collapsed help, retained unsaved care values and visible safety instructions.
The browser bundle was rebuilt with demo mode disabled and Metro's cache cleared;
an earlier cached bundle failed the unrelated signed-out family-entry assertion.
Physical iPhone rendering and VoiceOver checks for this follow-up remain pending.

## My account invitations and deletion — preview 28

Eligible, verified users now see **Received family invitations / 收到的家庭邀请**
directly below **Signed in / 已登录**, even when account details are collapsed.
Each invitation shows its inviter, expiry, and Accept/Decline actions. Existing
join review and local-data replacement/other-invitation consent are unchanged.
The inbox follows authoritative controller results, not a local dismissal flag:
cancellation or failure does not mark an invitation handled. A no-family action
awaiting confirmation retains disabled rows with an explicit pending status.
Known family membership, unverified/expired sign-in and account deletion do not
expose join actions; expired invitations are omitted.

**Delete account / 删除账户** is a separate final item in expanded account details,
below Sign out. Its full consequences and acknowledgement remain in the existing
confirmation dialog; administrators must still resolve ownership first.

TypeScript and all 522 verification tests passed, including 55 family UI tests.
The full browser regression, Apple layout checks and isolated bilingual Light/Dark
family flows at 320/390px also passed. Those flows check collapsed-account visibility,
non-nested action buttons, cancellation, confirmed decline and the separated
deletion confirmation. Physical iPhone VoiceOver order, large Dynamic Type and
keyboard behavior remain unverified. **0.2.1 / preview 28** finished successfully
from source `32d60b7`; preview 27 does not contain it. The exact build and
installation link are recorded in the manual runbook. Device acceptance is separate.

## More-level account deletion (preview 29)

Delete account is now a standalone item at the bottom of **More**, after ordinary
settings and before the passive footer. It is a sibling of **My account**, not
inside that disclosure. Received invitations remain directly below Signed in.
The item opens the existing confirmation with full consequences and explicit
acknowledgement; it does not directly submit deletion. Administrator restrictions,
authentication and lifecycle guards remain. A known family with unavailable
role/access keeps deletion disabled until refreshed. Deletion progress/recovery
stays in My account rather than being duplicated at the bottom.

This change ships in native **0.2.1 / preview 29**, which finished successfully
from source `12ea638`. Preview 28 has the old location; the manual runbook has the
exact build and installation link.
TypeScript and all 524 verification tests, full browser regression, four Apple
layout scenarios and isolated bilingual Light/Dark family flows passed. The
manual runbook records release evidence and the new phone acceptance steps.
Physical iPhone layout, large Dynamic Type and VoiceOver acceptance remain pending.

## Implementation boundaries

This is an Expo/React Native UI update, not a rewrite in SwiftUI. Existing
navigation state, data validation, synchronization, permissions and deletion
contracts are retained. No new UI dependency, Azure deployment or SQL migration
is required. Custom controls still need native acceptance; neither custom
controls nor a matching color palette alone prove HIG conformance.

These changes address identified issues, not a certification that every screen
meets every HIG recommendation. The portrait configuration is unchanged. Native
iPad presentation, VoiceOver focus, Large Content Viewer, native font rendering
and keyboard behavior must be verified on supported devices.

## Verification and phone acceptance

Automated evidence is recorded with the release in the
[manual runbook](AZURE-MANUAL-SETUP-RUNBOOK.md). Native-boundary mocks test behavior
and properties, not UIKit rendering. Browser screenshots use isolated synthetic
local data and block external requests; they are web layout evidence only.

On an already registered iPhone, install the exact **0.2.1 / 26** preview over
the existing app. Never uninstall, clear storage or create destructive test
operations against the real family.

1. In **Settings → Accessibility → Display & Text Size → Larger Text**, try the
   default and largest accessibility sizes. Check all five tabs, choices,
   summaries, forms and reachable Save/Cancel controls. Hold a tab on iOS to
   check Large Content Viewer; its full localized title should be readable.
2. Toggle **Bold Text** and **Increase Contrast**, return to the app, and verify
   both **More → Theme → Light/Dark** (浅色/深色). Also test Automatic against the system
   appearance. Pickers and keyboards should match the active appearance.
3. In **Settings → Accessibility → Motion**, enable **Reduce Motion** and, where
   offered, **Prefer Cross-Fade Transitions**. Open/close editors and confirmation
   sheets; there should be no sliding transition while either is enabled.
4. Enable **VoiceOver**. Navigate tabs, read inputs and selected/disabled states,
   adjust the milk amount, and cancel a non-destructive dialog with the escape
   gesture. Busy destructive operations must not bypass their existing guards.
5. Try care/feeding time wheels, birth date and daily reminder time: Cancel
   retains the old value; Done applies a valid value. A future time of day is
   valid for a daily reminder, unlike a future care record. Check an empty birth
   date and read-only family profile without saving test data.
6. Repeat core layouts in Chinese/English, with the keyboard open and on iPad.
   Confirm that family-shared records still show pending synchronization truthfully.

## Official references

- [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Typography and Dynamic Type](https://developer.apple.com/design/human-interface-guidelines/typography)
- [Adaptive layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
- [Semantic color](https://developer.apple.com/design/human-interface-guidelines/color)
- [Large Content Viewer](https://developer.apple.com/documentation/uikit/uilargecontentviewerinteraction)
- [React Native accessibility preferences](https://reactnative.dev/docs/accessibilityinfo)
