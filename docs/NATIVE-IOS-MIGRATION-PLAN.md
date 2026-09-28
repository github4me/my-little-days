# Native iOS, Watch and Widget migration plan

Prepared **21 September 2026**. Status: **implementation plan, not an implemented
rewrite or an authorization to deploy/change cloud resources**.

Repository baseline: `feature/family-invitations`,
`093683b7fc885216179c9bebc152504c9a669882`. Rebaseline against the reviewed release
SHA before starting implementation. No existing whole-product native migration
plan was found; the existing Watch, Widget, Apple UI and IAP plans cover parts of
the product and remain useful behavioral specifications.

## 1. Recommendation and scope

Build a **Swift/SwiftUI iPhone and iPad app**, reuse the existing native **SwiftUI
Watch app** and **WidgetKit extension**, and replace the phone's Expo-dependent
adapters with native services. Keep the existing Azure API, SQL database, Entra
accounts, App Store app, bundle identifiers and App Group.

The finished Apple build must not require React Native, JavaScript/Hermes, Metro,
Expo modules, CocoaPods, EAS Build, EAS Submit or EAS Update. Use a checked-in Xcode
project, Apple frameworks and a small number of pinned Swift-package dependencies.
Build and test on the Mac; archive locally and upload directly to Apple.

**A rewrite is not necessary merely to save Expo build charges.** The existing
Expo app already builds locally, including Watch, Widget and StoreKit. Continue
that local-only path during migration; there is no reason to buy cloud builds
while developing the replacement. Expo itself documents both local Xcode builds
and the separate `eas build --local` route. [Local builds](https://docs.expo.dev/guides/local-app-overview/),
[local EAS builds](https://docs.expo.dev/build-reference/local-builds/).

The native rewrite's benefits are direct ownership of the Apple UI, lifecycle,
debugging and dependencies. Those benefits must be weighed against substantial
one-time porting and regression work. Do not promise performance improvements
until measurements exist.

Scope defaults for this plan:

- Preserve all current phone features, offline behavior, family behavior, twelve
  locales, iPad support and System/Light/Night appearance.
- Preserve the Watch's existing feature set; it need not gain every phone screen.
  Keep it a paired companion, not a new independently authenticated cellular app.
- Preserve the current small/medium read-only Today widget. Interactive widgets,
  Live Activities, complications and HealthKit are separate future features.
- Keep Android/web source and current behavior. A SwiftUI rewrite does not replace
  them; deleting them or promising continued cross-platform feature parity needs
  a separate product decision.
- Keep browser-delegated Entra sign-in through Apple's system authentication
  session. A native app can legitimately use this secure system flow; rebuilding
  the email-code identity UI is not required to remove Expo.
- No new Expo project, Apple app listing, Azure service or paid build service.
  OTA remains disabled. Planning does not cancel an existing Expo subscription.

## 2. Evidence and remaining uncertainty

| Area | Observed baseline | Consequence |
| --- | --- | --- |
| Phone | Expo SDK 57 / React Native 0.86.3; `App.tsx`, `src/` | UI, domain helpers, persistence, auth and sync need Swift implementations. |
| Watch | SwiftUI in `watch/WatchApp/`; Foundation protocol in `watch/Shared/` | Reuse source, resources, on-disk state and wire protocol; replace the phone-side React adapter. |
| Widget | SwiftUI/WidgetKit in `widgets/TodayWidget.swift`; native snapshot publisher/model | Reuse extension and snapshot contract; publish from native phone state. |
| Native bridges | `modules/watch-bridge/`, `modules/family-storage-security/` import `ExpoModulesCore` | Extract their useful native implementation from the Expo module/delegate wrappers. |
| Notifications | `familyPush.native.ts` obtains Expo tokens; server `ExpoPushGateway` sends through Expo | Full Expo independence requires a native APNs client **and a compatible backend sender/registration change**. |
| Backend | Existing .NET/SQL full-history API and Entra tenant | Reuse contracts and data; do not replace with CloudKit/Firebase or a second backend. |
| Mac | Rechecked Xcode `26.5 (17F42)`, architecture `x86_64` | Local Apple compilation is available now. SDK/device support must be checked again for each release. |
| Current local build | Runbook records signed `0.2.1 (41)` from the baseline SHA, containing all three products | This is proof for the current Expo product, **not** proof of the proposed Swift phone rewrite. |
| Acceptance | That local candidate has not been recorded as uploaded, processed or physically accepted | Preserve separate release/device gates; earlier test results do not close native-migration gates. |

Detailed existing evidence and Mac setup:
[manual runbook](AZURE-MANUAL-SETUP-RUNBOOK.md#mac-setup-and-preview-preflight--21-september-2026-melbourne).
Watch/Widget source reuse does not imply their current behavior is fully
device-verified. No live Azure or Apple settings were changed or freshly audited
for this planning task.

## 3. Identity and compatibility invariants

| Setting | Preserve |
| --- | --- |
| Apple team | `A9974KXQ4G` — Chao Wang (Individual) |
| App Store Connect app | `6809826484` |
| Phone/iPad bundle | `com.littledays.babylog` |
| Watch bundle | `com.littledays.babylog.watchkitapp` |
| Widget bundle | `com.littledays.babylog.widget` |
| App Group, Phone + Widget only | `group.com.littledays.babylog.widgets` |
| URL routing | `mylittledays://auth`, `mylittledays://today` |
| Initial deployment targets | iOS/iPadOS `16.4`, watchOS `9.4`, matching generated targets |
| StoreKit consumables | `com.littledays.babylog.tip.small`, `.tip.coffee`, `.tip.generous` |
| Public service configuration | Existing API origin, Entra tenant/client/scope, demo `0`; exact values in runbook section 12.1 |
| Versioning | One marketing/build version across Phone, Watch and Widget; next unused Apple build number |

Do not change the signing application-identifier prefix or Keychain access groups
incidentally. The same bundle identifier alone is not sufficient evidence that
all old Keychain items remain readable. Verify signed entitlements and an actual
in-place update. Reuse valid existing profiles; repair only a demonstrated missing
or incompatible signing requirement, without revoking working credentials.

Keep the present OS floor initially. Use `ObservableObject`/`@Published` where
needed for iOS 16; do not make SwiftData, Observation-only APIs or newer visual
effects mandatory. Use availability checks and UIKit wrappers for gaps. A higher
minimum OS is a user-facing compatibility decision, not a cleanup shortcut.

## 4. Target project and service structure

Proposed layout; these paths do **not** exist yet:

```text
apple/
  MyLittleDays.xcodeproj/           # reviewed, tracked project + shared schemes
  Config/                         # build settings, public config, entitlements
  MyLittleDays/                    # SwiftUI app, routing, feature screens
  Packages/LittleDaysCore/         # models, validation, calculations, sync state
  Packages/LittleDaysStorage/      # SQLite + legacy compatibility + Keychain
  Packages/LittleDaysServices/     # API, auth, reminders, StoreKit, companions
  Tests/                          # integration, migration and UI test targets
  Fixtures/                       # synthetic cross-language parity fixtures
  Scripts/                        # local verify/archive/inspect scripts
watch/                            # retain existing Watch sources initially
widgets/                          # retain existing Widget sources initially
modules/watch-bridge/              # extract reusable native code carefully
```

The generated `ios/` is not tracked in the baseline. Do not make the new native
application depend on Expo regenerating that directory. Reference the existing
Watch/Widget files directly initially, avoiding two diverging implementations.
If files later move into packages, update the legacy Expo plugins and tests in
the same change while that release path is still maintained.

Proposed responsibilities:

- `@MainActor` view models expose explicit loading, locally saved, sync-pending,
  conflict and confirmed states. Domain decisions do not live inside views.
- `LocalStore` owns serialized SQLite transactions. A durable write completes
  before UI success, network dispatch or a saved Watch receipt.
- `AuthSessionCoordinator` owns token refresh, identity binding, logout barriers
  and session generations. Every result after an `await` rechecks its generation;
  Swift actors are reentrant and do not eliminate late-response races themselves.
- `FamilySyncEngine` owns scoped queues, immutable requests, snapshots, receipts
  and lifecycle transitions. Network calls occur outside database transactions.
- `CompanionCoordinator` starts the Watch transport at app launch, independent
  of any screen. `WidgetPublisher` runs after authorized durable projection.
- `ReminderCoordinator` reconciles device notification schedules;
  `PushRegistrationCoordinator` owns remote-notification consent and bindings.
- One app-lifetime `PurchaseCoordinator` handles StoreKit independently of family
  identity, navigation and baby-data cleanup.

Use `Foundation`, `SwiftUI`, `UIKit`, `SQLite3`, `Security`, `CryptoKit`,
`AuthenticationServices`, `UserNotifications`, `WatchConnectivity`, `WidgetKit`,
`PhotosUI`, `ImageIO`, `UniformTypeIdentifiers`, `Charts` and `StoreKit` as needed.
Use a tested SQLite wrapper over system SQLite first; a pinned, audited package
is an alternative if its transaction/backup behavior is demonstrably safer.
Do not perform a SwiftData schema conversion merely to obtain native UI.

One small authentication dependency is recommended: evaluate and pin
[AppAuth-iOS](https://github.com/openid/AppAuth-iOS), which supports system-browser
authentication, PKCE, custom redirects and Swift Package Manager. Prove compatibility
with this tenant before selection. Keep dependency licenses and `Package.resolved`
in source control. Node may remain a development-only fixture tool during the port;
the final Apple build itself must work without it.

## 5. Feature-by-feature parity backlog

Each row is required unless a separate scope reduction is explicitly approved.

| Feature / source of truth | Native implementation | Required parity evidence |
| --- | --- | --- |
| Navigation: `App.tsx`, `AppNavigation.tsx` | Five destinations: Today, Care, Records, Growth, More; native `TabView`, navigation stacks, sheets and alerts | Stable navigation, retained form drafts, predictable Back/Cancel/Done, cold/warm links. |
| Baby profile / avatar: `domain.ts`, `avatar.ts`, `avatarSanitizer.ts` | Typed profile forms; PhotosPicker/ImageIO pipeline; protected app-owned files | Same validation/owner permissions; orientation and size bounds; no original EXIF/GPS uploaded. |
| Milk / breastfeeding / nappies | Native editors and quick actions; port amount presets and validation | Bottle actual volume, feeding sides, dates, notes, zero versus missing, durable save, edit/delete behavior. |
| Feed/sleep timers: `feed*`, `sleep*` helpers | Persist start/end instants; derive elapsed display rather than requiring a running process | Restart/lock/clock changes; start-in-flight then stop; concurrent family completion; sub-minute cancellation only where authorized. |
| Care: `DailyCare.tsx`, `care.ts` | Native temperature, bath, wash, oral, nails and supplement forms | All kinds/methods/supplement combinations; date constraints; visible existing safety copy; keyboard and destructive confirmation. |
| Play: `PlayLearning.tsx`, `learning.ts` | Native activity lists, selection, favorites/check-ins and help | Stable activity IDs; age/day rules; all saved selections/check-ins migrate and synchronize. |
| Records: `Records.tsx`, `RecordsCalendar.tsx`, calendar helpers | Native list/calendar/filter/editor views | Dates, filters, authorship, starter/finisher, pending/conflict indicators, deletion/undo where supported. |
| Today totals / growth: `todaySummary.ts`, `domain.ts`, `growth.ts` | Shared calculations plus Swift Charts or accessible custom drawing | Sleep interval union/midnight/DST/rounding; exact bundled WHO reference points and limits; accessible chart alternative. |
| Preferences/localization: `storage.ts`, `locales*`, `palette.ts` | String catalogs, system formatting, persisted app-language and theme preference | All 12 locales and plural forms, language versus formatting locale, System/Light/Night across every sheet/picker. |
| Backup/recovery: `backup.ts`, recovery storage | Document picker, security-scoped access, share sheet, validated JSON | Existing personal backup compatibility/25 MiB bound; cancel/corrupt input non-destructive; preserve active-member download of fresh authorized family snapshots, separate family format and disabled family-file import/restore. Never export optimistic cache or pending operations. |
| Local/shared reminders: `reminders.ts`, `familyReminder*` | `UNUserNotificationCenter`, stable rule/revision reconciliation | Once/daily/after-feed, per-device opt-in, localized schedules, offline cleanup retry, no duplicate alerts after upgrade. |
| Sign-in: `family/auth.native.ts`, `identity.ts` | System-browser OAuth/OIDC + Keychain + existing API identity checks | Cancellation, expired token, OTP return, refresh timeout, account switch, secure cached startup and deletion receipt. |
| Family: `useFamilyPilot.ts`, `fullState.ts`, `pilotState.ts`, `extras.ts` | Explicit native state machine and native family/settings screens | Every contract/lifecycle/consent, durable outbox, conflict recovery, extras and mixed old/new client tests. |
| Family-entry push: `familyPush*`, server `Push*.cs` | APNs registration and direct backend APNs delivery | Opt-in, categories, generation/lease, actor exclusion, generic copy, old binding cleanup, sandbox + production delivery. |
| Watch: `watch/`, `watchProtocol.ts`, `watchFamily.ts`, `useWatchCompanion.ts` | Reuse SwiftUI/protocol; native phone command dispatcher and durable receipts | Offline queue, duplicate/out-of-order transfer, mixed-version upgrades, final sharing acknowledgment and access expiry. |
| Widget: `widgets/`, `TodayWidget*`, widget routing | Reuse WidgetKit; native summary publisher | Same kind/group/file/schema, small/medium, stale/empty/expired states, scope clearing and safe deep link. |
| Coffee: `support/*`, IAP plan | Direct StoreKit 2 | Exact verified transaction, repeated tips, cancellation/pending, unfinished replay and finish retry. No Apple Pay. |
| Privacy/support/acknowledgments | Native screens and links | Existing disclosures, API/account boundaries, license notices, review access and accurate native privacy manifests. |

Recheck [Apple tab guidance](https://developer.apple.com/design/human-interface-guidelines/tab-bars),
[accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
and [typography](https://developer.apple.com/design/human-interface-guidelines/typography)
when implementing each screen. Prefer standard controls, semantic colors and
system fonts. Maintain this project's 44 × 44-point interaction target, VoiceOver
semantics, accessible text sizes, keyboard avoidance and clear consent. Native
framework selection alone is not HIG compliance.

## 6. Highest-risk work: existing installations and data

### 6.1 Inventory to preserve

The recommended first native release uses a **compatibility storage adapter**:
open existing databases in place, preserve their schemas and durable payload
semantics, and postpone normalization to another release. This minimizes data
conversion, but does not remove the need for upgrade tests.

| Existing location | Content and migration obligation |
| --- | --- |
| `Documents/SQLite/little-days.db`, `app_data` | Personal `state`, recovery, avatar reference, theme/language/view, play preferences/check-ins, auto-feed settings, Watch workspace/ledger. Inventory every key; do not import only `State`. |
| `Documents/SQLite/little-days-family-pilot.db` | `pilot_accounts` and `owner_setup_drafts`; scoped snapshots, pending/failed/accepted operations, lifecycle/activation journal, draft, revision, Watch ledger/validation time. Preserve account-key construction exactly. |
| `Documents/SQLite/little-days-family-notifications.db` | `device_opt_in` and `cleanup_retry`; retain consent and unfinished cleanup, not just scheduled alerts. |
| Keychain | `my-little-days.family-pilot.{tokens,identity,signed-out,cache-guard,deletion-receipt}` and `my-little-days.family-entry-push.v1`. Preserve deny markers, device proofs and deletion receipts even if reauthentication is necessary. |
| Phone Application Support | `LittleDaysWatchBridge/inbox-v1.json`: bridge ID, generation, sequence, pending commands, receipt fingerprints and acknowledgments. |
| Watch Application Support | `LittleDaysWatch/outbox-v1.json`: cached context, pending commands, projections and selected bottle amount. Preserve Watch bundle/storage. |
| App Group | `LittleDaysWidget/today-v1.json`; schema 1, widget kind `LittleDaysToday`, `LittleDaysWidgetAppGroup` Info.plist setting. |
| Documents / system notification store | App-owned avatar files and existing `UNNotificationRequest` objects/metadata. Some reminder intent must be reconstructed from scheduled requests, not only SQLite. |

The installed Expo SecureStore source uses generic-password items, UTF-8 key bytes
for account/generic fields and normally service `app:no-auth`, with `app:auth` and
legacy `app` lookup fallbacks. Implement a narrow compatibility reader using the
exact pinned implementation and signed access group, not a broad Keychain dump.
Keep `WHEN_UNLOCKED_THIS_DEVICE_ONLY` semantics for the current sensitive keys.
Treat a locked device differently from a missing item. Never weaken protection to
make background refresh appear reliable.

### 6.2 Upgrade algorithm

1. Install as an update to the same app, not an uninstall/reinstall. Exercise this
   first on synthetic data in a simulator, then a designated disposable device.
2. Enter an initialization barrier: no writes, outbox replay, Watch saved receipts
   or Widget publication before local identity, migration and access guards are
   understood. The Watch transport may durably receive without applying commands.
3. Find paths through the current container APIs. Do not hard-code a simulator UUID.
   Validate database schema, stored versions, record counts and local scope.
4. Open through SQLite with WAL awareness. If a safety copy is required, use the
   SQLite backup API or a verified checkpoint/closed connection; copying only a
   live `.db` can omit unsynced WAL data. Any copy stays protected, backup-excluded
   and inside the applicable scope's purge inventory—not a permanent extra family
   archive. Do not export private test copies to the repository.
5. Decode with explicit validators. Preserve record ID spelling, original
   timestamps/offsets, optional-versus-null distinctions, opaque rowversions and
   decimal-string revisions. Reject unknown/duplicate **domain** fields as the
   current contract does; do not silently drop unreadable pending operations.
6. Use a resumable upgrade journal for any necessary metadata change and for
   cross-store work. SQLite, Keychain, files and notification schedules cannot
   participate in one atomic transaction. Record each phase, fail safely, and
   test process termination before and after every boundary.
7. Restore only permitted same-account cache promptly; background API checks must
   not block ordinary personal startup. Missing/mismatched identity or a deny
   marker must not expose family content. Reauthentication may restore access but
   must not delete local work or claim a different account owns it.
8. Resume queued operations with their original IDs and payloads, after current
   scope/capability checks. Reconcile reminders and Watch receipts idempotently.
   Publish the Widget only from the selected, authorized durable workspace.
9. Mark the upgrade accepted only after round-trip validation and restart tests.
   Keep a tested forward-fix path. Clear temporary copies on acceptance and on
   revocation/account cleanup; never resurrect a revoked snapshot for recovery.

### 6.3 Serialization is a protocol, not a cosmetic detail

Owner creation receipts bind the SHA-256 of the **exact seed JSON UTF-8 bytes**.
Swift `JSONEncoder` can change key order, escaping or number formatting compared
with `JSON.stringify`. Re-encoding a pending legacy seed can invalidate its receipt
or turn a retry into different content under the same operation ID.

- Build golden fixtures from `serializeOwnerSeed()` and current pending journals.
  Preserve/reconstruct the exact legacy serialized seed and test byte-for-byte
  equivalence before permitting replay. A normal unordered dictionary is not an
  adequate compatibility implementation.
- For newly prepared native operations, validate first, persist the actual request
  bytes before sending, compute the digest from the exact embedded seed bytes and
  reuse those bytes for retries. Do not encode a JSON object as a JSON string.
- Test slash/Unicode escaping, numeric spellings, property ordering, optional
  fields, UUID case, trailing-space record IDs and millisecond timestamps. Audit
  operation fingerprints as well as owner seed digests.
- Preserve configuration/account binding construction from the current code;
  syntactically different JSON must not accidentally grant another scope or
  strand an existing account cache.

### 6.4 Rollback constraints

Prefer a **forward-compatible corrective build**, not restoring an old local
snapshot. Once writes, membership changes or server acknowledgments occur, a
snapshot rollback can lose work or restore revoked access. Keeping the old source
and archive is useful but is not itself a safe downgrade mechanism.

A rollback candidate must use a new unused Apple build number, read native-created
storage, understand the current backend/APNs state and pass downgrade-with-pending-
work tests. Do not promise an older Expo binary can safely read future native
formats. Until compatibility is proved, keep the native rollout limited and
freeze incompatible schema/product changes. No rollback may down-migrate SQL or
delete receipt ledgers.

## 7. Auth, family sync and native service implementation

### Authentication and API

Keep the existing tenant/client, CIAM authority and `Family.ReadWrite` delegated
scope. Prove AppAuth system-browser authorization-code + PKCE using
`mylittledays://auth`, `openid profile offline_access` and the current API scope.
Validate state/nonce/redirect handling and discovery trust through the selected
library. Do not introduce a mobile client secret or copy example token logging.

If AppAuth cannot satisfy this tenant's behavior, evaluate **MSAL's
browser-delegated External ID flow** with the same registration. A required
additional redirect must be explicitly documented and added without removing the
old callback. Fully custom native email-OTP screens are optional later work;
[Microsoft distinguishes the two authentication approaches](https://learn.microsoft.com/en-us/entra/external-id/customers/concept-choose-authentication-approach).

Port API DTOs/error handling from `contracts.ts`, `api.ts` and the
[full API contract](FAMILY-API-CONTRACT.md). Use `URLSession` with separate bounded
auth/network timeouts, cancellation and generation checks. Preserve authorization
before cache/304 use, ETags, care-schema header, extras capabilities, watch-write
capability and cross-member completion capability. Never interpret a missing flag
as enabled. Keep legacy schema-1 family handling explicit.

### Family invariants and tests

- Offline personal use needs no account. Sign-in does not consent to upload.
- Creation uploads only the reviewed owner's seed, including supported extras;
  join downloads/replaces after consent, never merges the invitee's history.
- Activation verifies receipt/digest/destination, persists the full snapshot and
  only then executes the resumable personal-data cleanup.
- Port pending lifecycle request recovery, five-place invitation accounting,
  accepted/removed history, ownership transfer, profile permissions and deletion
  progress after sign-out. Do not equate leaving with account deletion.
- Preserve the documented creator/last-editor account-deletion behavior and its
  outstanding policy review; do not silently broaden or narrow deletion.
- Record changes project locally only after durable save; server-confirmed state
  requires a receipt. Keep dependent timer finishes separate from sent starts.
- Preserve author/owner permissions and the narrow cross-member finish exception;
  a caregiver cannot acquire deletion rights via a short-duration timer rule.
- Treat 401/403/revocation, 409 history/operation/capacity conflicts, 412 version
  conflict, 429 backoff and 503 recovery/service states distinctly. Never clear
  work merely to make a conflict disappear.
- Keep scope-specific revocation cleanup, reminders, Watch context and Widget
  invalidation consistent. Offline revocation cannot be detected immediately.

Use shared synthetic fixtures and scenarios from `tests/family-controller.mjs`,
`tests/family-auth.mjs`, `src/*test.ts` and backend tests. Keep old Expo + native
clients interoperating against the same API throughout controlled rollout.

### Watch and Widget integration

Extract `WatchBridgeTransport` and its disk models from the Expo wrapper; retain
protocol schema 1, bounds, ordering, generation/bridge binding and durable receipt
fingerprints. Connect commands to Swift repositories and family operations. Keep
transport-received, phone-saved, sharing-pending and server-shared states distinct.
Retain the existing companion flags and matching bundle/version metadata.

The native dispatcher can process eligible commands when iOS grants execution,
without waiting for JavaScript. This improves the implementation opportunity, not
a guarantee of execution with a force-quit/locked/unreachable phone. Preserve
durable queues and “open on iPhone” recovery. Test old Watch/new phone and delayed
Watch installation. Apple explicitly calls for physical paired-device tests for
[Watch Connectivity](https://developer.apple.com/documentation/WatchConnectivity/transferring-data-with-watch-connectivity).

Move Widget publication out of the Watch wrapper while retaining its common
authorization boundary. No Watch pairing is required to update a Widget. Preserve
kind, snapshot schema, group path, privacy-sensitive rendering, midnight/expiry
entries and invalidation. No credentials, child names/photos or full records in
the group snapshot. Reload on meaningful changes; WidgetKit owns scheduling and
[budgets refreshes](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date/).
Do not promise a continuously live sleep total or immediate removal of an already
rendered system snapshot. Test outside the Xcode debugger too.

### Reminders and StoreKit

Port reminder rules, authorization checks, notification metadata and cleanup
journals before rescheduling. Reconcile existing Expo-created iOS requests by
logical rule/revision; cancel only obsolete owned requests after replacements are
durable. Preserve per-device family opt-in and after-feed recalculation.

Use direct StoreKit 2 products/purchase/updates/unfinished APIs. Verify the exact
transaction, allowlist the three product IDs, serialize processing, distinguish
cancelled/pending/unverified/uncertain results and finish only after processing.
Unfinished transactions remain available until finished; recovery must run even
when the support screen is closed. [Apple transaction model](https://developer.apple.com/documentation/storekit/transaction),
[unfinished transactions](https://developer.apple.com/documentation/storekit/transaction/unfinished).
Test local StoreKit configuration first, then real sandbox/TestFlight. Preserve
no-login, no-entitlement, repeatable tips; do not add a payment backend, receipt
logs, family linkage or Apple Pay entitlement.

## 8. Removing Expo push: backend compatibility work

This is the main necessary server change. The present v2 registration requires an
Expo-formatted token/project ID, and `IPushGateway.Receipt` reflects Expo's ticket
model. Passing an APNs token into that route will fail; renaming a token field is
not a migration.

Proposed implementation, subject to API/schema review in phase P7:

1. Add versioned APNs registration/capability endpoints, for example
   `/v3/push/capabilities` and `/v3/push/installations/{id}`. Keep v2 requests and
   responses unchanged for installed Expo clients.
2. Retain operation ID, installation proof, expected generation, account/grant/
   history binding, consent, locale, categories and 24-hour renewal semantics.
   Add explicit APNs token/environment/provider data. The server fixes/allowlists
   the phone topic; it must not send to arbitrary client-supplied topics.
3. Use an additive DbUp migration. Initially isolate APNs registrations/delivery
   work in new tables so an older Expo-only worker cannot accidentally consume
   them. Reuse tested queue policies, not unsafe old SQL queries. Keep existing
   token ciphertext/AAD, receipts, quotas and immutable migrations unchanged.
   Verify new indexes, permissions, size bounds and zero unexpected pending scripts.
4. Implement `ApnsPushGateway` with pooled HTTP/2/TLS, a protected existing APNs
   signing key and bounded JWT refresh. Separate development sandbox from
   production/TestFlight, using the signed app's APNs environment; EAS profile
   names are not authoritative. [APNs connections](https://developer.apple.com/documentation/usernotifications/establishing-a-connection-to-apns),
   [token-based authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns).
5. Preserve generic twelve-locale content, current actor exclusion, catch-up
   summaries, bounded retries/leases, membership rechecks and recovery gates.
   No provider call under a SQL lock. APNs acceptance is not device delivery;
   there is no Expo-style receipt polling to invent for APNs. Handle invalid
   device tokens, environment/topic mismatch, throttling and transient failure
   separately; re-register on token changes. Never print tokens/private keys.
6. Migrate an existing opted-in installation with a durable handoff: resolve any
   old in-flight request, prove and disable its Expo binding, then register the
   native binding. Do not leave both providers enabled for the same installation
   or fabricate a new secret to bypass ownership. If offline/uncertain, retain
   the intent and show notification setup pending; family records still work.
7. Release schema, compatible backend and then native client, with APNs delivery
   default-off and a disposable acceptance cohort. Keep the legacy Expo sender
   available for old clients; never globally switch them to an unusable token.
8. Retire Expo delivery only after old-client/lease/queue evidence permits it.
   Removing the last Expo service is a separate recorded checkpoint from shipping
   a native app. Do not revoke shared keys or delete the Expo project as cleanup.

If APNs credentials or backend approval are unavailable, continue local native
development with delivery gated off and retain the existing app for notification
users. That is **not full notification parity**. A reduced release requires an
explicit scope decision; it cannot be silently called a completed migration.

## 9. Implementation phases, dependencies and acceptance gates

Effort ranges are planning estimates for an experienced developer familiar with
this code, not measured commitments. Device access, legal setup and review delays
are additional. Re-estimate after the first compatibility spikes.

| Phase | Work and concrete deliverables | Depends on | Exit gate | Effort |
| --- | --- | --- | --- | --- |
| P0 — Baseline | Freeze source/config; catalog current flows, disk/Keychain formats and target entitlements; create synthetic upgrade fixture corpus and parity checklist | None | Every feature/storage key accounted for; existing local three-target build remains reproducible | 2–3 days |
| P1 — Native skeleton | Tracked Xcode project, shared schemes/config, phone launch, existing Watch/Widget embedding, package boundaries, local verification script | P0 | All three compile locally; bundle/group/version checks pass; no RN runtime in native target | 2–4 days |
| P2 — Storage and upgrade | SQLite adapter, validators, legacy Keychain access, path rebasing, byte-stable requests, upgrade journal and purge inventory | P1 | In-place synthetic upgrade with unsynced work, pending activation, reminder cleanup and Watch queue survives termination/restart without loss | 5–8 days |
| P3 — Domain and offline app | Port domain/timer/calendar/growth/play logic; fixture parity; profile, recording, offline persistence and recovery | P2 | All core scenarios match TS expected results; records survive offline restart; no API required | 5–8 days |
| P4 — Phone feature parity | Complete native five-tab screens, all editors, charts, play, import/export, settings, twelve locales and appearance/accessibility | P3 | Feature table passes simulator/UI checks; keyboard and accessibility device gaps explicitly logged | 8–12 days |
| P5 — Auth and family | Early auth spike, native auth/API/sync actors, lifecycle/owner setup/management screens, cache/outbox/conflict/deletion recovery | P2, P3; screens with P4 | Old + native two-client contracts pass; synthetic interrupted/revoked/pending scenarios are durable and isolated | 7–10 days |
| P6 — Watch, Widget, reminders | Extract native bridge services; port command application, access leases, publisher and notification reconciliation | P3, P5 | Existing Swift tests plus new mixed-version/device scenarios pass; no duplicate records/alerts or scope leaks | 4–7 days |
| P7 — Direct APNs | Versioned registration, additive SQL, separate compatible delivery queue, native registration, protected sender and cohort rollout procedure | P5; schema design may start earlier | Local backend SQL tests and real sandbox/production paired-device delivery pass; legacy clients unaffected | 5–8 days |
| P8 — Native coffee | StoreKit 2 coordinator, native support screen, local StoreKit test file and interrupted transaction scenarios | P1, P4 | Simulated purchase tests pass; Apple products/agreements and real sandbox acceptance independently complete | 2–4 days |
| P9 — Release hardening | Upgrade/downgrade-or-forward-fix drills; physical two-phone/Watch/Widget matrix; performance, privacy and accessibility review | P4–P8 | No unresolved data-loss/security defects; all release-critical physical gates pass | 8–12 days |
| P10 — Controlled cutover | Local archive/sign/inspect; direct Apple upload; limited TestFlight acceptance; support/rollback notes; remove native target's Expo dependency | P9 | Apple processing + actual installed acceptance recorded separately; no EAS build required | 2–3 days |

Total indicative implementation: **50–79 developer-days**, approximately 10–16
full-time weeks; reserve around 30% for integration and upgrade findings
(roughly **13–21 weeks including contingency**). This is not a promise that an
agent can replace physical-device testing or compress external review waits.

The critical path is **P0 → P1 → P2 → P3/P5 → P6/P7 → P9 → P10**.
Do an authentication compatibility spike during P1/P2, before investing in all
screens. P4 and P8 can progress once their stable interfaces exist, without
changing shared storage contracts concurrently.

Recommended first milestone: **P0 + P1 and narrow P2/auth spikes**. Demonstrate the
three-target native skeleton, a synthetic legacy database/Keychain read, preserved
pending request bytes and real disposable-account system-browser return. It is
not a production replacement; its result determines whether to proceed unchanged
or adapt the storage/auth strategy.

## 10. Local development, phone testing and TestFlight

### Immediately available while the rewrite is planned

Use the current Expo CLI/Xcode path locally. This still uses Expo libraries but
does not require Expo Go or EAS cloud compute. A local debug app may use Metro;
a locally built Release app includes its bundle and can run without the Mac.
Follow runbook section 19 and the Mac checkpoint; do not regenerate native files
over unreviewed local edits.

### Proposed native workflow

1. Open `apple/MyLittleDays.xcodeproj`; select the real team for Phone, Watch and
   Widget. Keep exact existing identifiers and App Group. Commit shared schemes,
   not user-specific Xcode account state or signing secrets.
2. Connect/trust an iPhone by USB, enable Developer Mode when required, pair it in
   Xcode's Devices and Simulators, then select it and Run. Wi-Fi debugging can be
   enabled after pairing. No Expo Go, Metro or Expo login is needed for this
   native app. Do not overwrite a real user's only data copy with an early build.
3. Pair the Watch to the iPhone, select the Watch scheme/destination and verify
   installation. Add the Widget from the iPhone gallery. They are separate
   acceptance steps, not consequences assumed from a phone launch.
4. For release, freeze SHA/public configuration/dependency resolution, allocate
   an unused build number across all products, archive for generic iOS Device,
   inspect, then upload with Organizer → Distribute App → App Store Connect.
5. Wait for Apple processing/compliance, add intended testers, and perform the
   installed acceptance checklist. External testing may need beta review.
   [Apple upload methods and processing](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/).

Planned command shape (the native project/schemes must be implemented first):

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
xcodebuild -list -project apple/MyLittleDays.xcodeproj
xcodebuild -showdestinations -project apple/MyLittleDays.xcodeproj -scheme MyLittleDays
xcodebuild test -project apple/MyLittleDays.xcodeproj -scheme MyLittleDays \
  -destination 'platform=iOS Simulator,id=<verified-simulator-UDID>'
xcodebuild archive -project apple/MyLittleDays.xcodeproj -scheme MyLittleDays \
  -configuration Release -destination 'generic/platform=iOS' \
  -archivePath 'artifacts/native/MyLittleDays-<version>-<build>.xcarchive'
```

Implement `apple/Scripts/verify-local.sh`, `archive-local.sh` and
`inspect-archive.sh` as later deliverables. They must refuse ambiguous/dirty
release inputs, demo configuration, unapproved service origins, wrong team/IDs,
missing targets, reused build numbers and cloud-build commands. Archive output
must never overwrite a prior candidate. Use the installed `xcodebuild -help` and
Organizer-generated export options rather than copying stale export flags.

Before upload inspect all nested products, entitlements, profiles, expiry, correct
App Group placement, APNs environment, Watch companion ID, versions, privacy
manifests, icons and absence of Apple Pay. Verify signature, retain dSYMs/archive
and SHA-256 of the exact exported IPA. Inspect the target dependency graph and
bundle to confirm no Expo/React/Hermes/JS resources; do not rely only on a filename
search. Build once with Node/Ruby/CocoaPods unavailable on the build PATH.

Local execution is also the default for future Apple tests/archives; do not add
paid hosted macOS CI or Xcode Cloud by assumption. Keep existing Linux contract
checks where useful. A dedicated local/self-hosted runner can be considered later,
but must not expose the developer's signing keychain to untrusted PR code.

## 11. Release acceptance matrix

Use synthetic accounts/data and the actual oldest supported devices where
available. If a runtime/device is unavailable, record the gap; do not count it as
passed. Simulators and mocked providers supplement, not replace, these checks.

| Boundary | Required tests before native cutover |
| --- | --- |
| Upgrade/data | Latest shipping Expo → native in place; older supported storage fixtures; dirty WAL; low disk; corrupt payload; interrupted upgrade; pending create/join/delete; unsynced timer start/finish; no uninstall. |
| Identity/privacy | Signed out, valid/expired/missing/locked Keychain; same/different account; logout during refresh/write; removal offline then reconnect; no family cache resurrection from journal/safety copy. |
| Sync | Two physical phones, one Expo and one native, then both native; concurrent edits/timer completion; lost responses; retries; ETag/care capability; offline process restart; bounded 429/503 recovery. |
| Phone UI | Small/large iPhone and iPad; keyboard-open complete forms; English/Simplified/Traditional Chinese deep checks and all twelve locale smoke checks; light/dark/system; accessibility text, VoiceOver, contrast/motion/transparency. |
| Watch | Small/large supported Watch; paired/unreachable/locked/phone terminated; persisted bottle selection; sub-minute and valid sleep; duplicate/reordered delivery; expiration; logout/switch; staged old/new updates. |
| Widget | Small/medium, no Watch paired, empty/stale/expired/midnight/time-zone, all locales, light/dark/tinted where supported, cold/warm links with an unsaved editor, invalidation outside debugger. |
| Notifications | Permission denied/provisional/allowed, Focus and mirroring, once/daily/after-feed, cleanup failure/retry, token rotation, offline opt-out, no dual-provider duplicates; Debug sandbox and TestFlight production APNs. |
| Purchases | Every product, displayed StoreKit prices, cancel, pending approval, unverified/error, app termination before finish, repeated same-SKU tip, delayed update, sign-out/family change; real Apple sandbox. |
| Packaging/release | All three locally built/signed/embedded, no Expo runtime, correct icons/localizations/privacy declarations; direct Apple upload, processing, tester access and physical install separately recorded. |
| Performance | Compare baseline and native cold/warm/offline start, cache render, edit-save responsiveness, memory and scroll behavior with bounded large synthetic histories; set measured budgets before acceptance. |

Port deterministic unit coverage using XCTest or Swift Testing as supported by
the pinned toolchain. Keep existing Watch (21) and Widget model (6) tests as the
baseline, then expand them. Use injectable clocks, transports and storage failures.
Backend changes require **actual disposable SQL Server** tests; a SQLite substitute
does not prove rowversion/index/locking behavior. Prefer a local supported SQL
Server container on this Intel Mac if available; otherwise use an approved
existing isolated test host. Never point destructive fixtures at Azure production.

## 12. Limits and practical alternatives

| Requirement or obstacle | Reality | Local-first alternative / decision |
| --- | --- | --- |
| Build all three Apple targets locally | Feasible now; current product already demonstrates it | Use native Xcode targets; keep current local Expo release path until parity. |
| Convert React/TypeScript automatically without behavior risk | Not a reliable plan | Port behavior through fixtures and native modules incrementally. A temporary hybrid SwiftUI/RN screen can de-risk a feature, but is not the final no-Expo product. |
| No Expo runtime **and** no Expo service | Feasible for new native clients; old installed clients still need compatibility | Replace push with APNs and signing/upload with Apple tools; retire legacy service use only after controlled migration. |
| Entire system offline/local | Incompatible with shared remote family data, Entra login, remote push and TestFlight | Keep personal logging offline; keep existing remote services for sharing. Local build does not mean a local-only backend. |
| Immediate background sync or a permanently live Widget | iOS/watchOS execution and refresh are scheduled | Durable queues, cached timestamps, expiry states, timeline entries and foreground catch-up; no misleading real-time guarantee. |
| Watch independent of the phone | Not the current product/identity model | Retain paired offline commands and later reconciliation. Independent Watch auth/network/storage is a separate security/product project. |
| Perfect seamless token migration | Depends on access-group/service compatibility and item availability | Prove the narrow Keychain reader; allow explicit same-account reauthentication without losing records or unresolved receipts. |
| Same App ID native and Expo apps side-by-side on one phone | They update/replace the same installed app | Compare on simulators/two devices. A separate test ID/profile only after explicit approval, never a second production listing. |
| No paid Apple account for full TestFlight distribution | Apple distribution membership is still required | Reuse existing membership; simulator/basic local development is not equivalent to complete signing/capability/TestFlight access. [Membership](https://developer.apple.com/programs/whats-included/). |
| Current Intel Mac forever | Today's successful build does not guarantee future SDK/hardware support | Recheck [Xcode requirements](https://developer.apple.com/xcode/system-requirements) and Apple's submission requirements; use a compatible local Apple-silicon Mac if eventually necessary, not a silent paid-cloud fallback. |
| Commerce setup missing | A rewrite cannot accept agreements or make absent StoreKit products work | Account Holder completes the existing runbook steps; use local StoreKit tests meanwhile, without declaring real purchases accepted. |
| APNs private key unavailable | Apple permits only one private-key download. [Key handling](https://developer.apple.com/help/account/keys/create-a-private-key/) | Inspect existing protected backups/managed credentials privately; if no reusable key exists, request approval for an additional appropriate key within quota. Never revoke a working shared key to experiment. |
| Immediate safe downgrade after new writes | Not assured by retaining an old IPA | Preserve legacy-compatible storage initially; otherwise ship a forward fix. Do not restore stale family data. |

Cost outcome: the native path has **no required Expo build/service subscription**.
It does not remove existing Apple membership, applicable purchase commissions,
Azure/SQL/Entra charges, development effort, Mac ownership or electricity costs.
No new recurring service is proposed. Existing subscription cancellation or
cloud-resource resizing remains a separate explicit action.

## 13. Definition of done and handoff

Migration is complete only when:

- Every required row in the parity backlog has passed its relevant automated and
  physical acceptance checks, including existing-installation data preservation.
- The native app, Watch and Widget build/sign/archive on the Mac without Node,
  CocoaPods, React Native, Expo or EAS in their build path or runtime.
- Existing customers retain app identity, authorized history and pending work;
  no permission/consent/integrity rule was silently changed.
- Native notifications work directly through APNs, with backward-compatible
  treatment of remaining Expo installations and documented retirement criteria.
- StoreKit passes real sandbox acceptance. If commerce setup remains blocked,
  report it as outstanding; even an explicitly approved limited release is not
  proof that the complete feature set has been accepted.
- The exact local archive has been uploaded directly to Apple, processed, made
  available to the intended testers and exercised on iPhone, Watch and Widget.
- The runbook contains the actual source/config/toolchain/build evidence, remaining
  limitations and tested forward-fix procedure. Privacy/review metadata matches
  the native binary.

**Next implementation action:** start P0/P1 and the storage/auth spikes. Do not
start a wholesale UI rewrite before the identity/data upgrade risks are tested.
Until implementation is requested, this document is the deliverable; the working
Expo application, Apple records and Azure services remain unchanged.

Manual prerequisites and proposed operational fields are centralized in the
[native-migration runbook checklist](AZURE-MANUAL-SETUP-RUNBOOK.md#native-ios-migration--planned-manual-gates-21-september-2026).
